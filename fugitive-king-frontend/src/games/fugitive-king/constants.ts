export const generateSalt = () => Math.floor(Math.random() * 100000000);

export const PIECE_TYPE_MAP = {
  'knight': 1,
  'rook': 2,
  'bishop': 3,
  'pawn': 4,
  'queen': 5,
  'king': 6
};

export const PIECE_SYMBOLS = {
  white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' }
};

export const INITIAL_PIECES = [
        // Black pieces
        { id: 'br1', row: 0, col: 0, type: 'rook', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bn1', row: 0, col: 1, type: 'knight', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bb1', row: 0, col: 2, type: 'bishop', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bq', row: 0, col: 3, type: 'queen', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bk', row: 0, col: 4, type: 'king', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bb2', row: 0, col: 5, type: 'bishop', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bn2', row: 0, col: 6, type: 'knight', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'br2', row: 0, col: 7, type: 'rook', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp1', row: 1, col: 0, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp2', row: 1, col: 1, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp3', row: 1, col: 2, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp4', row: 1, col: 3, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp5', row: 1, col: 4, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp6', row: 1, col: 5, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp7', row: 1, col: 6, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        { id: 'bp8', row: 1, col: 7, type: 'pawn', color: 'black', salt: generateSalt(), commitment: null },
        // White pieces
        { id: 'wp1', row: 6, col: 0, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp2', row: 6, col: 1, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp3', row: 6, col: 2, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp4', row: 6, col: 3, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp5', row: 6, col: 4, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp6', row: 6, col: 5, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp7', row: 6, col: 6, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wp8', row: 6, col: 7, type: 'pawn', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wr1', row: 7, col: 0, type: 'rook', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wn1', row: 7, col: 1, type: 'knight', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wb1', row: 7, col: 2, type: 'bishop', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wq', row: 7, col: 3, type: 'queen', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wk', row: 7, col: 4, type: 'king', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wb2', row: 7, col: 5, type: 'bishop', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wn2', row: 7, col: 6, type: 'knight', color: 'white', salt: generateSalt(), commitment: null },
        { id: 'wr2', row: 7, col: 7, type: 'rook', color: 'white', salt: generateSalt(), commitment: null },
];