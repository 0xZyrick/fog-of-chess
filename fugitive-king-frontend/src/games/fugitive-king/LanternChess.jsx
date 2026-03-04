import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useGameLogic } from './useGameLogic';
import { ZKServiceManager, initializePieceCommitments } from './zkServices';
import { INITIAL_PIECES, PIECE_SYMBOLS } from './constants';
import { useWallet } from '../../hooks/useWallet';
import { DevWalletService } from '../../services/devWalletService';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { Client as FogOfChessClient } from 'board_commitment_contract';
import { Networks as StellarNetworks } from '@stellar/stellar-sdk';
import { broadcastMove, subscribeMoves } from './supabaseClient';
import { isValidMove } from './chessLogic';
import { computeCommitment } from './zkServices';
import { useStaking } from './useStaking';
import { useLeaderboard } from './useLeaderboard';
import StakeModal from './StakeModal';
import LeaderboardPanel from './LeaderboardPanel';
import SpectatorPanel from './SpectatorPanel';
import { useSpectatorBetting } from './useSpectatorBetting';
import { useChessAI } from './useChessAI';
import { useSoundSystem } from './useSoundSystem';

const CONTRACT_ID = "CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O";
const RPC_URL     = "https://soroban-testnet.stellar.org";
const zkManager   = new ZKServiceManager(CONTRACT_ID);
const TURN_TIME   = 300;

const createSessionId = () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] || 1; };
const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

const Toast = ({ message, type }) => {
  if (!message) return null;
  const colors = { error:'bg-red-700/90 border-red-500/50 text-red-100', success:'bg-green-700/90 border-green-500/50 text-green-100', zk:'bg-blue-700/90 border-blue-500/50 text-blue-100', chain:'bg-purple-700/90 border-purple-500/50 text-purple-100', default:'bg-gray-800/90 border-gray-600/50 text-gray-100' };
  return <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border backdrop-blur text-xs font-bold shadow-xl pointer-events-none text-center max-w-[80vw] ${colors[type]||colors.default}`}>{message}</div>;
};

// ── Game Over Overlay ─────────────────────────────────────────────────────────
const GameOverOverlay = ({ winner, myColor, sessionId, onPlayAgain, onClose }) => {
  const isWinner = (myColor === 'white' && winner === 'White') || (myColor === 'black' && winner === 'Black');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}>
      <div className="flex flex-col items-center gap-5 px-6 py-8 mx-4 rounded-2xl border max-w-sm w-full text-center"
        style={{ background: '#0f0f0f', borderColor: isWinner ? 'rgba(251,191,36,0.4)' : 'rgba(99,102,241,0.3)' }}>
        <div className="text-5xl" style={{ filter: isWinner ? 'drop-shadow(0 0 20px rgba(251,191,36,0.8))' : 'none' }}>
          {isWinner ? '♔' : '♚'}
        </div>
        <div>
          <div className={`text-2xl font-bold ${isWinner ? 'text-yellow-400' : 'text-gray-300'}`}>
            {isWinner ? 'You Win!' : 'You Lost'}
          </div>
          <div className="text-sm text-gray-500 mt-1">{winner} wins the game</div>
        </div>
        <div className="w-full bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
          <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5">Session</div>
          <div className="text-xs font-mono text-blue-400">{sessionId}</div>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <button onClick={onPlayAgain}
            className="w-full py-3 rounded-xl text-sm font-bold text-white active:scale-95"
            style={{ background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)' }}>
            ♟ Play Again
          </button>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-gray-800 hover:bg-gray-700 text-gray-300 active:scale-95">
            ✕ Close
          </button>
        </div>
        <a href="https://stellar.expert/explorer/testnet/contract/CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O"
          target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-gray-600 hover:text-purple-400 transition-colors">
          🔗 Verify on Stellar
        </a>
      </div>
    </div>
  );
};

const LanternChess = () => {
  const { publicKey: address, isConnected, isConnecting, connectFreighter, connectDev, disconnect, getContractSigner, walletType } = useWallet();
  const { pieces, setPieces, currentPlayer, selectedPieceId, setSelectedPieceId, validateMove, executeMove, kingInCheck, moveCount } = useGameLogic(INITIAL_PIECES);

  const [isVerifying,    setIsVerifying]    = useState(false);
  const [isBoardSealed,  setIsBoardSealed]  = useState(false);
  const [logs,           setLogs]           = useState(['Game started','White to move']);
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const [gameStarted,    setGameStarted]    = useState(false);
  const [gameOver,       setGameOver]       = useState(false);
  const [winner,         setWinner]         = useState(null);
  const [player2Address, setPlayer2Address] = useState('');
  const [joinSessionId,  setJoinSessionId]  = useState('');
  const [invalidMoveMsg, setInvalidMoveMsg] = useState(null);
  const [isCommitting,   setIsCommitting]   = useState(false);
  const [toast,          setToast]          = useState({ message: null, type: 'default' });
  const [isMobile,       setIsMobile]       = useState(false);
  const [whiteTime,      setWhiteTime]      = useState(TURN_TIME);
  const [blackTime,      setBlackTime]      = useState(TURN_TIME);
  const [myColor,        setMyColor]        = useState(null);
  const [isMyTurn,       setIsMyTurn]       = useState(false);
  const [opponentOnline, setOpponentOnline] = useState(false);
  const [activeTab,      setActiveTab]      = useState('board');
  const [sidebarTab,     setSidebarTab]     = useState('game');
  const [sidebarCollapsed,   setSidebarCollapsed]   = useState(false);
  const [leftCollapsed,      setLeftCollapsed]      = useState(false);  // left
  const [leftTab,            setLeftTab]            = useState('mode'); // 'mode' | 'tourn'
  const [aiMode,             setAiMode]             = useState(false);
  const [aiThinking,         setAiThinking]         = useState(false);
  const [soundModalOpen,     setSoundModalOpen]     = useState(false);

  // ── New: staking + leaderboard ────────────────────────────────────────────
  const [showStakeModal,   setShowStakeModal]   = useState(false);
  const [stakingEnabled,   setStakingEnabled]   = useState(false);
  const [showLeaderboard,  setShowLeaderboard]  = useState(false);
  const [opponentAddress,  setOpponentAddress]  = useState(null);

  const [gamePhase, setGamePhase] = useState('entry'); // 'entry' | 'game' | 'tournament'
  const [theme,     setTheme]     = useState('amber');  // 'amber' | 'navy' | 'mono' | 'forest'

  const { pickMove: aiPickMove } = useChessAI();
  const sound = useSoundSystem();

  const staking     = useStaking(sessionId, address, myColor);
  const leaderboard = useLeaderboard(address);

  // Derive player addresses for spectator pool blocking
  // white = whoever started (address when myColor==='white'), black = player2Address
  const [whiteAddress, setWhiteAddress] = useState(null);
  const playerAddressesForPool = [whiteAddress, player2Address].filter(Boolean);

  // Derive winningSide from winner string for spectator settlement
  const winningSide = winner === 'White' ? 'white' : winner === 'Black' ? 'black' : null;

  const spectator = useSpectatorBetting(
    gameStarted ? sessionId : null,
    address,
    playerAddressesForPool,
    moveCount,
    gameOver,
    winningSide
  );

  // refs to avoid stale closures in subscriptions
  const lastProcessedMove  = useRef(-1);
  const sessionIdRef       = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const piecesRef          = useRef(pieces);
  const myColorRef         = useRef(myColor);
  const currentPlayerRef   = useRef(currentPlayer);
  const moveCountRef       = useRef(moveCount);
  const executeMoveRef     = useRef(null);
  const addressRef         = useRef(address);
  const addLogRef          = useRef(null);  // FIX: declared here, not inside callback

  useEffect(() => { piecesRef.current        = pieces;        }, [pieces]);
  useEffect(() => { myColorRef.current       = myColor;       }, [myColor]);
  useEffect(() => { currentPlayerRef.current = currentPlayer; }, [currentPlayer]);
  useEffect(() => { moveCountRef.current     = moveCount;     }, [moveCount]);
  useEffect(() => { executeMoveRef.current   = executeMove;   }, [executeMove]);
  useEffect(() => { addressRef.current       = address;       }, [address]);

  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);

  // Timer — pauses during ZK proof generation
  useEffect(() => {
    if (!gameStarted || gameOver || isVerifying) return;
    const id = setInterval(() => {
      if (currentPlayerRef.current === 'white') {
        setWhiteTime(t => { if (t<=1){ setGameOver(true); setWinner('Black'); return 0; } return t-1; });
      } else {
        setBlackTime(t => { if (t<=1){ setGameOver(true); setWinner('White'); return 0; } return t-1; });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [gameStarted, gameOver, isVerifying]);

  // Supabase subscription — multiplayer only, never AI mode
  useEffect(() => {
    if (!gameStarted) return;
    if (aiMode) return; // AI mode: no Supabase
    const sid = sessionIdRef.current || sessionId;
    const unsub = subscribeMoves(sid, (move) => {
      if (move.move_count <= lastProcessedMove.current) return;
      if (move.player === addressRef.current) return;
      if (!executeMoveRef.current) return; // FIX: guard against stale ref

      lastProcessedMove.current = move.move_count;
      setOpponentOnline(true);

      const currentPieces = piecesRef.current;
      const opponentPiece = currentPieces.find(p => p.row === move.from_row && p.col === move.from_col);
      const targetPiece   = currentPieces.find(p => p.row === move.to_row   && p.col === move.to_col);

      if (opponentPiece) {
        executeMoveRef.current(opponentPiece.id, move.to_row, move.to_col, move.is_capture);
        if (addLogRef.current) addLogRef.current(`Opponent moved → [${move.to_row},${move.to_col}]`);
        setIsMyTurn(true);
      }

      if (move.is_capture && targetPiece?.type === 'king') {
        const mc = myColorRef.current;
        setGameOver(true);
        setWinner(mc === 'white' ? 'Black' : 'White');
        if (addLogRef.current) addLogRef.current(`GAME OVER: ${mc === 'white' ? 'Black' : 'White'} wins!`);
      }
    });
    return unsub;
  }, [gameStarted, aiMode, sessionId]); // eslint-disable-line

  const showToast = useCallback((msg, type='default') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast({ message: null, type: 'default' }), 2800);
  }, []);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev, msg].slice(-15));
    if (window.innerWidth < 768) {
      const type = msg.startsWith('ERROR')||msg.startsWith('INVALID') ? 'error' : msg.startsWith('SUCCESS') ? 'success' : msg.startsWith('ZK') ? 'zk' : msg.startsWith('ON-CHAIN')||msg.startsWith('GAME OVER') ? 'chain' : 'default';
      if (type !== 'default') showToast(msg, type);
    }
  }, [showToast]);
  // FIX: sync ref in useEffect, NOT inside the callback body
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  const showInvalid = (msg) => { setInvalidMoveMsg(msg); showToast(`⚠ ${msg}`, 'error'); setTimeout(() => setInvalidMoveMsg(null), 2500); };

  const getClient = () => new FogOfChessClient({ publicKey: address, contractId: CONTRACT_ID, networkPassphrase: StellarNetworks.TESTNET, rpcUrl: RPC_URL });

  const signAndSubmit = async (tx) => {
    if (!tx.built) throw new Error('Simulation failed');
    const signer = getContractSigner();
    const result = await signer.signTransaction(tx.built.toXDR(), { networkPassphrase: StellarNetworks.TESTNET });
    return new Server(RPC_URL).sendTransaction(TransactionBuilder.fromXDR(result.signedTxXdr, StellarNetworks.TESTNET));
  };

  // ── Real testnet XLM stake payment via Freighter ─────────────────────────
  const ESCROW_ADDRESS = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2GPLET4TQ3FROG6ZD52L'; // testnet escrow

  const sendStakePayment = async (amountXLM) => {
    if (!address) return null;
    try {
      const { Horizon, TransactionBuilder: TB, Asset: A, Networks: N, BASE_FEE, Operation } = await import('@stellar/stellar-sdk');
      const server  = new Horizon.Server('https://horizon-testnet.stellar.org');
      const account = await server.loadAccount(address);
      const tx = new TB(account, { fee: BASE_FEE, networkPassphrase: N.TESTNET })
        .addOperation(Operation.payment({
          destination: ESCROW_ADDRESS,
          asset:       A.native(),
          amount:      String(amountXLM),
        }))
        .setTimeout(30)
        .build();
      const signer   = getContractSigner();
      const signed   = await signer.signTransaction(tx.toXDR(), { networkPassphrase: N.TESTNET });
      const signedTx = TB.fromXDR(signed.signedTxXdr, N.TESTNET);
      const result   = await server.submitTransaction(signedTx);
      return result.hash || 'ok';
    } catch (e) {
      // Freighter not available or user rejected — proceed with Supabase-only mode
      console.warn('Stake payment skipped (dev mode or rejected):', e.message);
      return 'dev-mode';
    }
  };

  // ── Start AI game (solo — no wallet needed) ─────────────────────────────
  const handleStartAI = () => {
    setAiMode(true);
    setMyColor('white');
    myColorRef.current = 'white';
    setIsMyTurn(true);
    setGameStarted(true);
    setGamePhase('game');
    setActiveTab('board');
    setSidebarTab('game');
    setLogs(['AI game started', 'You are White — Good luck!']);
    sound.playGameStart();
  };

  const handleStartGame = async () => {
    if (!address)               { addLog('ERROR: Connect wallet first'); return; }
    if (!player2Address.trim()) { addLog('ERROR: Enter Player 2 address'); return; }
    setAiMode(false); // always multiplayer
    setOpponentAddress(player2Address.trim());
    setShowStakeModal(true);
  };

  const handleConfirmStart = async () => {
    setShowStakeModal(false);
    try {
      setIsCommitting(true);
      addLog('Initializing commitments...');
      const committed = await initializePieceCommitments(pieces);
      setPieces(committed);
      await zkManager.commitBoard(address, getContractSigner(), committed);
      addLog('Starting on-chain...');
      const tx = await getClient().start_game({ session_id: sessionId, player1: address, player2: player2Address.trim() });
      await signAndSubmit(tx);
      setMyColor('white');
      myColorRef.current = 'white';
      setWhiteAddress(address);
      setIsMyTurn(true);
      setGameStarted(true);
      setIsBoardSealed(true);
      setWhiteTime(TURN_TIME); // reset clocks on confirmed start
      setBlackTime(TURN_TIME);
      setActiveTab('board');
      // Lock spectator betting — no more bets once game starts
      spectator.lockBetting().catch(() => {});
      if (staking.status === 'matched') {
        addLog(`ON-CHAIN: Session ${sessionId} started — Staked ${staking.myStake?.amountXLM} XLM — You are WHITE`);
        showToast(`Staked! Game started — ${staking.payout?.potXLM} XLM pot`, 'chain');
      } else {
        addLog(`ON-CHAIN: Session ${sessionId} started — You are WHITE`);
        showToast('Game started! Share Session ID with opponent', 'chain');
      }
    } catch(e) { addLog('ERROR: Failed to start'); console.error(e); }
    finally    { setIsCommitting(false); }
  };

  const handleJoinGame = async () => {
    if (!address)       { addLog('ERROR: Connect wallet first'); return; }
    if (!joinSessionId) { addLog('ERROR: Enter Session ID'); return; }
    setAiMode(false); // always multiplayer
    const sid = Number(joinSessionId);
    setSessionId(sid);
    sessionIdRef.current = sid;
    setMyColor('black');
    myColorRef.current = 'black';
    // Show stake modal — player 2 matches white's stake or skips
    setShowStakeModal(true);
  };

  const handleConfirmJoin = async () => {
    setShowStakeModal(false);
    try {
      setIsCommitting(true);
      addLog('Initializing commitments...');
      const committed = await initializePieceCommitments(pieces);
      setPieces(committed);
      await zkManager.commitBoard(address, getContractSigner(), committed);
      setIsMyTurn(false);
      setGameStarted(true);
      setIsBoardSealed(true);
      setWhiteTime(TURN_TIME); // reset clocks on confirmed join
      setBlackTime(TURN_TIME);
      setActiveTab('board');
      spectator.lockBetting().catch(() => {});
      if (staking.status === 'matched') {
        addLog(`Joined session ${joinSessionId} — Staked ${staking.myStake?.amountXLM} XLM — BLACK — waiting for White…`);
        showToast(`Staked! Waiting for White to move — ${staking.payout?.potXLM} XLM pot`, 'chain');
      } else {
        addLog(`Joined session ${joinSessionId} — You are BLACK — waiting for White…`);
        showToast('Joined! Waiting for White to move…', 'chain');
      }
    } catch(e) { addLog('ERROR: Failed to join'); console.error(e); }
    finally    { setIsCommitting(false); }
  };

  const handleEndGame = async (whiteWon) => {
    if (!address) return;
    const iWon = (myColor === 'white' && whiteWon) || (myColor === 'black' && !whiteWon);

    // 1. Record result on-chain
    try {
      addLog('Recording result on-chain...');
      const tx = await getClient().end_game({ session_id: sessionId, caller: address, player1_won: whiteWon });
      await signAndSubmit(tx);
      addLog('Result recorded on-chain ✓');
    } catch (e) {
      addLog('ERROR: Result rejected — proof mismatch.');
      showToast('⚠ Game result could not be verified on-chain', 'error');
      console.error(e);
    }

    // 2. Claim stake winnings if game was staked
    if (staking.status === 'matched' && iWon) {
      try {
        addLog('Claiming stake winnings...');
        await staking.claimWinnings(address);
        addLog(`SUCCESS: Claimed ${staking.payout?.winnerXLM} XLM ✓`);
        showToast(`🏆 Won ${staking.payout?.winnerXLM} XLM!`, 'chain');
      } catch (e) {
        addLog('ERROR: Stake claim failed');
        console.error(e);
      }
    }

    // 3. Settle spectator pool
    if (winningSide) {
      try {
        const summary = await spectator.settlePool(winningSide);
        if (summary && !summary.noContest && summary.totalPoolXLM > 0) {
          addLog(`Spectator pool settled — ${summary.totalPoolXLM.toFixed(2)} XLM distributed`);
        }
      } catch (e) {
        console.error('Spectator pool settle failed:', e);
      }
    }

    // 4. Update ELO rating (both players)
    if (opponentAddress) {
      try {
        addLog('Updating ELO rating...');
        const delta = await leaderboard.recordGameResult(opponentAddress, iWon);
        const sign  = delta >= 0 ? '+' : '';
        addLog(`ELO: ${leaderboard.eloState?.rating ?? '?'} (${sign}${delta})`);
        showToast(`ELO ${sign}${delta} → ${leaderboard.eloState?.rating ?? '?'}`, iWon ? 'success' : 'default');
      } catch (e) {
        addLog('ERROR: ELO update failed');
        console.error(e);
      }
    }
  };

  const handlePlayAgain = () => {
    setGameOver(false);
    setWinner(null);
    setGameStarted(false);
    setIsBoardSealed(false);
    setMyColor(null);
    myColorRef.current = null;
    setIsMyTurn(false);
    setWhiteTime(TURN_TIME);
    setBlackTime(TURN_TIME);
    setLogs(['Ready for new game']);
    setSelectedPieceId(null);
    setPlayer2Address('');
    setJoinSessionId('');
    setOpponentOnline(false);
    lastProcessedMove.current = -1;
    setSessionId(createSessionId());
    setActiveTab('game');
    // Reset staking for next game
    staking.reset();
    spectator.reset();
    setStakingEnabled(false);
    setOpponentAddress(null);
    setWhiteAddress(null);
    // Refresh leaderboard
    leaderboard.refreshLeaderboard();
  };

  const handleTileClick = async (row, col) => {
    if (isVerifying || isCommitting || gameOver) return;
    if (!gameStarted) { showInvalid('Start or join a game first'); return; }
    if (myColor && !isMyTurn) { showInvalid("Not your turn"); return; }

    const clickedPiece = pieces.find(p => p.row === row && p.col === col);
    const movingPiece  = pieces.find(p => p.id === selectedPieceId);

    if (movingPiece) {
      if (clickedPiece?.color === myColor) { setSelectedPieceId(clickedPiece.id); return; }
      const result = validateMove(movingPiece.id, row, col);
      if (!result.valid) { showInvalid(result.reason||'Invalid move'); setSelectedPieceId(null); return; }

      setIsVerifying(!aiMode); // skip ZK spinner in AI mode
      if (!aiMode) addLog('ZK: Generating proof...');
      try {
        const isCapture = !!(clickedPiece && clickedPiece.color !== myColor);
        const isKingCap = isCapture && clickedPiece?.type === 'king';

        if (!aiMode) {
          // Multiplayer: ZK proof + Supabase broadcast
          const proof = await zkManager.getProofFromProver(movingPiece, row, col);
          await broadcastMove({
            session_id: sessionIdRef.current, player: address,
            from_row: movingPiece.row, from_col: movingPiece.col,
            to_row: row, to_col: col,
            is_capture: isCapture, move_count: moveCountRef.current + 1, proof_seal: proof.seal,
          });
        }

        executeMove(movingPiece.id, row, col, isCapture);
        if (!isCapture) setTimeout(() => {
          if (kingInCheck) sound.playCheck(currentPlayerRef.current === 'white' ? 'Black' : 'White');
        }, 100);
        lastProcessedMove.current = moveCountRef.current + 1;

        // Only recompute ZK commitment in multiplayer — AI doesn't need it
        if (!aiMode) {
          const newSalt = Math.floor(Math.random() * 0xffffffff);
          const newCommitment = await computeCommitment(row, col, newSalt);
          setPieces(prev => prev.map(p =>
            p.id === movingPiece.id ? { ...p, salt: newSalt, commitment: newCommitment } : p
          ));
        }
        setIsMyTurn(false);
        // AI responds if in AI mode
        if (aiMode) {
          setAiThinking(true);
          setTimeout(() => {
            const currentPieces = piecesRef.current;
            const move = aiPickMove(currentPieces);
            if (move) {
              const target = currentPieces.find(p => p.row === move.toRow && p.col === move.toCol);
              executeMoveRef.current?.(move.pieceId, move.toRow, move.toCol, move.isCapture);
              sound.playAIMove();
              if (move.isCapture) sound.playCapture();
              const isKingKill = target?.type === 'king';
              if (isKingKill) {
                setGameOver(true); setWinner('Black');
                sound.playWin('Black');
                addLogRef.current?.('GAME OVER: Black (AI) wins!');
              } else {
                setIsMyTurn(true);
                addLogRef.current?.('AI moved');
              }
            }
            setAiThinking(false);
          }, 600 + Math.random() * 800);
        }
        if (isCapture) sound.playCapture(); else sound.playMove();
        addLog(isCapture ? 'SUCCESS: Move sent — piece captured!' : 'SUCCESS: Move sent ✓');

        if (isKingCap) {
          const whiteWon = myColor === 'white';
          setGameOver(true); setWinner(whiteWon ? 'White' : 'Black');
          sound.playWin(whiteWon ? 'White' : 'Black');
          addLog(`GAME OVER: ${whiteWon ? 'White' : 'Black'} wins!`);
          await handleEndGame(whiteWon);
        }
      } catch(e) { console.error(e); addLog('ERROR: Move failed.'); }
      finally    { setIsVerifying(false); }
    } else if (clickedPiece?.color === myColor) {
      setSelectedPieceId(clickedPiece.id);
    }
  };

  // threatMap: red = enemy can actually capture one of your pieces, grey = just visible
  const threatMap = useMemo(() => {
    const map      = Array(8).fill(null).map(() => Array(8).fill(false));
    const myPieces = pieces.filter(p => p.color === myColor);
    pieces.filter(p => p.color !== myColor && myColor).forEach(enemy => {
      if (myPieces.some(mine => isValidMove(enemy, mine.row, mine.col, pieces).valid))
        map[enemy.row][enemy.col] = true;
    });
    return map;
  }, [pieces, myColor]);


  const isLoading    = isVerifying || isCommitting;
  const shortAddr    = address ? `${address.substring(0,5)}…${address.substring(51)}` : null;
  const whiteTimeLow = whiteTime < 30;
  const blackTimeLow = blackTime < 30;

  // ── ENTRY SCREEN ──────────────────────────────────────────────────────────
  const EntryScreen = () => {
    const modes = [
      {
        id:       'multiplayer',
        icon:     '⚔',
        label:    'Multiplayer',
        sub:      'Play online vs a friend',
        detail:   'Stake XLM · ELO ranked · ZK verified',
        action:   () => { setGamePhase('game'); setLeftTab('mode'); setSidebarTab('game'); },
        primary:  true,
      },
      {
        id:       'ai',
        icon:     '🤖',
        label:    'vs AI',
        sub:      'Solo practice — no wallet needed',
        detail:   'Instant play · Local ZK · Free',
        action:   () => { handleStartAI(); setGamePhase('game'); },
        primary:  false,
        disabled: false,
      },
      {
        id:       'tournament',
        icon:     '🏆',
        label:    'Tournament',
        sub:      'Compete for the top',
        detail:   'Brackets · Prizes · ELO ranked',
        action:   () => setGamePhase('tournament'),
        primary:  false,
        disabled: false,
      },
      {
        id:       'team',
        icon:     '⬡',
        label:    'Team Play',
        sub:      '2v2 collaborative mode',
        detail:   'Coming soon — coordinate with allies',
        action:   null,
        disabled: true,
      },
    ];

    return (
      <div style={{
        width: '100vw', height: '100vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: '#111111',
        fontFamily: "'Noto Sans', system-ui, sans-serif",
      }}>
        {/* Fog grid background */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(${T.line}99 1px, transparent 1px), linear-gradient(90deg, ${T.line}99 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
        }} />

        {/* Lantern glow behind logo */}
        <div style={{
          position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 400, height: 400, borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(224,160,32,0.07) 0%, transparent 70%)',
        }} />

        {/* Logo */}
        <div style={{ position: 'relative', textAlign: 'center', marginBottom: 56 }}>
          <div style={{
            fontSize: 52, marginBottom: 12, lineHeight: 1,
            color: '#e0a020',
            filter: 'drop-shadow(0 0 32px rgba(224,160,32,0.4))',
          }}>♟</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace",
            fontSize: 28, fontWeight: 700, letterSpacing: '0.18em',
            color: '#f0e8d8', marginBottom: 6,
          }}>LANTERN CHESS</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace",
            fontSize: 14, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#6a5a4a',
          }}>ZK FOG OF WAR · STELLAR TESTNET</div>
        </div>

        {/* Mode cards */}
        <div style={{ display: 'flex', gap: 16, padding: '0 24px', flexWrap: 'wrap', justifyContent: 'center', position: 'relative' }}>
          {modes.map(m => (
            <div
              key={m.id}
              onClick={() => !m.disabled && m.action && m.action()}
              style={{
                width: 220, padding: '28px 24px',
                background: m.primary ? 'rgba(212,149,10,0.06)' : m.disabled ? '#111111' : '#181510',
                border: `1px solid ${m.primary ? 'rgba(212,149,10,0.4)' : m.disabled ? '#222' : '#3a3020'}`,
                cursor: m.disabled ? 'not-allowed' : 'pointer',
                opacity: m.disabled ? 0.45 : 1,
                transition: 'border-color 0.15s, background 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!m.disabled) {
                  e.currentTarget.style.borderColor = m.primary ? 'rgba(212,149,10,0.75)' : 'rgba(212,149,10,0.3)';
                  e.currentTarget.style.background  = m.primary ? 'rgba(212,149,10,0.1)'  : 'rgba(212,149,10,0.04)';
                }
              }}
              onMouseLeave={e => {
                if (!m.disabled) {
                  e.currentTarget.style.borderColor = m.primary ? 'rgba(212,149,10,0.4)' : '#2a2a2a';
                  e.currentTarget.style.background  = m.primary ? 'rgba(212,149,10,0.06)': '#161616';
                }
              }}
            >
              {m.disabled && (
                <div style={{
                  position: 'absolute', top: 10, right: 10,
                  fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: '#7a6a5a', fontFamily: "'Roboto Mono', monospace",
                  border: '1px solid #3a3030', padding: '2px 5px',
                }}>
                  Soon
                </div>
              )}
              <div style={{ fontSize: 28, marginBottom: 14, color: m.primary ? '#e0a020' : '#586476', lineHeight: 1 }}>
                {m.icon}
              </div>
              <div style={{
                fontSize: 16, fontWeight: 600, color: m.primary ? '#f0e8d8' : '#c0b090',
                marginBottom: 6, letterSpacing: '0.02em',
              }}>
                {m.label}
              </div>
              <div style={{ fontSize: 14, color: m.primary ? '#8892a4' : '#586476', marginBottom: 10 }}>
                {m.sub}
              </div>
              <div style={{
                fontSize: 13, color: '#2a3040',
                fontFamily: "'Roboto Mono', monospace", lineHeight: 1.5,
              }}>
                {m.detail}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center',
          fontFamily: "'Roboto Mono', monospace", fontSize: 13,
          color: '#2a3040', letterSpacing: '0.1em',
        }}>
          Fog of war enforced by zero-knowledge proofs on Stellar
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  DESIGN SYSTEM
  //  References: chess.com · lichess · Valorant HUD · Poker Final Table · Dota2 HUD
  //
  //  Rules:
  //  · Board = hero. Player strips sit on its edges top/bottom (not sidebar)
  //  · Clock = largest number after pieces. Always Roboto Mono.
  //  · One accent color (#B8860B amber). Used ONLY for the active state.
  //  · Right panel = information. 1px separators, flat sections, no card boxes.
  //  · Zero blur. Zero glow. Zero pill shapes. Zero gradient buttons.
  //  · Monospace for every number/address. Noto Sans for every label.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Theme palettes ───────────────────────────────────────────────────────
  const THEMES = {
    amber: {  // Classic: dark walnut board, amber gold
      bg0:'#0a0a0a', bg1:'#111111', bg2:'#1a1a1a', bg3:'#0d0d0d',
      line:'#2a2a2a', text:'#f0e8d8', muted:'#c0b090', ghost:'#7a6a5a',
      accent:'#d4950a', accentLt:'#f0aa14',
      red:'#e05252', green:'#3fb950',
      bLight:'#f0d9b5', bDark:'#b58863', wPiece:'#FFFEF5', bPiece:'#1a1208',
      name: 'Amber',
    },
    navy: {  // Deep blue board, steel accents
      bg0:'#070c14', bg1:'#0d1520', bg2:'#111d2e', bg3:'#081018',
      line:'#1e2e42', text:'#d0dff0', muted:'#7a9bbf', ghost:'#3a5a7a',
      accent:'#4a8fd4', accentLt:'#6aaff4',
      red:'#e05252', green:'#3fb97a',
      bLight:'#c8ddf0', bDark:'#2a5080', wPiece:'#eef4fc', bPiece:'#061020',
      name: 'Navy',
    },
    mono: {  // Monochrome: black, white, grey
      bg0:'#080808', bg1:'#0f0f0f', bg2:'#181818', bg3:'#0a0a0a',
      line:'#2e2e2e', text:'#e8e8e8', muted:'#a0a0a0', ghost:'#555555',
      accent:'#c0c0c0', accentLt:'#e8e8e8',
      red:'#d04040', green:'#40b040',
      bLight:'#d8d8d8', bDark:'#484848', wPiece:'#f0f0f0', bPiece:'#101010',
      name: 'Mono',
    },
    forest: {  // Deep forest green board
      bg0:'#060e08', bg1:'#0c160e', bg2:'#121e14', bg3:'#080e0a',
      line:'#1a2e1c', text:'#c8e0c8', muted:'#7aaa7a', ghost:'#3a6a3a',
      accent:'#4ab84a', accentLt:'#6ed86e',
      red:'#e05252', green:'#5fd85f',
      bLight:'#aed6ae', bDark:'#2a5a2a', wPiece:'#e8f4e8', bPiece:'#060e06',
      name: 'Forest',
    },
  };
  const T = THEMES[theme] || THEMES.amber;
  const C = {
    bg0: T.bg0, bg1: T.bg1, bg2: T.bg2, bg3: T.bg3,
    line: T.line, text: T.text, muted: T.muted, ghost: T.ghost,
    amber: T.accent, amberLt: T.accentLt,
    red: T.red, green: T.green,
    bLight: T.bLight, bDark: T.bDark, wPiece: T.wPiece, bPiece: T.bPiece,
  };

  // Inject theme-aware CSS vars on every theme change
  React.useEffect(() => {
    let tv = document.getElementById('lc-theme-vars');
    if (!tv) { tv = document.createElement('style'); tv.id = 'lc-theme-vars'; document.head.appendChild(tv); }
    tv.textContent = `:root {
      --lc-accent: ${T.accent};
      --lc-accentLt: ${T.accentLt};
      --lc-bg2: ${T.bg2};
      --lc-line: ${T.line};
      --lc-text: ${T.text};
      --lc-muted: ${T.muted};
      --lc-ghost: ${T.ghost};
    }`;
  }, [theme]);

  // Inject base styles once
  React.useEffect(() => {
    if (document.getElementById('lc-css')) return;
    const s = document.createElement('style');
    s.id = 'lc-css';
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&family=Roboto+Mono:wght@400;500;700&display=swap');
      .lc { font-family: 'Noto Sans', system-ui, sans-serif; box-sizing: border-box; }
      .lc *, .lc *::before, .lc *::after { box-sizing: border-box; }
      .lc-mono { font-family: 'Roboto Mono', monospace; }
      .lc-tile { cursor: pointer; }
      .lc-tile:hover { filter: brightness(1.1); }
      .lc-btn {
        display: block; width: 100%; padding: 8px 12px;
        background: #232220; border: 1px solid #2a2825;
        color: #ede5d5; font-family: 'Noto Sans', system-ui, sans-serif;
        font-size: 13px; font-weight: 500; cursor: pointer;
        transition: background 0.1s, border-color 0.1s; text-align: center;
      }
      .lc-btn:hover:not(:disabled) { background: #323028; border-color: #4a4540; }
      .lc-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .lc-btn-gold { background: var(--lc-accent, #B8860B); border-color: var(--lc-accent, #B8860B); color: #0a0a0a; font-weight: 600; }
      .lc-btn-gold:hover:not(:disabled) { background: var(--lc-accentLt, #d4a017); border-color: var(--lc-accentLt, #d4a017); }
      .lc-btn-blue { background: #1a3a5c; border-color: #1e4a78; color: #93c5fd; }
      .lc-btn-blue:hover:not(:disabled) { background: #1e4a78; }
      .lc-input {
        display: block; width: 100%; padding: 7px 9px;
        background: #0f0e0c; border: 1px solid #3a3830;
        color: #ede5d5; font-family: 'Roboto Mono', monospace; font-size: 13px; outline: none;
        transition: border-color 0.1s;
      }
      .lc-input:focus { border-color: var(--lc-accent, #B8860B); }
      .lc-input::placeholder { color: #6a5a4a; }
      .lc-tab {
        flex: 1; padding: 9px 0; background: transparent; border: none;
        border-bottom: 2px solid transparent;
        font-family: 'Noto Sans', system-ui, sans-serif; font-size: 13px; font-weight: 500;
        color: #a09080; cursor: pointer; text-align: center; transition: color 0.12s;
      }
      .lc-tab:hover { color: #f0e8d8; }
      .lc-tab.on { color: var(--lc-accentLt, #d4a017); border-bottom-color: var(--lc-accent, #B8860B); }
      .lc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
      .lc-label { font-size: 13px; color: #b0a898; }
      .lc-val { font-family: 'Roboto Mono', monospace; font-size: 13px; color: #ede5d5; }
      .lc-val-amber { color: #d4a017; }
      .lc-section-hdr {
        font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--lc-muted, #b09070);
        padding-bottom: 6px; border-bottom: 1px solid #333; margin-bottom: 12px;
      }
      @keyframes lc-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      @keyframes lc-in { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
      .lc-pulse { animation: lc-pulse 0.8s ease-in-out infinite; }
      .lc-fadein { animation: lc-in 0.15s ease; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #2a2825; border-radius: 2px; }
    `;
    document.head.appendChild(s);
  }, []);

  // ── Tile ──────────────────────────────────────────────────────────────────
  const renderTile = (r, c) => {
    const piece      = pieces.find(p => p.row === r && p.col === c);
    const isSelected = selectedPieceId === piece?.id;
    const isOwn      = myColor ? piece?.color === myColor : piece?.color === currentPlayer;
    const isEnemy    = piece && !isOwn;
    const isThreat   = threatMap[r][c];
    const light      = (r + c) % 2 === 0;

    const bg = isSelected
      ? (light ? '#f6f081' : '#cdd26a')
      : (light ? C.bLight : C.bDark);

    return (
      <div
        key={`${r}-${c}`}
        className="lc-tile"
        onClick={() => handleTileClick(r, c)}
        style={{ aspectRatio: '1', background: bg, position: 'relative',
                 display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {isOwn && (
          <span style={{
            fontSize: 'clamp(22px, 3.8vw, 40px)', lineHeight: 1, userSelect: 'none',
            color: piece.color === 'white' ? '#ffffff' : '#1a2030',
            WebkitTextStroke: piece.color === 'white' ? '1px rgba(0,0,0,0.85)' : '1px rgba(255,255,255,0.25)',
          }}>
            {PIECE_SYMBOLS[piece.color][piece.type]}
          </span>
        )}
        {isEnemy && isThreat && (
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: C.red,
            boxShadow: `0 0 0 2.5px ${light ? C.bLight : C.bDark}`,
          }} />
        )}
        {isEnemy && !isThreat && (
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: light ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.3)',
            boxShadow: `0 0 0 1.5px ${light ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.2)'}`,
          }} />
        )}
      </div>
    );
  };

  // ── Player strip — lichess style, glued to board edge ─────────────────────
  const PlayerStrip = ({ color, time, isActive, addr }) => {
    const isMe  = myColor === color;
    const isLow = time < 30 && isActive;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', height: 46, padding: '0 12px',
        background: isActive ? 'rgba(184,134,11,0.05)' : C.bg2,
        borderLeft: `3px solid ${isActive ? C.amber : 'transparent'}`,
        borderTop:    color === 'black' ? 'none' : `1px solid ${C.line}`,
        borderBottom: color === 'white' ? 'none' : `1px solid ${C.line}`,
      }}>
        {/* Color symbol */}
        <span style={{ fontSize: 14, marginRight: 10, color: color === 'white' ? '#d4c9b0' : '#6b6456', lineHeight: 1 }}>
          {color === 'white' ? '○' : '●'}
        </span>
        {/* Name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: isMe ? 600 : 400,
            color: isMe ? C.text : C.muted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.2,
          }}>
            {addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : (color === 'white' ? 'White' : 'Black')}
          </div>
          {isMe && <div style={{ fontSize: 12, color: C.ghost, marginTop: 1, letterSpacing: '0.08em' }}>YOU</div>}
        </div>
        {/* Clock — the hero element */}
        <div className="lc-mono" style={{
          fontSize: 22, fontWeight: 700, minWidth: 72, textAlign: 'right', letterSpacing: '-0.5px',
          color: isLow ? C.red : isActive ? C.amberLt : C.muted,
        }}
          {...(isLow ? { className: 'lc-mono lc-pulse' } : {})}
        >
          {formatTime(time)}
        </div>
      </div>
    );
  };


  // ── Left Sidebar — Mode + Tournament ─────────────────────────────────────
  const LeftSidebarPanel = () => {
    const MODES = [
      {
        id: 'multiplayer', icon: '⚔', label: 'Multiplayer',
        sub: 'Play vs a friend online',
        detail: 'Stake XLM · ELO ranked · ZK verified',
        active: !aiMode && gameStarted,
        action: () => { if (gameStarted) { handlePlayAgain(); } else { setGamePhase('game'); } },
      },
      {
        id: 'ai', icon: '🤖', label: 'vs AI',
        sub: 'Solo — no wallet needed',
        detail: 'Instant play · Local · Free',
        active: aiMode,
        action: () => { handleStartAI(); },
      },
      {
        id: 'team', icon: '⬡', label: 'Team Play',
        sub: '2v2 collaborative mode',
        detail: 'Coming soon',
        disabled: true,
      },
    ];

    const ModeCard = ({ m }) => (
      <div
        onClick={() => !m.disabled && m.action?.()}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 12px', marginBottom: 6,
          background: m.active ? 'rgba(212,149,10,0.1)' : m.disabled ? 'transparent' : C.bg0,
          border: `1px solid ${m.active ? C.amber : m.disabled ? C.line : '#333'}`,
          cursor: m.disabled ? 'not-allowed' : 'pointer',
          opacity: m.disabled ? 0.38 : 1,
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          if (!m.disabled && !m.active) {
            e.currentTarget.style.borderColor = 'rgba(212,149,10,0.4)';
            e.currentTarget.style.background  = 'rgba(212,149,10,0.05)';
          }
        }}
        onMouseLeave={e => {
          if (!m.disabled && !m.active) {
            e.currentTarget.style.borderColor = '#333';
            e.currentTarget.style.background  = C.bg0;
          }
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>{m.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: m.active ? C.amberLt : C.text }}>
              {m.label}
            </span>
            {m.active && (
              <span style={{
                fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: C.amber, fontWeight: 700,
              }}>ACTIVE</span>
            )}
            {m.disabled && (
              <span style={{ fontSize: 9, color: C.ghost, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Soon
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.ghost, marginTop: 1 }}>{m.sub}</div>
        </div>
        {!m.disabled && !m.active && (
          <span style={{ fontSize: 13, color: C.ghost, flexShrink: 0 }}>›</span>
        )}
      </div>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Collapsed icon rail ────────────────────────────────────── */}
        {leftCollapsed && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, padding: '10px 0', width: '100%',
          }}>
            {/* Expand button — arrow points right (→) since it's the left bar */}
            <button onClick={() => setLeftCollapsed(false)} style={{
              width: 36, height: 36, background: 'transparent',
              border: `1px solid ${C.amber}`, color: C.amber,
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>‹</button>
            {[['mode','⊞','Mode'],['tourn','🏆','Tournament']].map(([id, icon, title]) => (
              <button key={id} title={title}
                onClick={() => {
                  if (id === 'tourn') { setGamePhase('tournament'); }
                  else { setLeftCollapsed(false); setLeftTab(id); }
                }}
                style={{
                  width: 36, height: 36,
                  background: leftTab === id ? 'rgba(184,134,11,0.12)' : 'transparent',
                  border: `1px solid ${leftTab === id ? C.amber : C.line}`,
                  color: leftTab === id ? C.amberLt : C.muted,
                  fontSize: 18, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {icon}
              </button>
            ))}
          </div>
        )}

        {/* ── Expanded tab bar ───────────────────────────────────────── */}
        {!leftCollapsed && (
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
            {/* Collapse button — left side so arrow points left (‹) */}
            <button onClick={() => setLeftCollapsed(true)} style={{
              flexShrink: 0, width: 34, background: 'transparent',
              border: 'none', borderRight: `1px solid ${C.line}`,
              color: C.ghost, fontSize: 20, cursor: 'pointer', alignSelf: 'stretch',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>›</button>
            {[['mode','⊞ Mode'],['tourn','🏆 Tourn']].map(([id, label]) => (
              <button key={id}
                className={`lc-tab${leftTab === id ? ' on' : ''}`}
                onClick={() => {
                  if (id === 'tourn') setGamePhase('tournament');
                  else setLeftTab(id);
                }}
                style={{ position: 'relative' }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Mode tab content ───────────────────────────────────────── */}
        {leftTab === 'mode' && !leftCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            <div className="lc-section-hdr">Switch Mode</div>
            {MODES.map(m => <ModeCard key={m.id} m={m} />)}

            {/* Theme switcher */}
            <div style={{ marginTop: 20 }}>
              <div className="lc-section-hdr">Board Theme</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {Object.entries(THEMES).map(([key, t]) => (
                  <button key={key} onClick={() => setTheme(key)}
                    style={{
                      padding: '8px 0', border: `1px solid ${theme === key ? T.accent : C.line}`,
                      background: theme === key ? `${T.accent}18` : C.bg0,
                      cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}>
                    {/* Mini board preview */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,8px)', gap: 0 }}>
                      {[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(i => (
                        <div key={i} style={{ width:8, height:8,
                          background: (Math.floor(i/4)+i)%2===0 ? t.bLight : t.bDark }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: theme === key ? T.accentLt : C.ghost,
                      fontWeight: theme === key ? 700 : 400, letterSpacing: '0.04em' }}>
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Team play coming soon */}
            <div style={{ marginTop: 16, padding: '10px 12px', border: `1px solid ${C.line}`, background: C.bg0, opacity: 0.4 }}>
              <div style={{ fontSize: 11, color: C.ghost, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>⬡ Team Play</div>
              <div style={{ fontSize: 11, color: C.ghost }}>2v2 mode — coming soon</div>
            </div>
          </div>
        )}

        {/* ── Tournament shortcut ────────────────────────────────────── */}
        {leftTab === 'tourn' && !leftCollapsed && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>🏆</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>No Tournaments</div>
            <div style={{ fontSize: 11, color: C.ghost, marginBottom: 20, lineHeight: 1.6 }}>
              ELO brackets, XLM prize pools — coming soon.
            </div>
            <button onClick={() => setGamePhase('tournament')} style={{
              padding: '8px 20px', background: 'transparent',
              border: `1px solid ${C.line}`, color: C.muted,
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              View Tournament Page →
            </button>
          </div>
        )}

      </div>
    );
  };


  const SidebarPanel = () => {
    const tabAlerts = {
      game:  isMyTurn && gameStarted && !gameOver,
      ranks: leaderboard.lastDelta !== null,
      pool:  (spectator.poolState?.totalXLM ?? 0) > 0,
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Collapsed icon rail */}
        {sidebarCollapsed && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, padding: '10px 0', width: '100%',
          }}>
            <button onClick={() => setSidebarCollapsed(false)} title="Expand" style={{
              width: 36, height: 36, background: 'transparent', border: `1px solid ${C.amber}`,
              color: C.amber, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>›</button>
            {[['game','♟'],['ranks','★'],['bets','⚡']].map(([id, icon]) => (
              <button key={id} title={id.charAt(0).toUpperCase()+id.slice(1)}
                onClick={() => { setSidebarCollapsed(false); setSidebarTab(id); }}
                style={{
                  width: 36, height: 36,
                  background: sidebarTab === id ? 'rgba(184,134,11,0.12)' : 'transparent',
                  border: `1px solid ${sidebarTab === id ? C.amber : C.line}`,
                  color: sidebarTab === id ? C.amberLt : C.muted,
                  fontSize: 18, cursor: 'pointer', position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {icon}
                {tabAlerts[id] && (
                  <span style={{ position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: '50%', background: C.green }} />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Tab bar */}
        {!sidebarCollapsed && <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
          {[['game','♟ Game'],['ranks','★ Ranks'],['bets','⚡ Bets']].map(([id, label]) => (
            <button
              key={id}
              className={`lc-tab${sidebarTab === id ? ' on' : ''}`}
              onClick={() => setSidebarTab(id)}
              style={{ position: 'relative' }}
            >
              {label}
              {tabAlerts[id] && (
                <span style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 5, height: 5, borderRadius: '50%', background: C.green,
                }} />
              )}
            </button>
          ))}
          {/* Collapse */}
          <button onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar" style={{
            flexShrink: 0, width: 34, background: 'transparent',
            border: 'none', borderLeft: `1px solid ${C.line}`,
            color: C.ghost, fontSize: 20, cursor: 'pointer', alignSelf: 'stretch',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>‹</button>
        </div>}

        {/* ── GAME TAB ────────────────────────────────────────────────── */}
        {sidebarTab === 'game' && !sidebarCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Wallet section */}
            <div>
              <div className="lc-section-hdr">Wallet</div>
              {!isConnected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="lc-btn lc-btn-gold" onClick={connectFreighter} disabled={isConnecting}>
                    {isConnecting ? 'Connecting…' : 'Connect Freighter'}
                  </button>
                  {DevWalletService.isDevModeAvailable() && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="lc-btn" onClick={() => connectDev(1)} style={{ flex: 1 }}>Dev P1</button>
                      <button className="lc-btn" onClick={() => connectDev(2)} style={{ flex: 1 }}>Dev P2</button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="lc-mono" style={{ fontSize: 14, color: C.green }}>{shortAddr}</div>
                    {myColor && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Playing as <span style={{color:C.text,fontWeight:600}}>{myColor}</span></div>}
                  </div>
                  <button className="lc-btn" onClick={disconnect} style={{ width: 'auto', padding: '4px 10px', fontSize: 13 }}>
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            {/* New game / Join */}
            {!gameStarted && isConnected && (
              <>
                <div>
                  <div className="lc-section-hdr">Start New Game</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bg0, border: `1px solid ${C.line}`, padding: '6px 8px' }}>
                      <span className="lc-mono" style={{ flex: 1, fontSize: 13, color: C.amber, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sessionId}
                      </span>
                      <button className="lc-btn" style={{ width: 'auto', padding: '2px 8px', fontSize: 13 }}
                        onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied', 'success'); }}>
                        Copy
                      </button>
                    </div>
                    <input className="lc-input" placeholder="Opponent address  G…" value={player2Address} onChange={e => setPlayer2Address(e.target.value)} />
                    <button className="lc-btn lc-btn-gold" onClick={handleStartGame} disabled={isCommitting}>
                      {isCommitting ? 'Setting up…' : '⚔ Start Game'}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="lc-section-hdr">Join Game</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input className="lc-input" placeholder="Session ID" value={joinSessionId} onChange={e => setJoinSessionId(e.target.value)} />
                    <button className="lc-btn lc-btn-blue" onClick={handleJoinGame} disabled={isCommitting}>
                      {isCommitting ? 'Joining…' : 'Join Game'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* In-game info */}
            {gameStarted && (
              <>
                {myColor === 'white' && (
                  <div>
                    <div className="lc-section-hdr">Share with Opponent</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: C.bg0, border: `1px solid ${C.line}`, padding: '6px 8px' }}>
                      <span className="lc-mono" style={{ flex: 1, fontSize: 13, color: C.amber, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sessionId}
                      </span>
                      <button className="lc-btn" style={{ width: 'auto', padding: '2px 8px', fontSize: 13 }}
                        onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied', 'success'); }}>
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                {/* ELO / Points card */}
                {leaderboard.eloState && (
                  <div style={{ background: C.bg0, border: `1px solid ${C.line}`, padding: '12px 14px', marginBottom: 4 }}>
                    <div className="lc-section-hdr" style={{ marginBottom: 8 }}>Your Rating</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 8 }}>
                      <div className="lc-mono" style={{ fontSize: 32, fontWeight: 700, color: C.amberLt, lineHeight: 1 }}>
                        {leaderboard.eloState.gamesPlayed === 0 ? 0 : leaderboard.eloState.rating}
                      </div>
                      {leaderboard.lastDelta !== null && (
                        <div className="lc-mono" style={{
                          fontSize: 14, fontWeight: 600, marginBottom: 3,
                          color: leaderboard.lastDelta >= 0 ? C.green : C.red,
                        }}>
                          {leaderboard.lastDelta >= 0 ? '+' : ''}{leaderboard.lastDelta}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div>
                        <div className="lc-mono" style={{ fontSize: 15, fontWeight: 700, color: C.green }}>{leaderboard.eloState.wins}</div>
                        <div style={{ fontSize: 13, color: C.muted }}>Wins</div>
                      </div>
                      <div>
                        <div className="lc-mono" style={{ fontSize: 15, fontWeight: 700, color: C.red }}>{leaderboard.eloState.losses}</div>
                        <div style={{ fontSize: 13, color: C.muted }}>Losses</div>
                      </div>
                      <div>
                        <div className="lc-mono" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{leaderboard.eloState.gamesPlayed}</div>
                        <div style={{ fontSize: 13, color: C.muted }}>Games</div>
                      </div>
                      {leaderboard.myRank && (
                        <div>
                          <div className="lc-mono" style={{ fontSize: 15, fontWeight: 700, color: C.amberLt }}>#{leaderboard.myRank}</div>
                          <div style={{ fontSize: 13, color: C.muted }}>Rank</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <div className="lc-section-hdr">Game</div>
                  <div className="lc-row"><span className="lc-label">Moves</span><span className="lc-val">{moveCount}</span></div>
                  <div className="lc-row">
                    <span className="lc-label">Chain</span>
                    <span className={`lc-val${isBoardSealed ? ' lc-val-amber' : ''}`}>{isBoardSealed ? 'Sealed ✓' : 'Local'}</span>
                  </div>
                  {opponentOnline && <div className="lc-row"><span className="lc-label">Opponent</span><span className="lc-val" style={{ color: C.green }}>Online</span></div>}
                  <div className="lc-row">
                    <span className="lc-label">Status</span>
                    <span className="lc-val" style={{ color: kingInCheck ? C.red : isMyTurn ? C.amberLt : C.muted }}>
                      {gameOver ? `${winner} wins` : kingInCheck ? 'CHECK' : isMyTurn ? 'Your move' : 'Waiting'}
                    </span>
                  </div>
                </div>

                {staking.status === 'matched' && (
                  <div>
                    <div className="lc-section-hdr">Stake</div>
                    <div className="lc-row"><span className="lc-label">Pot</span><span className="lc-val lc-val-amber">{staking.payout?.potXLM} XLM</span></div>
                    <div className="lc-row"><span className="lc-label">Winner gets</span><span className="lc-val">{staking.payout?.winnerXLM} XLM</span></div>
                    <div className="lc-row"><span className="lc-label">Fee</span><span className="lc-val">2%</span></div>
                  </div>
                )}
              </>
            )}

            {/* Legend */}
            <div>
              <div className="lc-section-hdr">Legend</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: C.muted }}>Enemy can capture your piece</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: C.muted }}>Enemy visible, no threat</span>
                </div>
              </div>
            </div>

            {/* Activity log */}
            <div style={{ flex: 1 }}>
              <div className="lc-section-hdr">Activity</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
                {logs.map((msg, i) => {
                  const color =
                    msg.startsWith('ERROR') || msg.startsWith('INVALID') ? C.red :
                    msg.startsWith('SUCCESS') ? C.green :
                    msg.startsWith('ZK')      ? '#3b82f6' :
                    msg.startsWith('ON-CHAIN')? '#8b5cf6' :
                    msg.startsWith('ELO')     ? C.amberLt :
                    msg.startsWith('GAME OVER') ? '#f59e0b' :
                    msg.startsWith('Opponent')  ? '#67e8f9' : C.ghost;
                  return (
                    <div key={i} className="lc-mono" style={{ fontSize: 13, lineHeight: 1.65, color }}>
                      {msg}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ── RANKS TAB ───────────────────────────────────────────────── */}
        {sidebarTab === 'ranks' && !sidebarCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div className="lc-section-hdr">Leaderboard</div>
            {/* My ELO card */}
            <div style={{ padding:'12px 14px', border:`1px solid ${C.line}`, marginBottom:16, background:C.bg0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:11, color:C.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>Your Rating</div>
                  <div style={{ fontFamily:"'Roboto Mono',monospace", fontSize:28, fontWeight:700, color:C.amberLt, lineHeight:1 }}>
                    {isConnected ? (leaderboard.eloState ? (leaderboard.eloState.gamesPlayed === 0 ? 0 : leaderboard.eloState.rating) : '…') : '—'}
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:13, color:C.text }}>{isConnected ? (leaderboard.eloState?.wins ?? 0) : '?'}W — {isConnected ? (leaderboard.eloState?.losses ?? 0) : '?'}L</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{isConnected ? (leaderboard.eloState?.gamesPlayed ?? 0) : '—'} games</div>
                </div>
              </div>
              {leaderboard.lastDelta !== null && (
                <div style={{ marginTop:8, fontSize:13, fontFamily:"'Roboto Mono',monospace", color: leaderboard.lastDelta >= 0 ? C.green : C.red, fontWeight:600 }}>
                  Last game: {leaderboard.lastDelta >= 0 ? '+' : ''}{leaderboard.lastDelta} ELO
                </div>
              )}
            </div>
            {/* Leaderboard list */}
            {leaderboard.isLoading ? (
              <div style={{ fontSize:13, color:C.muted, textAlign:'center', paddingTop:20 }}>Loading rankings…</div>
            ) : leaderboard.error ? (
              <div style={{ fontSize:12, color:C.red }}>{leaderboard.error}</div>
            ) : (leaderboard.entries?.length ?? 0) === 0 ? (
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>No ranked players yet — play a game to appear here.</div>
                {/* Placeholder rows */}
                {[{rank:1,addr:'GAHZ4P…QRST',elo:1540,w:12,l:3},{rank:2,addr:'GBNM8K…WXYZ',elo:1410,w:9,l:4},{rank:3,addr:'GCDE2M…ABCD',elo:1320,w:7,l:6}].map(p => (
                  <div key={p.rank} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:`1px solid ${C.line}`, opacity:0.4 }}>
                    <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:12, color:C.amber, minWidth:20 }}>#{p.rank}</span>
                    <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:11, color:C.muted, flex:1 }}>{p.addr}</span>
                    <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:13, fontWeight:700, color:C.text }}>{p.elo}</span>
                    <span style={{ fontSize:11, color:C.muted }}>{p.w}W {p.l}L</span>
                  </div>
                ))}
              </div>
            ) : (
              leaderboard.entries.slice(0,20).map((e, i) => (
                <div key={e.address} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:`1px solid ${C.line}`, background: e.address===address ? 'rgba(212,149,10,0.05)' : 'transparent' }}>
                  <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:12, color:C.amber, minWidth:20 }}>#{i+1}</span>
                  <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:11, color: e.address===address ? C.amberLt : C.muted, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {e.address.slice(0,6)}…{e.address.slice(-4)}
                  </span>
                  <span style={{ fontFamily:"'Roboto Mono',monospace", fontSize:13, fontWeight:700, color:C.text }}>{e.commitment?.slice(0,4) ?? '—'}</span>
                  <span style={{ fontSize:11, color:C.muted }}>{e.wins}W {e.losses}L</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── BETS TAB ────────────────────────────────────────────────── */}
        {sidebarTab === 'pool' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            <SpectatorPanel betting={spectator} gameStarted={gameStarted} gameOver={gameOver} />
          </div>
        )}

        {/* MODE + TOURN moved to LEFT sidebar */}
        {sidebarTab === 'mode_disabled' && !sidebarCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div className="lc-section-hdr">Switch Mode</div>
            <div style={{ fontSize: 12, color: C.ghost, marginBottom: 16 }}>
              {gameStarted
                ? 'Current game will end when you switch.'
                : 'Choose how you want to play.'}
            </div>
            {[
              {
                id: 'multiplayer',
                icon: '⚔',
                label: 'Multiplayer',
                sub: 'Play online vs a friend',
                detail: 'Stake XLM · ELO ranked · ZK verified',
                active: !aiMode,
                action: () => {
                  if (gameStarted) { handlePlayAgain(); }
                  else { setGamePhase('game'); setSidebarTab('game'); }
                },
              },
              {
                id: 'ai',
                icon: '🤖',
                label: 'vs AI',
                sub: 'Solo practice — no wallet needed',
                detail: 'Instant play · Local · Free',
                active: aiMode,
                action: () => { handleStartAI(); setSidebarTab('game'); },
              },
              {
                id: 'team',
                icon: '⬡',
                label: 'Team Play',
                sub: '2v2 collaborative mode',
                detail: 'Coming soon',
                disabled: true,
              },
              {
                id: 'tourn',
                icon: '🏆',
                label: 'Tournament',
                sub: 'Compete for the top',
                detail: 'Brackets · Prizes · ELO ranked',
                disabled: false,
                action: () => setGamePhase('tournament'),
              },
            ].map(m => (
              <div
                key={m.id}
                onClick={() => !m.disabled && m.action?.()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', marginBottom: 8,
                  background: m.active
                    ? 'rgba(212,149,10,0.1)'
                    : m.disabled ? 'transparent' : C.bg0,
                  border: `1px solid ${m.active ? C.amber : m.disabled ? C.line : '#333'}`,
                  cursor: m.disabled ? 'not-allowed' : 'pointer',
                  opacity: m.disabled ? 0.4 : 1,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => {
                  if (!m.disabled && !m.active) {
                    e.currentTarget.style.borderColor = 'rgba(212,149,10,0.35)';
                    e.currentTarget.style.background  = 'rgba(212,149,10,0.04)';
                  }
                }}
                onMouseLeave={e => {
                  if (!m.disabled && !m.active) {
                    e.currentTarget.style.borderColor = '#333';
                    e.currentTarget.style.background  = C.bg0;
                  }
                }}
              >
                <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{m.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    color: m.active ? C.amberLt : C.text,
                    marginBottom: 2,
                  }}>
                    {m.label}
                    {m.active && (
                      <span style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700,
                        letterSpacing: '0.1em', color: C.amber,
                        textTransform: 'uppercase',
                      }}>ACTIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.ghost }}>{m.sub}</div>
                </div>
                {!m.disabled && !m.active && (
                  <span style={{ fontSize: 14, color: C.ghost }}>›</span>
                )}
                {m.disabled && (
                  <span style={{
                    fontSize: 9, color: C.ghost, letterSpacing: '0.08em',
                    textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>Soon</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TOURN moved to left sidebar */}
        {sidebarTab === 'tourn_disabled' && !sidebarCollapsed && false && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}>
            <div className="lc-section-hdr">Tournament</div>

            {/* Empty state */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '40px 0', textAlign: 'center',
            }}>
              <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>🏆</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.muted, marginBottom: 8 }}>
                No Tournaments Right Now
              </div>
              <div style={{ fontSize: 12, color: C.ghost, lineHeight: 1.6, maxWidth: 220 }}>
                Tournaments are coming soon. Compete in ELO-ranked brackets,
                stake XLM, and climb the leaderboard.
              </div>
              <div style={{
                marginTop: 24, padding: '8px 16px',
                border: `1px solid ${C.line}`,
                fontSize: 11, color: C.ghost,
                fontFamily: "'Roboto Mono', monospace",
              }}>
                Check back soon
              </div>
            </div>

            {/* Upcoming placeholder card */}
            <div style={{
              padding: '14px 16px',
              border: `1px solid ${C.line}`,
              background: C.bg0,
              opacity: 0.45,
            }}>
              <div style={{
                fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: C.ghost, marginBottom: 8, fontWeight: 600,
              }}>Upcoming</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>
                Fog of War Open #1
              </div>
              <div style={{ fontSize: 11, color: C.ghost }}>
                16 players · Double elimination · 5 XLM entry
              </div>
              <div style={{
                marginTop: 10,
                fontFamily: "'Roboto Mono', monospace",
                fontSize: 11, color: C.ghost,
              }}>
                TBA
              </div>
            </div>
          </div>
        )}

      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  TOURNAMENT PAGE
  // ─────────────────────────────────────────────────────────────────────────
  const TournamentPage = () => (
    <div style={{
      width: '100vw', height: '100vh', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      background: C.bg1, color: C.text,
      fontFamily: "'Noto Sans', system-ui, sans-serif",
    }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px',
        background: C.bg2, borderBottom: `1px solid ${C.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, color: C.amber }}>♟</span>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.04em' }}>
            Lantern Chess
          </span>
          <span style={{ fontSize: 11, color: C.ghost }}>/ Tournament</span>
        </div>
        <button
          onClick={() => setGamePhase('entry')}
          style={{
            background: 'transparent', border: `1px solid ${C.line}`,
            color: C.muted, padding: '6px 14px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12,
          }}>
          ← Back
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '60px 24px',
      }}>

        {/* Empty state hero */}
        <div style={{ textAlign: 'center', maxWidth: 480, marginBottom: 64 }}>
          <div style={{
            fontSize: 72, marginBottom: 24, lineHeight: 1,
            filter: 'grayscale(0.6) opacity(0.5)',
          }}>🏆</div>
          <div style={{
            fontFamily: "'Roboto Mono', monospace",
            fontSize: 22, fontWeight: 700, letterSpacing: '0.12em',
            color: C.text, marginBottom: 12, textTransform: 'uppercase',
          }}>
            No Tournaments Right Now
          </div>
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
            Tournaments are being built. When they launch, you'll be able
            to enter ELO-ranked brackets, stake XLM on your games,
            and compete for prize pools.
          </div>
        </div>

        {/* What to expect section */}
        <div style={{ width: '100%', maxWidth: 640, marginBottom: 48 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.ghost,
            marginBottom: 20, paddingBottom: 8,
            borderBottom: `1px solid ${C.line}`,
          }}>
            What's Coming
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { icon: '⚔', title: 'Bracket Play',  desc: 'Single & double elimination · auto-seeded by ELO' },
              { icon: '⚡', title: 'XLM Prize Pools', desc: 'Entry fees pooled · winner takes the pot' },
              { icon: '🔒', title: 'ZK Verified',   desc: 'Every move proven · fog rules enforced on-chain' },
              { icon: '★', title: 'ELO Impact',     desc: 'Tournament wins count double toward your rating' },
            ].map(f => (
              <div key={f.title} style={{
                padding: '18px 20px',
                background: C.bg2,
                border: `1px solid ${C.line}`,
              }}>
                <div style={{ fontSize: 20, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: C.ghost, lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Placeholder upcoming tournament */}
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: C.ghost,
            marginBottom: 16, paddingBottom: 8,
            borderBottom: `1px solid ${C.line}`,
          }}>
            Upcoming
          </div>
          <div style={{
            padding: '20px 24px',
            background: C.bg2,
            border: `1px solid ${C.line}`,
            opacity: 0.5,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 20,
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                Fog of War Open #1
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>
                16 players · Double elimination · 5 XLM entry
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{
                fontFamily: "'Roboto Mono', monospace",
                fontSize: 12, color: C.ghost,
              }}>TBA</div>
              <div style={{
                marginTop: 8, padding: '5px 12px',
                border: `1px solid ${C.line}`,
                fontSize: 11, color: C.ghost, cursor: 'not-allowed',
              }}>
                Register
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Show entry screen before game
  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const blackAddr = myColor === 'black' ? address : (player2Address || null);
  const whiteAddr = myColor === 'white' ? address : (whiteAddress || null);

  if (gamePhase === 'entry')      return <EntryScreen />;
  if (gamePhase === 'tournament') return <TournamentPage />;

  return (
    <div className="lc" style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: C.bg1, color: C.text }}>

      {/* ── MODALS ────────────────────────────────────────────────────── */}
      {gameOver && winner && (() => {
        const won = (myColor === 'white' && winner === 'White') || (myColor === 'black' && winner === 'Black');
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(10,9,8,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="lc-fadein" style={{ width: 300, padding: '32px 28px', background: C.bg2, border: `1px solid ${won ? C.amber : C.line}` }}>
              <div style={{ fontSize: 13, color: C.ghost, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                {won ? 'Victory' : 'Defeat'}
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: won ? C.amberLt : C.text, marginBottom: 4 }}>{winner} wins</div>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 22 }}>Session {sessionId}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="lc-btn lc-btn-gold" onClick={handlePlayAgain}>Play Again</button>
                <button className="lc-btn" onClick={() => { disconnect(); handlePlayAgain(); }}>Exit</button>
              </div>
              <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', marginTop: 16, fontSize: 13, color: C.ghost, textDecoration: 'none', textAlign: 'center' }}>
                verify on stellar explorer →
              </a>
            </div>
          </div>
        );
      })()}

      {showStakeModal && (
        <StakeModal
          staking={staking}
          myColor={myColor === 'black' ? 'black' : 'white'}
          onStartGame={myColor === 'black' ? handleConfirmJoin : handleConfirmStart}
          onSkip={() => { setShowStakeModal(false); myColor === 'black' ? handleConfirmJoin() : handleConfirmStart(); }}
        />
      )}

      {/* ── SOUND MODAL ─────────────────────────────────── */}
      {soundModalOpen && (
        <div style={{
          position:'fixed', inset:0, zIndex:300,
          display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
          paddingTop:48, paddingRight:16,
        }} onClick={() => setSoundModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width:220, background:C.bg2,
            border:`1px solid ${C.line}`,
            padding:20,
            boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:20, letterSpacing:'0.04em' }}>
              🔊 Sound
            </div>
            {/* Music toggle */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div>
                <div style={{ fontSize:14, color:C.text, fontWeight:500 }}>Music</div>
                <div style={{ fontSize:12, color:C.muted }}>Ambient gameplay drone</div>
              </div>
              <button onClick={sound.toggleMusic} style={{
                width:44, height:24, border:`1px solid ${sound.musicOn ? C.amber : C.line}`,
                background: sound.musicOn ? C.amber : C.bg3,
                cursor:'pointer', position:'relative', transition:'all 0.2s',
              }}>
                <div style={{
                  position:'absolute', top:3, left: sound.musicOn ? 22 : 3,
                  width:16, height:16, background: sound.musicOn ? C.bg0 : C.muted,
                  transition:'left 0.2s',
                }} />
              </button>
            </div>
            {/* Voice toggle */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:14, color:C.text, fontWeight:500 }}>Voice</div>
                <div style={{ fontSize:12, color:C.muted }}>Game announcements</div>
              </div>
              <button onClick={sound.toggleVoice} style={{
                width:44, height:24, border:`1px solid ${sound.voiceOn ? C.amber : C.line}`,
                background: sound.voiceOn ? C.amber : C.bg3,
                cursor:'pointer', position:'relative', transition:'all 0.2s',
              }}>
                <div style={{
                  position:'absolute', top:3, left: sound.voiceOn ? 22 : 3,
                  width:16, height:16, background: sound.voiceOn ? C.bg0 : C.muted,
                  transition:'left 0.2s',
                }} />
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.message && (
        <div className="lc-fadein" style={{
          position: 'fixed', top: 46, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          padding: '5px 14px', background: C.bg2, border: `1px solid ${C.line}`,
          fontSize: 14, fontFamily: "'Roboto Mono', monospace", pointerEvents: 'none', whiteSpace: 'nowrap',
          color: toast.type === 'error' ? C.red : toast.type === 'success' ? C.green : C.text,
        }}>
          {toast.message}
        </div>
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 14px', background: C.bg2, borderBottom: `1px solid ${C.line}` }}>

        {/* Brand — left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ fontSize: 16, color: C.amber, lineHeight: 1 }}>♟</span>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}>Lantern Chess</span>
          {!isMobile && (
            <span style={{ fontSize: 12, color: C.ghost, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ZK Fog · Stellar
            </span>
          )}
        </div>

        {/* Clocks — center (desktop, in-game) */}
        {gameStarted && !isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {[
              { color: 'white', sym: '○', time: whiteTime, low: whiteTimeLow },
              { color: 'black', sym: '●', time: blackTime, low: blackTimeLow },
            ].map(({ color, sym, time, low }) => (
              <div key={color} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px',
                border: `1px solid ${currentPlayer === color ? C.amber : C.line}`,
                background: currentPlayer === color ? 'rgba(184,134,11,0.07)' : 'transparent',
              }}>
                <span style={{ fontSize: 13, color: C.muted }}>{sym}</span>
                <span className={`lc-mono${low && currentPlayer === color ? ' lc-pulse' : ''}`} style={{
                  fontSize: 14, fontWeight: 700,
                  color: low && currentPlayer === color ? C.red : currentPlayer === color ? C.amberLt : C.muted,
                }}>
                  {formatTime(time)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Status pills — right */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>

          {/* Sound toggle */}
          <button onClick={() => setSoundModalOpen(v => !v)} title="Sound settings" style={{
            background:'transparent', border:`1px solid ${C.line}`,
            color: (sound.musicOn || sound.voiceOn) ? C.amber : C.muted,
            width:34, height:26, cursor:'pointer', fontSize:14,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            {sound.musicOn || sound.voiceOn ? '🔊' : '🔇'}
          </button>

          {/* ELO — always shown once wallet connected */}
          {/* ELO always visible — placeholder until connected */
          true && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px',
              border: `1px solid ${C.line}`,
              background: 'rgba(184,134,11,0.04)',
            }}>
              <span style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em' }}>ELO</span>
              <span className="lc-mono" style={{ fontSize: 16, fontWeight: 700, color: C.amberLt }}>
                {isConnected ? (leaderboard.eloState ? (leaderboard.eloState.gamesPlayed === 0 ? 0 : leaderboard.eloState.rating) : '…') : '—'}
              </span>
              {leaderboard.lastDelta !== null && (
                <span className="lc-mono" style={{
                  fontSize: 13, fontWeight: 600,
                  color: leaderboard.lastDelta >= 0 ? C.green : C.red,
                }}>
                  {leaderboard.lastDelta >= 0 ? '+' : ''}{leaderboard.lastDelta}
                </span>
              )}
              <span style={{ fontSize: 11, color: C.ghost }}>
                {leaderboard.eloState?.wins ?? 0}W&nbsp;{leaderboard.eloState?.losses ?? 0}L
              </span>
            </div>
          )}

          {staking.status === 'matched' && (
            <span className="lc-mono" style={{ fontSize: 13, color: C.amber }}>⚡ {staking.payout?.potXLM} XLM</span>
          )}
          <span style={{
            fontSize: 12, padding: '2px 8px', fontFamily: "'Roboto Mono', monospace", letterSpacing: '0.06em',
            background: isBoardSealed ? 'rgba(39,174,96,0.1)' : 'rgba(184,134,11,0.08)',
            border: `1px solid ${isBoardSealed ? 'rgba(39,174,96,0.3)' : 'rgba(184,134,11,0.2)'}`,
            color: isBoardSealed ? C.green : C.amber,
          }}>
            {isBoardSealed ? 'ON-CHAIN' : 'LOCAL'}
          </span>
          {isLoading && (
            <span className="lc-mono lc-pulse" style={{ fontSize: 13, color: C.amber }}>
              {isVerifying ? 'ZK…' : '…'}
            </span>
          )}
        </div>
      </div>


      {/* ── MAIN LAYOUT ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── LEFT SIDEBAR — desktop ────────────────────────────────────── */}
        {!isMobile && (
          <div style={{
            width: leftCollapsed ? 52 : 220,
            minWidth: leftCollapsed ? 52 : 220,
            flexShrink: 0, background: C.bg2,
            borderRight: `1px solid ${C.line}`,
            display: 'flex', flexDirection: 'column',
            minHeight: 0, overflow: 'hidden',
            transition: 'width 0.2s ease, min-width 0.2s ease',
          }}>
            <LeftSidebarPanel />
          </div>
        )}

        {/* Board column */}
        <div style={{
          flex: 1, minWidth: 0,
          display: (isMobile && activeTab !== 'board') ? 'none' : 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: isMobile ? 8 : 24,
        }}>
          {/* Constrained board container */}
          <div style={{ width: 'min(calc(100vw - 48px), calc(100vh - 160px), 560px)', maxWidth: '100%' }}>

            {/* Black player strip — top */}
            <PlayerStrip color="black" time={blackTime}
              isActive={currentPlayer === 'black' && gameStarted} addr={blackAddr} />

            {/* THE BOARD */}
            <div style={{
              width: '100%', paddingBottom: '100%', position: 'relative', overflow:'hidden',
              opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.15s',
            }}>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gridTemplateRows: 'repeat(8,1fr)' }}>
                {Array.from({ length: 64 }).map((_, i) => {
                  const row = myColor === 'black' ? 7 - Math.floor(i / 8) : Math.floor(i / 8);
                  const col = myColor === 'black' ? 7 - (i % 8) : i % 8;
                  return renderTile(row, col);
                })}
              </div>
            </div>

            {/* White player strip — bottom */}
            <PlayerStrip color="white" time={whiteTime}
              isActive={currentPlayer === 'white' && gameStarted} addr={whiteAddr} />

            {/* AI thinking overlay */}
            {aiThinking && (
              <div style={{
                position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
                background:'rgba(0,0,0,0.35)', zIndex:10, pointerEvents:'none',
              }}>
                <div style={{ fontFamily:"'Roboto Mono',monospace", fontSize:16, color:C.amberLt, letterSpacing:'0.1em' }}>
                  🤖 Thinking…
                </div>
              </div>
            )}

            {/* Invalid move note */}
            {invalidMoveMsg && (
              <div className="lc-mono lc-fadein" style={{ marginTop: 6, textAlign: 'center', fontSize: 14, color: C.red }}>
                {invalidMoveMsg}
              </div>
            )}

            {/* Mobile clocks */}
            {isMobile && gameStarted && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {[
                  { color: 'white', label: '○ White', time: whiteTime, low: whiteTimeLow },
                  { color: 'black', label: '● Black', time: blackTime, low: blackTimeLow },
                ].map(({ color, label, time, low }) => (
                  <div key={color} style={{
                    flex: 1, padding: '7px 10px', textAlign: 'center',
                    border: `1px solid ${currentPlayer === color ? C.amber : C.line}`,
                    background: currentPlayer === color ? 'rgba(184,134,11,0.05)' : C.bg2,
                  }}>
                    <div className={`lc-mono${low && currentPlayer === color ? ' lc-pulse' : ''}`} style={{
                      fontSize: 18, fontWeight: 700,
                      color: low && currentPlayer === color ? C.red : currentPlayer === color ? C.amberLt : C.muted,
                    }}>
                      {formatTime(time)}
                    </div>
                    <div style={{ fontSize: 12, color: C.ghost, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR — desktop ──────────────────────────────────── */}
        {!isMobile && (
          <div style={{ width: sidebarCollapsed ? 52 : 320, minWidth: sidebarCollapsed ? 52 : 320, flexShrink: 0, background: C.bg2, borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', transition: 'width 0.2s ease' }}>
            <SidebarPanel />
          </div>
        )}

        {/* ── MOBILE PANELS ───────────────────────────────────────────── */}
        {isMobile && activeTab === 'game' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {/* Compact mobile game panel */}
            {!isConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="lc-section-hdr">Wallet</div>
                <button className="lc-btn lc-btn-gold" onClick={connectFreighter} disabled={isConnecting}>
                  {isConnecting ? 'Connecting…' : 'Connect Freighter'}
                </button>
                {DevWalletService.isDevModeAvailable() && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="lc-btn" onClick={() => connectDev(1)} style={{ flex: 1 }}>Dev P1</button>
                    <button className="lc-btn" onClick={() => connectDev(2)} style={{ flex: 1 }}>Dev P2</button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="lc-mono" style={{ fontSize: 14, color: C.green }}>{shortAddr}</span>
                  <button className="lc-btn" onClick={disconnect} style={{ width: 'auto', padding: '4px 10px', fontSize: 13 }}>Disconnect</button>
                </div>
                {!gameStarted && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="lc-section-hdr">New Game</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: C.bg0, border: `1px solid ${C.line}`, padding: '6px 8px' }}>
                        <span className="lc-mono" style={{ flex: 1, fontSize: 13, color: C.amber, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionId}</span>
                        <button className="lc-btn" style={{ width: 'auto', padding: '2px 8px', fontSize: 13 }} onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied','success'); }}>Copy</button>
                      </div>
                      <input className="lc-input" placeholder="Opponent address  G…" value={player2Address} onChange={e => setPlayer2Address(e.target.value)} />
                      <button className="lc-btn lc-btn-gold" onClick={() => { setAiMode(false); handleStartGame(); }} disabled={isCommitting}>{isCommitting ? 'Setting up…' : '⚔ Start Multiplayer'}</button>
                      <button className="lc-btn" onClick={handleStartAI} style={{ background:'#1a2a1a', borderColor:'#2a4a2a', color:'#6fd96f' }}>🤖 Play vs AI</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="lc-section-hdr">Join Game</div>
                      <input className="lc-input" placeholder="Session ID" value={joinSessionId} onChange={e => setJoinSessionId(e.target.value)} />
                      <button className="lc-btn lc-btn-blue" onClick={handleJoinGame} disabled={isCommitting}>{isCommitting ? 'Joining…' : 'Join'}</button>
                    </div>
                  </>
                )}
                {gameStarted && staking.status === 'matched' && (
                  <div style={{ padding: '10px 12px', border: `1px solid rgba(184,134,11,0.25)`, background: 'rgba(184,134,11,0.05)' }}>
                    <div style={{ fontSize: 13, color: C.ghost, marginBottom: 3 }}>ACTIVE STAKE</div>
                    <div className="lc-mono" style={{ fontSize: 17, color: C.amberLt, fontWeight: 700 }}>⚡ {staking.payout?.potXLM} XLM</div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Winner gets {staking.payout?.winnerXLM} XLM</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {isMobile && activeTab === 'ranks' && (
          <div style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
            <LeaderboardPanel leaderboard={leaderboard} address={address} compact />
          </div>
        )}
        {isMobile && activeTab === 'pool' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            <SpectatorPanel betting={spectator} gameStarted={gameStarted} gameOver={gameOver} />
          </div>
        )}
        {isMobile && activeTab === 'mode' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            <LeftSidebarPanel />
          </div>
        )}

      {/* ── MOBILE TAB BAR — fixed bottom ────────────────────────────────── */}
      {isMobile && (
        <div style={{ display: 'flex', background: C.bg2, borderTop: `1px solid ${C.line}`, flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {[
            { id: 'board', icon: '♟', label: 'Board', alert: isMyTurn && gameStarted && !gameOver },
            { id: 'mode',  icon: '⊞', label: 'Mode',  alert: false },
            { id: 'game',  icon: '☰', label: 'Game',  alert: false },
            { id: 'ranks', icon: '★', label: 'Ranks', alert: leaderboard.lastDelta !== null },
            { id: 'pool',  icon: '⚡', label: 'Bets',  alert: (spectator.poolState?.totalXLM ?? 0) > 0 },
            { id: 'tourn', icon: '🏆', label: 'Event', alert: false },
          ].map(t => {
            const isOn = activeTab === t.id;
            return (
              <button key={t.id}
                onClick={() => t.id === 'tourn' ? setGamePhase('tournament') : setActiveTab(t.id)}
                style={{
                  flex: 1, padding: '6px 0', background: 'transparent',
                  border: 'none', borderTop: `2px solid ${isOn ? C.amber : 'transparent'}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  cursor: 'pointer', position: 'relative',
                }}>
                <span style={{ fontSize: 16, lineHeight: 1, color: isOn ? C.amberLt : C.muted }}>{t.icon}</span>
                <span style={{ fontSize: 9, letterSpacing: '0.04em', color: isOn ? C.amber : C.ghost, fontFamily: "'Noto Sans',system-ui,sans-serif", fontWeight: isOn ? 600 : 400 }}>{t.label}</span>
                {t.alert && <span style={{ position: 'absolute', top: 4, right: '20%', width: 5, height: 5, borderRadius: '50%', background: C.green }} />}
              </button>
            );
          })}
        </div>
      )}

      </div>
    </div>
  );
};

export default LanternChess;