# ♟️ Fog of Chess (Lantern Chess)
### ZK-Powered Fog-of-War Chess on Stellar Protocol 25

In normal online chess, you trust the server to hide your opponent's pieces honestly.
In Fog of Chess, you don't have to trust anyone.

## 🎮 What Is It?

A two-player chess game where hidden pieces are mathematically enforced using
Zero-Knowledge proofs. Each player commits their board state via a Poseidon hash.
Every move generates a RISC Zero zkVM proof — proving the move is valid without
revealing hidden pieces to your opponent. Verified on Stellar testnet.

Web2 players get a seamless fog-of-war chess experience in the browser.
Web3 players get something deeper — a game where fairness isn't a promise, it's a proof.

## ⚡ How The ZK Works
```
Player makes a move
       ↓
RISC Zero prover generates ZK proof off-chain
(proves move is valid without revealing board state)
       ↓
Proof submitted to board-commitment-contract on Stellar
       ↓
Opponent sees the move — never sees the hidden pieces
       ↓
Game session recorded on Game Hub (start → end)
```

Board state is committed using **Poseidon hashing** — a ZK-native primitive
now available natively on Stellar via **Protocol 25**.

## 🔗 Deployed Contracts (Stellar Testnet)

| Contract | Address |
|----------|---------|
| Game Hub | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
| Board Commitment | `CBPCMMM2U5VL6LWMKLXEMYRP7EPPIQYQVQL2O4NADYVL3KAM52AGP2I2` |

## 🚀 Run Locally
```bash
# Terminal 1 — ZK Prover
cd contracts/fog-of-chess-zk
cargo run --bin host
# Prover at localhost:3001

# Terminal 2 — Frontend
cd fugitive-king-frontend
bun install && bun run dev
# Open http://localhost:5173
```

## 🎯 How To Play

1. Open the game and click **Connect as Player 1**
2. Enter your opponent's Stellar address
3. Click **Start On-Chain Game** — registers session on Stellar
4. Click pieces to move — ZK proof generates automatically
5. Capture the king to win — result recorded on Stellar

> Pieces outside your visibility zone are hidden behind fog.
> Your opponent can never see your hidden pieces — not even by inspecting the contract.

## 🛠 Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Rust + Soroban SDK |
| ZK Proof System | RISC Zero zkVM + Poseidon |
| Frontend | React + Vite |
| Stellar SDK | @stellar/stellar-sdk v14 |
| Network | Stellar Testnet (Protocol 25) |

## 📁 Structure
```
fog-of-chess/
├── contracts/
│   └── fog-of-chess/src/lib.rs      # Soroban contract
├── fugitive-king-frontend/
│   └── src/games/fugitive-king/
│       ├── LanternChess.jsx          # Main game UI
│       ├── zkServices.tsx            # ZK proof flow
│       ├── useGameLogic.ts           # Game state
│       └── constants.ts              # Piece definitions
├── bindings/
│   └── board_commitment_contract/    # Generated TS bindings
└── README.md
```

## 💡 Why This Matters

Traditional fog-of-war games hide pieces on a server you have to trust.
Fog of Chess removes that trust entirely. the fog is enforced by math,
not by a server promise. This is only possible because Protocol 25 brings
Poseidon hashing and BN254 operations natively to Stellar, making ZK
verification cheap enough to power real games.

*Built for the Stellar ZK Gaming Hackathon · Powered by Stellar Protocol 25*


License
MIT
