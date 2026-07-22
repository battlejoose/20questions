import { setTimeout as delay } from 'node:timers/promises';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type ClusterUrl,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import type { PaymentProvider } from './PaymentProvider.js';
import type {
  PaymentReceipt,
  PaymentRequest,
  QuestionReservation,
  RoundRecord,
} from '../types.js';

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

interface RpcAccountKey {
  pubkey: string;
  signer: boolean;
}

interface ParsedInstruction {
  program?: string;
  parsed?: {
    type?: string;
    info?: { source?: string; destination?: string; lamports?: number };
  };
}

interface ParsedTransaction {
  meta?: { err: unknown };
  transaction?: {
    message?: {
      accountKeys?: Array<string | RpcAccountKey>;
      instructions?: ParsedInstruction[];
    };
  };
}

export interface MainnetPaymentConfig {
  rpcUrl: string;
  mnemonic: string;
  derivationPath: string;
  expectedTreasuryAddress?: string;
  platformFeeBps: number;
}

export class MainnetPaymentProvider implements PaymentProvider {
  readonly mode = 'mainnet' as const;
  treasuryAddress: string | undefined;
  private signer: KeyPairSigner | undefined;

  constructor(private readonly config: MainnetPaymentConfig) {}

  async initialize(): Promise<void> {
    if (!validateMnemonic(this.config.mnemonic)) {
      throw new Error('SOLANA_TREASURY_MNEMONIC is not a valid BIP-39 mnemonic.');
    }
    const seed = mnemonicToSeedSync(this.config.mnemonic);
    const privateKey = derivePath(this.config.derivationPath, seed.toString('hex')).key;
    this.signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey);
    this.treasuryAddress = this.signer.address;
    if (
      this.config.expectedTreasuryAddress &&
      this.config.expectedTreasuryAddress !== this.treasuryAddress
    ) {
      throw new Error('SOLANA_TREASURY_ADDRESS does not match the mnemonic-derived signer.');
    }
  }

  async recordCommitment(round: RoundRecord): Promise<string> {
    return this.sendMemo(`20Q|COMMIT|v1|${round.id}|${round.commitment}`);
  }

  createPaymentRequest(reservation: QuestionReservation): PaymentRequest {
    if (!this.treasuryAddress) throw new Error('Mainnet payment provider is not initialized.');
    return {
      mode: this.mode,
      reservationId: reservation.id,
      amountLamports: reservation.amountLamports,
      treasuryAddress: this.treasuryAddress,
      expiresAt: reservation.expiresAt,
    };
  }

  async confirmPayment(
    reservation: QuestionReservation,
    signatureValue?: string,
  ): Promise<PaymentReceipt> {
    if (!signatureValue || !this.treasuryAddress) {
      throw new Error('A mainnet transaction signature is required.');
    }
    const transaction = await this.rpcCall<ParsedTransaction | null>('getTransaction', [
      signatureValue,
      { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
    if (!transaction || transaction.meta?.err) {
      throw new Error('The payment transaction is not finalized or it failed.');
    }
    const keys = transaction.transaction?.message?.accountKeys ?? [];
    const walletSigned = keys.some((key) =>
      typeof key === 'string'
        ? key === reservation.wallet
        : key.pubkey === reservation.wallet && key.signer,
    );
    const instructions = transaction.transaction?.message?.instructions ?? [];
    const exactTransfer = instructions.some((instruction) => {
      const info = instruction.parsed?.info;
      return (
        instruction.program === 'system' &&
        instruction.parsed?.type === 'transfer' &&
        info?.source === reservation.wallet &&
        info.destination === this.treasuryAddress &&
        info.lamports === reservation.amountLamports
      );
    });
    if (!walletSigned || !exactTransfer) {
      throw new Error('Transaction does not contain the reserved wallet-to-treasury payment.');
    }
    return { signature: signatureValue, amountLamports: reservation.amountLamports };
  }

  async refund(reservation: QuestionReservation): Promise<string> {
    return this.sendTransfer(
      address(reservation.wallet),
      reservation.amountLamports,
      `20Q|REFUND|v1|${reservation.roundId}|${reservation.id}`,
    );
  }

  async recordReveal(round: RoundRecord): Promise<string> {
    return this.sendMemo(`20Q|REVEAL|v1|${round.id}|${round.secret}|${round.salt}`);
  }

  async payout(round: RoundRecord, winnerAddress: string): Promise<string> {
    const fee = Math.floor((round.potLamports * this.config.platformFeeBps) / 10_000);
    const payoutLamports = round.potLamports - fee;
    if (payoutLamports <= 0) throw new Error('The computed payout is empty.');
    return this.sendTransfer(
      address(winnerAddress),
      payoutLamports,
      `20Q|PAYOUT|v1|${round.id}|${round.commitment}`,
    );
  }

  private async sendMemo(memo: string): Promise<string> {
    return this.sendInstructions([memoInstruction(memo)]);
  }

  private async sendTransfer(
    destination: Address,
    amountLamports: number,
    memo: string,
  ): Promise<string> {
    const signer = this.requireSigner();
    return this.sendInstructions([
      getTransferSolInstruction({ source: signer, destination, amount: BigInt(amountLamports) }),
      memoInstruction(memo),
    ]);
  }

  private async sendInstructions(instructions: readonly Instruction[]): Promise<string> {
    const signer = this.requireSigner();
    const rpc = createSolanaRpc(this.config.rpcUrl as ClusterUrl);
    const latestBlockhash = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayerSigner(signer, value),
      (value) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    const signatureValue = getSignatureFromTransaction(transaction);
    await sendTransactionWithoutConfirmingFactory({ rpc })(transaction, {
      commitment: 'confirmed',
      maxRetries: 3n,
      skipPreflight: false,
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statuses = await rpc.getSignatureStatuses([signatureValue]).send();
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'finalized') {
        return signatureValue;
      }
      await delay(1_000);
    }
    throw new Error(`Timed out confirming Solana transaction ${signatureValue}.`);
  }

  private requireSigner(): KeyPairSigner {
    if (!this.signer) throw new Error('Mainnet payment provider is not initialized.');
    return this.signer;
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`);
    const payload = (await response.json()) as { result?: T; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message ?? 'Solana RPC request failed.');
    return payload.result as T;
  }
}

function memoInstruction(memo: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM,
    data: new TextEncoder().encode(memo),
  };
}
