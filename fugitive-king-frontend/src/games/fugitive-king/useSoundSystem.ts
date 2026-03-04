import { useState, useRef, useCallback, useEffect } from 'react';

// ── Tone helpers ──────────────────────────────────────────────────────────────

const NOTE = {
  A2: 110.0, C3: 130.8, D3: 146.8, E3: 164.8, G3: 196.0,
  A3: 220.0, C4: 261.6, D4: 293.7, E4: 329.6, G4: 392.0, A4: 440.0,
};

const createCtx = () => {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch { return null; }
};

const speak = (text: string, rate = 0.92, pitch = 1.0) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate  = rate;
  u.pitch = pitch;
  u.volume = 0.5;
  // Try to pick a deeper voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.toLowerCase().includes('daniel') ||
    v.name.toLowerCase().includes('google uk') ||
    v.name.toLowerCase().includes('male')
  );
  if (preferred) u.voice = preferred;
  window.speechSynthesis.speak(u);
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useSoundSystem = () => {
  const [musicOn, setMusicOn] = useState(false); // off by default — user opts in
  const [voiceOn, setVoiceOn] = useState(false); // off by default

  const ctxRef       = useRef<AudioContext | null>(null);
  const musicNodes   = useRef<AudioNode[]>([]);
  const musicRunning = useRef(false);

  const getCtx = useCallback((): AudioContext | null => {
    if (!ctxRef.current) ctxRef.current = createCtx();
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // ── Stop all music nodes ──────────────────────────────────────────────────
  const stopMusic = useCallback(() => {
    musicRunning.current = false;
    musicNodes.current.forEach(n => {
      try { (n as OscillatorNode).stop?.(); } catch {}
    });
    musicNodes.current = [];
  }, []);

  // ── Play a single tone burst (non-music sound effects) ───────────────────
  const playTone = useCallback((
    freq: number, dur: number, type: OscillatorType = 'sine',
    gainVal = 0.06, delay = 0
  ) => {
    const ctx = getCtx();
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type      = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(gainVal, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur + 0.05);
    } catch {}
  }, [getCtx]);

  // ── Ambient drone loop (intro / gameplay music) ───────────────────────────
  const startAmbientLoop = useCallback((
    baseFreq: number,
    harmonics: number[],
    gain = 0.025
  ) => {
    const ctx = getCtx();
    if (!ctx) return;

    stopMusic();
    musicRunning.current = true;

    const master = ctx.createGain();
    master.gain.value = gain;
    master.connect(ctx.destination);
    musicNodes.current.push(master);

    harmonics.forEach((ratio, i) => {
      try {
        const osc  = ctx.createOscillator();
        const lfo  = ctx.createOscillator();
        const lfoG = ctx.createGain();

        osc.type      = i === 0 ? 'sawtooth' : 'sine';
        osc.frequency.value = baseFreq * ratio;

        // Slow vibrato
        lfo.frequency.value = 0.2 + i * 0.07;
        lfoG.gain.value     = 0.4;
        lfo.connect(lfoG);
        lfoG.connect(osc.frequency);

        const g = ctx.createGain();
        g.gain.value = 0.3 / (i + 1.5);

        osc.connect(g);
        g.connect(master);

        osc.start();
        lfo.start();

        musicNodes.current.push(osc, lfo, lfoG, g);
      } catch {}
    });
  }, [getCtx, stopMusic]);

  // ── Public sound events ───────────────────────────────────────────────────

  const playIntro = useCallback(() => {
    if (musicOn) {
      // Mysterious low drone — A minor feel
      startAmbientLoop(NOTE.A2, [1, 1.5, 2, 2.5, 3], 0.018);
    }
    if (voiceOn) {
      setTimeout(() => speak('Lantern Chess. Zero knowledge fog of war. A game of hidden power.', 0.85, 0.9), 600);
    }
  }, [musicOn, voiceOn, startAmbientLoop]);

  const playGameStart = useCallback(() => {
    if (musicOn) {
      stopMusic();
      // Tenser, rhythmic gameplay drone
      startAmbientLoop(NOTE.D3, [1, 1.498, 2, 2.996, 4], 0.022);
      // Stinger
      [NOTE.D3, NOTE.A3, NOTE.D4].forEach((f, i) => playTone(f, 0.4, 'triangle', 0.06, i * 0.18));
    }
    if (voiceOn) setTimeout(() => speak('Game started. White to move.', 0.9), 400);
  }, [musicOn, voiceOn, startAmbientLoop, stopMusic, playTone]);

  const playMove = useCallback(() => {
    // Quiet click — always plays (no toggle check, it's subtle)
    playTone(NOTE.C4, 0.08, 'square', 0.025);
  }, [playTone]);

  const playCapture = useCallback(() => {
    if (musicOn) {
      playTone(NOTE.G3, 0.12, 'sawtooth', 0.05);
      playTone(NOTE.D3, 0.25, 'sawtooth', 0.04, 0.1);
    }
  }, [musicOn, playTone]);

  const playCheck = useCallback((color: string) => {
    if (musicOn) {
      [NOTE.E4, NOTE.C4, NOTE.E4].forEach((f, i) =>
        playTone(f, 0.2, 'square', 0.06, i * 0.12)
      );
    }
    if (voiceOn) setTimeout(() => speak(`${color} king is in check!`, 1.0, 1.1), 100);
  }, [musicOn, voiceOn, playTone]);

  const playWin = useCallback((color: string) => {
    stopMusic();
    if (musicOn) {
      // Victory fanfare — ascending
      const fanfare = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.A4];
      fanfare.forEach((f, i) => playTone(f, 0.5, 'triangle', 0.08, i * 0.22));
      // Final chord
      [NOTE.C4, NOTE.E4, NOTE.G4].forEach(f => playTone(f, 1.5, 'sine', 0.05, 1.1));
    }
    if (voiceOn) {
      const msg = color === 'White'
        ? 'White wins! The fog has lifted. Well played.'
        : 'Black wins! The darkness conquers. Well played.';
      setTimeout(() => speak(msg, 0.88, 0.95), 300);
    }
  }, [musicOn, voiceOn, stopMusic, playTone]);

  const playAIMove = useCallback(() => {
    playTone(NOTE.C3, 0.1, 'sine', 0.03);
  }, [playTone]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMusic();
      ctxRef.current?.close();
    };
  }, [stopMusic]);

  // ── Toggles ───────────────────────────────────────────────────────────────
  const toggleMusic = useCallback(() => {
    setMusicOn(prev => {
      if (prev) stopMusic();
      return !prev;
    });
  }, [stopMusic]);

  const toggleVoice = useCallback(() => {
    setVoiceOn(prev => {
      if (prev) window.speechSynthesis?.cancel();
      return !prev;
    });
  }, []);

  return {
    musicOn, voiceOn,
    toggleMusic, toggleVoice,
    playIntro, playGameStart, playMove, playCapture,
    playCheck, playWin, playAIMove, stopMusic,
  };
};