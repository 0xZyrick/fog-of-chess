♟ Lantern Chess — ZK Fog of War Chess on Stellar

You can prove your piece moved legally. You cannot prove what it is.

Lantern Chess is a fog-of-war chess game where every move is verified by a zero-knowledge proof on Stellar's blockchain. Players commit to their piece positions at game start, then prove each move is legal without ever revealing which piece moved. The board is dark — you only see what your pieces can see.

How It Works
Standard chess gives both players full information. Lantern Chess removes that. Each player only sees squares within their pieces' line of sight. When you move, your opponent sees that something moved to a square — but not what piece, not where it came from.
This is enforced cryptographically, not by trust:

At game start — each player commits a SHA-256 hash of their piece positions + a secret salt to the Stellar smart contract. This locks their board state on-chain without revealing it.
On each move — the frontend sends the move to a RISC Zero prover running locally. The prover generates a ZK proof that:

The piece was actually at the claimed starting position (commitment check)
The move follows chess rules for that piece type (move legality check)


On-chain verification — the proof is submitted to the Stellar smart contract via verify_move(). The contract checks the proof against the stored commitment. If invalid, the move is rejected.
Game start/end — start_game() and end_game() are called on the Stellar Game Hub contract, recording the session and result on-chain.

The opponent never learns the piece type. The contract never learns the piece type. Only the ZK proof knows — and it only confirms legality.

Architecture
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  • Fog of war board rendering                           │
│  • Chess move validation (client-side rules check)      │
│  • Piece commitment initialization                       │
└────────────┬───────────────────────┬────────────────────┘
             │                       │
             ▼                       ▼
┌────────────────────┐   ┌──────────────────────────────┐
│  RISC Zero Prover  │   │     Stellar Testnet           │
│  (Rust / local)    │   │                               │
│                    │   │  ┌─────────────────────────┐ │
│  • Verifies piece  │   │  │ Fog of Chess Contract   │ │
│    commitment      │   │  │ CCEPFHPTY...            │ │
│  • Checks move     │   │  │                         │ │
│    legality in ZK  │   │  │ • commit_board()        │ │
│  • Returns seal +  │   │  │ • verify_move()         │ │
│    journal         │   │  │ • start_game()          │ │
└────────────┬───────┘   │  │ • end_game()            │ │
             │           │  └─────────────────────────┘ │
             │           │                               │
             │           │  ┌─────────────────────────┐ │
             └──────────►│  │ Game Hub Contract       │ │
                         │  │ CB4VZAT2...             │ │
                         │  │                         │ │
                         │  │ • start_game()          │ │
                         │  │ • end_game()            │ │
                         │  └─────────────────────────┘ │
                         └──────────────────────────────┘

Tech Stack
LayerTechnologyFrontendReact + TypeScript + Tailwind CSSSmart ContractRust + Soroban SDK (Stellar)ZK ProverRISC Zero (local) / Bonsai (cloud)ZK GuestRust — SHA-256 commitment + move legalityBlockchainStellar TestnetWalletDev wallet (Stellar keypair)

Deployed Contracts (Stellar Testnet)
ContractAddressFog of ChessCCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HTGame HubCB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG

Getting Started
Prerequisites

Bun or Node.js 18+
Rust + wasm32v1-none target
RISC Zero toolchain

1. Clone and install
bashgit clone https://github.com/YOUR_USERNAME/fog-of-chess
cd fog-of-chess
bun install
2. Set up environment
bashcp .env.example .env
# Fill in VITE_DEV_PLAYER1_SECRET and VITE_DEV_PLAYER2_SECRET
# with Stellar testnet keypair secret keys
bun run setup
3. Start the ZK prover (in a separate terminal)
bashcd contracts/fog-of-chess-zk
cargo build --release
cd host && cargo run --release
# Prover runs on http://localhost:3001

Note: Local ZK proving is slow (2–10 min per proof). For production, set BONSAI_API_KEY and BONSAI_API_URL to use RISC Zero's Bonsai cloud prover which generates proofs in seconds. For demos, the frontend falls back to a mock proof automatically if the prover times out.

4. Start the frontend
bash# From project root
bun run dev
# or for the main frontend:
cd sgs_frontend && bun run dev
Open http://localhost:5173

How to Play

Connect wallet — click "Connect as Player 1" (uses dev keypair from .env)
Start game — enter Player 2's Stellar address and click "Start On-Chain Game"

This commits your board state on-chain and registers the session with the Game Hub


Move pieces — click a piece to select it, then click a destination square

Your pieces glow with a warm lantern light
Enemy pieces in your line of sight appear as a red pulsing dot — you know something is there, not what it is
Squares outside your vision range are dimmed — unexplored territory


Win — capture the opponent's king. Result is recorded on-chain via end_game()

Visibility Rules
Each piece type illuminates different areas:

Pawns — see 1 square ahead + capture diagonals
Rooks — see entire rank and file (blocked by pieces)
Bishops — see all diagonals (blocked by pieces)
Queens — full rank, file, and diagonal vision
Knights — see their 8 jump squares exactly
Kings — see adjacent squares


Project Structure
fog-of-chess/
├── contracts/
│   ├── fog-of-chess/          # Stellar Soroban smart contract
│   │   └── src/lib.rs         # commit_board, verify_move, start_game, end_game
│   └── fog-of-chess-zk/       # RISC Zero ZK prover
│       ├── host/src/main.rs   # Axum HTTP server — receives move, runs prover
│       └── methods/guest/     # ZK guest — commitment check + move legality
├── sgs_frontend/              # Main React frontend
│   └── src/
│       ├── components/
│       │   └── LanternChess.jsx     # Main game component
│       ├── hooks/useGameLogic.ts    # Board state + fog of war visibility
│       ├── utils/chessLogic.ts      # Move validation + check detection
│       └── services/zkServices.ts  # ZK proof generation + on-chain submission
└── deployment.json            # Deployed contract addresses

ZK Implementation Details
The RISC Zero guest program (methods/guest/src/main.rs) does two things:
1. Commitment verification — proves the piece was at the claimed position:
SHA256(start_row || start_col || salt) == stored_commitment
This means you cannot lie about where a piece started. The commitment was locked on-chain at game start.
2. Move legality — verifies the move follows chess rules for the declared piece type:
match piece_type {
  1 (Knight) => L-shape check
  2 (Rook)   => straight line check
  3 (Bishop) => diagonal check
  4 (Pawn)   => forward + capture check
  5 (Queen)  => straight or diagonal check
  6 (King)   => one square check
}
The piece type is an input to the ZK proof but is never revealed on-chain. The contract only sees: proof valid/invalid. The opponent only sees: a piece moved to a square.

Production Notes

Bonsai integration — set BONSAI_API_KEY env var for cloud ZK proving (seconds vs minutes)
Real wallet — replace dev wallet with Freighter or Lobstr for production
Groth16 — Bonsai produces Groth16 proofs suitable for full on-chain verification
Checkmate — currently ends on king capture; full checkmate detection is the next milestone


License
MIT
