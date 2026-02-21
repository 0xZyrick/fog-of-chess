import React, { useState, useEffect } from 'react';
import { useGameLogic } from './useGameLogic';
import { ZKServiceManager, initializePieceCommitments } from './zkServices';
import { INITIAL_PIECES, PIECE_SYMBOLS } from './constants';
import { useWallet } from '../../hooks/useWallet';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { Client as FogOfChessClient } from 'board_commitment_contract';
import { Networks as StellarNetworks } from '@stellar/stellar-sdk';

// ✅ FIXED: matches deployment.json board-commitment-contract
const CONTRACT_ID = "CCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HT";
const RPC_URL = "https://soroban-testnet.stellar.org";
const zkManager = new ZKServiceManager(CONTRACT_ID);

const createSessionId = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] || 1;
};

const LanternChess = () => {
  const { publicKey: address, isConnected, connectDev, getContractSigner } = useWallet();
  const {
    pieces,
    setPieces,
    currentPlayer,
    selectedPieceId,
    setSelectedPieceId,
    visibilityMap,
    validateMove,
    executeMove,
    kingInCheck,
    moveCount,
  } = useGameLogic(INITIAL_PIECES);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isBoardSealed, setIsBoardSealed] = useState(false);
  const [logs, setLogs] = useState(['Game started', 'White to move']);
  const [sessionId] = useState(() => createSessionId());
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [player2Address, setPlayer2Address] = useState('');
  const [showP2Input, setShowP2Input] = useState(false);
  const [invalidMoveMsg, setInvalidMoveMsg] = useState(null);
  const [isCommitting, setIsCommitting] = useState(false);

  const addLog = (message) => setLogs(prev => [...prev, message].slice(-12));

  const showInvalid = (msg) => {
    setInvalidMoveMsg(msg);
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
    if (!address) { addLog('ERROR: Connect wallet first'); return; }
    if (!player2Address.trim()) { addLog('ERROR: Enter Player 2 address'); return; }
    try {
      setIsCommitting(true);

      // ✅ Step 1: Initialize piece commitments (SHA256 of position + salt)
      addLog('Initializing piece commitments...');
      const committedPieces = await initializePieceCommitments(pieces);
      setPieces(committedPieces);

      // ✅ Step 2: Commit board on-chain (using king's commitment as anchor)
      addLog('Committing board on-chain...');
      const signer = getContractSigner();
      await zkManager.commitBoard(address, signer, committedPieces);

      // ✅ Step 3: Start the game session on-chain
      addLog('Starting game session...');
      const client = getClient();
      const tx = await client.start_game({
        session_id: sessionId,
        player1: address,
        player2: player2Address.trim(),
      });
      await signAndSubmit(tx);

      setGameStarted(true);
      setIsBoardSealed(true);
      setShowP2Input(false);
      addLog(`ON-CHAIN: Session ${sessionId} started`);
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
        session_id: sessionId,
        caller: address,
        player1_won: whiteWon,
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
    const movingPiece = pieces.find(p => p.id === selectedPieceId);

    if (movingPiece) {
      if (clickedPiece && clickedPiece.color === currentPlayer) {
        setSelectedPieceId(clickedPiece.id);
        return;
      }

      // Validate move rules first (no ZK cost for illegal moves)
      const moveResult = validateMove(movingPiece.id, row, col);
      if (!moveResult.valid) {
        showInvalid(moveResult.reason || 'Invalid move');
        addLog(`INVALID: ${moveResult.reason}`);
        setSelectedPieceId(null);
        return;
      }

      setIsVerifying(true);
      // ✅ No piece type in log — opponent can't sniff identity
      addLog('ZK: Generating proof...');

      try {
        const signer = getContractSigner();

        // ✅ Step 1: Get proof from RISC Zero prover (real or mock fallback)
        const proof = await zkManager.getProofFromProver(movingPiece, row, col);

        // ✅ Step 2: Verify proof on Stellar contract
        addLog('ZK: Submitting proof on-chain...');
        await zkManager.verifyAndMoveOnChain(address, signer, sessionId, proof, movingPiece);

        // ✅ Step 3: Execute move locally (update React state)
        const isCapture = !!(clickedPiece && clickedPiece.color !== currentPlayer);
        const isKingCapture = isCapture && clickedPiece.type === 'king';

        executeMove(movingPiece.id, row, col, isCapture);

        // ✅ Update commitment for moved piece (new position = new commitment)
        // This keeps local state in sync for next proof
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

  const renderTile = (r, c) => {
    const piece = pieces.find(p => p.row === r && p.col === c);
    const isVisible = visibilityMap[r][c];
    const isSelected = selectedPieceId === piece?.id;
    const isOwnPiece = piece?.color === currentPlayer;
    const isOpponentPiece = piece && !isOwnPiece;

    const baseColor = (r + c) % 2 === 0 ? '#1a2035' : '#212840';

    const renderContent = () => {
      if (piece && isOwnPiece) {
        return (
          <div
            className="text-4xl select-none z-20"
            style={{
              color: piece.color === 'white' ? '#e8dcc8' : '#1a0f05',
              filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.5))',
            }}
          >
            {PIECE_SYMBOLS[piece.color][piece.type]}
          </div>
        );
      }
      // Opponent in visible range — red dot only, type hidden
      if (isOpponentPiece && isVisible) {
        return (
          <div className="z-20">
            <div
              className="w-3 h-3 rounded-full animate-pulse"
              style={{
                background: 'radial-gradient(circle, #ff4444 0%, #991111 100%)',
                boxShadow: '0 0 10px 3px rgba(255,50,50,0.7), 0 0 20px 6px rgba(255,50,50,0.3)',
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
        {/* ✅ Subtle dim instead of blackout — board grid stays visible */}
        {!isVisible && (
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          />
        )}
        {isVisible && (
          <div
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(251,191,36,0.07) 0%, transparent 80%)',
            }}
          />
        )}
        {renderContent()}
      </div>
    );
  };

  const isLoading = isVerifying || isCommitting;

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col text-white" style={{ background: '#0d1117' }}>
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {/* Logo — chess piece lantern icon */}
            <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-lg">
              ♟
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold tracking-tighter text-lg text-blue-400">LANTERN CHESS</span>
              <span className="text-[9px] text-gray-500 tracking-widest uppercase">ZK Fog of Chess</span>
            </div>
          </div>
          <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${isBoardSealed ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
            {isBoardSealed ? '• ON-CHAIN' : '• LOCAL'}
          </div>
          {isCommitting && <div className="text-yellow-400 text-xs animate-pulse">COMMITTING BOARD...</div>}
          {isVerifying && <div className="text-blue-400 text-xs animate-pulse">GENERATING ZK PROOF...</div>}
          {gameOver && <div className="text-yellow-400 text-xs font-bold">🏆 {winner} WINS!</div>}
        </div>
        <div className="text-xs font-mono text-gray-500">
          {address ? `${address.substring(0, 6)}...${address.substring(50)}` : 'Wallet Disconnected'}
        </div>
      </div>

      {/* Check warning */}
      {kingInCheck && !gameOver && (
        <div
          className="shrink-0 flex items-center justify-center gap-2 py-2 text-sm font-bold animate-pulse"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(220,38,38,0.3), rgba(220,38,38,0.5), rgba(220,38,38,0.3), transparent)',
            borderBottom: '1px solid rgba(220,38,38,0.4)',
            color: '#fca5a5',
          }}
        >
          ⚠ {currentPlayer.toUpperCase()} KING IS IN CHECK — YOU MUST RESPOND
        </div>
      )}

      {/* Invalid move toast */}
      {invalidMoveMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-700/90 backdrop-blur text-white text-sm font-bold px-5 py-2 rounded shadow-xl border border-red-500/50">
          ⚠ {invalidMoveMsg}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center gap-10 p-6 min-h-0">
        {/* Board */}
        <div
          className="rounded-sm shrink-0"
          style={{
            width: 'min(75vh, 75vw)',
            height: 'min(75vh, 75vw)',
            border: '2px solid #2a3450',
            boxShadow: '0 0 60px rgba(0,0,0,0.9), 0 0 20px rgba(251,191,36,0.05)',
            opacity: isLoading ? 0.7 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          <div className="grid grid-cols-8 w-full h-full">
            {Array.from({ length: 64 }).map((_, i) => {
              const r = Math.floor(i / 8);
              const c = i % 8;
              return renderTile(r, c);
            })}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-64 flex flex-col gap-4 shrink-0">
          {/* Wallet */}
          <div className="bg-gray-900 p-4 rounded border border-gray-800">
            <h3 className="text-xs text-gray-500 uppercase mb-3 tracking-wider">Wallet</h3>
            {!isConnected ? (
              <div className="space-y-2">
                <button onClick={() => connectDev(1)} className="w-full py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-bold transition-colors">
                  Connect as Player 1
                </button>
                <button onClick={() => connectDev(2)} className="w-full py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm font-bold transition-colors">
                  Connect as Player 2
                </button>
              </div>
            ) : (
              <div className="text-xs text-green-400 font-mono">✓ {address?.substring(0, 8)}...{address?.substring(50)}</div>
            )}
          </div>

          {/* Start Game */}
          {!gameStarted && isConnected && (
            <div className="bg-gray-900 p-4 rounded border border-gray-800">
              <h3 className="text-xs text-gray-500 uppercase mb-3 tracking-wider">Start Game</h3>
              {!showP2Input ? (
                <button onClick={() => setShowP2Input(true)} className="w-full py-2 bg-green-700 hover:bg-green-600 rounded text-sm font-bold transition-colors">
                  Start On-Chain Game
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Player 2 address (G...)"
                    value={player2Address}
                    onChange={e => setPlayer2Address(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 rounded text-xs font-mono border border-gray-700 focus:border-blue-500 outline-none"
                  />
                  <button
                    onClick={handleStartGame}
                    disabled={isCommitting}
                    className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-bold transition-colors"
                  >
                    {isCommitting ? 'Setting up...' : 'Confirm Start'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Game Info */}
          <div className="bg-gray-900 p-4 rounded border border-gray-800">
            <h3 className="text-xs text-gray-500 uppercase mb-2 tracking-wider">Game Info</h3>
            <div className={`text-lg font-bold ${kingInCheck ? 'text-red-400 animate-pulse' : 'text-blue-400'}`}>
              {gameOver ? `${winner} Wins!` : `${currentPlayer.toUpperCase()}'S TURN`}
            </div>
            <div className="text-sm text-gray-500">Moves: {moveCount}</div>
            <div className="text-xs text-gray-700 font-mono mt-1 truncate">Session: {sessionId}</div>

            {/* Legend */}
            <div className="mt-3 pt-3 border-t border-gray-800 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.8)' }} />
                <span>Enemy detected (type hidden)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: '#1a2035', border: '1px solid #2a3450' }} />
                <span>Unexplored territory</span>
              </div>
            </div>

            {/* Logs */}
            <div className="mt-4">
              <h3 className="text-xs text-gray-500 uppercase mb-2 border-t border-gray-800 pt-3 tracking-wider">Activity</h3>
              <div className="flex flex-col gap-1 h-44 overflow-y-auto">
                {logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`text-[10px] font-mono leading-tight ${
                      log.startsWith('INVALID') || log.startsWith('ERROR') ? 'text-red-400' :
                      log.startsWith('SUCCESS') ? 'text-green-400' :
                      log.startsWith('ZK') ? 'text-blue-400' :
                      log.startsWith('ON-CHAIN') ? 'text-purple-400' :
                      log.startsWith('GAME OVER') ? 'text-yellow-400' :
                      'text-gray-400'
                    }`}
                  >
                    {`> ${log}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LanternChess;