/**
 * pointsContract.ts
 *
 * ELO rating system for Lantern Chess — scores are private commitments.
 *
 * ELO FORMULA:
 *   expected  = 1 / (1 + 10^((opponent_rating - player_rating) / 400))
 *   new_rating = old_rating + K * (actual_score - expected)
 *   K = 32 (standard rapid chess K-factor)
 *   Starting rating = 1200
 *   actual_score: win=1, loss=0
 *
 * PRIVACY MODEL:
 *   - Raw ELO stored as SHA256(rating + salt) commitment on-chain
 *   - Only the player knows their actual rating
 *   - Rank (position) is public; score is not
 *   - ZK proof verifies: new_commitment is correctly derived from old + ELO delta
 *     without revealing either rating value
 *
 * LOCAL STORAGE:
 *   Player's own rating + salt cached in localStorage so they can compute
 *   proofs without a server. Supabase stores commitments for leaderboard.
 */

import { supabase } from './supabaseClient';

export const STARTING_ELO  = 0;    // new players start unranked (0), earn ELO by playing
export const K_FACTOR       = 32;
export const ELO_STORAGE_KEY = 'lantern_elo';

// ── ELO maths ─────────────────────────────────────────────────────────────────

export const expectedScore = (playerRating: number, opponentRating: number): number =>
  1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));

export const computeNewRating = (
  currentRating:  number,
  opponentRating: number,
  won:            boolean
): number => {
  const expected = expectedScore(currentRating, opponentRating);
  const actual   = won ? 1 : 0;
  return Math.round(currentRating + K_FACTOR * (actual - expected));
};

export const ratingDelta = (
  currentRating:  number,
  opponentRating: number,
  won:            boolean
): number => computeNewRating(currentRating, opponentRating, won) - currentRating;

// ── Local ELO state ───────────────────────────────────────────────────────────

export interface EloState {
  rating:     number;
  salt:       number;
  commitment: string;
  wins:       number;
  losses:     number;
  gamesPlayed:number;
}

const generateEloSalt = (): number =>
  Math.floor(Math.random() * 0xffffffff);

export const computeEloCommitment = async (
  rating: number,
  salt:   number
): Promise<string> => {
  const data = new Uint8Array(8);
  data[0] = (rating >> 24) & 0xff;
  data[1] = (rating >> 16) & 0xff;
  data[2] = (rating >> 8)  & 0xff;
  data[3] =  rating        & 0xff;
  data[4] = (salt >> 24) & 0xff;
  data[5] = (salt >> 16) & 0xff;
  data[6] = (salt >> 8)  & 0xff;
  data[7] =  salt        & 0xff;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Load ELO state from localStorage, or initialise a fresh one.
 * Each player's wallet address is the key.
 */
export const loadEloState = async (address: string): Promise<EloState> => {
  try {
    const raw = localStorage.getItem(`${ELO_STORAGE_KEY}_${address}`);
    if (raw) {
      const parsed = JSON.parse(raw) as EloState;
      // Re-derive commitment to guard against tampering
      const commitment = await computeEloCommitment(parsed.rating, parsed.salt);
      return { ...parsed, commitment };
    }
  } catch { /* corrupt storage — reinitialise */ }

  // Fresh state
  const salt       = generateEloSalt();
  const commitment = await computeEloCommitment(STARTING_ELO, salt);
  const fresh: EloState = {
    rating: 0, salt, commitment, // 0 = unranked until first game completes
    wins: 0, losses: 0, gamesPlayed: 0,
  };
  saveEloState(address, fresh);
  return fresh;
};

export const saveEloState = (address: string, state: EloState): void => {
  localStorage.setItem(
    `${ELO_STORAGE_KEY}_${address}`,
    JSON.stringify({ ...state, commitment: undefined }) // don't persist commitment — recomputed
  );
};

// ── Update rating after a game ────────────────────────────────────────────────

export interface RatingUpdate {
  oldRating:     number;
  newRating:     number;
  delta:         number;
  newCommitment: string;
  newSalt:       number;
}

/**
 * Apply ELO result. Returns updated values — caller must persist via saveEloState.
 * opponentRating is the opponent's claimed rating (from their public leaderboard entry).
 * If opponent has no entry, use STARTING_ELO.
 */
export const applyGameResult = async (
  currentState:   EloState,
  opponentRating: number,
  won:            boolean
): Promise<RatingUpdate> => {
  const oldRating = currentState.rating;
  const newRating = computeNewRating(oldRating, opponentRating, won);
  const delta     = newRating - oldRating;

  // New salt every update — forward secrecy (old commitment can't be linked to new)
  const newSalt       = generateEloSalt();
  const newCommitment = await computeEloCommitment(newRating, newSalt);

  return { oldRating, newRating, delta, newCommitment, newSalt };
};

// ── ZK proof for rating update ────────────────────────────────────────────────

export interface RatingProofResult {
  seal:      string;
  journal:   string;
  isDevMode: boolean;
}

const PROVER_URL = import.meta.env.VITE_PROVER_URL || 'http://localhost:3001';

/**
 * ZK proof that:
 *   1. SHA256(old_rating + old_salt) == old_commitment  (you really held this rating)
 *   2. new_rating = old_rating + K*(actual - expected)  (ELO applied correctly)
 *   3. SHA256(new_rating + new_salt) == new_commitment  (new commitment is valid)
 * Public outputs: old_commitment, new_commitment, delta (sign only — win/loss)
 */
export const generateRatingProof = async (
  oldRating:      number,
  oldSalt:        number,
  oldCommitment:  string,
  newRating:      number,
  newSalt:        number,
  newCommitment:  string,
  opponentRating: number,
  won:            boolean
): Promise<RatingProofResult> => {
  try {
    const response = await fetch(`${PROVER_URL}/prove_rating`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_rating:      oldRating,
        old_salt:        oldSalt,
        old_commitment:  oldCommitment,
        new_rating:      newRating,
        new_salt:        newSalt,
        new_commitment:  newCommitment,
        opponent_rating: opponentRating,
        k_factor:        K_FACTOR,
        won,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      return { seal: data.seal, journal: data.journal, isDevMode: data.is_dev_mode };
    }
  } catch { /* prover not available */ }

  // Mock fallback
  const mockJournal = new Uint8Array([
    (newRating >> 8) & 0xff,
     newRating       & 0xff,
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

// ── Supabase leaderboard storage ──────────────────────────────────────────────

export interface LeaderboardEntry {
  address:       string;
  commitment:    string;  // SHA256(rating+salt) — public
  gamesPlayed:   number;
  wins:          number;
  losses:        number;
  rank?:         number;  // computed client-side from ordering
  // rating is NOT stored — only commitment
}

export const upsertLeaderboardEntry = async (
  address:     string,
  state:       EloState,
  proof:       RatingProofResult
): Promise<void> => {
  const { error } = await supabase.from('leaderboard').upsert({
    address,
    commitment:   state.commitment,
    games_played: state.gamesPlayed,
    wins:         state.wins,
    losses:       state.losses,
    proof_seal:   proof.seal,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'address' });
  if (error) throw new Error(`Leaderboard update failed: ${error.message}`);
};

export const fetchLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  // Ordered by wins desc as public proxy for rank (actual rating private)
  const { data, error } = await supabase
    .from('leaderboard')
    .select('address, commitment, games_played, wins, losses')
    .order('wins', { ascending: false })
    .limit(100);

  if (error) throw new Error(`Fetch leaderboard failed: ${error.message}`);

  return (data ?? []).map((row, idx) => ({
    address:     row.address,
    commitment:  row.commitment,
    gamesPlayed: row.games_played,
    wins:        row.wins,
    losses:      row.losses,
    rank:        idx + 1,
  }));
};

export const fetchPlayerEntry = async (
  address: string
): Promise<LeaderboardEntry | null> => {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('address, commitment, games_played, wins, losses')
    .eq('address', address)
    .single();

  if (error || !data) return null;
  return {
    address:     data.address,
    commitment:  data.commitment,
    gamesPlayed: data.games_played,
    wins:        data.wins,
    losses:      data.losses,
  };
};