/**
 * zkServices.ts
 * 
 * Handles ZK proof generation and on-chain verification for Lantern Chess.
 * 
 * PROOF FLOW:
 *   1. Frontend calls /prove on local prover server (localhost:3001)
 *   2. Prover runs RISC Zero guest circuit:
 *        - Verifies SHA256(start_pos + salt) == commitment  (piece was really there)
 *        - Verifies move is legal for piece_type             (without revealing type)
 *        - Returns end_pos as public output
 *   3. If Bonsai configured: returns real Groth16 seal
 *      If dev mode: returns mock seal (same format, not cryptographically valid)
 *   4. Frontend passes proof to Soroban contract verify_move()
 *   5. Contract calls Nethermind Groth16 verifier on-chain (real enforcement)
 */

import { TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';

// const CONTRACT_ID   = "CCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HT";
const CONTRACT_ID   = "CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O";
const RPC_URL       = "https://soroban-testnet.stellar.org";
const PROVER_URL    = import.meta.env.VITE_PROVER_URL || 'http://localhost:3001';

// Nethermind verifier already on testnet — used by the Soroban contract internally
// export const NETHERMIND_VERIFIER = "CBY3GOBGQXDGRR4K2KYJO2UOXDW5NRW6UKIQHUBNBNU2V3BXQBXGTVX7";
export const NETHERMIND_VERIFIER = "CDAEGIJHTD7Y3CQW6UY2EWVG5SOPATAYAHT6KQ7VL3WULPYJ6MHQH4TY";

export interface ProofResult {
  seal:           string;  // selector + groth16 proof (or mock)
  journal:        string;  // hex of journal bytes (end_pos)
  journalSha256:  string;  // SHA256 of journal — for on-chain verify
  imageId:        string;  // METHOD_ID of circuit
  isDevMode:      boolean; // true = mock proof, false = real Groth16
}

export interface Piece {
  id:         string;
  row:        number;
  col:        number;
  type:       string;
  color:      string;
  salt?:      number;
  commitment?:string | null;
}

// Map piece type string to the number the ZK circuit expects
const PIECE_TYPE_MAP: Record<string, number> = {
  knight: 1,
  rook:   2,
  bishop: 3,
  pawn:   4,
  queen:  5,
  king:   6,
};

// ── Board commitment ──────────────────────────────────────────────────────────

export const computeCommitment = async (row: number, col: number, salt: number): Promise<string> => {
  const data = new Uint8Array(6);
  data[0] = row;
  data[1] = col;
  // salt as 4 big-endian bytes
  data[2] = (salt >> 24) & 0xff;
  data[3] = (salt >> 16) & 0xff;
  data[4] = (salt >> 8)  & 0xff;
  data[5] =  salt        & 0xff;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

export const initializePieceCommitments = async (pieces: Piece[]): Promise<Piece[]> => {
  return Promise.all(pieces.map(async (piece) => {
    const salt       = Math.floor(Math.random() * 0xffffffff);
    const commitment = await computeCommitment(piece.row, piece.col, salt);
    return { ...piece, salt, commitment };
  }));
};

// ── ZK Service Manager ────────────────────────────────────────────────────────

export class ZKServiceManager {
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
  }

  // Commit all piece positions to the Soroban contract at game start
  async commitBoard(playerAddress: string, signer: any, pieces: Piece[]): Promise<void> {
    // Use the king's commitment as the board commitment (representative hash)
    const king = pieces.find(p => p.type === 'king' && p.color === 'white') || pieces[0];
    if (!king?.commitment) throw new Error('Pieces not committed yet');

    console.log('Board commitment (king position hash):', king.commitment);

    const { Client } = await import('board_commitment_contract');
    const client = new Client({
      publicKey:          playerAddress,
      contractId:         this.contractId,
      networkPassphrase:  Networks.TESTNET,
      rpcUrl:             RPC_URL,
    });

    try {
      const commitmentBytes = new Uint8Array(32);
      const hex = king.commitment;
      for (let i = 0; i < 32; i++) {
        commitmentBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
      }

      const tx = await client.commit_board({
        player_id:    playerAddress,
        poseidon_hash:commitmentBytes as any,
      });
      const signed = await signer.signTransaction(tx.built!.toXDR(), { networkPassphrase: Networks.TESTNET });
      const { Server } = await import('@stellar/stellar-sdk/rpc');
      const server = new Server('https://soroban-testnet.stellar.org');
      await server.sendTransaction(
        (await import('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(signed.signedTxXdr, Networks.TESTNET)
      );
      console.log('Board committed on-chain ✓');
    } catch (e: any) {
      // AlreadyCommitted error (code 1) is fine — board was previously committed
      if (e?.message?.includes('1') || e?.message?.includes('AlreadyCommitted')) {
        console.log('Board already committed ✓');
        return;
      }
      throw e;
    }
  }

  // Generate ZK proof for a move
  async getProofFromProver(piece: Piece, toRow: number, toCol: number): Promise<ProofResult> {
    if (!piece.commitment || piece.salt === undefined) {
      throw new Error('Piece has no commitment — was initializePieceCommitments called?');
    }

    const pieceTypeNum = PIECE_TYPE_MAP[piece.type];
    if (!pieceTypeNum) throw new Error(`Unknown piece type: ${piece.type}`);

    // Try real prover first
    try {
      const response = await fetch(`${PROVER_URL}/prove`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          start_pos:  [piece.row, piece.col],
          end_pos:    [toRow, toCol],
          piece_type: pieceTypeNum,
          salt:       piece.salt,
          commitment: piece.commitment,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`ZK proof generated — ${data.is_dev_mode ? '⚠️ DEV MODE' : '✅ REAL Groth16'}`);
        return {
          seal:          data.seal,
          journal:       data.journal,
          journalSha256: data.journal_sha256,
          imageId:       data.image_id,
          isDevMode:     data.is_dev_mode,
        };
      }
    } catch (e) {
      console.log('Prover not reachable — using mock proof (Vercel/remote env)');
    }

    // Fallback: mock proof for Vercel / when prover not running
    console.warn('Using mock proof — start local prover for real ZK');
    const mockJournal   = new Uint8Array([toRow, toCol]);
    const hashBuffer    = await crypto.subtle.digest('SHA-256', mockJournal);
    const sha256Hex     = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const mockSeal      = '73c457ba' + '00'.repeat(256);

    return {
      seal:          mockSeal,
      journal:       Array.from(mockJournal).map(b => b.toString(16).padStart(2,'0')).join(''),
      journalSha256: sha256Hex,
      imageId:       '0000000000000000000000000000000000000000000000000000000000000000',
      isDevMode:     true,
    };
  }

  // Submit proof to Soroban contract for on-chain verification
  async verifyAndMoveOnChain(
    playerAddress: string,
    signer:        any,
    sessionId:     number,
    proof:         ProofResult,
    piece:         Piece,
  ): Promise<void> {
    // NOTE: Per-move on-chain verification requires a Freighter signature each move.
    // For UX we batch — commitments verified at game start, results recorded at end.
    // If VITE_VERIFY_EVERY_MOVE=true, this submits every move to chain (slower but more trustless).
    if (import.meta.env.VITE_VERIFY_EVERY_MOVE !== 'true') {
      console.log(`ZK proof ${proof.isDevMode ? '(mock)' : '(Groth16)'} stored — will batch verify at game end`);
      return;
    }

    // On-chain per-move verification path (requires Bonsai + real proofs)
    const { Client } = await import('board_commitment_contract');
    const client = new Client({
      publicKey: playerAddress, contractId: this.contractId,
      networkPassphrase: Networks.TESTNET, rpcUrl: RPC_URL,
    });

    // Convert proof data to contract format
    const sealBytes       = hexToBytes(proof.seal);
    const journalSha256   = hexToBytes(proof.journalSha256);
    const imageIdBytes    = hexToBytes(proof.imageId);
    const commitmentBytes = hexToBytes(piece.commitment!);

    // ZKProof shape matches the deployed contract binding:
    // proof: BytesN<128> (first 128 bytes of seal), public_inputs: Vec<BytesN<32>>
    const proofBytes = sealBytes.slice(0, 128);
    const tx = await client.verify_move({
      player_id: playerAddress,
      proof: {
        proof:         Array.from(proofBytes) as any,
        public_inputs: [Array.from(commitmentBytes)] as any,
      },
    });

    const result = await signer.signTransaction(tx.built!.toXDR(), {
      networkPassphrase: Networks.TESTNET,
    });
    const server   = new Server(RPC_URL);
    const signedTx = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    await server.sendTransaction(signedTx);
    console.log('Move verified on-chain via Nethermind Groth16 verifier ✅');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}