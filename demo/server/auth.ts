import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { PlayerSession } from './types.js';

interface Challenge {
  address: string;
  message: string;
  expiresAt: number;
}

export class AuthService {
  private readonly challenges = new Map<string, Challenge>();
  private readonly sessions = new Map<string, PlayerSession>();

  constructor(private readonly publicOrigin: string) {}

  createGuest(): PlayerSession {
    const id = randomUUID().slice(0, 8).toUpperCase();
    return this.createSession(`SIM-${id}`, `Player ${id.slice(0, 4)}`, true);
  }

  createChallenge(address: string): Challenge {
    if (!address || address.length > 64) throw new Error('Invalid wallet address.');
    const expiresAt = Date.now() + 5 * 60_000;
    const nonce = randomBytes(16).toString('hex');
    const message = [
      '20 Questions wallet sign-in',
      `Origin: ${this.publicOrigin}`,
      `Wallet: ${address}`,
      `Nonce: ${nonce}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      '',
      'This request signs in only. It does not authorize a transaction.',
    ].join('\n');
    const challenge = { address, message, expiresAt };
    this.challenges.set(address, challenge);
    return challenge;
  }

  verifyChallenge(input: {
    address: string;
    message: string;
    signatureBase64: string;
    publicKeyBase64: string;
  }): PlayerSession {
    const challenge = this.challenges.get(input.address);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.message !== input.message) {
      throw new Error('Wallet challenge is invalid or expired.');
    }
    const publicKey = Buffer.from(input.publicKeyBase64, 'base64');
    const signature = Buffer.from(input.signatureBase64, 'base64');
    if (publicKey.length !== nacl.sign.publicKeyLength || bs58.encode(publicKey) !== input.address) {
      throw new Error('Wallet public key does not match the requested address.');
    }
    const verified = nacl.sign.detached.verify(
      Buffer.from(input.message, 'utf8'),
      signature,
      publicKey,
    );
    if (!verified) throw new Error('Wallet signature could not be verified.');
    this.challenges.delete(input.address);
    return this.createSession(input.address, shortWallet(input.address), false);
  }

  resolve(authorization: string | undefined): PlayerSession | undefined {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      if (session) this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  private createSession(wallet: string, playerName: string, simulated: boolean): PlayerSession {
    const token = randomBytes(32).toString('base64url');
    const session = {
      token,
      wallet,
      playerName,
      simulated,
      expiresAt: Date.now() + 24 * 60 * 60_000,
    };
    this.sessions.set(token, session);
    return session;
  }
}

export function shortWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
