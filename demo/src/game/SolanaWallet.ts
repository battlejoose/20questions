import { createDefaultClient, type SolanaClient, type WalletSession } from '@solana/client';
import type { GameApi } from './api';
import type { PlayerSession } from './types';

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
}

export class SolanaWallet {
  private client: SolanaClient | undefined;
  private walletSession: WalletSession | undefined;

  constructor(private readonly api: GameApi) {}

  get options(): WalletOption[] {
    return this.requireClient().connectors.all
      .filter((connector) => connector.isSupported())
      .map(({ id, name, icon }) => ({ id, name, icon }));
  }

  get connectedAddress(): string | undefined {
    return this.walletSession?.account.address;
  }

  async connect(connectorId: string): Promise<PlayerSession> {
    const walletSession = await this.requireClient().actions.connectWallet(connectorId, {
      allowInteractiveFallback: true,
    });
    if (!walletSession.signMessage) {
      await walletSession.disconnect();
      throw new Error('This wallet does not support message signing.');
    }
    const address = walletSession.account.address;
    const challenge = await this.api.challenge(address);
    const signature = await walletSession.signMessage(new TextEncoder().encode(challenge.message));
    const session = await this.api.verifyWallet({
      address,
      message: challenge.message,
      signatureBase64: bytesToBase64(signature),
      publicKeyBase64: bytesToBase64(walletSession.account.publicKey),
    });
    this.walletSession = walletSession;
    return session;
  }

  async pay(destination: string, amountLamports: number): Promise<string> {
    if (!this.walletSession) throw new Error('Reconnect the wallet to approve this payment.');
    const signature = await this.requireClient().solTransfer.sendTransfer(
      {
        amount: BigInt(amountLamports),
        authority: this.walletSession,
        destination,
        commitment: 'finalized',
      },
      { commitment: 'finalized', maxRetries: 3 },
    );
    return signature;
  }

  async disconnect(): Promise<void> {
    await this.walletSession?.disconnect();
    this.walletSession = undefined;
    this.api.clearSession();
  }

  destroy(): void {
    this.client?.destroy();
  }

  private requireClient(): SolanaClient {
    this.client ??= createDefaultClient({
      cluster: 'mainnet-beta',
      commitment: 'finalized',
      walletConnectors: 'default',
    });
    return this.client;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
