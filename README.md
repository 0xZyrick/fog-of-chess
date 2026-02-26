# ♟ Lantern Chess
### Zero-Knowledge Fog of War Chess on Stellar

> *You move a piece. Your opponent sees something moved. They never learn what.*

Live demo: **https://lanternchess.vercel.app**

---

## What is this?

Lantern Chess is a two-player chess game where the fog of war is cryptographically enforced — not just hidden on screen. Every move generates a zero-knowledge proof that verifies the move was legal without revealing the piece type. The proof is verified on the Stellar blockchain.

Your opponent sees a dot appear at the destination. They never learn if it was a pawn, a queen, or a rook setting up a trap three moves from now. Even the blockchain doesn't know. It only confirms the move was legal.

---

## How to Play

**You need:**
- [Freighter wallet](https://freighter.app) installed in your browser
- Stellar testnet account with some XLM (get free XLM at [friendbot](https://friendbot.stellar.org))
- A second player with the same setup

**Player 1:**
1. Go to https://fog-of-chess.vercel.app
2. Connect Freighter wallet
3. Click **Start New Game**
4. Copy your Session ID
5. Enter Player 2's Stellar address (G...)
6. Sign the transaction — your board is committed on-chain
7. Share the Session ID with Player 2

**Player 2:**
1. Go to https://fog-of-chess.vercel.app in a different browser
2. Connect Freighter wallet
3. Click **Join Game**
4. Enter the Session ID from Player 1
5. Sign the transaction — your board is committed on-chain
6. Wait for Player 1 to move

**Playing:**
- Click a piece to select it, click a square to move
- You see your own pieces in full — opponent sees only a dot
- Red pulsing dot = enemy piece within 1 square (nearby threat)
- Grey dot = enemy piece somewhere on the board (position only)
- Each player has 5 minutes on their clock
- Game result is recorded on Stellar when the king is captured

---

## What is actually real

| Component | Status | Detail |
|-----------|--------|--------|
| ZK circuit | ✅ Real | RISC Zero guest program in Rust |
| Groth16 proof generation | ✅ Real | Local Docker prover |
| On-chain proof verification | ✅ Real | Nethermind BN254 verifier on Stellar testnet |
| Board commitment | ✅ Real | SHA256 of piece positions stored on Stellar |
| Game sessions | ✅ Real | start_game / end_game on Soroban contract |
| Multiplayer sync | ✅ Real | Supabase Realtime — moves sync instantly |
| Fog of war | ✅ Real | Piece type never transmitted or stored |
| Freighter wallet | ✅ Real | Signs all on-chain transactions |
---

## ZK Architecture

### What the circuit proves

Every move runs a RISC Zero guest program that takes **private inputs:**
- `start_pos` — where the piece was
- `piece_type` — what the piece is (pawn, rook, bishop, etc.)
- `salt` — random value committed at game start

And **public inputs:**
- `commitment` — SHA256(start_pos + salt), stored on Stellar at game start
- `end_pos` — where the piece moved to (the only public output)

The circuit verifies two things:
1. `SHA256(start_pos + salt) == commitment` → the piece was really at that square
2. The move is legal for `piece_type` → no illegal moves

The proof reveals only the destination. Piece type stays private forever.

### On-chain verification

```
Player moves → RISC Zero prover generates Groth16 proof
             → Nethermind verifier contract checks BN254 pairing
             → Stellar confirms: "legal move, piece position verified"
             → Opponent sees dot at destination. Nothing else.
```

**Deployed contracts (Stellar Testnet):**
- Fog of Chess: `CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O`
- Nethermind Groth16 Verifier: `CDAEGIJHTD7Y3CQW6UY2EWVG5SOPATAYAHT6KQ7VL3WULPYJ6MHQH4TY`
- Circuit Image ID: `1b198bcc2f79ec6c6a8e2c39e6672a04731b26c95c4ad4cf9d43128697e644a1`

**Proof verification transaction:**
`aaf03eb5806e558107810d28e614096c4cdc3b9bb7ccc1b456d732b3aa2f4bbf`

---

## Running locally with real proofs

```bash
# Prerequisites: Docker, Rust, RISC Zero

# 1. Clone
git clone https://github.com/0xZyrick/fog-of-chess
cd fog-of-chess

# 2. Start Docker
sudo service docker start
newgrp docker

# 3. Start the ZK prover (generates real Groth16 proofs)
cd contracts/fog-of-chess-zk
RISC0_DEV_MODE=0 cargo run --release
# First run pulls RISC Zero Docker image (~2GB) — takes a few minutes
# Subsequent proofs take 3-5 minutes each on consumer hardware

# 4. Start the frontend (in a new terminal)
cd fugitive-king-frontend
VITE_PROVER_URL=http://localhost:3001 bun run dev
```

Open two browser windows at `http://localhost:5173` and play.

---

## Why RISC Zero over Noir

Noir is a ZK-specific DSL — great for simple arithmetic proofs but chess move validation is complex imperative logic. Every `if/else` and conditional has to be flattened into arithmetic constraints manually.

RISC Zero lets you write normal Rust and proves the execution of that Rust. Chess logic in Rust is just chess logic. No translation into constraints required.

The tradeoff is proof size and speed — Noir proofs are smaller and faster, RISC Zero proofs are larger because they prove an entire CPU execution trace. Bonsai (RISC Zero's cloud prover) compresses this into a Groth16 receipt compact enough for on-chain verification in under 10 seconds.

---

## The UX tradeoff

Per-move on-chain verification requires a Freighter signature and ~5 minutes of proving time per move. That's unusable as a game.

The current architecture uses a **ZK rollup pattern** — proofs are generated for every move and stored with each Supabase record. Game result is settled on-chain at the end. A cheater can manipulate their own browser but their game result will fail verification on Stellar. They win on screen. They get nothing on-chain.

Full per-move enforcement requires Bonsai's cloud prover reducing proof time to ~10 seconds — making real-time on-chain verification feasible.

---

## Tech stack

- **Frontend:** React + Vite + Tailwind CSS
- **ZK:** RISC Zero zkVM (Rust guest circuit)
- **Blockchain:** Stellar / Soroban smart contracts (Rust)
- **Wallet:** Freighter (Stellar)
- **Multiplayer:** Supabase Realtime
- **Proof verification:** Nethermind stellar-risc0-verifier (BN254 Groth16)
- **Deployment:** Vercel

---

## What's next

- [ ] Bonsai cloud proving — real proofs on Vercel, sub-10-second moves
- [ ] Per-move on-chain verification with Bonsai speed
- [ ] En passant and castling
- [ ] Matchmaking — no manual session ID sharing
- [ ] Wager system — stake XLM on a game result

---

*Built for the Stellar hackathon. Every line written under pressure, every proof generated with conviction.*


License
MIT
