import React, { useState, useEffect, useCallback } from 'react';
import { useGameLogic } from './useGameLogic';
import { ZKServiceManager, initializePieceCommitments } from './zkServices';
import { INITIAL_PIECES, PIECE_SYMBOLS } from './constants';
import { useWallet } from '../../hooks/useWallet';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { Client as FogOfChessClient } from 'board_commitment_contract';
import { Networks as StellarNetworks } from '@stellar/stellar-sdk';

const CONTRACT_ID = "CCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HT";
const RPC_URL     = "https://soroban-testnet.stellar.org";
const zkManager   = new ZKServiceManager(CONTRACT_ID);

const createSessionId = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] || 1;
};

// ─── TOAST (replaces logs on mobile) ─────────────────────────────────────────
const Toast = ({ message, type }) => {
  if (!message) return null;
  const colors = {
    error:   'bg-red-700/90 border-red-500/50 text-red-100',
    success: 'bg-green-700/90 border-green-500/50 text-green-100',
    zk:      'bg-blue-700/90 border-blue-500/50 text-blue-100',
    chain:   'bg-purple-700/90 border-purple-500/50 text-purple-100',
    default: 'bg-gray-800/90 border-gray-600/50 text-gray-100',
  };
  return (
    <div className={`
      fixed top-14 left-1/2 -translate-x-1/2 z-50
      px-4 py-2 rounded-lg border backdrop-blur text-xs font-bold
      shadow-xl pointer-events-none text-center max-w-[80vw]
      ${colors[type] || colors.default}
    `}>
      {message}
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const LanternChess = () => {
  const { publicKey: address, isConnected, connectDev, getContractSigner } = useWallet();
  const {
    pieces, setPieces, currentPlayer, selectedPieceId, setSelectedPieceId,
    visibilityMap, validateMove, executeMove, kingInCheck, moveCount,
  } = useGameLogic(INITIAL_PIECES);

  const [isVerifying,   setIsVerifying]   = useState(false);
  const [isBoardSealed, setIsBoardSealed] = useState(false);
  const [logs,          setLogs]          = useState(['Game started', 'White to move']);
  const [sessionId]                       = useState(() => createSessionId());
  const [gameStarted,   setGameStarted]   = useState(false);
  const [gameOver,      setGameOver]      = useState(false);
  const [winner,        setWinner]        = useState(null);
  const [player2Address,setPlayer2Address]= useState('');
  const [showP2Input,   setShowP2Input]   = useState(false);
  const [invalidMoveMsg,setInvalidMoveMsg]= useState(null);
  const [isCommitting,  setIsCommitting]  = useState(false);

  // Toast for mobile
  const [toast, setToast] = useState({ message: null, type: 'default' });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const showToast = useCallback((message, type = 'default') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: null, type: 'default' }), 2800);
  }, []);

  const addLog = useCallback((message) => {
    setLogs(prev => [...prev, message].slice(-12));
    // Always show toast on mobile for important messages
    if (isMobile) {
      const type =
        message.startsWith('ERROR') || message.startsWith('INVALID') ? 'error' :
        message.startsWith('SUCCESS') ? 'success' :
        message.startsWith('ZK') ? 'zk' :
        message.startsWith('ON-CHAIN') || message.startsWith('GAME OVER') ? 'chain' : 'default';
      if (type !== 'default') showToast(message, type);
    }
  }, [isMobile, showToast]);

  const showInvalid = (msg) => {
    setInvalidMoveMsg(msg);
    if (isMobile) showToast(`⚠ ${msg}`, 'error');
    setTimeout(() => setInvalidMoveMsg(null), 2500);
  };

  const getClient = () => new FogOfChessClient({
    publicKey: address,
    contractId: CONTRACT_ID,
    networkPassphrase: StellarNetworks.TESTNET,
    rpcUrl: RPC_URL,
  });

  const signAndSubmit = async (tx) => {
    const signer = getContractSigner();
    const result = await signer.signTransaction(tx.built.toXDR(), {
      networkPassphrase: StellarNetworks.TESTNET,
    });
    const server = new Server(RPC_URL);
    const signedTx = TransactionBuilder.fromXDR(result.signedTxXdr, StellarNetworks.TESTNET);
    return server.sendTransaction(signedTx);
  };

  const handleStartGame = async () => {
    if (!address)              { addLog('ERROR: Connect wallet first'); return; }
    if (!player2Address.trim()){ addLog('ERROR: Enter Player 2 address'); return; }
    try {
      setIsCommitting(true);
      addLog('Initializing piece commitments...');
      const committedPieces = await initializePieceCommitments(pieces);
      setPieces(committedPieces);
      addLog('Committing board on-chain...');
      const signer = getContractSigner();
      await zkManager.commitBoard(address, signer, committedPieces);
      addLog('Starting game session...');
      const client = getClient();
      const tx = await client.start_game({
        session_id: sessionId, player1: address, player2: player2Address.trim(),
      });
      await signAndSubmit(tx);
      setGameStarted(true);
      setIsBoardSealed(true);
      setShowP2Input(false);
      addLog(`ON-CHAIN: Session ${sessionId} started`);
      if (isMobile) showToast('Game started on-chain ✓', 'chain');
    } catch (e) {
      addLog('ERROR: Failed to start game');
      console.error(e);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleEndGame = async (whiteWon) => {
    if (!address) return;
    try {
      addLog('Recording result on-chain...');
      const client = getClient();
      const tx = await client.end_game({
        session_id: sessionId, caller: address, player1_won: whiteWon,
      });
      await signAndSubmit(tx);
      addLog('Result recorded on-chain ✓');
    } catch (e) {
      addLog('ERROR: Failed to record result');
      console.error(e);
    }
  };

  const handleTileClick = async (row, col) => {
    if (isVerifying || isCommitting || gameOver) return;
    if (!gameStarted) { addLog('Start the game first!'); return; }

    const clickedPiece = pieces.find(p => p.row === row && p.col === col);
    const movingPiece  = pieces.find(p => p.id === selectedPieceId);

    if (movingPiece) {
      if (clickedPiece && clickedPiece.color === currentPlayer) {
        setSelectedPieceId(clickedPiece.id);
        return;
      }
      const moveResult = validateMove(movingPiece.id, row, col);
      if (!moveResult.valid) {
        showInvalid(moveResult.reason || 'Invalid move');
        addLog(`INVALID: ${moveResult.reason}`);
        setSelectedPieceId(null);
        return;
      }
      setIsVerifying(true);
      addLog('ZK: Generating proof...');
      try {
        const signer = getContractSigner();
        const proof  = await zkManager.getProofFromProver(movingPiece, row, col);
        addLog('ZK: Submitting proof on-chain...');
        await zkManager.verifyAndMoveOnChain(address, signer, sessionId, proof, movingPiece);
        const isCapture    = !!(clickedPiece && clickedPiece.color !== currentPlayer);
        const isKingCapture= isCapture && clickedPiece.type === 'king';
        executeMove(movingPiece.id, row, col, isCapture);
        addLog(isCapture ? 'SUCCESS: Move verified — piece captured!' : 'SUCCESS: Move verified.');
        if (isKingCapture) {
          const whiteWon = movingPiece.color === 'white';
          setGameOver(true);
          setWinner(whiteWon ? 'White' : 'Black');
          addLog(`GAME OVER: ${whiteWon ? 'White' : 'Black'} wins!`);
          await handleEndGame(whiteWon);
        }
      } catch (e) {
        console.error(e);
        addLog('ERROR: Move rejected.');
      } finally {
        setIsVerifying(false);
      }
    } else if (clickedPiece && clickedPiece.color === currentPlayer) {
      setSelectedPieceId(clickedPiece.id);
    }
  };

  // ─── TILE ────────────────────────────────────────────────────────────────
  const renderTile = (r, c) => {
    const piece         = pieces.find(p => p.row === r && p.col === c);
    const isVisible     = visibilityMap[r][c];
    const isSelected    = selectedPieceId === piece?.id;
    const isOwnPiece    = piece?.color === currentPlayer;
    const isOpponentPiece = piece && !isOwnPiece;
    const baseColor     = (r + c) % 2 === 0 ? '#1a2035' : '#212840';

    const renderContent = () => {
      if (piece && isOwnPiece) {
        return (
          <div
            className="select-none z-20"
            style={{
              fontSize: 'clamp(16px, 4.5vmin, 36px)',
              color: piece.color === 'white' ? '#e8dcc8' : '#1a0f05',
              filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.5))',
            }}
          >
            {PIECE_SYMBOLS[piece.color][piece.type]}
          </div>
        );
      }
      if (isOpponentPiece && isVisible) {
        return (
          <div className="z-20">
            <div
              className="rounded-full animate-pulse"
              style={{
                width:  'clamp(8px, 2vmin, 12px)',
                height: 'clamp(8px, 2vmin, 12px)',
                background: 'radial-gradient(circle, #ff4444 0%, #991111 100%)',
                boxShadow: '0 0 8px 2px rgba(255,50,50,0.7)',
              }}
            />
          </div>
        );
      }
      return null;
    };

    return (
      <div
        key={`${r}-${c}`}
        onClick={() => handleTileClick(r, c)}
        className="relative flex items-center justify-center cursor-pointer overflow-hidden"
        style={{
          aspectRatio: '1',
          backgroundColor: baseColor,
          outline: isSelected ? '3px solid rgba(251,191,36,0.9)' : 'none',
          outlineOffset: '-3px',
        }}
      >
        {!isVisible && (
          <div className="absolute inset-0 z-10 pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.45)' }} />
        )}
        {isVisible && (
          <div className="absolute inset-0 z-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at center, rgba(251,191,36,0.07) 0%, transparent 80%)' }} />
        )}
        {renderContent()}
      </div>
    );
  };

  const isLoading     = isVerifying || isCommitting;
  const shortAddr     = address ? `${address.substring(0,6)}...${address.substring(50)}` : null;

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col text-white" style={{ background: '#0d1117' }}>

      {/* ── NAVBAR ── */}
      <div className="shrink-0 bg-gray-950 border-b border-gray-800 px-3 md:px-5 py-2 flex items-center justify-between gap-2">

        {/* Left: logo + status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-base shrink-0">♟</div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="font-bold tracking-tight text-sm text-blue-400 whitespace-nowrap">LANTERN CHESS</span>
            <span className="text-[8px] text-gray-500 tracking-widest uppercase hidden sm:block">ZK Fog of Chess</span>
          </div>
          <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isBoardSealed ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
            {isBoardSealed ? '● ON-CHAIN' : '● LOCAL'}
          </div>
          {isCommitting && <span className="text-yellow-400 text-[9px] animate-pulse hidden sm:block">COMMITTING...</span>}
          {isVerifying   && <span className="text-blue-400   text-[9px] animate-pulse hidden sm:block">ZK PROOF...</span>}
          {gameOver      && <span className="text-yellow-400 text-[9px] font-bold">🏆 {winner} WINS!</span>}
        </div>

        {/* Right: wallet address + connect buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {shortAddr && (
            <span className="text-[9px] font-mono text-gray-500 hidden md:block">{shortAddr}</span>
          )}
          {!isConnected ? (
            <>
              <button
                onClick={() => connectDev(1)}
                className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-[10px] font-bold transition-colors whitespace-nowrap"
              >
                P1 Connect
              </button>
              <button
                onClick={() => connectDev(2)}
                className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-[10px] font-bold transition-colors whitespace-nowrap"
              >
                P2 Connect
              </button>
            </>
          ) : (
            <span className="text-[9px] text-green-400 font-mono">✓ {shortAddr}</span>
          )}
        </div>
      </div>

      {/* ── CHECK BANNER ── */}
      {kingInCheck && !gameOver && (
        <div
          className="shrink-0 flex items-center justify-center gap-2 py-1.5 text-xs font-bold animate-pulse"
          style={{
            background: 'linear-gradient(90deg,transparent,rgba(220,38,38,.3),rgba(220,38,38,.5),rgba(220,38,38,.3),transparent)',
            borderBottom: '1px solid rgba(220,38,38,.4)',
            color: '#fca5a5',
          }}
        >
          ⚠ {currentPlayer.toUpperCase()} KING IN CHECK
        </div>
      )}

      {/* ── INVALID MOVE TOAST (desktop) ── */}
      {invalidMoveMsg && !isMobile && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-700/90 backdrop-blur text-white text-xs font-bold px-4 py-2 rounded-lg shadow-xl border border-red-500/50">
          ⚠ {invalidMoveMsg}
        </div>
      )}

      {/* ── MOBILE TOAST ── */}
      {isMobile && <Toast message={toast.message} type={toast.type} />}

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── BOARD ── */}
        <div className="flex-1 flex items-center justify-center p-2 md:p-4 min-w-0">
          <div
            className="rounded-sm"
            style={{
              width:  'min(calc(100vw - 16px), calc(100vh - 120px), 540px)',
              height: 'min(calc(100vw - 16px), calc(100vh - 120px), 540px)',
              border: '2px solid #2a3450',
              boxShadow: '0 0 40px rgba(0,0,0,.9), 0 0 16px rgba(251,191,36,.05)',
              opacity: isLoading ? 0.7 : 1,
              transition: 'opacity .2s',
            }}
          >
            <div className="grid grid-cols-8 w-full h-full">
              {Array.from({ length: 64 }).map((_, i) => renderTile(Math.floor(i/8), i%8))}
            </div>
          </div>
        </div>

        {/* ── SIDEBAR (desktop only) ── */}
        <div className="hidden md:flex w-56 shrink-0 flex-col gap-3 p-3 overflow-y-auto border-l border-gray-800">

          {/* Start game */}
          {!gameStarted && isConnected && (
            <div className="bg-gray-900 p-3 rounded border border-gray-800">
              <h3 className="text-[9px] text-gray-500 uppercase mb-2 tracking-wider">Start Game</h3>
              {!showP2Input ? (
                <button
                  onClick={() => setShowP2Input(true)}
                  className="w-full py-2 bg-green-700 hover:bg-green-600 rounded text-xs font-bold transition-colors"
                >
                  Start On-Chain
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Player 2 address (G...)"
                    value={player2Address}
                    onChange={e => setPlayer2Address(e.target.value)}
                    className="w-full px-2 py-1.5 bg-gray-800 rounded text-[10px] font-mono border border-gray-700 focus:border-blue-500 outline-none"
                  />
                  <button
                    onClick={handleStartGame}
                    disabled={isCommitting}
                    className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-xs font-bold transition-colors"
                  >
                    {isCommitting ? 'Setting up...' : 'Confirm Start'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Game info */}
          <div className="bg-gray-900 p-3 rounded border border-gray-800">
            <h3 className="text-[9px] text-gray-500 uppercase mb-2 tracking-wider">Game</h3>
            <div className={`text-base font-bold ${kingInCheck ? 'text-red-400 animate-pulse' : 'text-blue-400'}`}>
              {gameOver ? `${winner} Wins!` : `${currentPlayer.toUpperCase()}'S TURN`}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Moves: {moveCount}</div>
            <div className="text-[9px] text-gray-700 font-mono mt-1 truncate">#{sessionId}</div>

            {/* Legend */}
            <div className="mt-2 pt-2 border-t border-gray-800 space-y-1.5">
              <div className="flex items-center gap-2 text-[9px] text-gray-400">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" style={{ boxShadow: '0 0 5px rgba(239,68,68,.8)' }} />
                <span>Enemy (type hidden)</span>
              </div>
              <div className="flex items-center gap-2 text-[9px] text-gray-400">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: '#1a2035', border: '1px solid #2a3450' }} />
                <span>Fog territory</span>
              </div>
            </div>
          </div>

          {/* Activity log */}
          <div className="bg-gray-900 p-3 rounded border border-gray-800 flex-1 min-h-0">
            <h3 className="text-[9px] text-gray-500 uppercase mb-2 tracking-wider">Activity</h3>
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '200px' }}>
              {logs.map((log, idx) => (
                <div
                  key={idx}
                  className={`text-[9px] font-mono leading-snug ${
                    log.startsWith('INVALID') || log.startsWith('ERROR') ? 'text-red-400' :
                    log.startsWith('SUCCESS')  ? 'text-green-400' :
                    log.startsWith('ZK')       ? 'text-blue-400' :
                    log.startsWith('ON-CHAIN') ? 'text-purple-400' :
                    log.startsWith('GAME OVER')? 'text-yellow-400' :
                    'text-gray-500'
                  }`}
                >
                  {'> '}{log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE BOTTOM BAR ── */}
      <div className="md:hidden shrink-0 border-t border-gray-800 bg-gray-950 px-3 py-2 flex items-center justify-between gap-2">
        {/* Turn indicator */}
        <div className={`text-xs font-bold ${kingInCheck ? 'text-red-400 animate-pulse' : 'text-blue-400'}`}>
          {gameOver ? `🏆 ${winner} Wins!` : `${currentPlayer.toUpperCase()}'S TURN`}
        </div>
        <div className="text-[9px] text-gray-500 font-mono">Moves: {moveCount}</div>

        {/* Start game on mobile */}
        {!gameStarted && isConnected && !showP2Input && (
          <button
            onClick={() => setShowP2Input(true)}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-[10px] font-bold"
          >
            Start
          </button>
        )}
        {!gameStarted && isConnected && showP2Input && (
          <div className="flex gap-1 flex-1 max-w-xs">
            <input
              type="text"
              placeholder="P2 address..."
              value={player2Address}
              onChange={e => setPlayer2Address(e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-800 rounded text-[9px] font-mono border border-gray-700 outline-none"
            />
            <button
              onClick={handleStartGame}
              disabled={isCommitting}
              className="px-2 py-1 bg-green-700 rounded text-[9px] font-bold disabled:opacity-50"
            >
              {isCommitting ? '...' : 'Go'}
            </button>
          </div>
        )}

        {/* Status indicators */}
        {isVerifying  && <span className="text-blue-400 text-[9px] animate-pulse">ZK...</span>}
        {isCommitting && <span className="text-yellow-400 text-[9px] animate-pulse">Committing...</span>}
      </div>

    </div>
  );
};

export default LanternChess;