import { useCallback } from 'react';
import { useWalletStore } from '../store/walletSlice';
import { devWalletService, DevWalletService } from '../services/devWalletService';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';
import {
  isConnected as freighterIsConnected,
  requestAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';

export function useWallet() {
  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    setWallet,
    setConnecting,
    setNetwork,
    setError,
    disconnect: storeDisconnect,
  } = useWalletStore();

  const connectFreighter = useCallback(async () => {
    try {
      setConnecting(true);
      setError(null);

      const { isConnected: installed } = await freighterIsConnected();
      if (!installed) {
        throw new Error('Freighter not installed. Get it at freighter.app');
      }

      // Retry up to 3 times — Freighter extension context sometimes closes early
      let pk: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await requestAccess();
          pk = (result as any).address || (result as any).publicKey || null;
          if (pk) break;
          // Got a response but no address — wait and retry
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < 3) await new Promise(r => setTimeout(r, 600));
        }
      }

      if (!pk) {
        throw lastError || new Error('Freighter did not return an address — try clicking Connect again');
      }

      setWallet(pk, 'freighter', 'wallet');
      setNetwork(NETWORK, NETWORK_PASSPHRASE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect Freighter';
      setError(msg);
      console.error('Freighter connection error:', err);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setWallet, setConnecting, setNetwork, setError]);

  const connectDev = useCallback(
    async (playerNumber: 1 | 2) => {
      try {
        setConnecting(true);
        setError(null);
        await devWalletService.initPlayer(playerNumber);
        const address = devWalletService.getPublicKey();
        setWallet(address, `dev-player${playerNumber}`, 'dev');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to connect dev wallet';
        setError(msg);
        console.error('Dev wallet connection error:', err);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [setWallet, setConnecting, setNetwork, setError]
  );

  const switchPlayer = useCallback(
    async (playerNumber: 1 | 2) => {
      if (walletType !== 'dev') throw new Error('Can only switch players in dev mode');
      try {
        setConnecting(true);
        setError(null);
        await devWalletService.switchPlayer(playerNumber);
        const address = devWalletService.getPublicKey();
        setWallet(address, `dev-player${playerNumber}`, 'dev');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to switch player';
        setError(msg);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [walletType, setWallet, setConnecting, setError]
  );

  const disconnect = useCallback(async () => {
    if (walletType === 'dev') devWalletService.disconnect();
    storeDisconnect();
  }, [walletType, storeDisconnect]);

  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey || !walletType) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'dev') {
      return devWalletService.getSigner();
    }

    return {
      signTransaction: async (txXdr: string, opts?: any) => {
        const result = await freighterSignTransaction(txXdr, {
          networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
        });
        if ('error' in result && result.error) {
          throw new Error(result.error);
        }
        const signedTxXdr = 'signedTxXdr' in result ? result.signedTxXdr : (result as any);
        return { signedTxXdr, signerAddress: publicKey };
      },
      signAuthEntry: async (preimageXdr: string) => {
        return { signedAuthEntry: preimageXdr, signerAddress: publicKey };
      },
    };
  }, [isConnected, publicKey, walletType]);

  const isDevModeAvailable  = useCallback(() => DevWalletService.isDevModeAvailable(), []);
  const isDevPlayerAvailable = useCallback((n: 1 | 2) => DevWalletService.isPlayerAvailable(n), []);
  const getCurrentDevPlayer  = useCallback(() => {
    if (walletType !== 'dev') return null;
    return devWalletService.getCurrentPlayer();
  }, [walletType]);

  return {
    publicKey, walletId, walletType, isConnected, isConnecting,
    network, networkPassphrase, error,
    connectFreighter, connectDev, switchPlayer, disconnect,
    getContractSigner, isDevModeAvailable, isDevPlayerAvailable, getCurrentDevPlayer,
  };
}