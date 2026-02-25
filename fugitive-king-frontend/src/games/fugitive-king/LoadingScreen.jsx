import React, { useState, useEffect } from 'react';

const LoadingScreen = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const steps = [
      { target: 30, delay: 300 },
      { target: 60, delay: 500 },
      { target: 85, delay: 400 },
      { target: 100, delay: 300 },
    ];

    let current = 0;
    const run = () => {
      if (current >= steps.length) {
        setTimeout(() => onComplete?.(), 300);
        return;
      }
      const { target, delay } = steps[current++];
      const start = progress;
      const startTime = Date.now();
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const p = Math.min(elapsed / delay, 1);
        const val = Math.round(start + (target - start) * p);
        setProgress(val);
        if (p < 1) requestAnimationFrame(animate);
        else run();
      };
      requestAnimationFrame(animate);
    };
    run();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
      style={{ background: '#0d1117' }}
    >
      {/* King with fill animation */}
      <div className="relative" style={{ width: 64, height: 64 }}>
        {/* Unfilled king — dim */}
        <div
          className="absolute inset-0 flex items-center justify-center select-none"
          style={{ fontSize: 64, color: 'rgba(255,255,255,0.08)', lineHeight: 1 }}
        >
          ♔
        </div>

        {/* Filled king — clips from bottom up based on progress */}
        <div
          className="absolute inset-0 flex items-center justify-center select-none overflow-hidden"
          style={{
            clipPath: `inset(${100 - progress}% 0 0 0)`,
            transition: 'clip-path 0.1s linear',
            fontSize: 64,
            lineHeight: 1,
          }}
        >
          <span style={{
            color: '#e8dcc8',
            filter: 'drop-shadow(0 0 12px rgba(251,191,36,0.6))',
          }}>
            ♔
          </span>
        </div>
      </div>

      {/* Title */}
      <div className="flex flex-col items-center gap-1">
        <span className="font-bold tracking-widest text-sm text-blue-400">LANTERN CHESS</span>
        <span className="text-[9px] tracking-widest text-gray-600 uppercase">ZK Fog of War · Stellar</span>
      </div>

      {/* Progress bar + percentage */}
      <div className="flex flex-col items-center gap-1.5" style={{ width: 140 }}>
        <div className="w-full h-0.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #3b82f6, #a78bfa)',
              transition: 'width 0.1s linear',
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-gray-600">{progress}%</span>
      </div>
    </div>
  );
};

export default LoadingScreen;
