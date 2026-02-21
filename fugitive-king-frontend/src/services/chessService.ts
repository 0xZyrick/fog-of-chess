// Use a relative path if the 'bun add' linking hasn't finished yet
import * as FogOfChess from '../../../packages/fog-of-chess'; 
import { Buffer } from 'buffer';

// The Contract ID you just deployed
const CONTRACT_ID = 'CAWXNLVXEYY7C74M5B2YCUWN3M5H4JGNOQDAJKKDZJ6KZ2KJE4AZ2FTG';

// Manually define Testnet details since the constants file is missing
const TESTNET_DETAILS = {
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org:443',
};

export const chessClient = new FogOfChess.Client({
  ...TESTNET_DETAILS,
  contractId: CONTRACT_ID,
});

export const commitBoard = async (userAddress: string, boardHash: string) => {
  try {
    // 1. Convert your hex string into a 32-byte Buffer
    // This removes the '0x' if it exists and converts the rest
    const cleanHash = boardHash.startsWith('0x') ? boardHash.slice(2) : boardHash;
    const hashBuffer = Buffer.from(cleanHash, 'hex');

    // 2. Pass the Buffer instead of the string
    const tx = await chessClient.commit_board({
      player_id: userAddress,
      poseidon_hash: hashBuffer, // No more type error!
    });
    
    const result = await tx.signAndSend();
    return result;
  } catch (error) {
    console.error("Board commitment failed:", error);
    throw error;
  }
};
