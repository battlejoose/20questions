import { randomUUID } from 'node:crypto';
import { createQuestionHash, normalizeGuess, sha256 } from './gameCrypto.js';
import type { Referee } from './referee.js';
import type { JsonGameStore } from './store.js';
import type { PaymentProvider } from './payments/PaymentProvider.js';
import type {
  GameEntry,
  PaymentRequest,
  PlayerSession,
  PublicRound,
  QuestionKind,
  QuestionReservation,
  RoundRecord,
} from './types.js';

export interface ReserveResult {
  payment: PaymentRequest;
  round: PublicRound;
  entry?: GameEntry;
}

export class GameUnavailableError extends Error {
  readonly status = 503;

  constructor(message: string, readonly refundSignature?: string) {
    super(message);
    this.name = 'GameUnavailableError';
  }
}

export class GameService {
  private readonly listeners = new Set<(round: PublicRound) => void>();
  private serialQueue = Promise.resolve();

  constructor(
    private readonly store: JsonGameStore,
    private readonly payments: PaymentProvider,
    private readonly referee: Referee,
  ) {}

  async initialize(): Promise<void> {
    await this.store.load();
    await this.payments.initialize();
    await this.referee.ensureReady();
    const round = this.store.snapshot.round;
    if (!round.commitmentSignature) {
      round.commitmentSignature = await this.payments.recordCommitment(round);
      await this.store.save();
    }
  }

  get publicRound(): PublicRound {
    return toPublicRound(this.store.snapshot.round);
  }

  subscribe(listener: (round: PublicRound) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reserve(
    session: PlayerSession,
    input: { kind: QuestionKind; text: string },
  ): Promise<ReserveResult> {
    const text = input.text.trim();
    if (input.kind !== 'ask' && input.kind !== 'guess') throw new Error('Choose ask or guess.');
    if (!text || text.length > 240) throw new Error('Questions must be between 1 and 240 characters.');
    if (this.payments.mode === 'mainnet' && session.simulated) {
      throw new Error('A verified Solana wallet is required for mainnet payments.');
    }
    try {
      await this.referee.ensureReady(60_000);
    } catch {
      throw new GameUnavailableError('The AI referee is unavailable. No question was charged.');
    }

    const reservation = await this.serial(async () => {
      const round = this.store.snapshot.round;
      if (round.phase !== 'active') throw new Error('This round is over.');
      const pending = this.store.pendingReservations(round.id);
      if (round.turnsRemaining - pending.length <= 0) {
        throw new Error('All remaining question slots are currently reserved.');
      }
      if (pending.some((item) => item.wallet === session.wallet)) {
        throw new Error('This wallet already has a pending payment reservation.');
      }
      const createdAt = new Date();
      const item: QuestionReservation = {
        id: randomUUID(),
        roundId: round.id,
        wallet: session.wallet,
        playerName: session.playerName,
        kind: input.kind,
        text,
        questionHash: createQuestionHash(round.id, session.wallet, text),
        amountLamports: round.questionPriceLamports,
        status: 'pending',
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + 5 * 60_000).toISOString(),
      };
      this.store.snapshot.reservations.push(item);
      await this.store.save();
      return item;
    });

    const payment = this.payments.createPaymentRequest(reservation);
    if (this.payments.mode === 'mainnet') {
      return { payment, round: this.publicRound };
    }
    const receipt = await this.payments.confirmPayment(reservation);
    const settled = await this.applyConfirmedPayment(reservation, receipt.signature);
    if (!settled.entry) throw new Error('Simulated payment was unexpectedly refunded.');
    const entry = settled.entry;
    return { payment, round: this.publicRound, entry };
  }

  async confirm(
    session: PlayerSession,
    reservationId: string,
    signature: string,
  ): Promise<{ round: PublicRound; entry?: GameEntry; refundSignature?: string }> {
    const reservation = this.store.snapshot.reservations.find(
      (item) => item.id === reservationId && item.wallet === session.wallet,
    );
    if (!reservation) throw new Error('Payment reservation was not found.');
    if (this.store.snapshot.usedPaymentSignatures.includes(signature)) {
      throw new Error('That transaction signature has already been used.');
    }
    const receipt = await this.payments.confirmPayment(reservation, signature);
    const settled = await this.applyConfirmedPayment(reservation, receipt.signature);
    return { round: this.publicRound, ...settled };
  }

  private async applyConfirmedPayment(
    reservation: QuestionReservation,
    signature: string,
  ): Promise<{ entry?: GameEntry; refundSignature?: string }> {
    return this.serial(async () => {
      const round = this.store.snapshot.round;
      if (this.store.snapshot.usedPaymentSignatures.includes(signature)) {
        throw new Error('That transaction signature has already been used.');
      }
      const mustRefund =
        reservation.status !== 'pending' ||
        Date.parse(reservation.expiresAt) <= Date.now() ||
        round.id !== reservation.roundId ||
        round.phase !== 'active';
      if (mustRefund) {
        const refundSignature = await this.payments.refund(reservation);
        if (reservation.status === 'pending') {
          reservation.status = 'refunded';
          reservation.paymentSignature = signature;
        }
        this.store.snapshot.usedPaymentSignatures.push(signature);
        await this.store.save();
        return { refundSignature };
      }

      let entry: GameEntry;
      try {
        entry = await this.createEntry(round, reservation, signature);
      } catch {
        const refundSignature = await this.payments.refund(reservation);
        reservation.status = 'refunded';
        reservation.paymentSignature = signature;
        this.store.snapshot.usedPaymentSignatures.push(signature);
        await this.store.save();
        throw new GameUnavailableError(
          this.payments.mode === 'mainnet'
            ? 'The AI referee became unavailable. The payment was refunded.'
            : 'The AI referee became unavailable. No simulated payment was charged.',
          refundSignature,
        );
      }

      reservation.status = 'confirmed';
      reservation.paymentSignature = signature;
      this.store.snapshot.usedPaymentSignatures.push(signature);
      round.potLamports += reservation.amountLamports;
      round.turnsRemaining -= 1;
      round.entries.push(entry);
      await this.store.save();

      if (entry.verdict === 'correct') {
        round.phase = 'won';
        round.winner = reservation.wallet;
        round.winnerName = reservation.playerName;
        round.endedAt = new Date().toISOString();
        await this.store.save();
        round.revealSignature = await this.payments.recordReveal(round);
        round.payoutSignature = await this.payments.payout(round, reservation.wallet);
        await this.store.save();
      }

      this.publish();
      return { entry };
    });
  }

  private async createEntry(
    round: RoundRecord,
    reservation: QuestionReservation,
    paymentSignature: string,
  ): Promise<GameEntry> {
    const createdAt = new Date().toISOString();
    if (reservation.kind === 'guess') {
      const guess = normalizeGuess(reservation.text);
      const validAnswers = [round.secret, ...round.aliases].map(normalizeGuess);
      const correct = validAnswers.includes(guess);
      return {
        id: randomUUID(),
        wallet: reservation.wallet,
        playerName: reservation.playerName,
        kind: reservation.kind,
        text: reservation.text,
        answer: correct ? 'Correct. You found the secret.' : 'No. That is not the secret.',
        verdict: correct ? 'correct' : 'incorrect',
        paymentSignature,
        createdAt,
      };
    }

    const safetyIdentifier = sha256(reservation.wallet).slice(0, 64);
    const refereeAnswer = await this.referee.answer(
      round.secret,
      round.category,
      reservation.text,
      safetyIdentifier,
    );
    return {
      id: randomUUID(),
      wallet: reservation.wallet,
      playerName: reservation.playerName,
      kind: reservation.kind,
      text: reservation.text,
      answer: refereeAnswer.answer,
      verdict: refereeAnswer.verdict,
      paymentSignature,
      createdAt,
    };
  }

  private publish(): void {
    const round = this.publicRound;
    for (const listener of this.listeners) listener(round);
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.serialQueue.then(operation, operation);
    this.serialQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function toPublicRound(round: RoundRecord): PublicRound {
  return {
    id: round.id,
    number: round.number,
    phase: round.phase,
    category: round.category,
    commitment: round.commitment,
    commitmentSignature: round.commitmentSignature,
    reveal:
      round.phase === 'won'
        ? { secret: round.secret, salt: round.salt, signature: round.revealSignature }
        : undefined,
    payoutSignature: round.payoutSignature,
    turnsRemaining: round.turnsRemaining,
    questionPriceLamports: round.questionPriceLamports,
    potLamports: round.potLamports,
    winner: round.winner,
    winnerName: round.winnerName,
    createdAt: round.createdAt,
    endedAt: round.endedAt,
    entries: round.entries,
  };
}
