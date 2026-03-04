/**
 * LeaderboardPanel.jsx
 *
 * Leaderboard display for Lantern Chess.
 *
 * Shows:
 *   - Rank positions (1–50) with wallet addresses
 *   - Win / games stats (public)
 *   - Your rank highlighted, with ELO delta from last game
 *   - Each entry has a commitment hash (proves rank is ZK-verified)
 *   - Score numbers are NEVER shown — privacy by design
 */

import React, { useState } from 'react';


// ── Helpers ───────────────────────────────────────────────────────────────────

const shortAddr = (addr) => addr?.length > 10
  ? `${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}`
  : addr || '—';

const winRate = (wins, total) =>
  total > 0 ? `${Math.round((wins / total) * 100)}%` : '—';

const timeAgo = (ts) => {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const rankStyle = (rank) => {
  if (rank === 1) return { color: '#fbbf24', glow: '0 0 12px rgba(251,191,36,0.5)', medal: '🥇' };
  if (rank === 2) return { color: '#d1d5db', glow: '0 0 8px rgba(209,213,219,0.3)',  medal: '🥈' };
  if (rank === 3) return { color: '#f97316', glow: '0 0 8px rgba(249,115,22,0.3)',   medal: '🥉' };
  return { color: '#6b7280', glow: 'none', medal: null };
};

// ── Row component ─────────────────────────────────────────────────────────────

const LeaderboardRow = ({ entry, isMe, showCommitment }) => {
  const { color, glow, medal } = rankStyle(entry.rank);
  const rate = winRate(entry.wins, entry.gamesPlayed);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        isMe
          ? 'bg-blue-500/10 border-blue-500/30'
          : 'bg-gray-900/50 border-gray-800/50 hover:border-gray-700'
      }`}
    >
      {/* Rank */}
      <div className="w-8 shrink-0 text-center">
        {medal
          ? <span className="text-sm">{medal}</span>
          : <span className="text-xs font-bold" style={{ color }}>#{entry.rank}</span>
        }
      </div>

      {/* Address */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-mono ${isMe ? 'text-blue-300' : 'text-gray-300'}`}>
            {shortAddr(entry.address)}
          </span>
          {isMe && (
            <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">YOU</span>
          )}
        </div>
        {showCommitment && (
          <div className="text-[8px] text-gray-600 font-mono truncate mt-0.5">
            🔐 {entry.commitment?.substring(0, 16)}…
          </div>
        )}
        <div className="text-[9px] text-gray-600 mt-0.5">
          {entry.gamesPlayed}G · {entry.wins}W · {rate} WR · {entry.gamesPlayed + "G total"}
        </div>
      </div>

      {/* ZK verified badge */}
      <div className="shrink-0">
        <div
          className="text-[8px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(124,58,237,0.15)', color: 'rgba(167,139,250,0.8)', border: '1px solid rgba(124,58,237,0.2)' }}
          title="Rank verified by ZK proof on Stellar"
        >
          ZK✓
        </div>
      </div>
    </div>
  );
};

// ── My ELO Status ─────────────────────────────────────────────────────────────

const MyEloCard = ({ myElo, myRank, lastDelta }) => {
  if (!myElo) return null;

  const hasDelta = lastDelta !== null;
  const deltaPos = hasDelta && lastDelta > 0;

  return (
    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Your Stats</span>
        {myRank && (
          <span className="text-[10px] text-blue-400 font-bold">Rank #{myRank}</span>
        )}
        {!myRank && (
          <span className="text-[9px] text-gray-600">Not ranked yet</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* ELO display — number hidden, show tier instead */}
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: eloToColor(myElo.rating) }}>
            {eloToTier(myElo.rating)}
          </div>
          <div className="text-[9px] text-gray-600">Tier</div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-sm font-bold text-green-400">{myElo.wins}</div>
            <div className="text-[9px] text-gray-600">Wins</div>
          </div>
          <div>
            <div className="text-sm font-bold text-red-400">{myElo.losses}</div>
            <div className="text-[9px] text-gray-600">Losses</div>
          </div>
          <div>
            <div className="text-sm font-bold text-gray-300">{myElo.gamesPlayed}</div>
            <div className="text-[9px] text-gray-600">Games</div>
          </div>
        </div>

        {hasDelta && (
          <div className={`text-sm font-bold ${deltaPos ? 'text-green-400' : 'text-red-400'}`}>
            {deltaPos ? '+' : ''}{lastDelta}
          </div>
        )}
      </div>

      {/* Privacy note */}
      <div className="text-[9px] text-gray-600 border-t border-gray-800 pt-2">
        🔐 Your rating is hidden — rank proven by ZK without revealing the number
      </div>
    </div>
  );
};

// ── ELO tier labels (replaces raw numbers in UI) ──────────────────────────────

const eloToTier = (rating) => {
  if (rating >= 2000) return 'MASTER';
  if (rating >= 1800) return 'EXPERT';
  if (rating >= 1600) return 'ADVANCED';
  if (rating >= 1400) return 'SKILLED';
  if (rating >= 1200) return 'STANDARD';
  return 'BEGINNER';
};

const eloToColor = (rating) => {
  if (rating >= 2000) return '#fbbf24';
  if (rating >= 1800) return '#a78bfa';
  if (rating >= 1600) return '#60a5fa';
  if (rating >= 1400) return '#4ade80';
  return '#9ca3af';
};

// ── Main component ────────────────────────────────────────────────────────────

const LeaderboardPanel = ({
  leaderboard,   // useLeaderboard() hook return value
  address,       // current wallet address
  compact,       // true = condensed view (sidebar), false = full modal
  onClose,       // only used in modal mode
}) => {
  const [showCommitments, setShowCommitments] = useState(false);

  // Adapt flat useLeaderboard() shape to what this component expects
  const {
    entries        = [],
    eloState,
    myRank,
    lastDelta,
    isLoading,
    error,
    refreshLeaderboard,
  } = leaderboard ?? {};

  // Map eloState to the myElo shape used by sub-components
  const myElo = eloState ? {
    rating:      eloState.rating,
    wins:        eloState.wins,
    losses:      eloState.losses,
    gamesPlayed: eloState.gamesPlayed,
    winStreak:   0,
  } : null;

  const refresh     = refreshLeaderboard;
  const phase       = error ? 'error' : isLoading ? 'loading' : 'ready';
  const lastUpdated = null;

  const content = (
    <div className="flex flex-col gap-3 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <div className="text-sm font-bold text-white">🏆 Leaderboard</div>
          <div className="text-[9px] text-gray-500">
            Ranks verified by ZK · Scores private
            {lastUpdated && ` · Updated ${timeAgo(lastUpdated)}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCommitments(v => !v)}
            className="text-[9px] px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-400"
            title="Show/hide ZK commitments"
          >
            {showCommitments ? '🔐 Hide' : '🔐 Show'}
          </button>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="text-[9px] px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 disabled:opacity-40"
          >
            {isLoading ? '⟳' : '↻'}
          </button>
          {!compact && onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1">✕</button>
          )}
        </div>
      </div>

      {/* My ELO card */}
      {myElo && address && (
        <MyEloCard myElo={myElo} myRank={myRank} lastDelta={lastDelta} />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-8 text-gray-500 text-xs animate-pulse">Loading leaderboard…</div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
          {error}
        </div>
      )}

      {/* Board */}
      {!isLoading && entries.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          {entries.map(entry => (
            <LeaderboardRow
              key={entry.rank}
              entry={entry}
              isMe={entry.address === address}
              showCommitment={showCommitments}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="text-2xl">♟</div>
            <div className="text-xs text-gray-500">No ranked players yet</div>
            <div className="text-[10px] text-gray-600">Play games to appear here</div>
          </div>
        </div>
      )}

      {/* Privacy footer */}
      {!compact && (
        <div className="shrink-0 text-[9px] text-gray-600 text-center border-t border-gray-800 pt-2">
          Raw ratings are never stored on-chain. Each rank is backed by a Groth16 ZK proof on Stellar Testnet.
        </div>
      )}
    </div>
  );

  // Compact mode — render inline (sidebar / panel)
  if (compact) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col gap-3" style={{ minHeight: '300px', maxHeight: '480px' }}>
        {content}
      </div>
    );
  }

  // Full modal mode
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-5 flex flex-col gap-3"
        style={{
          background:  '#0d1117',
          borderColor: 'rgba(99,102,241,0.3)',
          height:      'min(600px, 90vh)',
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default LeaderboardPanel;