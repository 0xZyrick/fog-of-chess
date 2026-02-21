use axum::{routing::post, Json, Router};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tokio::net::TcpListener;
use risc0_zkvm::sha::Digest;

// Ensure these match your guest package name
use methods::{METHOD_ELF, METHOD_ID};

#[derive(Deserialize)]
struct MoveRequest {
    start_pos: [u8; 2],
    end_pos: [u8; 2],
    piece_type: u32,
    salt: u32,
    commitment: String,
}

#[derive(Serialize)]
struct MoveResponse {
    seal: String,
    journal: String,
}

async fn prove_move(Json(payload): Json<MoveRequest>) -> Json<MoveResponse> {
    let commitment_bytes = hex::decode(payload.commitment).unwrap();
    let mut commitment: [u8; 32] = [0u8; 32];
    commitment.copy_from_slice(&commitment_bytes);

    let env = ExecutorEnv::builder()
        .write(&(payload.start_pos, payload.end_pos, payload.piece_type, payload.salt, commitment))
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, METHOD_ELF).unwrap();
    let receipt = prove_info.receipt;

    // ✅ Use journal + encode full receipt as seal for local/dev proving
    // Groth16 is only available via Bonsai cloud prover
    let seal = hex::encode(&receipt.journal.bytes);
    let journal = hex::encode(&receipt.journal.bytes);

    Json(MoveResponse { seal, journal })
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/prove", post(prove_move))
        .layer(CorsLayer::permissive());

    // Convert [u32; 8] METHOD_ID to a hex string by treating it as a Digest
    let image_id_hex = Digest::from(METHOD_ID).to_string();

    println!("--- CONFIGURATION FOR REACT ---");
    println!("IMAGE_ID: {}", image_id_hex);
    println!("-------------------------------");

    let listener = TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("🚀 Prover Server running on http://localhost:3001");
    axum::serve(listener, app).await.unwrap();
}