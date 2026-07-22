export type PaymentMode = 'simulation' | 'mainnet';
export type QuestionKind = 'ask' | 'guess';

export interface GameEntry {
  id: string;
  wallet: string;
  playerName: string;
  kind: QuestionKind;
  text: string;
  answer: string;
  verdict: 'yes' | 'no' | 'unknown' | 'correct' | 'incorrect';
  paymentSignature: string;
  createdAt: string;
}

export interface PublicRound {
  id: string;
  number: number;
  phase: 'active' | 'won';
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

export interface PublicConfig {
  paymentMode: PaymentMode;
  questionPriceLamports: number;
  treasuryAddress?: string;
  walletRequired: boolean;
  network: 'simulation' | 'mainnet-beta';
  refereeMode: 'openai';
  refereeModel: string;
}

export interface PlayerSession {
  token: string;
  wallet: string;
  playerName: string;
  simulated: boolean;
  expiresAt: string;
}

export interface ReserveResponse {
  payment: {
    mode: PaymentMode;
    reservationId: string;
    amountLamports: number;
    treasuryAddress?: string;
    expiresAt: string;
  };
  round: PublicRound;
  entry?: GameEntry;
}
