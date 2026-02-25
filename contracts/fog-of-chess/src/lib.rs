#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Env, BytesN, Address, Vec, Bytes,
};

// ── Nethermind RISC Zero Groth16 Verifier (already deployed on testnet) ──────
// https://github.com/NethermindEth/stellar-risc0-verifier
const NETHERMIND_VERIFIER_ID: &str = "CBY3GOBGQXDGRR4K2KYJO2UOXDW5NRW6UKIQHUBNBNU2V3BXQBXGTVX7";

mod risc0_verifier {
    use soroban_sdk::contractimport;
    // Import the Nethermind verifier interface
    // verify(journal: BytesN<32>, image_id: BytesN<32>, seal: Bytes) -> Result<(), VerifierError>
    contractimport!(file = "../../target/wasm32v1-none/release/groth16_verifier.wasm");
}

mod game_hub {
    use soroban_sdk::contractimport;
    contractimport!(file = "../../target/wasm32v1-none/release/mock_game_hub.wasm");
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Commitment(Address),
    GameSession(u32),
    Admin,
    GameHub,
    ImageId,   // Stores the METHOD_ID for your ZK circuit
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyCommitted    = 1,
    NoCommitment        = 2,
    InvalidProof        = 3,
    InvalidProofFormat  = 4,
    NotInitialized      = 5,
    SessionExists       = 6,
    SessionNotFound     = 7,
    NotAuthorized       = 8,
    VerificationFailed  = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct ZKProof {
    pub seal:          Bytes,       // selector(4) + groth16 proof bytes
    pub journal_sha256:BytesN<32>,  // SHA256 of journal (end_pos)
    pub image_id:      BytesN<32>,  // METHOD_ID — identifies the circuit
    pub public_inputs: Vec<BytesN<32>>, // [0] = board commitment
}

#[contracttype]
#[derive(Clone)]
pub struct GameSession {
    pub session_id:  u32,
    pub player1:     Address,
    pub player2:     Address,
    pub player1_won: bool,
    pub active:      bool,
}

#[contract]
pub struct FogOfChessContract;

#[contractimpl]
impl FogOfChessContract {
    /// Initialize contract — store admin, game hub, and circuit image_id
    pub fn init(env: Env, admin: Address, game_hub: Address, image_id: BytesN<32>) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin,   &admin);
        env.storage().instance().set(&DataKey::GameHub, &game_hub);
        env.storage().instance().set(&DataKey::ImageId, &image_id);
    }

    /// Commit to a board setup using a hash
    pub fn commit_board(
        env:          Env,
        player_id:    Address,
        poseidon_hash:BytesN<32>,
    ) -> Result<(), Error> {
        player_id.require_auth();
        let key = DataKey::Commitment(player_id.clone());
        if env.storage().instance().has(&key) {
            return Err(Error::AlreadyCommitted);
        }
        env.storage().instance().set(&key, &poseidon_hash);
        Ok(())
    }

    /// Start a game session — calls game hub
    pub fn start_game(
        env:        Env,
        session_id: u32,
        player1:    Address,
        player2:    Address,
    ) -> Result<(), Error> {
        player1.require_auth();

        let session_key = DataKey::GameSession(session_id);
        if env.storage().instance().has(&session_key) {
            return Err(Error::SessionExists);
        }

        let game_hub: Address = env.storage().instance()
            .get(&DataKey::GameHub).ok_or(Error::NotInitialized)?;

        let hub_client = game_hub::Client::new(&env, &game_hub);
        hub_client.start_game(
            &env.current_contract_address(),
            &session_id, &player1, &player2,
            &1000i128, &1000i128,
        );

        env.storage().instance().set(&session_key, &GameSession {
            session_id, player1, player2,
            player1_won: false, active: true,
        });
        Ok(())
    }

    /// Verify a move with REAL Groth16 proof via Nethermind verifier
    pub fn verify_move(
        env:       Env,
        player_id: Address,
        proof:     ZKProof,
    ) -> Result<bool, Error> {
        player_id.require_auth();

        // 1. Check player has committed a board
        let key = DataKey::Commitment(player_id.clone());
        let commitment: BytesN<32> = env.storage().instance()
            .get(&key).ok_or(Error::NoCommitment)?;

        // 2. Verify the proof's public input matches the stored commitment
        if proof.public_inputs.is_empty() {
            return Err(Error::InvalidProofFormat);
        }
        let proof_commitment = proof.public_inputs.get(0)
            .ok_or(Error::InvalidProofFormat)?;
        if commitment != proof_commitment {
            return Err(Error::InvalidProof);
        }

        // 3. Get the stored image_id (METHOD_ID of our chess circuit)
        let stored_image_id: BytesN<32> = env.storage().instance()
            .get(&DataKey::ImageId).ok_or(Error::NotInitialized)?;

        // 4. REAL on-chain Groth16 verification via Nethermind verifier ✅
        let verifier_id = Address::from_string(
            &soroban_sdk::String::from_str(&env, NETHERMIND_VERIFIER_ID)
        );
        let verifier = risc0_verifier::Client::new(&env, &verifier_id);

        // This call cryptographically verifies the Groth16 proof on-chain
        // Panics (reverts) if proof is invalid — that's the Stellar contract pattern
        verifier.verify(
            &proof.journal_sha256,  // SHA256 of journal (public outputs)
            &stored_image_id,       // Identifies our chess circuit
            &proof.seal,            // selector(4 bytes) + Groth16 proof
        );

        Ok(true)
    }

    /// End game session — calls game hub
    pub fn end_game(
        env:        Env,
        caller:     Address,
        session_id: u32,
        player1_won:bool,
    ) -> Result<(), Error> {
        caller.require_auth();

        let session_key = DataKey::GameSession(session_id);
        let mut session: GameSession = env.storage().instance()
            .get(&session_key).ok_or(Error::SessionNotFound)?;

        if caller != session.player1 && caller != session.player2 {
            return Err(Error::NotAuthorized);
        }

        let game_hub: Address = env.storage().instance()
            .get(&DataKey::GameHub).ok_or(Error::NotInitialized)?;

        let hub_client = game_hub::Client::new(&env, &game_hub);
        hub_client.end_game(&session_id, &player1_won);

        session.active      = false;
        session.player1_won = player1_won;
        env.storage().instance().set(&session_key, &session);
        Ok(())
    }

    pub fn get_commitment(env: Env, player_id: Address) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::Commitment(player_id))
    }

    pub fn get_session(env: Env, session_id: u32) -> Option<GameSession> {
        env.storage().instance().get(&DataKey::GameSession(session_id))
    }
}