use axum::{routing::post, Json, Router};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, VerifierContext};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tokio::net::TcpListener;
use risc0_zkvm::sha::Digest;
use sha2::{Sha256, Digest as Sha2Digest};

use methods::{METHOD_ELF, METHOD_ID};

// Nethermind verifier selector — prepend to every Groth16 seal
const GROTH16_SELECTOR: &str = "73c457ba";

#[derive(Deserialize)]
struct MoveRequest {
    start_pos:  [u8; 2],
    end_pos:    [u8; 2],
    piece_type: u32,
    salt:       u32,
    commitment: String,
}

#[derive(Serialize)]
struct MoveResponse {
    seal:          String, // selector(4 bytes) + groth16 proof — ready for Nethermind verifier
    journal:       String, // hex of raw journal bytes (end_pos)
    journal_sha256:String, // sha256 of journal — what Nethermind verifier expects
    image_id:      String, // METHOD_ID hex — identifies your circuit
    is_dev_mode:   bool,   // tells frontend if this is a real proof
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

async fn prove_move(Json(payload): Json<MoveRequest>) -> Json<MoveResponse> {
    let commitment_bytes = hex::decode(&payload.commitment).expect("Invalid hex commitment");
    let mut commitment: [u8; 32] = [0u8; 32];
    commitment.copy_from_slice(&commitment_bytes);

    let env = ExecutorEnv::builder()
        .write(&(payload.start_pos, payload.end_pos, payload.piece_type, payload.salt, commitment))
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();

    // Check if Bonsai is configured — if so, use Groth16. Otherwise fall back to dev mode.
    let bonsai_configured = std::env::var("BONSAI_API_KEY").is_ok()
        && std::env::var("BONSAI_API_URL").is_ok();
    let dev_mode = std::env::var("RISC0_DEV_MODE").map(|v| v == "1").unwrap_or(!bonsai_configured);

    let image_id_hex = Digest::from(METHOD_ID).to_string();

    if !dev_mode {
        // ── REAL GROTH16 PROOF (Bonsai or local Docker) ───────────────────────
        let prove_info = prover
            .prove_with_ctx(
                env,
                &VerifierContext::default(),
                METHOD_ELF,
                &ProverOpts::groth16(), // ← request Groth16 specifically
            )
            .expect("Proving failed");

        let receipt = prove_info.receipt;

        // Extract Groth16 seal
        let groth16 = receipt
            .inner
            .groth16()
            .expect("Expected Groth16 receipt — make sure Bonsai or Docker is configured");

        let seal_bytes    = &groth16.seal;
        let seal_hex      = hex::encode(seal_bytes);
        // Prepend Nethermind verifier selector
        let seal_with_selector = format!("{}{}", GROTH16_SELECTOR, seal_hex);

        let journal_bytes = &receipt.journal.bytes;
        let journal_hex   = hex::encode(journal_bytes);

        // SHA256 of journal — what Nethermind verifier's `journal` param expects
        let mut hasher = Sha256::new();
        hasher.update(journal_bytes);
        let journal_sha256 = hex::encode(hasher.finalize());

        println!("✅ Real Groth16 proof generated");
        println!("   image_id:       {}", image_id_hex);
        println!("   journal:        {}", journal_hex);
        println!("   journal_sha256: {}", journal_sha256);
        println!("   seal (partial): {}...", &seal_with_selector[..20]);

        Json(MoveResponse {
            seal:          seal_with_selector,
            journal:       journal_hex,
            journal_sha256,
            image_id:      image_id_hex,
            is_dev_mode:   false,
        })
    } else {
        // ── DEV MODE — fast mock proof for local development ─────────────────
        println!("⚠️  DEV MODE — mock proof (set BONSAI_API_KEY + BONSAI_API_URL for real proofs)");

        let prove_info = prover.prove(env, METHOD_ELF).expect("Dev prove failed");
        let receipt    = prove_info.receipt;

        let journal_bytes  = &receipt.journal.bytes;
        let journal_hex    = hex::encode(journal_bytes);

        let mut hasher = Sha256::new();
        hasher.update(journal_bytes);
        let journal_sha256 = hex::encode(hasher.finalize());

        // Mock seal — journal bytes padded, prefixed with selector so format matches
        let mock_seal_bytes = {
            let mut v = journal_bytes.to_vec();
            v.resize(256, 0); // pad to look like a real seal
            v
        };
        let seal_with_selector = format!("{}{}", GROTH16_SELECTOR, hex::encode(&mock_seal_bytes));

        Json(MoveResponse {
            seal:          seal_with_selector,
            journal:       journal_hex,
            journal_sha256,
            image_id:      image_id_hex,
            is_dev_mode:   true,
        })
    }
}

#[tokio::main]
async fn main() {
    let bonsai_ready = std::env::var("BONSAI_API_KEY").is_ok();
    let dev_mode_env  = std::env::var("RISC0_DEV_MODE").unwrap_or_default();
    let real_mode     = !bonsai_ready && dev_mode_env == "0";
    let mode_label    = if bonsai_ready { "🟢 REAL Groth16 (Bonsai cloud)" }
                        else if real_mode { "🟢 REAL Groth16 (local Docker)" }
                        else { "🟡 Dev mode (mock proofs)" };

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  LANTERN CHESS — ZK PROVER SERVER");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  Mode:      {}", mode_label);
    println!("  Image ID:  {}", Digest::from(METHOD_ID).to_string());
    println!("  Verifier:  CBY3GOBGQXDGRR4K2KYJO2UOXDW5NRW6UKIQHUBNBNU2V3BXQBXGTVX7");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if !bonsai_ready && !real_mode {
        println!("  To enable real proofs:");
        println!("  RISC0_DEV_MODE=0 cargo run --release  (uses local Docker)");
        println!("  or set BONSAI_API_KEY + BONSAI_API_URL for cloud proving");
    }

    let app = Router::new()
        .route("/prove", post(prove_move))
        .layer(CorsLayer::permissive());

    let listener = TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("\n🚀 Prover running on http://localhost:3001/prove\n");
    axum::serve(listener, app).await.unwrap();
}