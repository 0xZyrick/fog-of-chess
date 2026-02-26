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

  /**
   * Connect with Freighter wallet (real wallet — production)
   */
  const connectFreighter = useCallback(async () => {
    try {
      setConnecting(true);
      setError(null);

      // Check Freighter is installed
      const { isConnected: installed } = await freighterIsConnected();
      if (!installed) {
        throw new Error('Freighter not installed. Get it at freighter.app');
      }

      // Request access — opens Freighter popup
      const result = await requestAccess();

      // v6 returns { address } not { publicKey }
      const pk = (result as any).address || (result as any).publicKey;
      if (!pk) throw new Error('No address returned from Freighter');

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

  /**
   * Connect as a dev player (for testing only)
   */
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

  /**
   * Get a signer — works for both Freighter and dev wallet
   */
  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey || !walletType) {
      throw new Error('Wallet not connected');
    }

    if (walletType === 'dev') {
      return devWalletService.getSigner();
    }

    // Freighter signer
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
        // Freighter v6 doesn't expose signAuthEntry directly
        // Return as-is — contract will handle unsigned auth entries
        return { signedAuthEntry: preimageXdr, signerAddress: publicKey };
      },
    };
  }, [isConnected, publicKey, walletType]);

  const isDevModeAvailable = useCallback(() => DevWalletService.isDevModeAvailable(), []);
  const isDevPlayerAvailable = useCallback((n: 1 | 2) => DevWalletService.isPlayerAvailable(n), []);
  const getCurrentDevPlayer = useCallback(() => {
    if (walletType !== 'dev') return null;
    return devWalletService.getCurrentPlayer();
  }, [walletType]);

  return {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    connectFreighter,
    connectDev,
    switchPlayer,
    disconnect,
    getContractSigner,
    isDevModeAvailable,
    isDevPlayerAvailable,
    getCurrentDevPlayer,
  };
}