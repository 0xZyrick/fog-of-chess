/**
 * StakeModal.jsx
 *
 * Pre-game staking modal. Shows before game starts.
 * Handles: amount input → ZK proof → Supabase broadcast → matched confirmation.
 */

import React, { useState } from 'react';

const MIN_STAKE = 0.5;

// ── Animated background grid ─────────────────────────────────────────────────
const GridLines = () => (
  <svg className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#7dd3fc" strokeWidth="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />
  </svg>
);

// ── Status badge ──────────────────────────────────────────────────────────────
const StatusBadge = ({ status, timeoutSecondsLeft }) => {
  const configs = {
    idle:             { label: 'Ready to stake',       color: '#60a5fa', dot: '#3b82f6' },
    staking:          { label: 'Generating ZK proof…', color: '#fbbf24', dot: '#f59e0b' },
    waiting_opponent: { label: 'Waiting for opponent', color: '#a78bfa', dot: '#8b5cf6' },
    matched:          { label: 'Stakes matched ✓',     color: '#34d399', dot: '#10b981' },
    error:            { label: 'Error',                 color: '#f87171', dot: '#ef4444' },
  };
  const cfg = configs[status] || configs.idle;

  const formatTime = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: cfg.dot }} />
      <span className="text-[11px] font-semibold tracking-wide" style={{ color: cfg.color }}>
        {cfg.label}
        {status === 'waiting_opponent' && timeoutSecondsLeft > 0 && (
          <span className="ml-1.5 font-mono opacity-70">({formatTime(timeoutSecondsLeft)})</span>
        )}
      </span>
    </div>
  );
};

// ── Payout breakdown ──────────────────────────────────────────────────────────
const PayoutBreakdown = ({ stakeAmount }) => {
  const pot     = stakeAmount * 2;
  const fee     = parseFloat((pot * 0.02).toFixed(4));
  const winner  = parseFloat((pot - fee).toFixed(4));

  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'rgba(99,102,241,0.25)' }}>
      <div className="px-3 py-1.5 text-[9px] font-bold tracking-widest uppercase"
        style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8' }}>
        Payout Preview
      </div>
      <div className="px-3 py-2 space-y-1.5" style={{ background: 'rgba(15,18,30,0.6)' }}>
        {[
          { label: 'Your stake',   value: `${stakeAmount.toFixed(2)} XLM`, dim: true },
          { label: 'Total pot',    value: `${pot.toFixed(2)} XLM`,         dim: true },
          { label: '2% fee',       value: `−${fee} XLM`,                   dim: true },
          { label: 'Winner gets',  value: `${winner.toFixed(2)} XLM`,      dim: false, highlight: true },
        ].map(({ label, value, dim, highlight }) => (
          <div key={label} className="flex justify-between items-center">
            <span className="text-[10px]" style={{ color: dim ? '#6b7280' : '#9ca3af' }}>{label}</span>
            <span className={`text-[10px] font-mono font-bold ${highlight ? 'text-yellow-400' : ''}`}
              style={!highlight ? { color: dim ? '#4b5563' : '#9ca3af' } : {}}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── ZK badge ─────────────────────────────────────────────────────────────────
const ZKBadge = ({ isDevMode }) => (
  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold"
    style={{ background: isDevMode ? 'rgba(251,191,36,0.1)' : 'rgba(16,185,129,0.1)',
             color: isDevMode ? '#fbbf24' : '#34d399',
             border: `1px solid ${isDevMode ? 'rgba(251,191,36,0.2)' : 'rgba(16,185,129,0.2)'}` }}>
    {isDevMode ? '⚠ MOCK PROOF' : '✓ ZK GROTH16'}
  </div>
);

// ── Main modal ────────────────────────────────────────────────────────────────
const StakeModal = ({ staking, onStartGame, onSkip, myColor }) => {
  const [inputAmount, setInputAmount] = useState('1');
  const [proofMode,   setProofMode]   = useState(null); // null | 'mock' | 'real'
  const amount    = parseFloat(inputAmount) || 0;
  const isValid   = amount >= MIN_STAKE;
  const isLoading = staking.status === 'staking';
  const isWaiting = staking.status === 'waiting_opponent';
  const isMatched = staking.status === 'matched';

  const handleStake = async () => {
    if (!isValid || isLoading) return;
    try {
      await staking.submitStake(amount);
    } catch (e) {
      console.error(e);
    }
  };

  // Once matched → auto-proceed after short delay
  React.useEffect(() => {
    if (!isMatched) return;
    const t = setTimeout(() => onStartGame?.(), 2000);
    return () => clearTimeout(t);
  }, [isMatched]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)' }}>

      <div className="relative w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#0c0f1a', border: '1px solid rgba(99,102,241,0.2)',
                 boxShadow: '0 0 80px rgba(99,102,241,0.1)' }}>

        <GridLines />

        {/* Header */}
        <div className="relative px-5 pt-5 pb-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">⚡</span>
                <span className="font-bold text-white text-base tracking-tight">Stake to Play</span>
              </div>
              <p className="text-[10px]" style={{ color: '#6b7280' }}>
                Winner takes both stakes. ZK-verified, Stellar-settled.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={staking.status} timeoutSecondsLeft={staking.timeoutSecondsLeft} />
              {proofMode && <ZKBadge isDevMode={proofMode === 'mock'} />}
            </div>
          </div>

          {/* Color badge */}
          {myColor && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold"
              style={{ background: myColor === 'white' ? 'rgba(241,245,249,0.08)' : 'rgba(30,30,60,0.6)',
                       border: '1px solid rgba(255,255,255,0.08)', color: myColor === 'white' ? '#f1f5f9' : '#94a3b8' }}>
              {myColor === 'white' ? '♙' : '♟'} Playing as {myColor.toUpperCase()}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="relative px-5 py-4 space-y-4">

          {/* Matched state */}
          {isMatched ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2" style={{ filter: 'drop-shadow(0 0 20px rgba(52,211,153,0.6))' }}>✓</div>
              <div className="text-sm font-bold text-emerald-400">Stakes Matched!</div>
              <div className="text-[10px] mt-1" style={{ color: '#6b7280' }}>Both players staked. Starting game…</div>
              {staking.payout && (
                <div className="mt-3 text-xs font-mono font-bold text-yellow-400">
                  Winner receives {staking.payout.winnerXLM} XLM
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Amount input */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#6b7280' }}>
                    Stake Amount
                  </label>
                  <span className="text-[9px]" style={{ color: '#374151' }}>
                    min. {MIN_STAKE} XLM
                  </span>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min={MIN_STAKE}
                    value={inputAmount}
                    onChange={e => setInputAmount(e.target.value)}
                    disabled={isLoading || isWaiting}
                    className="w-full px-4 py-3 rounded-xl text-white font-mono text-lg font-bold outline-none disabled:opacity-40 pr-16"
                    style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${isValid ? 'rgba(99,102,241,0.3)' : 'rgba(239,68,68,0.3)'}` }}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold"
                    style={{ color: '#4b5563' }}>XLM</span>
                </div>

                {/* Quick amount buttons */}
                <div className="flex gap-1.5">
                  {[0.5, 1, 2, 5].map(v => (
                    <button key={v} onClick={() => setInputAmount(String(v))}
                      disabled={isLoading || isWaiting}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-30"
                      style={{
                        background: parseFloat(inputAmount) === v ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${parseFloat(inputAmount) === v ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                        color: parseFloat(inputAmount) === v ? '#818cf8' : '#6b7280',
                      }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payout preview */}
              {isValid && <PayoutBreakdown stakeAmount={amount} />}

              {/* Error */}
              {staking.error && (
                <div className="px-3 py-2 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                  ⚠ {staking.error}
                </div>
              )}

              {/* Waiting state */}
              {isWaiting && (
                <div className="text-center py-2">
                  <div className="text-[10px]" style={{ color: '#6b7280' }}>
                    Waiting for opponent to match your{' '}
                    <span className="font-bold text-white">{staking.myStake?.amountXLM} XLM</span> stake
                  </div>
                  <div className="mt-2 text-[9px]" style={{ color: '#374151' }}>
                    Auto-refund in {Math.floor(staking.timeoutSecondsLeft / 60)}:{String(staking.timeoutSecondsLeft % 60).padStart(2, '0')}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {!isMatched && (
          <div className="relative px-5 pb-5 pt-1 flex flex-col gap-2">
            <button
              onClick={handleStake}
              disabled={!isValid || isLoading || isWaiting}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide transition-all active:scale-[0.98] disabled:opacity-40"
              style={{ background: isValid ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' : 'rgba(255,255,255,0.04)', color: 'white' }}>
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                  Generating ZK Proof…
                </span>
              ) : isWaiting ? (
                '⏳ Waiting for opponent…'
              ) : (
                `⚡ Stake ${isValid ? amount.toFixed(2) : '—'} XLM`
              )}
            </button>

            {!isWaiting && !isLoading && (
              <button onClick={onSkip}
                className="w-full py-2 rounded-xl text-[11px] font-semibold transition-colors"
                style={{ color: '#374151' }}>
                Skip staking — play for free
              </button>
            )}
          </div>
        )}

        {/* ZK footnote */}
        <div className="relative px-5 pb-4 text-[9px] text-center" style={{ color: '#1f2937' }}>
          Stake amount committed via ZK proof · Amount private until game ends
        </div>
      </div>
    </div>
  );
};

export default StakeModal;