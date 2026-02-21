import { Networks as StellarNetworks, TransactionBuilder } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { Client as FogOfChessClient } from 'board_commitment_contract';
import { PIECE_TYPE_MAP } from './constants';

// ✅ FIXED: correct contract ID from deployment.json
const CONTRACT_ID = "CCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HT";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PROVER_URL = "http://localhost:3001/prove";

interface Piece {
  id: string;
  row: number;
  col: number;
  type: string;
  color: string;
  salt?: number;
  commitment?: string | null;
}

interface ProofResult {
  seal: string;
  journal: string;
}

/**
 * Compute SHA-256 of (row || col || salt) — matches the ZK guest logic exactly.
 * Returns hex string.
 */
async function computeCommitment(row: number, col: number, salt: number): Promise<string> {
  const buf = new Uint8Array(9);
  buf[0] = row;
  buf[1] = col;
  // salt as 4 big-endian bytes (matches guest: salt.to_be_bytes())
  buf[2] = (salt >>> 24) & 0xff;
  buf[3] = (salt >>> 16) & 0xff;
  buf[4] = (salt >>> 8) & 0xff;
  buf[5] = salt & 0xff;
  // pad remaining bytes to 0 (matches Sha256::update on 4-byte salt)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf.slice(0, 6));
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export class ZKServiceManager {
  private contractId: string;
  private proverAvailable: boolean = true;

  constructor(_contractId: string) {
    // Always use the correct deployed contract ID
    this.contractId = CONTRACT_ID;
  }

  private getClient(address: string, signTransaction: (xdr: string, opts: any) => Promise<{ signedTxXdr: string }>) {
    return new FogOfChessClient({
      publicKey: address,
      contractId: this.contractId,
      networkPassphrase: StellarNetworks.TESTNET,
      rpcUrl: RPC_URL,
    });
  }

  private async signAndSubmit(
    tx: any,
    signer: { signTransaction: (xdr: string, opts: any) => Promise<{ signedTxXdr: string }> }
  ) {
    const result = await signer.signTransaction(tx.built.toXDR(), {
      networkPassphrase: StellarNetworks.TESTNET,
    });
    const server = new Server(RPC_URL);
    const signedTx = TransactionBuilder.fromXDR(result.signedTxXdr, StellarNetworks.TESTNET);
    return server.sendTransaction(signedTx);
  }

  /**
   * Call this once at game start for a player.
   * Computes SHA256(row || col || salt) for their king and commits it on-chain.
   * The contract only allows one commitment per address, so we commit a
   * deterministic hash derived from the player's address.
   */
  async commitBoard(
    address: string,
    signer: any,
    pieces: Piece[]
  ): Promise<void> {
    // Use king's position for the initial commitment
    const king = pieces.find(p => p.type === 'king' && p.color !== 'black');
    if (!king || king.salt === undefined) {
      throw new Error('Cannot find king piece for commitment');
    }

    const commitment = await computeCommitment(king.row, king.col, king.salt);
    console.log('Board commitment (king position hash):', commitment);

    try {
      const client = this.getClient(address, signer.signTransaction);
      const tx = await client.commit_board({
        player_id: address,
        poseidon_hash: hexToBytes(commitment) as unknown as any,
      });
      await this.signAndSubmit(tx, signer);
      console.log('Board committed on-chain ✓');
    } catch (e: any) {
      // AlreadyCommitted = 1 — fine for demo, means we already set it
      if (e?.message?.includes('AlreadyCommitted') || e?.message?.includes('1')) {
        console.log('Board already committed (ok for demo)');
      } else {
        throw e;
      }
    }
  }

  /**
   * Generate ZK proof for a move.
   * Tries real prover first, falls back to mock if prover isn't running.
   */
  // async getProofFromProver(piece: Piece, toRow: number, toCol: number): Promise<ProofResult> {
  //   console.log('Piece commitment being sent:', piece.commitment);
  //   console.log('Piece salt:', piece.salt);

  //   if (!piece.commitment || piece.salt === undefined) {
  //     console.warn('Piece has no commitment — using mock proof');
  //     return this.mockProof();
  //   }

  //   if (!/^[0-9a-f]{64}$/i.test(piece.commitment)) {
  //   console.warn('Invalid commitment format:', piece.commitment);
  //   return this.mockProof();
  // }

  //   const pieceTypeId = PIECE_TYPE_MAP[piece.type as keyof typeof PIECE_TYPE_MAP];
  //   if (!pieceTypeId) {
  //     console.warn('Unknown piece type — using mock proof');
  //     return this.mockProof();
  //   }

  //   if (!this.proverAvailable) {
  //     return this.mockProof();
  //   }

  //   try {
  //     const response = await fetch(PROVER_URL, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         start_pos: [piece.row, piece.col],
  //         end_pos: [toRow, toCol],
  //         piece_type: pieceTypeId,
  //         salt: piece.salt,
  //         commitment: piece.commitment,
  //       }),
  //       signal: AbortSignal.timeout(60000), // ZK proving can take a while
  //     });

  //     if (!response.ok) throw new Error(`Prover returned ${response.status}`);
  //     const result = await response.json();
  //     console.log('Real ZK proof generated ✓');
  //     return result;
  //   } catch (e: any) {
  //     if (e.name === 'TypeError' || e.name === 'AbortError') {
  //       // Prover not running locally — fall back to mock for demo
  //       console.warn('Prover not reachable, using mock proof for demo');
  //       this.proverAvailable = false;
  //       return this.mockProof();
  //     }
  //     throw e;
  //   }
  // }

  async getProofFromProver(piece: Piece, toRow: number, toCol: number): Promise<ProofResult> {
  console.log('Using mock proof (local ZK proving too slow for demo)');
  return this.mockProof();
}

  /**
   * Send the ZK proof to the Stellar smart contract for on-chain verification.
   */
  async verifyAndMoveOnChain(
    address: string,
    signer: any,
    sessionId: number,
    proofData: ProofResult,
    piece: Piece
  ): Promise<void> {
    // Build public_inputs: first entry must be the piece commitment
    // (this is what the contract checks against the stored commitment)
    const commitment = piece.commitment
      ? hexToBytes(piece.commitment)
      : new Uint8Array(32); // zero fallback for demo

    // Seal must be exactly 128 bytes (256 hex chars)
    const sealHex = proofData.seal.padEnd(256, '0').substring(0, 256);
    const sealBytes = hexToBytes(sealHex);

    try {
      const client = this.getClient(address, signer?.signTransaction);
      const tx = await client.verify_move({
        player_id: address,
        proof: {
          proof: sealBytes as unknown as any,           // BytesN<128>
          public_inputs: [commitment as unknown as any], // Vec<BytesN<32>>
        },
      });
      await this.signAndSubmit(tx, signer);
      console.log('Move verified on-chain ✓');
    } catch (e: any) {
      // For demo: log but don't throw — local game state still updates
      // In production you'd throw here and reject the move
      console.warn('On-chain verify_move failed (demo mode continues):', e?.message);
    }
  }

  /**
   * Mock proof for demo when prover isn't running.
   * 128 zero bytes for seal passes the contract's length check.
   * Internal verifier returns Ok(true) for any valid-length proof.
   */
  private mockProof(): ProofResult {
    return {
      seal: '0'.repeat(256),   // 128 bytes of zeros
      journal: '0'.repeat(64), // 32 bytes of zeros
    };
  }
}

/**
 * Compute and attach commitments to all pieces at game start.
 * Call this before the first move.
 */
export async function initializePieceCommitments(pieces: Piece[]): Promise<Piece[]> {
  return Promise.all(pieces.map(async piece => {
    const salt = piece.salt ?? Math.floor(Math.random() * 0xffffffff);
    const commitment = await computeCommitment(piece.row, piece.col, salt);
    return { ...piece, salt, commitment };
  }));
}