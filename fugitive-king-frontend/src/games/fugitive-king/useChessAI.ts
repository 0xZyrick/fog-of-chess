/**
 * useChessAI.ts
 * Simple chess AI — picks the highest-value legal capture, else random legal move.
 * Plays as 'black' against a human 'white'. No external dependencies.
 */

import { useCallback } from 'react';
import { isValidMove } from './chessLogic';
import type { Piece } from './chessLogic';

const PIECE_VALUE: Record<string, number> = {
  queen: 9, rook: 5, bishop: 3, knight: 3, pawn: 1, king: 0,
};

export interface AIMove {
  pieceId:   string;
  toRow:     number;
  toCol:     number;
  isCapture: boolean;
  capturedType?: string;
}

export const useChessAI = () => {

  const pickMove = useCallback((pieces: Piece[]): AIMove | null => {
    const aiPieces = pieces.filter(p => p.color === 'black');

    const allMoves: Array<{
      piece: Piece;
      toRow: number;
      toCol: number;
      captureValue: number;
      capturedType?: string;
    }> = [];

    for (const piece of aiPieces) {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const result = isValidMove(piece, r, c, pieces);
          if (!result.valid) continue;
          const target = pieces.find(p => p.row === r && p.col === c);
          const captureValue = (target && target.color !== 'black')
            ? PIECE_VALUE[target.type] ?? 0
            : 0;
          allMoves.push({ piece, toRow: r, toCol: c, captureValue, capturedType: target?.type });
        }
      }
    }

    if (allMoves.length === 0) return null;

    // Sort: captures first (by value), then random among non-captures
    const captures = allMoves.filter(m => m.captureValue > 0)
      .sort((a, b) => b.captureValue - a.captureValue);

    const chosen = captures.length > 0
      ? captures[0]
      : allMoves[Math.floor(Math.random() * allMoves.length)];

    return {
      pieceId:      chosen.piece.id,
      toRow:        chosen.toRow,
      toCol:        chosen.toCol,
      isCapture:    chosen.captureValue > 0,
      capturedType: chosen.capturedType,
    };
  }, []);

  return { pickMove };
};
