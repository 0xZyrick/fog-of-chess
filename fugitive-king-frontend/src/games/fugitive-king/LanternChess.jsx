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
        style={{ background: '#0d1117', borderColor: isWinner ? 'rgba(251,191,36,0.4)' : 'rgba(99,102,241,0.3)' }}>
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

  // refs to avoid stale closures in subscriptions
  const lastProcessedMove  = useRef(-1);
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

  // Supabase subscription
  useEffect(() => {
    if (!gameStarted) return;
    const unsub = subscribeMoves(sessionId, (move) => {
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
  }, [gameStarted, sessionId]);

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

  const handleStartGame = async () => {
    if (!address)               { addLog('ERROR: Connect wallet first'); return; }
    if (!player2Address.trim()) { addLog('ERROR: Enter Player 2 address'); return; }
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
      setIsMyTurn(true);
      setGameStarted(true);
      setIsBoardSealed(true);
      setActiveTab('board');
      addLog(`ON-CHAIN: Session ${sessionId} started — You are WHITE`);
      showToast('Game started! Share Session ID with opponent', 'chain');
    } catch(e) { addLog('ERROR: Failed to start'); console.error(e); }
    finally    { setIsCommitting(false); }
  };

  const handleJoinGame = async () => {
    if (!address)       { addLog('ERROR: Connect wallet first'); return; }
    if (!joinSessionId) { addLog('ERROR: Enter Session ID'); return; }
    try {
      setIsCommitting(true);
      addLog('Initializing commitments...');
      const committed = await initializePieceCommitments(pieces);
      setPieces(committed);
      await zkManager.commitBoard(address, getContractSigner(), committed);
      setSessionId(Number(joinSessionId));
      setMyColor('black');
      myColorRef.current = 'black';
      setIsMyTurn(false);
      setGameStarted(true);
      setIsBoardSealed(true);
      setActiveTab('board');
      addLog(`Joined session ${joinSessionId} — You are BLACK — waiting for White…`);
      showToast('Joined! Waiting for White to move…', 'chain');
    } catch(e) { addLog('ERROR: Failed to join'); console.error(e); }
    finally    { setIsCommitting(false); }
  };

  const handleEndGame = async (whiteWon) => {
    if (!address) return;
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

      setIsVerifying(true);
      addLog('ZK: Generating proof...');
      try {
        const proof     = await zkManager.getProofFromProver(movingPiece, row, col);
        const isCapture = !!(clickedPiece && clickedPiece.color !== myColor);
        const isKingCap = isCapture && clickedPiece?.type === 'king';

        await broadcastMove({
          session_id: sessionId, player: address,
          from_row: movingPiece.row, from_col: movingPiece.col,
          to_row: row, to_col: col,
          is_capture: isCapture, move_count: moveCountRef.current + 1, proof_seal: proof.seal,
        });

        executeMove(movingPiece.id, row, col, isCapture);
        lastProcessedMove.current = moveCountRef.current + 1;

        // FIX (main freeze): After executeMove, commitment is cleared (null) for the moved
        // piece. Recompute it at the new position so the piece can be moved again later.
        // Without this, any piece that has moved before throws "Piece has no commitment"
        // and silently fails, making the game appear frozen.
        const newSalt = Math.floor(Math.random() * 0xffffffff);
        const newCommitment = await computeCommitment(row, col, newSalt);
        setPieces(prev => prev.map(p =>
          p.id === movingPiece.id ? { ...p, salt: newSalt, commitment: newCommitment } : p
        ));
        setIsMyTurn(false);
        addLog(isCapture ? 'SUCCESS: Move sent — piece captured!' : 'SUCCESS: Move sent ✓');

        if (isKingCap) {
          const whiteWon = myColor === 'white';
          setGameOver(true); setWinner(whiteWon ? 'White' : 'Black');
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

  const renderTile = (r, c) => {
    const piece      = pieces.find(p => p.row === r && p.col === c);
    const isSelected = selectedPieceId === piece?.id;
    const isOwnPiece = myColor ? piece?.color === myColor : piece?.color === currentPlayer;
    const isEnemy    = piece && !isOwnPiece;
    const isThreat   = threatMap[r][c];
    const base       = (r+c)%2===0 ? '#1e2640' : '#252e4a';

    return (
      <div key={`${r}-${c}`} onClick={() => handleTileClick(r,c)}
        className="relative flex items-center justify-center cursor-pointer overflow-hidden"
        style={{ aspectRatio:'1', backgroundColor: base, outline: isSelected ? '3px solid rgba(251,191,36,0.9)' : 'none', outlineOffset:'-3px' }}>
        {isOwnPiece && <div className="absolute inset-0 pointer-events-none" style={{ background:'radial-gradient(ellipse at center,rgba(251,191,36,0.07) 0%,transparent 80%)' }}/>}
        {isOwnPiece && (
          <div className="flex items-center justify-center w-full h-full z-20">
            <span className="text-3xl md:text-4xl select-none"
              style={{ color: piece.color==='white' ? '#e8dcc8' : '#1a1a2e', filter: piece.color==='white' ? 'drop-shadow(0 0 8px rgba(251,191,36,0.5))' : 'drop-shadow(0 0 8px rgba(255,255,255,0.6)) drop-shadow(0 0 2px rgba(255,255,255,0.9))' }}>
              {PIECE_SYMBOLS[piece.color][piece.type]}
            </span>
          </div>
        )}
        {isEnemy && isThreat && (
          <div className="z-20 flex items-center justify-center w-full h-full">
            <div className="w-3 h-3 rounded-full animate-pulse" style={{ background:'radial-gradient(circle,#ff4444 0%,#991111 100%)', boxShadow:'0 0 10px 3px rgba(255,50,50,0.7)' }}/>
          </div>
        )}
        {isEnemy && !isThreat && (
          <div className="z-20 flex items-center justify-center w-full h-full">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background:'rgba(180,180,200,0.35)', border:'1px solid rgba(180,180,200,0.5)' }}/>
          </div>
        )}
      </div>
    );
  };

  const isLoading    = isVerifying || isCommitting;
  const shortAddr    = address ? `${address.substring(0,5)}…${address.substring(51)}` : null;
  const whiteTimeLow = whiteTime < 30;
  const blackTimeLow = blackTime < 30;

  // ── SIDEBAR CONTENT (desktop) ────────────────────────────────────────────
  const SidebarContent = () => (
    <>
      {/* Wallet */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
        <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">Wallet</h3>
        {!isConnected ? (
          <div className="space-y-2">
            <button onClick={connectFreighter} disabled={isConnecting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-bold transition-colors">
              {isConnecting ? 'Connecting...' : '🔗 Connect Freighter'}
            </button>
            {DevWalletService.isDevModeAvailable() && (
              <div className="flex gap-2">
                <button onClick={() => connectDev(1)} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold">Dev P1</button>
                <button onClick={() => connectDev(2)} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold">Dev P2</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-green-400 font-mono">{walletType==='wallet'?'🔗':'🛠'} {shortAddr}</div>
              {myColor && <div className={`text-[10px] mt-0.5 font-bold ${myColor==='white'?'text-white':'text-gray-400'}`}>Playing as {myColor.toUpperCase()}</div>}
            </div>
            <button onClick={disconnect} className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-400">✕</button>
          </div>
        )}
      </div>

      {/* Start / Join — only before game */}
      {!gameStarted && isConnected && (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 space-y-3">
          <h3 className="text-[10px] text-gray-500 uppercase tracking-wider">Play</h3>
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 font-semibold">Start New Game</p>
            <div className="text-[10px] text-gray-500">Your Session ID:</div>
            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
              <span className="text-blue-400 font-mono text-[10px] flex-1 truncate">{sessionId}</span>
              <button onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied!','success'); }}
                className="text-[9px] bg-gray-700 hover:bg-gray-600 px-2 py-0.5 rounded shrink-0">Copy</button>
            </div>
            <input type="text" placeholder="Player 2 address (G...)"
              value={player2Address} onChange={e => setPlayer2Address(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 rounded text-xs text-white placeholder-gray-500 font-mono border border-gray-700 focus:border-blue-500 outline-none"/>
            <button onClick={handleStartGame} disabled={isCommitting}
              className="w-full py-2.5 text-white bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg text-xs font-bold">
              {isCommitting ? 'Setting up...' : 'Confirm & Start'}
            </button>
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <p className="text-[10px] text-gray-400 font-semibold">Join Existing Game</p>
            <input type="text" placeholder="Session ID from opponent"
              value={joinSessionId} onChange={e => setJoinSessionId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 text-white placeholder-gray-500 rounded text-xs font-mono border border-gray-700 focus:border-blue-500 outline-none"/>
            <button onClick={handleJoinGame} disabled={isCommitting}
              className="w-full py-2.5 text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-lg text-xs font-bold">
              {isCommitting ? 'Joining...' : 'Join Game'}
            </button>
          </div>
        </div>
      )}

      {/* Session ID after start */}
      {gameStarted && myColor === 'white' && (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
          <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Share with Opponent</h3>
          <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
            <span className="text-blue-400 font-mono text-[10px] flex-1 truncate">{sessionId}</span>
            <button onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied!','success'); }}
              className="text-[9px] bg-gray-700 hover:bg-gray-600 px-2 py-0.5 rounded shrink-0">Copy</button>
          </div>
        </div>
      )}

      {/* Game status */}
      {gameStarted && (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
          <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Game</h3>
          <div className={`text-sm font-bold mb-1 ${gameOver ? 'text-yellow-400' : kingInCheck ? 'text-red-400 animate-pulse' : isMyTurn ? 'text-green-400' : 'text-gray-400'}`}>
            {gameOver ? `${winner} Wins!` : kingInCheck ? `⚠ CHECK` : isMyTurn ? '● YOUR TURN' : '⏳ Opponent…'}
          </div>
          <div className="text-xs text-gray-500">Moves: {moveCount}</div>
          {opponentOnline && <div className="text-[10px] text-green-400 mt-1">● Opponent online</div>}
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" style={{ boxShadow:'0 0 5px rgba(239,68,68,.8)' }}/>
              <span>Enemy can take your piece</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background:'rgba(180,180,200,0.35)', border:'1px solid rgba(180,180,200,0.5)' }}/>
              <span>Enemy visible, no threat</span>
            </div>
          </div>
        </div>
      )}

      {/* Activity log */}
      <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 flex-1 min-h-0">
        <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Activity</h3>
        <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '220px' }}>
          {logs.map((log, i) => (
            <div key={i} className={`text-[10px] font-mono leading-snug ${
              log.startsWith('INVALID')||log.startsWith('ERROR') ? 'text-red-400' :
              log.startsWith('SUCCESS') ? 'text-green-400' :
              log.startsWith('ZK')      ? 'text-blue-400' :
              log.startsWith('ON-CHAIN')? 'text-purple-400' :
              log.startsWith('GAME OVER')? 'text-yellow-400' :
              log.startsWith('Opponent') ? 'text-cyan-400' :
              'text-gray-500'
            }`}>{'>'} {log}</div>
          ))}
        </div>
      </div>
    </>
  );

  // ── MOBILE GAME TAB CONTENT ───────────────────────────────────────────────
  const MobileGameTab = () => (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
        <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Wallet</h3>
        {!isConnected ? (
          <div className="space-y-2">
            <button onClick={connectFreighter} disabled={isConnecting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold">
              {isConnecting ? 'Connecting...' : '🔗 Connect Freighter'}
            </button>
            {DevWalletService.isDevModeAvailable() && (
              <div className="flex gap-2">
                <button onClick={() => connectDev(1)} className="flex-1 py-2 bg-gray-700 rounded text-xs font-bold">Dev P1</button>
                <button onClick={() => connectDev(2)} className="flex-1 py-2 bg-gray-700 rounded text-xs font-bold">Dev P2</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-green-400 font-mono">{walletType==='wallet'?'🔗':'🛠'} {shortAddr}</div>
              {myColor && <div className={`text-[10px] mt-0.5 font-bold ${myColor==='white'?'text-white':'text-gray-400'}`}>Playing as {myColor.toUpperCase()}</div>}
            </div>
            <button onClick={disconnect} className="text-[10px] px-2 py-1 bg-gray-800 rounded text-gray-400">✕</button>
          </div>
        )}
      </div>

      {!gameStarted && isConnected && (
        <div className="bg-gray-900 p-3 rounded-lg border border-gray-800 space-y-3">
          <div className="space-y-2">
            <p className="text-xs text-gray-300 font-semibold">Start New Game</p>
            <div className="text-[10px] text-gray-500">Your Session ID (share with opponent):</div>
            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
              <span className="text-blue-400 font-mono text-xs flex-1">{sessionId}</span>
              <button onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied!','success'); }}
                className="text-[10px] bg-gray-700 px-2 py-0.5 rounded shrink-0">Copy</button>
            </div>
            <input type="text" placeholder="Player 2 address (G...)"
              value={player2Address} onChange={e => setPlayer2Address(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 rounded text-xs font-mono border border-gray-700 outline-none"/>
            <button onClick={handleStartGame} disabled={isCommitting}
              className="w-full py-2.5 bg-green-700 rounded-lg text-xs font-bold disabled:opacity-50">
              {isCommitting ? 'Setting up...' : 'Confirm & Start'}
            </button>
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <p className="text-xs text-gray-300 font-semibold">Join Existing Game</p>
            <input type="text" placeholder="Session ID from opponent"
              value={joinSessionId} onChange={e => setJoinSessionId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 rounded text-xs font-mono border border-gray-700 outline-none"/>
            <button onClick={handleJoinGame} disabled={isCommitting}
              className="w-full py-2.5 bg-blue-700 rounded-lg text-xs font-bold disabled:opacity-50">
              {isCommitting ? 'Joining...' : 'Join Game'}
            </button>
          </div>
        </div>
      )}

      {gameStarted && myColor === 'white' && (
        <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
          <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Share Session ID</h3>
          <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
            <span className="text-blue-400 font-mono text-xs flex-1">{sessionId}</span>
            <button onClick={() => { navigator.clipboard.writeText(String(sessionId)); showToast('Copied!','success'); }}
              className="text-[10px] bg-gray-700 px-2 py-0.5 rounded">Copy</button>
          </div>
        </div>
      )}

      {gameStarted && (
        <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] text-gray-500 uppercase tracking-wider">Status</h3>
            {opponentOnline && <span className="text-[10px] text-green-400">● Opponent online</span>}
          </div>
          <div className={`text-sm font-bold ${gameOver?'text-yellow-400':kingInCheck?'text-red-400 animate-pulse':isMyTurn?'text-green-400':'text-gray-400'}`}>
            {gameOver?`${winner} Wins!`:kingInCheck?'⚠ CHECK':isMyTurn?'● YOUR TURN':'⏳ Opponent…'}
          </div>
          <div className="text-xs text-gray-500 mt-1">Moves: {moveCount}</div>
        </div>
      )}

      <div className="bg-gray-900 p-3 rounded-lg border border-gray-800">
        <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Activity</h3>
        <div className="space-y-1">
          {logs.slice(-8).map((log, i) => (
            <div key={i} className={`text-[10px] font-mono ${
              log.startsWith('INVALID')||log.startsWith('ERROR')?'text-red-400':
              log.startsWith('SUCCESS')?'text-green-400':
              log.startsWith('ZK')?'text-blue-400':
              log.startsWith('ON-CHAIN')?'text-purple-400':
              log.startsWith('GAME OVER')?'text-yellow-400':
              log.startsWith('Opponent')?'text-cyan-400':'text-gray-500'
            }`}>{'>'} {log}</div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col text-white relative" style={{ background:'#0d1117' }}>

      {/* Game Over Overlay */}
      {gameOver && winner && (
        <GameOverOverlay
          winner={winner}
          myColor={myColor}
          sessionId={sessionId}
          onPlayAgain={handlePlayAgain}
          onClose={() => { disconnect(); handlePlayAgain(); }}
        />
      )}

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="bg-gray-950 border-b border-gray-800 px-3 py-2 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-sm shrink-0">♟</div>
          <div className="flex flex-col leading-none">
            <span className="font-bold text-sm text-blue-400">LANTERN CHESS</span>
            <span className="text-[8px] text-gray-500 tracking-widest uppercase hidden sm:block">ZK Fog of War · Stellar</span>
          </div>
          <div className={`px-1.5 py-0.5 rounded text-[8px] font-bold shrink-0 ${isBoardSealed?'bg-green-500/20 text-green-400':'bg-yellow-500/20 text-yellow-400'}`}>
            {isBoardSealed?'● CHAIN':'● LOCAL'}
          </div>
          {gameOver && <span className="text-yellow-400 text-xs font-bold">🏆 {winner}!</span>}
          {isVerifying  && <span className="text-blue-400 text-[9px] animate-pulse">ZK…</span>}
          {isCommitting && <span className="text-yellow-400 text-[9px] animate-pulse">…</span>}
        </div>

        {gameStarted && (
          <div className="flex gap-1.5 shrink-0">
            <div className={`text-[10px] font-mono font-bold px-2 py-1 rounded border transition-colors ${currentPlayer==='white'?'border-blue-500/60 bg-blue-500/10 text-blue-300':'border-gray-800 text-gray-600'} ${whiteTimeLow&&currentPlayer==='white'?'text-red-400 animate-pulse border-red-500/60':''}`}>
              ♙ {formatTime(whiteTime)}
            </div>
            <div className={`text-[10px] font-mono font-bold px-2 py-1 rounded border transition-colors ${currentPlayer==='black'?'border-blue-500/60 bg-blue-500/10 text-blue-300':'border-gray-800 text-gray-600'} ${blackTimeLow&&currentPlayer==='black'?'text-red-400 animate-pulse border-red-500/60':''}`}>
              ♟ {formatTime(blackTime)}
            </div>
          </div>
        )}

        {isConnected && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-green-400 font-mono">{shortAddr}</span>
          </div>
        )}
      </div>

      {/* ── MOBILE TABS ───────────────────────────────────────────────────── */}
      {isMobile && (
        <div className="flex shrink-0 border-b border-gray-800 bg-gray-950">
          <button onClick={() => setActiveTab('board')}
            className={`flex-1 py-2 text-xs font-bold transition-colors ${activeTab==='board'?'text-blue-400 border-b-2 border-blue-400':'text-gray-500'}`}>
            ♟ Board
          </button>
          <button onClick={() => setActiveTab('game')}
            className={`flex-1 py-2 text-xs font-bold transition-colors relative ${activeTab==='game'?'text-blue-400 border-b-2 border-blue-400':'text-gray-500'}`}>
            ☰ Game
            {isMyTurn && activeTab==='board' && gameStarted && !gameOver && (
              <span className="absolute top-1.5 right-6 w-1.5 h-1.5 bg-green-400 rounded-full" />
            )}
          </button>
        </div>
      )}

      {/* ── TURN / CHECK BANNER ───────────────────────────────────────────── */}
      {gameStarted && !gameOver && (isMobile ? activeTab==='board' : true) && (
        <div className={`shrink-0 flex items-center justify-center py-1.5 text-[10px] font-bold ${kingInCheck?'animate-pulse text-red-300':isMyTurn?'text-green-400':'text-gray-500'}`}
          style={kingInCheck
            ? { background:'linear-gradient(90deg,transparent,rgba(220,38,38,.3),rgba(220,38,38,.5),rgba(220,38,38,.3),transparent)', borderBottom:'1px solid rgba(220,38,38,.4)' }
            : { borderBottom:'1px solid #1f2937' }}>
          {kingInCheck ? `⚠ ${currentPlayer.toUpperCase()} KING IN CHECK` : isMyTurn ? '● YOUR TURN — make a move' : '⏳ Waiting for opponent…'}
        </div>
      )}

      {invalidMoveMsg && !isMobile && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-700/90 backdrop-blur text-white text-xs font-bold px-4 py-2 rounded-lg shadow-xl border border-red-500/50">
          ⚠ {invalidMoveMsg}
        </div>
      )}
      <Toast message={toast.message} type={toast.type} />

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        <div className={`flex-1 flex items-center justify-center p-2 md:p-4 min-w-0 ${isMobile && activeTab==='game' ? 'hidden' : 'flex'}`}>
          <div className="rounded-sm"
            style={{
              width:  'min(calc(100vw - 16px), calc(100vh - 160px), 580px)',
              height: 'min(calc(100vw - 16px), calc(100vh - 160px), 580px)',
              border: '2px solid #2a3450',
              boxShadow: '0 0 40px rgba(0,0,0,.9)',
              opacity: isLoading ? 0.65 : 1,
              transition: 'opacity .2s',
            }}>
            <div className="grid grid-cols-8 w-full h-full">
              {Array.from({length:64}).map((_,i) => {
                const row = myColor === 'black' ? 7 - Math.floor(i/8) : Math.floor(i/8);
                const col = myColor === 'black' ? 7 - (i%8) : i%8;
                return renderTile(row, col);
              })}
            </div>
          </div>
        </div>

        {isMobile && activeTab === 'game' && <MobileGameTab />}

        <div className="hidden md:flex w-72 shrink-0 flex-col gap-3 p-4 overflow-y-auto border-l border-gray-800">
          <SidebarContent />
        </div>
      </div>
    </div>
  );
};

export default LanternChess;