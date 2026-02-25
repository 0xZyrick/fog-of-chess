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
  fromRow: number, fromCol: number,
  toRow: number,   toCol: number
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

// ── Raw move validity — no check-exposure guard, no recursion ────────────────
const isRawMoveValid = (
  piece: Piece,
  toRow: number,
  toCol: number,
  pieces: Piece[]
): boolean => {
  const { row, col, type, color } = piece;
  if (!inBounds(toRow, toCol)) return false;
  if (row === toRow && col === toCol) return false;

  const target = pieceAt(pieces, toRow, toCol);
  if (target && target.color === color) return false;

  const dr = toRow - row;
  const dc = toCol - col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  switch (type) {
    case 'pawn': {
      const dir = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;
      // Forward one
      if (dc === 0 && dr === dir) return !target;
      // Forward two from start
      if (dc === 0 && dr === dir * 2 && row === startRow)
        return !pieceAt(pieces, row + dir, col) && !target;
      // Diagonal capture
      if (absDc === 1 && dr === dir) return !!(target && target.color !== color);
      return false;
    }
    case 'rook':
      return (dr === 0 || dc === 0) && isPathClear(pieces, row, col, toRow, toCol);
    case 'bishop':
      return absDr === absDc && isPathClear(pieces, row, col, toRow, toCol);
    case 'queen': {
      const ok = absDr === absDc || dr === 0 || dc === 0;
      return ok && isPathClear(pieces, row, col, toRow, toCol);
    }
    case 'knight':
      return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
    case 'king':
      return absDr <= 1 && absDc <= 1;
  }
};

// ── Check detector — uses raw moves only, no recursion ──────────────────────
export const isInCheck = (color: PieceColor, pieces: Piece[]): boolean => {
  const king = pieces.find(p => p.type === 'king' && p.color === color);
  if (!king) return false;
  const opponent: PieceColor = color === 'white' ? 'black' : 'white';
  return pieces
    .filter(p => p.color === opponent)
    .some(p => isRawMoveValid(p, king.row, king.col, pieces));
};

// ── Simulate a move and test if it leaves own king in check ──────────────────
const moveLeavesKingInCheck = (
  piece: Piece,
  toRow: number,
  toCol: number,
  pieces: Piece[]
): boolean => {
  // Apply the move on a temporary board
  const next = pieces
    .filter(p => !(p.row === toRow && p.col === toCol && p.id !== piece.id))
    .map(p => p.id === piece.id ? { ...p, row: toRow, col: toCol } : p);
  return isInCheck(piece.color, next);
};

// ── Full move validation with check-exposure guard ───────────────────────────
export const isValidMove = (
  piece: Piece,
  toRow: number,
  toCol: number,
  pieces: Piece[]
): MoveResult => {
  if (!isRawMoveValid(piece, toRow, toCol, pieces)) {
    // Reproduce specific reason for UI feedback
    const { row, col, type, color } = piece;
    if (!inBounds(toRow, toCol)) return { valid: false, reason: 'Out of bounds' };
    if (row === toRow && col === toCol) return { valid: false, reason: 'Same square' };
    const target = pieceAt(pieces, toRow, toCol);
    if (target?.color === color) return { valid: false, reason: "Can't capture your own piece" };

    const dr = toRow - row; const dc = toCol - col;
    const absDr = Math.abs(dr); const absDc = Math.abs(dc);

    switch (type) {
      case 'pawn': {
        const dir = color === 'white' ? -1 : 1;
        if (Math.abs(dc) === 1 && dr === dir && !target)
          return { valid: false, reason: 'Pawn can only move diagonally to capture' };
        if (dc !== 0)
          return { valid: false, reason: 'Invalid pawn move' };
        if (!isPathClear(pieces, row, col, toRow, toCol))
          return { valid: false, reason: 'Pawn blocked' };
        return { valid: false, reason: 'Invalid pawn move' };
      }
      case 'rook':
        if (dr !== 0 && dc !== 0) return { valid: false, reason: 'Rook moves in straight lines only' };
        return { valid: false, reason: 'Path is blocked' };
      case 'bishop':
        if (absDr !== absDc) return { valid: false, reason: 'Bishop moves diagonally only' };
        return { valid: false, reason: 'Path is blocked' };
      case 'queen':
        if (absDr !== absDc && dr !== 0 && dc !== 0)
          return { valid: false, reason: 'Queen moves straight or diagonally' };
        return { valid: false, reason: 'Path is blocked' };
      case 'knight':
        return { valid: false, reason: 'Knight moves in an L-shape only' };
      case 'king':
        return { valid: false, reason: 'King moves one square at a time' };
    }
  }

  // Raw move is valid — now check if it exposes own king
  if (moveLeavesKingInCheck(piece, toRow, toCol, pieces)) {
    return { valid: false, reason: 'That move leaves your king in check' };
  }

  return { valid: true };
};