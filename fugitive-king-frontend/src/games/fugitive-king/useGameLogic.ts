import { useState, useMemo, useCallback } from 'react';
import { isValidMove, isInCheck } from './chessLogic';
import type { Piece, PieceColor, MoveResult } from './chessLogic';

export type { Piece, PieceColor, MoveResult };

type VisibilityMap = boolean[][];

const addVisible = (map: VisibilityMap, r: number, c: number): void => {
  if (r >= 0 && r < 8 && c >= 0 && c < 8) map[r][c] = true;
};

const rayVision = (
  map: VisibilityMap,
  pieces: Piece[],
  startRow: number,
  startCol: number,
  dr: number,
  dc: number
): void => {
  let r = startRow + dr;
  let c = startCol + dc;
  while (r >= 0 && r < 8 && c >= 0 && c < 8) {
    map[r][c] = true;
    if (pieces.find(p => p.row === r && p.col === c)) break;
    r += dr;
    c += dc;
  }
};

const computeVision = (piece: Piece, map: VisibilityMap, pieces: Piece[]): void => {
  const { row, col, type, color } = piece;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      addVisible(map, row + dr, col + dc);
    }
  }

  switch (type) {
    case 'pawn': {
      const dir = color === 'white' ? -1 : 1;
      addVisible(map, row + dir, col);
      addVisible(map, row + dir, col - 1);
      addVisible(map, row + dir, col + 1);
      const startRow = color === 'white' ? 6 : 1;
      if (row === startRow) addVisible(map, row + dir * 2, col);
      break;
    }
    case 'rook':
      (([[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][])).forEach(([dr, dc]) =>
        rayVision(map, pieces, row, col, dr, dc));
      break;
    case 'bishop':
      (([[-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][])).forEach(([dr, dc]) =>
        rayVision(map, pieces, row, col, dr, dc));
      break;
    case 'queen':
      (([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][])).forEach(([dr, dc]) =>
        rayVision(map, pieces, row, col, dr, dc));
      break;
    case 'knight':
      (([[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as [number, number][])).forEach(([dr, dc]) =>
        addVisible(map, row + dr, col + dc));
      break;
    case 'king':
      break;
  }
};

export const useGameLogic = (initialPieces: Piece[]) => {
  const [pieces, setPieces] = useState<Piece[]>(initialPieces);
  const [currentPlayer, setCurrentPlayer] = useState<PieceColor>('white');
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState<number>(0);

  const visibilityMap = useMemo((): VisibilityMap => {
    const map: VisibilityMap = Array(8).fill(null).map(() => Array(8).fill(false));
    pieces
      .filter(p => p.color === currentPlayer)
      .forEach(piece => computeVision(piece, map, pieces));
    return map;
  }, [pieces, currentPlayer]);

  // Check status for current player — used to show warning
  const kingInCheck = useMemo((): boolean => {
    return isInCheck(currentPlayer, pieces);
  }, [pieces, currentPlayer]);

  const validateMove = useCallback((pieceId: string, toRow: number, toCol: number): MoveResult => {
    const piece = pieces.find(p => p.id === pieceId);
    if (!piece) return { valid: false, reason: 'Piece not found' };
    if (piece.color !== currentPlayer) return { valid: false, reason: 'Not your piece' };
    return isValidMove(piece, toRow, toCol, pieces);
  }, [pieces, currentPlayer]);

  const executeMove = useCallback((pieceId: string, row: number, col: number, isCapture: boolean): void => {
    setPieces(prev => {
      let next: Piece[] = isCapture
        ? prev.filter(p => !(p.row === row && p.col === col && p.id !== pieceId))
        : prev;
      // FIX: Do NOT wipe commitment here. Commitment is recomputed in LanternChess.jsx
      // after the move (at the new position) so the piece can be moved again.
      // Wiping it here was the root cause of "game freezes after ~5 moves".
      next = next.map(p =>
        p.id === pieceId
          ? { ...p, row, col, hasMoved: true } as Piece
          : p
      );
      return next;
    });
    setCurrentPlayer(p => p === 'white' ? 'black' : 'white');
    setSelectedPieceId(null);
    setMoveCount(m => m + 1);
  }, []);

  return {
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
  };
};