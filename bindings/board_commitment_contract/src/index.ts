import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBPCMMM2U5VL6LWMKLXEMYRP7EPPIQYQVQL2O4NADYVL3KAM52AGP2I2",
  }
} as const

export const Errors = {
  1: {message:"AlreadyCommitted"},
  2: {message:"NoCommitment"},
  3: {message:"InvalidProof"},
  4: {message:"InvalidProofFormat"},
  5: {message:"NotInitialized"},
  6: {message:"SessionExists"},
  7: {message:"SessionNotFound"},
  8: {message:"NotAuthorized"}
}

export type DataKey = {tag: "Commitment", values: readonly [string]} | {tag: "GameSession", values: readonly [u32]} | {tag: "Admin", values: void} | {tag: "GameHub", values: void};


export interface ZKProof {
  proof: Buffer;
  public_inputs: Array<Buffer>;
}


export interface GameSession {
  active: boolean;
  player1: string;
  player1_won: boolean;
  player2: string;
  session_id: u32;
}

export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize contract with admin and game hub address
   */
  init: ({admin, game_hub}: {admin: string, game_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a end_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * End game session — calls game hub
   */
  end_game: ({caller, session_id, player1_won}: {caller: string, session_id: u32, player1_won: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a game session — calls game hub
   */
  start_game: ({session_id, player1, player2}: {session_id: u32, player1: string, player2: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a game session
   */
  get_session: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<GameSession>>>

  /**
   * Construct and simulate a verify_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a move with ZK proof
   */
  verify_move: ({player_id, proof}: {player_id: string, proof: ZKProof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a commit_board transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Commit to a board setup using a hash
   */
  commit_board: ({player_id, poseidon_hash}: {player_id: string, poseidon_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_commitment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a player's commitment
   */
  get_commitment: ({player_id}: {player_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAEAAAAAAAAADE5vQ29tbWl0bWVudAAAAAIAAAAAAAAADEludmFsaWRQcm9vZgAAAAMAAAAAAAAAEkludmFsaWRQcm9vZkZvcm1hdAAAAAAABAAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAUAAAAAAAAADVNlc3Npb25FeGlzdHMAAAAAAAAGAAAAAAAAAA9TZXNzaW9uTm90Rm91bmQAAAAABwAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAg=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAACkNvbW1pdG1lbnQAAAAAAAEAAAATAAAAAQAAAAAAAAALR2FtZVNlc3Npb24AAAAAAQAAAAQAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAAB0dhbWVIdWIA",
        "AAAAAQAAAAAAAAAAAAAAB1pLUHJvb2YAAAAAAgAAAAAAAAAFcHJvb2YAAAAAAAPuAAAAgAAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAAC0dhbWVTZXNzaW9uAAAAAAUAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAtwbGF5ZXIxX3dvbgAAAAABAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQ=",
        "AAAAAAAAADNJbml0aWFsaXplIGNvbnRyYWN0IHdpdGggYWRtaW4gYW5kIGdhbWUgaHViIGFkZHJlc3MAAAAABGluaXQAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGdhbWVfaHViAAAAEwAAAAA=",
        "AAAAAAAAACNFbmQgZ2FtZSBzZXNzaW9uIOKAlCBjYWxscyBnYW1lIGh1YgAAAAAIZW5kX2dhbWUAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAC3BsYXllcjFfd29uAAAAAAEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAACdTdGFydCBhIGdhbWUgc2Vzc2lvbiDigJQgY2FsbHMgZ2FtZSBodWIAAAAACnN0YXJ0X2dhbWUAAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAABJHZXQgYSBnYW1lIHNlc3Npb24AAAAAAAtnZXRfc2Vzc2lvbgAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+gAAAfQAAAAC0dhbWVTZXNzaW9uAA==",
        "AAAAAAAAABtWZXJpZnkgYSBtb3ZlIHdpdGggWksgcHJvb2YAAAAAC3ZlcmlmeV9tb3ZlAAAAAAIAAAAAAAAACXBsYXllcl9pZAAAAAAAABMAAAAAAAAABXByb29mAAAAAAAH0AAAAAdaS1Byb29mAAAAAAEAAAPpAAAAAQAAAAM=",
        "AAAAAAAAACRDb21taXQgdG8gYSBib2FyZCBzZXR1cCB1c2luZyBhIGhhc2gAAAAMY29tbWl0X2JvYXJkAAAAAgAAAAAAAAAJcGxheWVyX2lkAAAAAAAAEwAAAAAAAAANcG9zZWlkb25faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAABlHZXQgYSBwbGF5ZXIncyBjb21taXRtZW50AAAAAAAADmdldF9jb21taXRtZW50AAAAAAABAAAAAAAAAAlwbGF5ZXJfaWQAAAAAAAATAAAAAQAAA+gAAAPuAAAAIA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<null>,
        end_game: this.txFromJSON<Result<void>>,
        start_game: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Option<GameSession>>,
        verify_move: this.txFromJSON<Result<boolean>>,
        commit_board: this.txFromJSON<Result<void>>,
        get_commitment: this.txFromJSON<Option<Buffer>>
  }
}