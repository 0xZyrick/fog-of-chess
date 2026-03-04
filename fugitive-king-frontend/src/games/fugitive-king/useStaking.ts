/**
 * useStaking.ts
 *
 * Manages the full staking lifecycle:
 *   idle → staking → waiting_opponent → matched → claiming → settled
 *
 * USAGE:
 *   const staking = useStaking(sessionId, address, myColor);
 *   // Before game: await staking.submitStake(1.5)
 *   // After win:   await staking.claimWinnings(winnerAddress)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  StakeRecord,
  MIN_STAKE_XLM,
  MIN_STAKE_STROOPS,
  generateStakeSalt,
  computeStakeCommitment,
  generateStakeProof,
  broadcastStake,
  fetchSessionStakes,
  subscribeStakes,
  calculatePayout,
} from './stakingContract';

export type StakeStatus =
  | 'idle'               // no stake yet
  | 'staking'            // submitting stake tx
  | 'waiting_opponent'   // my stake in, waiting for theirs
  | 'matched'            // both staked — ready to play
  | 'claiming'           // game over, claiming winnings
  | 'settled'            // payout done
  | 'refunded'           // timeout — stake returned
  | 'error';

export interface StakingState {
  status:           StakeStatus;
  myStake:          StakeRecord | null;
  opponentStake:    { amountXLM: number; commitment: string } | null;
  payout:           { winnerXLM: number; feeXLM: number; potXLM: number } | null;
  error:            string | null;
  timeoutSecondsLeft: number;
}

const STAKE_TIMEOUT_S = 600;

export const useStaking = (
  sessionId:   number,
  address:     string | null,
  myColor:     'white' | 'black' | null
) => {
  const [state, setState] = useState<StakingState>({
    status:             'idle',
    myStake:            null,
    opponentStake:      null,
    payout:             null,
    error:              null,
    timeoutSecondsLeft: STAKE_TIMEOUT_S,
  });

  const timeoutRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const myStakeRef  = useRef<StakeRecord | null>(null);

  // ── Timeout countdown once we've staked and are waiting ────────────────────
  useEffect(() => {
    if (state.status !== 'waiting_opponent') return;
    timeoutRef.current = setInterval(() => {
      setState(prev => {
        const next = prev.timeoutSecondsLeft - 1;
        if (next <= 0) {
          // Auto-trigger refund path
          clearInterval(timeoutRef.current!);
          return { ...prev, status: 'refunded', timeoutSecondsLeft: 0 };
        }
        return { ...prev, timeoutSecondsLeft: next };
      });
    }, 1000);
    return () => clearInterval(timeoutRef.current!);
  }, [state.status]);

  // ── Subscribe to opponent stake ─────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || state.status === 'idle') return;

    const unsub = subscribeStakes(sessionId, ({ player, amountXLM, commitment }) => {
      if (player === address) return; // own stake echo

      setState(prev => {
        if (prev.status !== 'waiting_opponent') return prev;
        clearInterval(timeoutRef.current!);
        const payout = calculatePayout(prev.myStake?.amountXLM ?? amountXLM);
        return {
          ...prev,
          status:        'matched',
          opponentStake: { amountXLM, commitment },
          payout,
        };
      });
    });

    // Also poll once in case we joined after opponent staked
    fetchSessionStakes(sessionId).then(stakes => {
      const opponentStake = stakes.find(s => s.player !== address);
      if (opponentStake) {
        setState(prev => {
          if (prev.status !== 'waiting_opponent' || !prev.myStake) return prev;
          clearInterval(timeoutRef.current!);
          const payout = calculatePayout(prev.myStake.amountXLM);
          return {
            ...prev,
            status:        'matched',
            opponentStake: { amountXLM: opponentStake.amountXLM, commitment: opponentStake.commitment },
            payout,
          };
        });
      }
    }).catch(() => {});

    return unsub;
  }, [sessionId, address, state.status]);

  // ── submitStake ─────────────────────────────────────────────────────────────
  const submitStake = useCallback(async (amountXLM: number): Promise<void> => {
    if (!address) throw new Error('Wallet not connected');
    if (amountXLM < MIN_STAKE_XLM) throw new Error(`Minimum stake is ${MIN_STAKE_XLM} XLM`);

    setState(prev => ({ ...prev, status: 'staking', error: null }));

    try {
      const amountStroops = Math.round(amountXLM * 10_000_000);
      const salt          = generateStakeSalt();
      const commitment    = await computeStakeCommitment(amountStroops, salt);

      // Check if opponent already staked — if so, verify amounts match
      const existingStakes = await fetchSessionStakes(sessionId);
      const opponentStake  = existingStakes.find(s => s.player !== address);

      if (opponentStake && Math.abs(opponentStake.amountXLM - amountXLM) > 0.0001) {
        throw new Error(
          `Opponent staked ${opponentStake.amountXLM} XLM — you must match exactly`
        );
      }

      // Generate ZK proof that stake >= minimum and matches opponent (if present)
      const proof = await generateStakeProof(
        amountStroops,
        salt,
        commitment,
        opponentStake?.commitment ?? commitment // self-compare if no opponent yet
      );

      console.log(`Stake proof ${proof.isDevMode ? '(mock)' : '(Groth16)'} generated`);

      const record: StakeRecord = {
        sessionId,
        player:     address,
        amountXLM,
        commitment,
        salt,         // stored client-side only — never sent to Supabase
        timestamp:    Date.now(),
      };

      await broadcastStake(record);
      myStakeRef.current = record;

      const payout       = calculatePayout(amountXLM);
      const newStatus    = opponentStake ? 'matched' : 'waiting_opponent';

      setState(prev => ({
        ...prev,
        status:        newStatus,
        myStake:       record,
        opponentStake: opponentStake
          ? { amountXLM: opponentStake.amountXLM, commitment: opponentStake.commitment }
          : null,
        payout:        opponentStake ? payout : null,
      }));
    } catch (e: any) {
      setState(prev => ({ ...prev, status: 'error', error: e.message }));
      throw e;
    }
  }, [address, sessionId]);

  // ── claimWinnings ───────────────────────────────────────────────────────────
  // In a full Soroban deployment this would call the escrow contract.
  // For testnet we record the claim in Supabase and show the payout UI.
  const claimWinnings = useCallback(async (winnerAddress: string): Promise<void> => {
    if (state.status !== 'matched') return;
    setState(prev => ({ ...prev, status: 'claiming' }));

    try {
      const { error } = await (await import('./supabaseClient')).supabase
        .from('stake_claims')
        .insert({
          session_id:     sessionId,
          winner_address: winnerAddress,
          amount_xlm:     state.payout?.winnerXLM,
          claimed_at:     new Date().toISOString(),
        });
      if (error) throw new Error(error.message);
      setState(prev => ({ ...prev, status: 'settled' }));
    } catch (e: any) {
      setState(prev => ({ ...prev, status: 'error', error: e.message }));
    }
  }, [sessionId, state.status, state.payout]);

  // ── refund ──────────────────────────────────────────────────────────────────
  const requestRefund = useCallback(async (): Promise<void> => {
    // In production: call Soroban refund() after STAKE_TIMEOUT has passed
    setState(prev => ({ ...prev, status: 'refunded' }));
  }, []);

  // ── reset ───────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    clearInterval(timeoutRef.current!);
    myStakeRef.current = null;
    setState({
      status:             'idle',
      myStake:            null,
      opponentStake:      null,
      payout:             null,
      error:              null,
      timeoutSecondsLeft: STAKE_TIMEOUT_S,
    });
  }, []);

  return {
    ...state,
    submitStake,
    claimWinnings,
    requestRefund,
    reset,
    MIN_STAKE_XLM,
  };
};