import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSecretCommitment, createSecretSalt } from './gameCrypto.js';
import type { GameDatabase, QuestionReservation, RoundRecord } from './types.js';

const SECRETS = [
  { secret: 'octopus', category: 'Living things', aliases: ['an octopus'] },
  { secret: 'volcano', category: 'Natural world', aliases: ['a volcano'] },
  { secret: 'compass', category: 'Objects', aliases: ['a compass'] },
] as const;

function createInitialRound(questionPriceLamports: number, initialTurns: number): RoundRecord {
  const selected = SECRETS[Math.floor(Math.random() * SECRETS.length)] ?? SECRETS[0];
  const id = randomUUID();
  const salt = createSecretSalt();
  return {
    id,
    number: 1,
    phase: 'active',
    category: selected.category,
    secret: selected.secret,
    aliases: [...selected.aliases],
    salt,
    commitment: createSecretCommitment(id, selected.secret, salt),
    turnsRemaining: initialTurns,
    questionPriceLamports,
    potLamports: 0,
    createdAt: new Date().toISOString(),
    entries: [],
  };
}

export class JsonGameStore {
  private data: GameDatabase | undefined;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly questionPriceLamports: number,
    private readonly initialTurns: number,
  ) {}

  async load(): Promise<GameDatabase> {
    if (this.data) return this.data;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as GameDatabase;
      if (parsed.version !== 1) throw new Error('Unsupported game data version.');
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = {
        version: 1,
        round: createInitialRound(this.questionPriceLamports, this.initialTurns),
        reservations: [],
        usedPaymentSignatures: [],
      };
      await this.save();
    }
    return this.data;
  }

  get snapshot(): GameDatabase {
    if (!this.data) throw new Error('Game store has not been loaded.');
    return this.data;
  }

  async save(): Promise<void> {
    if (!this.data) return;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.filePath);
    });
    await this.writeQueue;
  }

  pendingReservations(roundId: string): QuestionReservation[] {
    const now = Date.now();
    return this.snapshot.reservations.filter(
      (reservation) =>
        reservation.roundId === roundId &&
        reservation.status === 'pending' &&
        Date.parse(reservation.expiresAt) > now,
    );
  }
}
