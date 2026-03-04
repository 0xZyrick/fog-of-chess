/**
 * spectatorPool.ts
 *
 * Parimutuel spectator betting for Lantern Chess.
 *
 * FAIRNESS RULES (hard-enforced):
 *   1. Player wallets (white + black) are blocked from betting — registered at game start
 *   2. Pool hard cap: MAX_POOL_XLM total across all bets
 *   3. Individual bet cap: MAX_BET_XLM per spectator wallet
 *   4. Bets locked once game starts — no placing or cancelling after lock
 *   5. Payout only releases after MIN_MOVES_FOR_PAYOUT moves played
 *
 * PAYOUT MATH (parimutuel — no house odds):
 *   loser_pot  = sum of all bets on losing side
 *   winner_pot = sum of all bets on winning side
 *   fee        = (loser_pot + winner_pot) × SPECTATOR_FEE_RATE
 *   distributable = loser_pot - fee
 *   each winner gets: their_bet + (their_bet / winner_pot) × distributable
 *
 *   Edge case — everyone bet on the winner (no losers):
 *   → everyone gets their bet back (no winnings, no fee)
 */

import { supabase } from './supabaseClient';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_POOL_XLM          = 50;    // hard cap on total spectator pool
export const MAX_BET_XLM           = 5;     // max any single wallet can bet
export const MIN_BET_XLM           = 0.1;   // floor to prevent spam
export const MIN_MOVES_FOR_PAYOUT  = 10;    // moves before payout unlocks
export const SPECTATOR_FEE_RATE    = 0.03;  // 3% of spectator pool

// ── Types ─────────────────────────────────────────────────────────────────────

export type BetSide = 'white' | 'black';

export interface SpectatorBet {
  id?:          number;
  sessionId:    number;
  bettor:       string;   // wallet address
  side:         BetSide;
  amountXLM:    number;
  placedAt:     number;   // timestamp
  commitment:   string;   // SHA256(amount + salt) — amount private until reveal
}

export interface PoolState {
  sessionId:      number;
  whiteSideXLM:   number;
  blackSideXLM:   number;
  totalXLM:       number;
  betCount:       number;
  isLocked:       boolean;  // true once game starts
  lockedAt?:      number;
  playerAddresses: string[]; // blocked from betting
}

export interface PayoutResult {
  bettor:        string;
  betAmountXLM:  number;
  side:          BetSide;
  payoutXLM:     number;   // 0 if lost
  profitXLM:     number;   // payoutXLM - betAmountXLM
  isWinner:      boolean;
}

export interface PoolPayoutSummary {
  winningSide:      BetSide;
  totalPoolXLM:     number;
  loserPotXLM:      number;
  winnerPotXLM:     number;
  feeXLM:           number;
  distributableXLM: number;
  payouts:          PayoutResult[];
  noContest:        boolean; // true if everyone bet the same side
}

// ── Commitment ────────────────────────────────────────────────────────────────

export const generateBetSalt = (): number =>
  Math.floor(Math.random() * 0xffffffff);

export const computeBetCommitment = async (
  amountStroops: number,
  salt:          number
): Promise<string> => {
  const data = new Uint8Array(8);
  data[0] = (amountStroops >> 24) & 0xff;
  data[1] = (amountStroops >> 16) & 0xff;
  data[2] = (amountStroops >> 8)  & 0xff;
  data[3] =  amountStroops        & 0xff;
  data[4] = (salt >> 24) & 0xff;
  data[5] = (salt >> 16) & 0xff;
  data[6] = (salt >> 8)  & 0xff;
  data[7] =  salt        & 0xff;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// ── Validation ────────────────────────────────────────────────────────────────

export interface BetValidation {
  valid:   boolean;
  reason?: string;
}

export const validateBet = (
  bettor:      string,
  amountXLM:   number,
  poolState:   PoolState,
  existingBet: SpectatorBet | null
): BetValidation => {
  // Rule 1: Players cannot bet
  if (poolState.playerAddresses.includes(bettor)) {
    return { valid: false, reason: 'Players cannot bet on their own game' };
  }

  // Rule 2: Bets locked once game starts
  if (poolState.isLocked) {
    return { valid: false, reason: 'Betting is locked — game has started' };
  }

  // Rule 3: No duplicate bets (one bet per wallet per session)
  if (existingBet) {
    return { valid: false, reason: 'You have already placed a bet on this game' };
  }

  // Rule 4: Amount bounds
  if (amountXLM < MIN_BET_XLM) {
    return { valid: false, reason: `Minimum bet is ${MIN_BET_XLM} XLM` };
  }
  if (amountXLM > MAX_BET_XLM) {
    return { valid: false, reason: `Maximum bet is ${MAX_BET_XLM} XLM per wallet` };
  }

  // Rule 5: Pool cap
  if (poolState.totalXLM + amountXLM > MAX_POOL_XLM) {
    const remaining = MAX_POOL_XLM - poolState.totalXLM;
    if (remaining <= 0) {
      return { valid: false, reason: 'Spectator pool is full' };
    }
    return {
      valid:  false,
      reason: `Pool cap reached. Max you can add: ${remaining.toFixed(2)} XLM`,
    };
  }

  return { valid: true };
};

// ── Payout calculation ────────────────────────────────────────────────────────

export const calculatePayouts = (
  bets:        SpectatorBet[],
  winningSide: BetSide,
  moveCount:   number
): PoolPayoutSummary => {
  // Payout locked until minimum moves played
  if (moveCount < MIN_MOVES_FOR_PAYOUT) {
    return {
      winningSide,
      totalPoolXLM:     0,
      loserPotXLM:      0,
      winnerPotXLM:     0,
      feeXLM:           0,
      distributableXLM: 0,
      payouts:          bets.map(b => ({
        bettor:       b.bettor,
        betAmountXLM: b.amountXLM,
        side:         b.side,
        payoutXLM:    b.amountXLM, // refund if min moves not met
        profitXLM:    0,
        isWinner:     false,
      })),
      noContest: true,
    };
  }

  const loserSide  : BetSide = winningSide === 'white' ? 'black' : 'white';
  const winnerBets  = bets.filter(b => b.side === winningSide);
  const loserBets   = bets.filter(b => b.side === loserSide);
  const winnerPot   = winnerBets.reduce((s, b) => s + b.amountXLM, 0);
  const loserPot    = loserBets.reduce((s, b) => s + b.amountXLM, 0);
  const totalPool   = winnerPot + loserPot;

  // No-contest: everyone bet on the same side
  if (loserPot === 0 || winnerPot === 0) {
    return {
      winningSide,
      totalPoolXLM:     totalPool,
      loserPotXLM:      loserPot,
      winnerPotXLM:     winnerPot,
      feeXLM:           0,
      distributableXLM: 0,
      payouts: bets.map(b => ({
        bettor:       b.bettor,
        betAmountXLM: b.amountXLM,
        side:         b.side,
        payoutXLM:    b.amountXLM, // full refund, no fee
        profitXLM:    0,
        isWinner:     false,
      })),
      noContest: true,
    };
  }

  const fee            = parseFloat((loserPot * SPECTATOR_FEE_RATE).toFixed(7));
  const distributable  = loserPot - fee;

  const payouts: PayoutResult[] = bets.map(b => {
    if (b.side !== winningSide) {
      return { bettor: b.bettor, betAmountXLM: b.amountXLM, side: b.side, payoutXLM: 0, profitXLM: -b.amountXLM, isWinner: false };
    }
    // Winner gets back their bet + proportional share of distributable loser pot
    const share       = b.amountXLM / winnerPot;
    const winnings    = parseFloat((b.amountXLM + share * distributable).toFixed(7));
    return { bettor: b.bettor, betAmountXLM: b.amountXLM, side: b.side, payoutXLM: winnings, profitXLM: winnings - b.amountXLM, isWinner: true };
  });

  return {
    winningSide,
    totalPoolXLM:     totalPool,
    loserPotXLM:      loserPot,
    winnerPotXLM:     winnerPot,
    feeXLM:           fee,
    distributableXLM: distributable,
    payouts,
    noContest:        false,
  };
};

// ── Supabase I/O ──────────────────────────────────────────────────────────────

export const broadcastBet = async (bet: SpectatorBet): Promise<void> => {
  const { error } = await supabase.from('spectator_bets').insert({
    session_id:  bet.sessionId,
    bettor:      bet.bettor,
    side:        bet.side,
    amount_xlm:  bet.amountXLM,
    commitment:  bet.commitment,
    // NOTE: salt NEVER sent — client-side only
    placed_at:   new Date(bet.placedAt).toISOString(),
  });
  if (error) throw new Error(`Bet broadcast failed: ${error.message}`);
};

export const fetchSessionBets = async (
  sessionId: number
): Promise<SpectatorBet[]> => {
  const { data, error } = await supabase
    .from('spectator_bets')
    .select('id, session_id, bettor, side, amount_xlm, commitment, placed_at')
    .eq('session_id', sessionId)
    .order('placed_at', { ascending: true });

  if (error) throw new Error(`Fetch bets failed: ${error.message}`);
  return (data ?? []).map(r => ({
    id:          r.id,
    sessionId:   r.session_id,
    bettor:      r.bettor,
    side:        r.side as BetSide,
    amountXLM:   r.amount_xlm,
    commitment:  r.commitment,
    placedAt:    new Date(r.placed_at).getTime(),
  }));
};

export const fetchMyBet = async (
  sessionId: number,
  bettor:    string
): Promise<SpectatorBet | null> => {
  const { data, error } = await supabase
    .from('spectator_bets')
    .select('*')
    .eq('session_id', sessionId)
    .eq('bettor', bettor)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id:         data.id,
    sessionId:  data.session_id,
    bettor:     data.bettor,
    side:       data.side as BetSide,
    amountXLM:  data.amount_xlm,
    commitment: data.commitment,
    placedAt:   new Date(data.placed_at).getTime(),
  };
};

export const lockPool = async (sessionId: number): Promise<void> => {
  const { error } = await supabase
    .from('spectator_pools')
    .upsert({ session_id: sessionId, locked: true, locked_at: new Date().toISOString() },
             { onConflict: 'session_id' });
  if (error) console.warn('Pool lock failed (non-critical):', error.message);
};

export const recordPayouts = async (
  sessionId: number,
  summary:   PoolPayoutSummary
): Promise<void> => {
  const rows = summary.payouts.map(p => ({
    session_id:    sessionId,
    bettor:        p.bettor,
    payout_xlm:    p.payoutXLM,
    profit_xlm:    p.profitXLM,
    is_winner:     p.isWinner,
    settled_at:    new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('spectator_payouts').insert(rows);
  if (error) console.error('Payout record failed:', error.message);
};

export const subscribePoolBets = (
  sessionId: number,
  onBet:     (bet: SpectatorBet) => void
): (() => void) => {
  const channel = supabase
    .channel(`pool-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'spectator_bets', filter: `session_id=eq.${sessionId}` },
      payload => onBet({
        id:         payload.new.id,
        sessionId:  payload.new.session_id,
        bettor:     payload.new.bettor,
        side:       payload.new.side as BetSide,
        amountXLM:  payload.new.amount_xlm,
        commitment: payload.new.commitment,
        placedAt:   new Date(payload.new.placed_at).getTime(),
      })
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};
