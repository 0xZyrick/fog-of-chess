export type PieceColor = 'white' | 'black';
export type PieceType = 'pawn' | 'rook' | 'bishop' | 'queen' | 'knight' | 'king';

export interface Piece {
  id: string;
  row: number;
  col: number;
  type: PieceType;
  color: PieceColor;
  salt?: number;
  commitment?: string | null;
  hasMoved?: boolean;
}

export interface MoveResult {
  valid: boolean;
  reason?: string;
}

const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const pieceAt = (pieces: Piece[], r: number, c: number): Piece | undefined =>
  pieces.find(p => p.row === r && p.col === c);

const isPathClear = (
  pieces: Piece[],
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): boolean => {
  const dr = Math.sign(toRow - fromRow);
  const dc = Math.sign(toCol - fromCol);
  let r = fromRow + dr;
  let c = fromCol + dc;
  while (r !== toRow || c !== toCol) {
    if (pieceAt(pieces, r, c)) return false;
    r += dr;
    c += dc;
  }
  return true;
};

export const isValidMove = (
  piece: Piece,
  toRow: number,
  toCol: number,
  pieces: Piece[]
): MoveResult => {
  const { row, col, type, color } = piece;

  if (!inBounds(toRow, toCol)) return { valid: false, reason: 'Out of bounds' };
  if (row === toRow && col === toCol) return { valid: false, reason: 'Same square' };

  const target = pieceAt(pieces, toRow, toCol);
  if (target && target.color === color) return { valid: false, reason: "Can't capture your own piece" };

  const dr = toRow - row;
  const dc = toCol - col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  switch (type) {
    case 'pawn': {
      const dir = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;
      if (dc === 0 && dr === dir) {
        if (target) return { valid: false, reason: 'Pawn blocked — cannot capture forward' };
        return { valid: true };
      }
      if (dc === 0 && dr === dir * 2 && row === startRow) {
        if (pieceAt(pieces, row + dir, col)) return { valid: false, reason: 'Pawn blocked' };
        if (target) return { valid: false, reason: 'Pawn blocked' };
        return { valid: true };
      }
      if (absDc === 1 && dr === dir) {
        if (target && target.color !== color) return { valid: true };
        return { valid: false, reason: 'Pawn can only move diagonally to capture' };
      }
      return { valid: false, reason: 'Invalid pawn move' };
    }
    case 'rook': {
      if (dr !== 0 && dc !== 0) return { valid: false, reason: 'Rook moves in straight lines only' };
      if (!isPathClear(pieces, row, col, toRow, toCol)) return { valid: false, reason: 'Path is blocked' };
      return { valid: true };
    }
    case 'bishop': {
      if (absDr !== absDc) return { valid: false, reason: 'Bishop moves diagonally only' };
      if (!isPathClear(pieces, row, col, toRow, toCol)) return { valid: false, reason: 'Path is blocked' };
      return { valid: true };
    }
    case 'queen': {
      const isDiagonal = absDr === absDc;
      const isStraight = dr === 0 || dc === 0;
      if (!isDiagonal && !isStraight) return { valid: false, reason: 'Queen moves straight or diagonally' };
      if (!isPathClear(pieces, row, col, toRow, toCol)) return { valid: false, reason: 'Path is blocked' };
      return { valid: true };
    }
    case 'knight': {
      const isLShape = (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
      if (!isLShape) return { valid: false, reason: 'Knight moves in an L-shape only' };
      return { valid: true };
    }
    case 'king': {
      if (absDr > 1 || absDc > 1) return { valid: false, reason: 'King moves one square at a time' };
      return { valid: true };
    }
  }
};

/**
 * Returns true if the given color's king is currently under attack.
 * We simulate each opponent piece attacking the king's square.
 */
export const isInCheck = (color: PieceColor, pieces: Piece[]): boolean => {
  const king = pieces.find(p => p.type === 'king' && p.color === color);
  if (!king) return false;
  const opponent: PieceColor = color === 'white' ? 'black' : 'white';
  return pieces
    .filter(p => p.color === opponent)
    .some(p => isValidMove(p, king.row, king.col, pieces).valid);
};