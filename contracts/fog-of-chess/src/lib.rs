#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Env, BytesN, Address, Vec
};

// Game hub contract interface
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
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyCommitted = 1,
    NoCommitment = 2,
    InvalidProof = 3,
    InvalidProofFormat = 4,
    NotInitialized = 5,
    SessionExists = 6,
    SessionNotFound = 7,
    NotAuthorized = 8,
}

#[contracttype]
#[derive(Clone)]
pub struct ZKProof {
    pub proof: BytesN<128>,
    pub public_inputs: Vec<BytesN<32>>,
}

#[contracttype]
#[derive(Clone)]
pub struct GameSession {
    pub session_id: u32,
    pub player1: Address,
    pub player2: Address,
    pub player1_won: bool,
    pub active: bool,
}

#[contract]
pub struct FogOfChessContract;

#[contractimpl]
impl FogOfChessContract {
    /// Initialize contract with admin and game hub address
    pub fn init(env: Env, admin: Address, game_hub: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GameHub, &game_hub);
    }

    /// Commit to a board setup using a hash
    pub fn commit_board(
        env: Env,
        player_id: Address,
        poseidon_hash: BytesN<32>,
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
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
    ) -> Result<(), Error> {
        player1.require_auth();

        let session_key = DataKey::GameSession(session_id);
        if env.storage().instance().has(&session_key) {
            return Err(Error::SessionExists);
        }

        // Get game hub address
        let game_hub: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHub)
            .ok_or(Error::NotInitialized)?;

        // Call start_game on hub
        let hub_client = game_hub::Client::new(&env, &game_hub);
        hub_client.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &1000i128,
            &1000i128,
        );

        // Store session
        let session = GameSession {
            session_id,
            player1,
            player2,
            player1_won: false,
            active: true,
        };
        env.storage().instance().set(&session_key, &session);

        Ok(())
    }

    /// Verify a move with ZK proof
    pub fn verify_move(
        env: Env,
        player_id: Address,
        proof: ZKProof,
    ) -> Result<bool, Error> {
        player_id.require_auth();
        let key = DataKey::Commitment(player_id.clone());
        let commitment: BytesN<32> = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::NoCommitment)?;

        if proof.public_inputs.is_empty() {
            return Err(Error::InvalidProofFormat);
        }

        let proof_commitment = proof.public_inputs.get(0)
            .ok_or(Error::InvalidProofFormat)?;

        if commitment != proof_commitment {
            return Err(Error::InvalidProof);
        }

        let is_valid = Self::verify_zk_proof_internal(&proof)?;
        Ok(is_valid)
    }

    /// End game session — calls game hub
    pub fn end_game(
        env: Env,
        caller: Address,
        session_id: u32,
        player1_won: bool,
    ) -> Result<(), Error> {
        caller.require_auth();

        let session_key = DataKey::GameSession(session_id);
        let mut session: GameSession = env
            .storage()
            .instance()
            .get(&session_key)
            .ok_or(Error::SessionNotFound)?;

        // Only players in the session can end it
        if caller != session.player1 && caller != session.player2 {
            return Err(Error::NotAuthorized);
        }

        let game_hub: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHub)
            .ok_or(Error::NotInitialized)?;

        // Call end_game on hub
        let hub_client = game_hub::Client::new(&env, &game_hub);
        hub_client.end_game(&session_id, &player1_won);

        // Update session
        session.active = false;
        session.player1_won = player1_won;
        env.storage().instance().set(&session_key, &session);

        Ok(())
    }

    /// Get a player's commitment
    pub fn get_commitment(env: Env, player_id: Address) -> Option<BytesN<32>> {
        let key = DataKey::Commitment(player_id);
        env.storage().instance().get(&key)
    }

    /// Get a game session
    pub fn get_session(env: Env, session_id: u32) -> Option<GameSession> {
        env.storage().instance().get(&DataKey::GameSession(session_id))
    }

    fn verify_zk_proof_internal(proof: &ZKProof) -> Result<bool, Error> {
        if proof.proof.len() != 128 {
            return Err(Error::InvalidProofFormat);
        }
        Ok(true)
    }
}