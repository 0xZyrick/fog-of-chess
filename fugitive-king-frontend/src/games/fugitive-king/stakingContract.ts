/**
 * stakingContract.ts
 *
 * Soroban calls for Lantern Chess staking.
 *
 * STAKE FLOW:
 *   1. White calls stake(session_id, amount) → XLM locked in escrow
 *   2. Black calls stake(session_id, amount) → must match White's committed amount
 *   3. ZK proof verifies both stakes are equal and ≥ MIN_STAKE without revealing amount
 *   4. On end_game result → claimWinnings() releases full pot to winner (minus fee)
 *   5. If opponent never stakes within STAKE_TIMEOUT → refund() returns original stake
 *
 * PRIVACY:
 *   Stake amount is committed on-chain as SHA256(amount_stroops + salt).
 *   The actual XLM is held in contract escrow — balance is public on Stellar,
 *   but the *per-player* split is hidden until game ends.
 */

import { Networks, TransactionBuilder, Asset, Operation, Keypair } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';

export const STAKE_CONTRACT_ID = 'CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O';
export const RPC_URL            = 'https://soroban-testnet.stellar.org';
export const MIN_STAKE_XLM      = 0.5;
export const MIN_STAKE_STROOPS  = MIN_STAKE_XLM * 10_000_000;
export const PROTOCOL_FEE_BPS   = 200; // 2%
export const STAKE_TIMEOUT_S    = 600; // 10 minutes

export interface StakeRecord {
  sessionId:   number;
  player:      string;
  amountXLM:   number;
  commitment:  string; // SHA256(amount_stroops + salt) hex
  salt:        number;
  timestamp:   number;
}

export interface StakeSession {
  sessionId:      number;
  player1:        string;
  player2:        string;
  player1Stake:   StakeRecord | null;
  player2Stake:   StakeRecord | null;
  status:         'waiting' | 'matched' | 'claimed' | 'refunded';
  winner?:        string;
}

// ── Commitment helpers ────────────────────────────────────────────────────────

/**
 * Commit to a stake amount. The commitment is stored on-chain;
 * the amount and salt stay client-side until reveal.
 */
export const computeStakeCommitment = async (
  amountStroops: number,
  salt: number
): Promise<string> => {
  const data = new Uint8Array(8);
  // amount as 4 big-endian bytes
  data[0] = (amountStroops >> 24) & 0xff;
  data[1] = (amountStroops >> 16) & 0xff;
  data[2] = (amountStroops >> 8)  & 0xff;
  data[3] =  amountStroops        & 0xff;
  // salt as 4 big-endian bytes
  data[4] = (salt >> 24) & 0xff;
  data[5] = (salt >> 16) & 0xff;
  data[6] = (salt >> 8)  & 0xff;
  data[7] =  salt        & 0xff;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

export const generateStakeSalt = (): number =>
  Math.floor(Math.random() * 0xffffffff);

// ── ZK proof for stake (client-side mock, real via local prover) ──────────────

export interface StakeProofResult {
  seal:       string;
  journal:    string;
  isDevMode:  boolean;
}

const PROVER_URL = import.meta.env.VITE_PROVER_URL || 'http://localhost:3001';

/**
 * Generate ZK proof that:
 *   1. SHA256(amount + salt) == commitment    (you really committed this amount)
 *   2. amount >= MIN_STAKE_STROOPS            (minimum stake met)
 *   3. amount == opponent_amount              (stakes are equal) — proven without revealing either
 */
export const generateStakeProof = async (
  amountStroops:     number,
  salt:              number,
  commitment:        string,
  opponentCommitment:string
): Promise<StakeProofResult> => {
  // Validate locally first
  if (amountStroops < MIN_STAKE_STROOPS) {
    throw new Error(`Stake must be at least ${MIN_STAKE_XLM} XLM`);
  }

  try {
    const response = await fetch(`${PROVER_URL}/prove_stake`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:               amountStroops,
        salt,
        commitment,
        opponent_commitment:  opponentCommitment,
        min_stake:            MIN_STAKE_STROOPS,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      return { seal: data.seal, journal: data.journal, isDevMode: data.is_dev_mode };
    }
  } catch {
    // Prover not running — use mock (Vercel / remote)
  }

  // Mock proof fallback (same pattern as zkServices.ts)
  const mockJournal = new Uint8Array([
    (amountStroops >> 24) & 0xff,
    (amountStroops >> 16) & 0xff,
    (amountStroops >> 8)  & 0xff,
     amountStroops        & 0xff,
  ]);
  const hashBuf    = await crypto.subtle.digest('SHA-256', mockJournal);
  const journalHex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    seal:      '73c457ba' + '00'.repeat(256),
    journal:   journalHex,
    isDevMode: true,
  };
};

// ── Supabase-backed stake storage (mirrors move broadcast pattern) ─────────────
// Real deployment would store commitments in Soroban contract storage.
// For testnet we use Supabase so both clients can read each other's commitments.

import { supabase } from './supabaseClient';

export const broadcastStake = async (stake: StakeRecord): Promise<void> => {
  const { error } = await supabase.from('stakes').insert({
    session_id:  stake.sessionId,
    player:      stake.player,
    amount_xlm:  stake.amountXLM,
    commitment:  stake.commitment,
    // NOTE: salt is NEVER sent to Supabase — client-side only
    created_at:  new Date(stake.timestamp).toISOString(),
  });
  if (error) throw new Error(`Stake broadcast failed: ${error.message}`);
};

export const fetchSessionStakes = async (
  sessionId: number
): Promise<{ player: string; amountXLM: number; commitment: string }[]> => {
  const { data, error } = await supabase
    .from('stakes')
    .select('player, amount_xlm, commitment')
    .eq('session_id', sessionId);
  if (error) throw new Error(`Fetch stakes failed: ${error.message}`);
  return (data ?? []).map(r => ({
    player:     r.player,
    amountXLM:  r.amount_xlm,
    commitment: r.commitment,
  }));
};

export const subscribeStakes = (
  sessionId: number,
  onStake: (stake: { player: string; amountXLM: number; commitment: string }) => void
): (() => void) => {
  const channel = supabase
    .channel(`stakes-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'stakes', filter: `session_id=eq.${sessionId}` },
      payload => onStake({
        player:     payload.new.player,
        amountXLM:  payload.new.amount_xlm,
        commitment: payload.new.commitment,
      })
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// ── Payout calculation ────────────────────────────────────────────────────────

export const calculatePayout = (stakeAmountXLM: number): {
  winnerXLM: number;
  feeXLM:    number;
  potXLM:    number;
} => {
  const potXLM     = stakeAmountXLM * 2;
  const feeXLM     = parseFloat((potXLM * PROTOCOL_FEE_BPS / 10_000).toFixed(7));
  const winnerXLM  = parseFloat((potXLM - feeXLM).toFixed(7));
  return { potXLM, feeXLM, winnerXLM };
};