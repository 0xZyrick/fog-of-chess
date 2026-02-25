import { Client as FogOfChessClient } from 'board_commitment_contract';
import { Buffer } from 'buffer';

const CONTRACT_ID = 'CCBL5BNUPBW7HMHCZAQFIC6VTW7HACS2FWCOL3MGWGTZC4QLRVPD6S6O';

const TESTNET_DETAILS = {
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
};

export const getChessClient = (publicKey: string) =>
  new FogOfChessClient({
    ...TESTNET_DETAILS,
    contractId: CONTRACT_ID,
    publicKey,
  });

export const commitBoard = async (
  userAddress: string,
  boardHash: string,
  signTransaction: (xdr: string, opts: any) => Promise<{ signedTxXdr: string }>
) => {
  try {
    const cleanHash = boardHash.startsWith('0x') ? boardHash.slice(2) : boardHash;
    const hashBuffer = Buffer.from(cleanHash, 'hex');

    const client = getChessClient(userAddress);
    const tx = await client.commit_board({
      player_id: userAddress,
      poseidon_hash: hashBuffer as unknown as any,
    });

    if (!tx.built) {
      throw new Error('Transaction simulation failed — built is undefined');
    }

    const { Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
    const { Server } = await import('@stellar/stellar-sdk/rpc');
    const result = await signTransaction(tx.built.toXDR(), {
      networkPassphrase: Networks.TESTNET,
    });
    const server = new Server(TESTNET_DETAILS.rpcUrl);
    const signedTx = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    return server.sendTransaction(signedTx);
  } catch (error) {
    console.error('Board commitment failed:', error);
    throw error;
  }
};