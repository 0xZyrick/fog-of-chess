/**
 * SpectatorPanel.jsx
 *
 * Live spectator betting panel — shown to non-player wallets watching a game.
 * Displays: pool state, odds, bet placement, payout results.
 *
 * SHOWN TO:
 *   - Any wallet that isn't white or black in this session
 *   - Accessible via a shareable game link (e.g. /game?session=12345)
 *
 * PLAYER VIEW:
 *   - Players see the pool summary (how much is bet on them) but cannot interact
 *   - Enforced by isSpectator check in useSpectatorBetting
 */

import React, { useState } from 'react';

// ── Pool bar visualization ────────────────────────────────────────────────────
const PoolBar = ({ whitePct, whiteSideXLM, blackSideXLM, totalXLM }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-end">
      <div className="text-center">
        <div className="text-xs font-bold text-white">♙ White</div>
        <div className="text-[10px] font-mono" style={{ color: '#9ca3af' }}>{whiteSideXLM.toFixed(2)} XLM</div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold tracking-widest uppercase" style={{ color: '#374151' }}>
          {totalXLM.toFixed(2)} XLM pool
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-bold" style={{ color: '#94a3b8' }}>Black ♟</div>
        <div className="text-[10px] font-mono" style={{ color: '#9ca3af' }}>{blackSideXLM.toFixed(2)} XLM</div>
      </div>
    </div>

    {/* Split bar */}
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
        style={{
          width: `${whitePct}%`,
          background: 'linear-gradient(90deg, #e8dcc8, #c4b896)',
        }}
      />
      <div
        className="absolute right-0 top-0 h-full rounded-full transition-all duration-700"
        style={{
          width: `${100 - whitePct}%`,
          background: 'linear-gradient(270deg, #2d3a5e, #1a2035)',
        }}
      />
    </div>
    <div className="flex justify-between text-[9px] font-mono" style={{ color: '#374151' }}>
      <span>{whitePct}%</span>
      <span>{100 - whitePct}%</span>
    </div>
  </div>
);

// ── Odds pill ─────────────────────────────────────────────────────────────────
const OddsPill = ({ label, odds, side, isSelected, onClick, disabled, myBetSide }) => {
  const isMine    = myBetSide === side;
  const baseStyle = {
    background: isSelected
      ? side === 'white'
        ? 'rgba(232,220,200,0.15)'
        : 'rgba(45,58,94,0.5)'
      : 'rgba(255,255,255,0.03)',
    border: `1px solid ${
      isMine
        ? 'rgba(251,191,36,0.4)'
        : isSelected
          ? side === 'white' ? 'rgba(232,220,200,0.3)' : 'rgba(100,116,139,0.3)'
          : 'rgba(255,255,255,0.06)'
    }`,
    color: isMine ? '#fbbf24' : isSelected ? (side === 'white' ? '#e8dcc8' : '#94a3b8') : '#4b5563',
  };

  return (
    <button
      onClick={() => !disabled && !isMine && onClick(side)}
      disabled={disabled || isMine}
      className="flex-1 rounded-xl px-3 py-3 text-center transition-all active:scale-[0.97] disabled:cursor-not-allowed"
      style={baseStyle}
    >
      <div className="text-base mb-0.5">{side === 'white' ? '♙' : '♟'}</div>
      <div className="text-[10px] font-semibold">{label}</div>
      <div className="text-sm font-bold font-mono mt-0.5" style={{ color: isMine ? '#fbbf24' : '#fff' }}>
        {odds}
      </div>
      <div className="text-[8px] tracking-wider uppercase mt-0.5" style={{ color: '#374151' }}>
        {isMine ? 'your bet' : 'return'}
      </div>
    </button>
  );
};

// ── Payout result card ────────────────────────────────────────────────────────
const PayoutCard = ({ payout, myPayout, myBet, winningSide }) => {
  if (!payout) return null;
  const won       = myBet?.side === winningSide;
  const noContest = payout.noContest;

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${won ? 'rgba(52,211,153,0.3)' : noContest ? 'rgba(99,102,241,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
      <div className="px-3 py-2 text-center"
        style={{ background: won ? 'rgba(16,185,129,0.08)' : noContest ? 'rgba(99,102,241,0.06)' : 'rgba(239,68,68,0.06)' }}>
        <div className="text-xl mb-0.5">
          {noContest ? '↩' : won ? '🏆' : '✗'}
        </div>
        <div className="text-sm font-bold" style={{ color: won ? '#34d399' : noContest ? '#818cf8' : '#f87171' }}>
          {noContest ? 'No Contest — Refunded' : won ? 'You Won!' : 'Better luck next time'}
        </div>
      </div>
      {myPayout !== null && (
        <div className="px-3 py-2.5 space-y-1.5" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="flex justify-between text-[10px]">
            <span style={{ color: '#6b7280' }}>Your bet</span>
            <span className="font-mono font-bold" style={{ color: '#9ca3af' }}>{myBet?.amountXLM} XLM</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span style={{ color: '#6b7280' }}>Payout</span>
            <span className="font-mono font-bold text-white">{myPayout.toFixed(4)} XLM</span>
          </div>
          {!noContest && (
            <div className="flex justify-between text-[10px]">
              <span style={{ color: '#6b7280' }}>Profit</span>
              <span className={`font-mono font-bold ${won ? 'text-emerald-400' : 'text-red-400'}`}>
                {won ? '+' : ''}{(myPayout - (myBet?.amountXLM ?? 0)).toFixed(4)} XLM
              </span>
            </div>
          )}
        </div>
      )}
      {!noContest && (
        <div className="px-3 py-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          <div className="flex justify-between text-[8px]" style={{ color: '#1f2937' }}>
            <span>Total pool: {payout.totalPoolXLM.toFixed(2)} XLM</span>
            <span>3% fee: {payout.feeXLM.toFixed(4)} XLM</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Bet list ──────────────────────────────────────────────────────────────────
const BetList = ({ bets }) => {
  if (bets.length === 0) return (
    <div className="text-center py-4 text-[10px]" style={{ color: '#1f2937' }}>
      No bets placed yet
    </div>
  );

  return (
    <div className="space-y-1 max-h-28 overflow-y-auto">
      {bets.map((bet, i) => (
        <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px]">{bet.side === 'white' ? '♙' : '♟'}</span>
            <span className="text-[9px] font-mono" style={{ color: '#4b5563' }}>
              {bet.bettor.substring(0, 5)}…{bet.bettor.substring(bet.bettor.length - 4)}
            </span>
          </div>
          <span className="text-[9px] font-mono font-bold" style={{ color: '#6b7280' }}>
            {bet.amountXLM} XLM
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────
const SpectatorPanel = ({ betting, gameStarted, gameOver }) => {
  const [selectedSide, setSelectedSide] = useState(null);
  const [betAmount,    setBetAmount]     = useState('1');
  const amount  = parseFloat(betAmount) || 0;
  const canBet  = betting.isSpectator && betting.status === 'open' && !betting.poolState?.isLocked;
  const isLocked = betting.poolState?.isLocked || gameStarted;
  const pool     = betting.poolState;

  const handlePlaceBet = async () => {
    if (!selectedSide || !canBet || betting.isPlacing) return;
    try {
      await betting.placeBet(selectedSide, amount);
      setSelectedSide(null);
      setBetAmount('1');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col rounded-xl overflow-hidden"
      style={{ background: '#0c0f1a', border: '1px solid rgba(255,255,255,0.06)' }}>

      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div>
          <div className="text-[11px] font-bold text-white tracking-tight">Spectator Pool</div>
          <div className="text-[8px] tracking-widest uppercase mt-0.5" style={{ color: '#374151' }}>
            Parimutuel · 3% fee · Capped at {betting.MAX_POOL_XLM} XLM
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
          <span className="text-[9px] font-semibold" style={{ color: isLocked ? '#f87171' : '#34d399' }}>
            {isLocked ? 'LOCKED' : 'OPEN'}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">

        {/* Pool state */}
        {pool && pool.totalXLM > 0 ? (
          <PoolBar
            whitePct={betting.whitePct()}
            whiteSideXLM={pool.whiteSideXLM}
            blackSideXLM={pool.blackSideXLM}
            totalXLM={pool.totalXLM}
          />
        ) : (
          <div className="text-center py-2 text-[10px]" style={{ color: '#374151' }}>
            No bets yet — be the first
          </div>
        )}

        {/* Pool cap progress */}
        {pool && (
          <div>
            <div className="flex justify-between text-[8px] mb-1" style={{ color: '#374151' }}>
              <span>Pool capacity</span>
              <span className="font-mono">{pool.totalXLM.toFixed(2)} / {betting.MAX_POOL_XLM} XLM</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((pool.totalXLM / betting.MAX_POOL_XLM) * 100, 100)}%`,
                  background: pool.totalXLM > betting.MAX_POOL_XLM * 0.8
                    ? 'linear-gradient(90deg,#f59e0b,#ef4444)'
                    : 'linear-gradient(90deg,#6366f1,#8b5cf6)',
                }}
              />
            </div>
          </div>
        )}

        {/* Settled payout */}
        {betting.status === 'settled' && (
          <PayoutCard
            payout={betting.payout}
            myPayout={betting.myPayout}
            myBet={betting.myBet}
            winningSide={betting.payout?.winningSide}
          />
        )}

        {/* Player view — cannot bet */}
        {!betting.isSpectator && !gameOver && (
          <div className="text-center py-2 px-3 rounded-lg text-[10px] font-semibold"
            style={{ background: 'rgba(99,102,241,0.06)', color: '#6b7280', border: '1px solid rgba(99,102,241,0.12)' }}>
            🎮 Players cannot bet on their own game
            {pool && pool.totalXLM > 0 && (
              <div className="mt-1 text-[9px]" style={{ color: '#374151' }}>
                {pool.betCount} spectator{pool.betCount !== 1 ? 's' : ''} have bet {pool.totalXLM.toFixed(2)} XLM on this game
              </div>
            )}
          </div>
        )}

        {/* Betting UI — spectators only, pre-game */}
        {betting.isSpectator && betting.status === 'open' && !isLocked && !betting.myBet && (
          <>
            {/* Side selection + odds */}
            <div className="flex gap-2">
              <OddsPill label="White wins" odds={betting.impliedOdds('white')} side="white"
                isSelected={selectedSide === 'white'} onClick={setSelectedSide}
                disabled={!canBet} myBetSide={betting.myBet?.side} />
              <OddsPill label="Black wins" odds={betting.impliedOdds('black')} side="black"
                isSelected={selectedSide === 'black'} onClick={setSelectedSide}
                disabled={!canBet} myBetSide={betting.myBet?.side} />
            </div>

            {/* Amount input */}
            {selectedSide && (
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min={betting.MIN_BET_XLM}
                    max={Math.min(betting.MAX_BET_XLM, betting.remainingCapXLM)}
                    value={betAmount}
                    onChange={e => setBetAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-white font-mono font-bold text-sm outline-none pr-14"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(99,102,241,0.25)' }}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: '#4b5563' }}>XLM</span>
                </div>

                {/* Quick amounts */}
                <div className="flex gap-1">
                  {[0.1, 0.5, 1, Math.min(5, betting.remainingCapXLM)].filter(v => v > 0 && v <= betting.MAX_BET_XLM).map(v => (
                    <button key={v} onClick={() => setBetAmount(String(v))}
                      className="flex-1 py-1 rounded-lg text-[9px] font-bold transition-all active:scale-95"
                      style={{
                        background: parseFloat(betAmount) === v ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                        border:     `1px solid ${parseFloat(betAmount) === v ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.05)'}`,
                        color:      parseFloat(betAmount) === v ? '#818cf8' : '#4b5563',
                      }}>
                      {v}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handlePlaceBet}
                  disabled={!amount || amount < betting.MIN_BET_XLM || amount > betting.MAX_BET_XLM || betting.isPlacing}
                  className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white' }}>
                  {betting.isPlacing
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                        Placing bet…
                      </span>
                    : `Bet ${amount.toFixed(2)} XLM on ${selectedSide === 'white' ? '♙ White' : '♟ Black'}`}
                </button>
              </div>
            )}

            {/* Error */}
            {betting.error && (
              <div className="px-3 py-2 rounded-lg text-[10px] font-semibold"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                ⚠ {betting.error}
              </div>
            )}
          </>
        )}

        {/* Already bet — show confirmation */}
        {betting.myBet && betting.status !== 'settled' && (
          <div className="px-3 py-2.5 rounded-xl text-center"
            style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
            <div className="text-[10px] font-semibold text-white">
              Your bet: {betting.myBet.amountXLM} XLM on {betting.myBet.side === 'white' ? '♙ White' : '♟ Black'}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: '#4b5563' }}>
              {isLocked
                ? `Waiting for result (min ${betting.MIN_MOVES_FOR_PAYOUT} moves)`
                : 'Bet locked in — waiting for game to start'}
            </div>
          </div>
        )}

        {/* Locked — game started */}
        {betting.isSpectator && isLocked && !betting.myBet && betting.status !== 'settled' && (
          <div className="text-center py-2 text-[10px]" style={{ color: '#374151' }}>
            🔒 Betting locked — game in progress
          </div>
        )}

        {/* Bet history */}
        {betting.allBets.length > 0 && betting.status !== 'settled' && (
          <div>
            <div className="text-[8px] tracking-widest uppercase mb-1.5" style={{ color: '#1f2937' }}>
              All bets ({betting.allBets.length})
            </div>
            <BetList bets={betting.allBets} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="text-[8px] text-center" style={{ color: '#1f2937' }}>
          Bets lock at game start · Min {betting.MIN_MOVES_FOR_PAYOUT} moves required · Players cannot bet
        </div>
      </div>
    </div>
  );
};

export default SpectatorPanel;
