import type {
  PaymentMode,
  PaymentReceipt,
  PaymentRequest,
  QuestionReservation,
  RoundRecord,
} from '../types.js';

export interface PaymentProvider {
  readonly mode: PaymentMode;
  readonly treasuryAddress?: string;
  initialize(): Promise<void>;
  recordCommitment(round: RoundRecord): Promise<string>;
  createPaymentRequest(reservation: QuestionReservation): PaymentRequest;
  confirmPayment(reservation: QuestionReservation, signature?: string): Promise<PaymentReceipt>;
  refund(reservation: QuestionReservation): Promise<string>;
  recordReveal(round: RoundRecord): Promise<string>;
  payout(round: RoundRecord, winnerAddress: string): Promise<string>;
}
