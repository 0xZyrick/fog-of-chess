import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
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
        contractId: "CCEPFHPTYYKBTAXVSS73Y757JR53YGQCPXGYEO7DDUU5LA4SGQDXH3HT",
    }
};
export const Errors = {
    1: { message: "AlreadyCommitted" },
    2: { message: "NoCommitment" },
    3: { message: "InvalidProof" },
    4: { message: "InvalidProofFormat" },
    5: { message: "NotInitialized" },
    6: { message: "SessionExists" },
    7: { message: "SessionNotFound" },
    8: { message: "NotAuthorized" }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAEAAAAAAAAADE5vQ29tbWl0bWVudAAAAAIAAAAAAAAADEludmFsaWRQcm9vZgAAAAMAAAAAAAAAEkludmFsaWRQcm9vZkZvcm1hdAAAAAAABAAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAUAAAAAAAAADVNlc3Npb25FeGlzdHMAAAAAAAAGAAAAAAAAAA9TZXNzaW9uTm90Rm91bmQAAAAABwAAAAAAAAANTm90QXV0aG9yaXplZAAAAAAAAAg=",
            "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAACkNvbW1pdG1lbnQAAAAAAAEAAAATAAAAAQAAAAAAAAALR2FtZVNlc3Npb24AAAAAAQAAAAQAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAAB0dhbWVIdWIA",
            "AAAAAQAAAAAAAAAAAAAAB1pLUHJvb2YAAAAAAgAAAAAAAAAFcHJvb2YAAAAAAAPuAAAAgAAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAPuAAAAIA==",
            "AAAAAQAAAAAAAAAAAAAAC0dhbWVTZXNzaW9uAAAAAAUAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAtwbGF5ZXIxX3dvbgAAAAABAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQ=",
            "AAAAAAAAADNJbml0aWFsaXplIGNvbnRyYWN0IHdpdGggYWRtaW4gYW5kIGdhbWUgaHViIGFkZHJlc3MAAAAABGluaXQAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGdhbWVfaHViAAAAEwAAAAA=",
            "AAAAAAAAACNFbmQgZ2FtZSBzZXNzaW9uIOKAlCBjYWxscyBnYW1lIGh1YgAAAAAIZW5kX2dhbWUAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAC3BsYXllcjFfd29uAAAAAAEAAAABAAAD6QAAAAIAAAAD",
            "AAAAAAAAACdTdGFydCBhIGdhbWUgc2Vzc2lvbiDigJQgY2FsbHMgZ2FtZSBodWIAAAAACnN0YXJ0X2dhbWUAAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAQAAA+kAAAACAAAAAw==",
            "AAAAAAAAABJHZXQgYSBnYW1lIHNlc3Npb24AAAAAAAtnZXRfc2Vzc2lvbgAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+gAAAfQAAAAC0dhbWVTZXNzaW9uAA==",
            "AAAAAAAAABtWZXJpZnkgYSBtb3ZlIHdpdGggWksgcHJvb2YAAAAAC3ZlcmlmeV9tb3ZlAAAAAAIAAAAAAAAACXBsYXllcl9pZAAAAAAAABMAAAAAAAAABXByb29mAAAAAAAH0AAAAAdaS1Byb29mAAAAAAEAAAPpAAAAAQAAAAM=",
            "AAAAAAAAACRDb21taXQgdG8gYSBib2FyZCBzZXR1cCB1c2luZyBhIGhhc2gAAAAMY29tbWl0X2JvYXJkAAAAAgAAAAAAAAAJcGxheWVyX2lkAAAAAAAAEwAAAAAAAAANcG9zZWlkb25faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
            "AAAAAAAAABlHZXQgYSBwbGF5ZXIncyBjb21taXRtZW50AAAAAAAADmdldF9jb21taXRtZW50AAAAAAABAAAAAAAAAAlwbGF5ZXJfaWQAAAAAAAATAAAAAQAAA+gAAAPuAAAAIA=="]), options);
        this.options = options;
    }
    fromJSON = {
        init: (this.txFromJSON),
        end_game: (this.txFromJSON),
        start_game: (this.txFromJSON),
        get_session: (this.txFromJSON),
        verify_move: (this.txFromJSON),
        commit_board: (this.txFromJSON),
        get_commitment: (this.txFromJSON)
    };
}
