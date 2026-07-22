import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import type { PaymentMode } from './types.js';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

const paymentMode = (process.env.PAYMENT_MODE ?? 'simulation') as PaymentMode;
if (paymentMode !== 'simulation' && paymentMode !== 'mainnet') {
  throw new Error('PAYMENT_MODE must be either simulation or mainnet.');
}

export const config = {
  host: process.env.GAME_HOST ?? '127.0.0.1',
  port: integerEnv('GAME_PORT', 5190),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:5188',
  paymentMode,
  mainnetTransactionsEnabled: process.env.MAINNET_TRANSACTIONS_ENABLED === 'true',
  questionPriceLamports: integerEnv('QUESTION_PRICE_LAMPORTS', 10_000_000),
  initialTurns: integerEnv('INITIAL_TURNS', 20),
  platformFeeBps: integerEnv('PLATFORM_FEE_BPS', 0),
  dataFile: resolve(process.cwd(), process.env.GAME_DATA_FILE ?? '.data/game.json'),
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6-sol',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  solanaTreasuryMnemonic: process.env.SOLANA_TREASURY_MNEMONIC,
  solanaTreasuryDerivationPath:
    process.env.SOLANA_TREASURY_DERIVATION_PATH ?? "m/44'/501'/0'/0'",
  solanaTreasuryAddress: process.env.SOLANA_TREASURY_ADDRESS,
} as const;

if (config.platformFeeBps > 10_000) {
  throw new Error('PLATFORM_FEE_BPS cannot exceed 10000.');
}

if (!config.openAiApiKey) {
  throw new Error('OPENAI_API_KEY is required. The game does not run without its AI referee.');
}

if (config.paymentMode === 'mainnet' && !config.solanaTreasuryMnemonic) {
  throw new Error('SOLANA_TREASURY_MNEMONIC is required when PAYMENT_MODE=mainnet.');
}

if (config.paymentMode === 'mainnet' && !config.mainnetTransactionsEnabled) {
  throw new Error(
    'Set MAINNET_TRANSACTIONS_ENABLED=true to acknowledge that the server will sign real mainnet transactions.',
  );
}
