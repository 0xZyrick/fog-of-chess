/**
 * useLeaderboard.ts
 *
 * Manages local ELO state and the public leaderboard.
 *
 * PRIVACY NOTE:
 *   Your actual ELO rating lives only in localStorage + this hook's state.
 *   The leaderboard stores only your commitment hash and win/loss counts.
 *   Rank is inferred from win count (public proxy) — your real rating is never published.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  EloState,
  LeaderboardEntry,
  STARTING_ELO,
  loadEloState,
  saveEloState,
  applyGameResult,
  generateRatingProof,
  upsertLeaderboardEntry,
  fetchLeaderboard,
  fetchPlayerEntry,
  ratingDelta,
} from './pointsContract';

export interface LeaderboardHookState {
  eloState:      EloState | null;
  entries:       LeaderboardEntry[];
  myEntry:       LeaderboardEntry | null;
  myRank:        number | null;
  isLoading:     boolean;
  isUpdating:    boolean;
  error:         string | null;
  lastDelta:     number | null; // +/- from last game, shown briefly in UI
}

export const useLeaderboard = (address: string | null) => {
  const [state, setState] = useState<LeaderboardHookState>({
    eloState:   null,
    entries:    [],
    myEntry:    null,
    myRank:     null,
    isLoading:  false,
    isUpdating: false,
    error:      null,
    lastDelta:  null,
  });

  // ── Load ELO state + leaderboard on mount / address change ─────────────────
  useEffect(() => {
    if (!address) return;
    setState(prev => ({ ...prev, isLoading: true }));

    Promise.all([
      loadEloState(address),
      fetchLeaderboard(),
      fetchPlayerEntry(address),
    ])
      .then(([eloState, entries, myEntry]) => {
        const myRank = myEntry
          ? entries.findIndex(e => e.address === address) + 1 || null
          : null;
        setState(prev => ({
          ...prev,
          eloState,
          entries,
          myEntry,
          myRank,
          isLoading: false,
        }));
      })
      .catch(e => {
        setState(prev => ({ ...prev, isLoading: false, error: e.message }));
      });
  }, [address]);

  // ── Refresh leaderboard (call after any game) ───────────────────────────────
  const refreshLeaderboard = useCallback(async () => {
    try {
      const [entries, myEntry] = await Promise.all([
        fetchLeaderboard(),
        address ? fetchPlayerEntry(address) : Promise.resolve(null),
      ]);
      setState(prev => {
        const myRank = myEntry
          ? entries.findIndex(e => e.address === address) + 1 || null
          : null;
        return { ...prev, entries, myEntry, myRank };
      });
    } catch (e: any) {
      setState(prev => ({ ...prev, error: e.message }));
    }
  }, [address]);

  // ── recordGameResult ────────────────────────────────────────────────────────
  /**
   * Call this after a game ends. Pass the opponent's address so we can
   * look up their win count as a proxy for their rating in ELO calc.
   *
   * opponentAddress: used to look up opponent's public entry (win count)
   * won: did the local player win?
   */
  const recordGameResult = useCallback(async (
    opponentAddress: string,
    won:             boolean
  ): Promise<number> => {
    if (!address) throw new Error('Not connected');

    setState(prev => ({ ...prev, isUpdating: true, error: null }));

    try {
      const currentElo = state.eloState ?? await loadEloState(address);

      // Look up opponent's inferred rating from their public win count
      // (we use wins*10 + STARTING_ELO as a public proxy since real rating is private)
      const opponentEntry  = await fetchPlayerEntry(opponentAddress);
      const opponentRating = opponentEntry
        ? STARTING_ELO + (opponentEntry.wins - opponentEntry.losses) * 16
        : STARTING_ELO;

      // Compute new ELO
      const update = await applyGameResult(currentElo, opponentRating, won);

      // Generate ZK proof of correct ELO update
      const proof = await generateRatingProof(
        update.oldRating,   currentElo.salt,       currentElo.commitment,
        update.newRating,   update.newSalt,         update.newCommitment,
        opponentRating,     won
      );
      console.log(`ELO proof ${proof.isDevMode ? '(mock)' : '(Groth16)'} — delta: ${update.delta > 0 ? '+' : ''}${update.delta}`);

      // Build updated state
      const newEloState: EloState = {
        rating:      update.newRating,
        salt:        update.newSalt,
        commitment:  update.newCommitment,
        wins:        currentElo.wins   + (won ? 1 : 0),
        losses:      currentElo.losses + (won ? 0 : 1),
        gamesPlayed: currentElo.gamesPlayed + 1,
      };

      // Persist locally (never sends raw rating anywhere)
      saveEloState(address, newEloState);

      // Publish commitment + win/loss counts to leaderboard
      await upsertLeaderboardEntry(address, newEloState, proof);

      setState(prev => ({
        ...prev,
        eloState:   newEloState,
        isUpdating: false,
        lastDelta:  update.delta,
      }));

      // Clear delta display after 5 seconds
      setTimeout(() => setState(prev => ({ ...prev, lastDelta: null })), 5000);

      await refreshLeaderboard();
      return update.delta;

    } catch (e: any) {
      setState(prev => ({ ...prev, isUpdating: false, error: e.message }));
      throw e;
    }
  }, [address, state.eloState, refreshLeaderboard]);

  // ── Helpers for display ─────────────────────────────────────────────────────

  const formatRating = (rating: number): string => rating.toString();

  const winRate = (): string => {
    const elo = state.eloState;
    if (!elo || elo.gamesPlayed === 0) return '—';
    return `${Math.round((elo.wins / elo.gamesPlayed) * 100)}%`;
  };

  const shortAddress = (addr: string): string =>
    `${addr.substring(0, 5)}…${addr.substring(addr.length - 4)}`;

  return {
    ...state,
    recordGameResult,
    refreshLeaderboard,
    formatRating,
    winRate,
    shortAddress,
  };
};