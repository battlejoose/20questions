export type PaymentMode = 'simulation' | 'mainnet';
export type RoundPhase = 'active' | 'won';
export type QuestionKind = 'ask' | 'guess';
export type PaymentStatus = 'pending' | 'confirmed' | 'refunded';
export type RefereeVerdict = 'yes' | 'no' | 'unknown' | 'correct' | 'incorrect';

export interface GameEntry {
  id: string;
  wallet: string;
  playerName: string;
  kind: QuestionKind;
  text: string;
  answer: string;
  verdict: RefereeVerdict;
  paymentSignature: string;
  createdAt: string;
}

export interface RoundRecord {
  id: string;
  number: number;
  phase: RoundPhase;
  category: string;
  secret: string;
  aliases: string[];
  salt: string;
  commitment: string;
  commitmentSignature?: string;
  revealSignature?: string;
  payoutSignature?: string;
  turnsRemaining: number;
  questionPriceLamports: number;
  potLamports: number;
  winner?: string;
  winnerName?: string;
  createdAt: string;
  endedAt?: string;
  entries: GameEntry[];
}

export interface QuestionReservation {
  id: string;
  roundId: string;
  wallet: string;
  playerName: string;
  kind: QuestionKind;
  text: string;
  questionHash: string;
  amountLamports: number;
  status: PaymentStatus;
  paymentSignature?: string;
  createdAt: string;
  expiresAt: string;
}

export interface GameDatabase {
  version: 1;
  round: RoundRecord;
  reservations: QuestionReservation[];
  usedPaymentSignatures: string[];
}

export interface PublicRound {
  id: string;
  number: number;
  phase: RoundPhase;
  category: string;
  commitment: string;
  commitmentSignature?: string;
  reveal?: { secret: string; salt: string; signature?: string };
  payoutSignature?: string;
  turnsRemaining: number;
  questionPriceLamports: number;
  potLamports: number;
  winner?: string;
  winnerName?: string;
  createdAt: string;
  endedAt?: string;
  entries: GameEntry[];
}

export interface PlayerSession {
  token: string;
  wallet: string;
  playerName: string;
  simulated: boolean;
  expiresAt: number;
}

export interface PaymentRequest {
  mode: PaymentMode;
  reservationId: string;
  amountLamports: number;
  treasuryAddress?: string;
  expiresAt: string;
}

export interface PaymentReceipt {
  signature: string;
  amountLamports: number;
}
