/**
 * useSpectatorBetting.ts
 *
 * Hook for spectators (and optionally players watching a live game link).
 *
 * STATE MACHINE:
 *   idle → loading → open (accepting bets) → locked (game started)
 *   → settling (game over + moves check) → settled
 *
 * USED BY:
 *   - SpectatorPanel.jsx for the betting UI
 *   - LanternChess.jsx to lock pool on game start and settle on game end
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SpectatorBet,
  PoolState,
  PoolPayoutSummary,
  BetSide,
  MAX_POOL_XLM,
  MAX_BET_XLM,
  MIN_BET_XLM,
  MIN_MOVES_FOR_PAYOUT,
  generateBetSalt,
  computeBetCommitment,
  validateBet,
  calculatePayouts,
  broadcastBet,
  fetchSessionBets,
  fetchMyBet,
  lockPool,
  recordPayouts,
  subscribePoolBets,
} from './spectatorPool';

export type PoolStatus = 'idle' | 'loading' | 'open' | 'locked' | 'settling' | 'settled' | 'error';

export interface SpectatorBettingState {
  status:       PoolStatus;
  poolState:    PoolState | null;
  allBets:      SpectatorBet[];
  myBet:        SpectatorBet | null;
  payout:       PoolPayoutSummary | null;
  myPayout:     number | null;           // my personal payout amount
  error:        string | null;
  isPlacing:    boolean;
  isSpectator:  boolean;                 // false if this wallet is a player
}

export const useSpectatorBetting = (
  sessionId:        number | null,
  address:          string | null,
  playerAddresses:  string[],            // [white_address, black_address] — blocked from betting
  moveCount:        number,
  gameOver:         boolean,
  winningSide:      BetSide | null
) => {
  const [state, setState] = useState<SpectatorBettingState>({
    status:      'idle',
    poolState:   null,
    allBets:     [],
    myBet:       null,
    payout:      null,
    myPayout:    null,
    error:       null,
    isPlacing:   false,
    isSpectator: true,
  });

  const myBetSaltRef = useRef<number | null>(null);

  // ── Derived: is this wallet a player (blocked from betting)? ───────────────
  const isSpectator = !address || !playerAddresses.includes(address);

  // ── Build pool state from bets ─────────────────────────────────────────────
  const buildPoolState = useCallback((
    bets:    SpectatorBet[],
    locked:  boolean
  ): PoolState => {
    const whiteSide = bets.filter(b => b.side === 'white').reduce((s, b) => s + b.amountXLM, 0);
    const blackSide = bets.filter(b => b.side === 'black').reduce((s, b) => s + b.amountXLM, 0);
    return {
      sessionId:       sessionId ?? 0,
      whiteSideXLM:    parseFloat(whiteSide.toFixed(4)),
      blackSideXLM:    parseFloat(blackSide.toFixed(4)),
      totalXLM:        parseFloat((whiteSide + blackSide).toFixed(4)),
      betCount:        bets.length,
      isLocked:        locked,
      playerAddresses,
    };
  }, [sessionId, playerAddresses]);

  // ── Load initial state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    setState(prev => ({ ...prev, status: 'loading' }));

    Promise.all([
      fetchSessionBets(sessionId),
      address ? fetchMyBet(sessionId, address) : Promise.resolve(null),
    ]).then(([bets, myBet]) => {
      const locked    = gameOver; // locked once game is over too
      const poolState = buildPoolState(bets, locked);
      setState(prev => ({
        ...prev,
        status:      gameOver ? 'locked' : 'open',
        poolState,
        allBets:     bets,
        myBet,
        isSpectator: !address || !playerAddresses.includes(address),
      }));
    }).catch(e => {
      setState(prev => ({ ...prev, status: 'error', error: e.message }));
    });
  }, [sessionId, address]);

  // ── Subscribe to live bet updates ──────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribePoolBets(sessionId, (newBet) => {
      setState(prev => {
        // Ignore own bet echo
        if (newBet.bettor === address && prev.myBet) return prev;
        const allBets   = [...prev.allBets, newBet];
        const poolState = buildPoolState(allBets, prev.poolState?.isLocked ?? false);
        return { ...prev, allBets, poolState };
      });
    });
    return unsub;
  }, [sessionId, address, buildPoolState]);

  // ── Lock pool when game starts (called by LanternChess) ───────────────────
  const lockBetting = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await lockPool(sessionId);
    setState(prev => ({
      ...prev,
      status:    'locked',
      poolState: prev.poolState ? { ...prev.poolState, isLocked: true } : prev.poolState,
    }));
  }, [sessionId]);

  // ── Settle pool when game ends ─────────────────────────────────────────────
  const settlePool = useCallback(async (side: BetSide): Promise<PoolPayoutSummary | null> => {
    if (!sessionId || state.allBets.length === 0) return null;

    setState(prev => ({ ...prev, status: 'settling' }));

    const summary = calculatePayouts(state.allBets, side, moveCount);

    // Record payouts in Supabase
    await recordPayouts(sessionId, summary);

    // Find this wallet's payout
    const myPayout = address
      ? summary.payouts.find(p => p.bettor === address)?.payoutXLM ?? null
      : null;

    setState(prev => ({
      ...prev,
      status:    'settled',
      payout:    summary,
      myPayout,
    }));

    return summary;
  }, [sessionId, state.allBets, moveCount, address]);

  // ── Place bet ─────────────────────────────────────────────────────────────
  const placeBet = useCallback(async (
    side:      BetSide,
    amountXLM: number
  ): Promise<void> => {
    if (!address || !sessionId) throw new Error('Not connected');
    if (!isSpectator)           throw new Error('Players cannot bet on their own game');

    const currentPool = state.poolState;
    const validation  = validateBet(address, amountXLM, currentPool!, state.myBet);
    if (!validation.valid) throw new Error(validation.reason);

    setState(prev => ({ ...prev, isPlacing: true, error: null }));

    try {
      const salt        = generateBetSalt();
      const stroops     = Math.round(amountXLM * 10_000_000);
      const commitment  = await computeBetCommitment(stroops, salt);
      myBetSaltRef.current = salt; // store for ZK proof later

      const bet: SpectatorBet = {
        sessionId,
        bettor:    address,
        side,
        amountXLM,
        commitment,
        placedAt:  Date.now(),
      };

      await broadcastBet(bet);

      setState(prev => {
        const allBets   = [...prev.allBets, bet];
        const poolState = buildPoolState(allBets, prev.poolState?.isLocked ?? false);
        return { ...prev, allBets, poolState, myBet: bet, isPlacing: false };
      });
    } catch (e: any) {
      setState(prev => ({ ...prev, isPlacing: false, error: e.message }));
      throw e;
    }
  }, [address, sessionId, state.poolState, state.myBet, isSpectator, buildPoolState]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    myBetSaltRef.current = null;
    setState({
      status:      'idle',
      poolState:   null,
      allBets:     [],
      myBet:       null,
      payout:      null,
      myPayout:    null,
      error:       null,
      isPlacing:   false,
      isSpectator: true,
    });
  }, []);

  // ── Convenience getters ───────────────────────────────────────────────────
  const remainingCapXLM = parseFloat(
    (MAX_POOL_XLM - (state.poolState?.totalXLM ?? 0)).toFixed(4)
  );

  const impliedOdds = (side: BetSide): string => {
    const pool = state.poolState;
    if (!pool || pool.totalXLM === 0) return '—';
    const sideXLM  = side === 'white' ? pool.whiteSideXLM : pool.blackSideXLM;
    const otherXLM = side === 'white' ? pool.blackSideXLM : pool.whiteSideXLM;
    if (sideXLM === 0) return '∞';
    const ratio = (otherXLM / sideXLM) * (1 - 0.03); // after fee
    return `${ratio.toFixed(2)}×`;
  };

  const whitePct = (): number => {
    const pool = state.poolState;
    if (!pool || pool.totalXLM === 0) return 50;
    return Math.round((pool.whiteSideXLM / pool.totalXLM) * 100);
  };

  return {
    ...state,
    isSpectator,
    placeBet,
    lockBetting,
    settlePool,
    reset,
    remainingCapXLM,
    impliedOdds,
    whitePct,
    MAX_POOL_XLM,
    MAX_BET_XLM,
    MIN_BET_XLM,
    MIN_MOVES_FOR_PAYOUT,
  };
};
