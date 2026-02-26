import { Networks } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { TransactionBuilder } from '@stellar/stellar-sdk';

const CONTRACT_ID = "CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O";
const RPC_URL     = "https://soroban-testnet.stellar.org";
const PROVER_URL  = (import.meta as any).env?.VITE_PROVER_URL || 'http://localhost:3001';

export interface Piece {
  id:          string;
  row:         number;
  col:         number;
  type:        string;
  color:       string;
  salt?:       number;
  commitment?: string | null;
}

export interface ProofResult {
  seal:        string;
  journal:     string;
  isDevMode:   boolean;
}

const PIECE_TYPE_MAP: Record<string, number> = {
  knight: 1, rook: 2, bishop: 3, pawn: 4, queen: 5, king: 6,
};

// ── Commitment ───────────────────────────────────────────────────────────────
export const computeCommitment = async (row: number, col: number, salt: number): Promise<string> => {
  const data = new Uint8Array(6);
  data[0] = row;
  data[1] = col;
  data[2] = (salt >> 24) & 0xff;
  data[3] = (salt >> 16) & 0xff;
  data[4] = (salt >> 8)  & 0xff;
  data[5] =  salt        & 0xff;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
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

  async commitBoard(playerAddress: string, signer: any, pieces: Piece[]): Promise<void> {
    const king = pieces.find(p => p.type === 'king' && p.color === 'white') || pieces[0];
    if (!king?.commitment) throw new Error('Pieces not committed yet');

    console.log('Board commitment (king position hash):', king.commitment);

    try {
      const { Client } = await import('board_commitment_contract');
      const client = new Client({
        publicKey:         playerAddress,
        contractId:        this.contractId,
        networkPassphrase: Networks.TESTNET,
        rpcUrl:            RPC_URL,
      });

      const commitmentBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        commitmentBytes[i] = parseInt(king.commitment.substring(i * 2, i * 2 + 2), 16);
      }

      const tx = await client.commit_board({
        player_id:    playerAddress,
        poseidon_hash: commitmentBytes as any,
      });

      if (!tx.built) { console.warn('commit_board simulation failed — skipping'); return; }

      const result = await signer.signTransaction(tx.built.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      const server = new Server(RPC_URL);
      await server.sendTransaction(
        TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET)
      );
      console.log('Board committed on-chain ✓');
    } catch (e: any) {
      // AlreadyCommitted (error code 1) is fine — just means board was set before
      if (e?.message?.includes('AlreadyCommitted') || e?.message?.includes('"1"') || e?.message?.includes('code: 1')) {
        console.log('Board already committed ✓');
        return;
      }
      // Log but don't throw — game must continue even if commitment fails
      console.warn('commitBoard failed (non-fatal):', e?.message);
    }
  }

  async getProofFromProver(piece: Piece, toRow: number, toCol: number): Promise<ProofResult> {
    if (!piece.commitment || piece.salt === undefined) {
      return this.mockProof(toRow, toCol);
    }

    const pieceTypeNum = PIECE_TYPE_MAP[piece.type];
    if (!pieceTypeNum) return this.mockProof(toRow, toCol);

    try {
      const response = await fetch(`${PROVER_URL}/prove`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_pos:  [piece.row, piece.col],
          end_pos:    [toRow, toCol],
          piece_type: pieceTypeNum,
          salt:       piece.salt,
          commitment: piece.commitment,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`ZK proof ${data.is_dev_mode ? '⚠️ mock' : '✅ real Groth16'}`);
        return { seal: data.seal, journal: data.journal, isDevMode: data.is_dev_mode };
      }
    } catch {
      console.log('Prover not reachable — using mock proof');
    }

    return this.mockProof(toRow, toCol);
  }

  private async mockProof(toRow: number, toCol: number): Promise<ProofResult> {
    console.warn('Using mock proof (local ZK proving too slow for demo)');
    const mockJournal = new Uint8Array([toRow, toCol]);
    const seal = '73c457ba' + Array.from(mockJournal).map(b => b.toString(16).padStart(2,'0')).join('').padEnd(512, '0');
    return {
      seal,
      journal:   Array.from(mockJournal).map(b => b.toString(16).padStart(2,'0')).join(''),
      isDevMode: true,
    };
  }
}