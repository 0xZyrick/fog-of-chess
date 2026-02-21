#![no_main]
use risc0_zkvm::guest::env;
use sha2::{Sha256, Digest}; // Standard Rust hashing!

risc0_zkvm::guest::entry!(main);

pub fn main() {
    // 1. Read inputs from the Host (the game)
    // We expect: [start_row, start_col], [end_row, end_col], piece_type, salt, expected_hash
    let (start_pos, end_pos, piece_type, salt, commitment): ([u8; 2], [u8; 2], u32, u32, [u8; 32]) = env::read();

    // 2. Verify the Commitment (Hidden State)
    // This proves the piece was actually at start_pos without revealing start_pos to the opponent
    let mut hasher = Sha256::new();
    hasher.update(&[start_pos[0], start_pos[1]]);
    hasher.update(&salt.to_be_bytes());
    let hash_result = hasher.finalize();
    
    assert_eq!(hash_result.as_slice(), commitment, "Commitment verification failed!");

    // 3. Verify Move Legality (Standard Rust logic)
    let row_diff = (start_pos[0] as i32 - end_pos[0] as i32).abs();
    let col_diff = (start_pos[1] as i32 - end_pos[1] as i32).abs();

        // ... inside main.rs match block ...
    let is_valid = match piece_type {
    1 => (row_diff == 2 && col_diff == 1) || (row_diff == 1 && col_diff == 2), // Knight
    2 => (row_diff == 0 || col_diff == 0) && (row_diff + col_diff > 0),         // Rook
    3 => (row_diff == col_diff) && (row_diff > 0),                              // Bishop
    4 => { // Pawn — both colors
        if col_diff == 0 {
            row_diff == 1 || (row_diff == 2 && (start_pos[0] == 1 || start_pos[0] == 6))
        } else if col_diff == 1 {
            row_diff == 1
        } else {
            false
        }
    },
    5 => (row_diff == 0 || col_diff == 0) || (row_diff == col_diff), // Queen
    6 => row_diff <= 1 && col_diff <= 1 && (row_diff + col_diff > 0), // King
    _ => false,
};

    assert!(is_valid, "Illegal move for this piece type!");

    // 4. Commit the result
    // This makes the end_pos public so the game board can update
    env::commit(&end_pos);
}