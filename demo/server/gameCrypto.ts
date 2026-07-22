import { createHash, randomBytes } from 'node:crypto';

export function normalizeGuess(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/^(a|an|the)\s+/, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createSecretSalt(): string {
  return randomBytes(32).toString('hex');
}

export function createSecretCommitment(roundId: string, secret: string, salt: string): string {
  return sha256(`20Q:SECRET:v1:${roundId}:${normalizeGuess(secret)}:${salt}`);
}

export function createQuestionHash(roundId: string, wallet: string, text: string): string {
  return sha256(`20Q:QUESTION:v1:${roundId}:${wallet}:${text.trim()}`);
}
