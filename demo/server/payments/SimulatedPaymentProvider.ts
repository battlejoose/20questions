import { randomUUID } from 'node:crypto';
import type { PaymentProvider } from './PaymentProvider.js';
import type {
  PaymentReceipt,
  PaymentRequest,
  QuestionReservation,
  RoundRecord,
} from '../types.js';

function simulatedSignature(kind: string): string {
  return `sim_${kind}_${randomUUID().replaceAll('-', '')}`;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly mode = 'simulation' as const;
  readonly treasuryAddress = undefined;

  async initialize(): Promise<void> {}

  async recordCommitment(_round: RoundRecord): Promise<string> {
    return simulatedSignature('commit');
  }

  createPaymentRequest(reservation: QuestionReservation): PaymentRequest {
    return {
      mode: this.mode,
      reservationId: reservation.id,
      amountLamports: reservation.amountLamports,
      expiresAt: reservation.expiresAt,
    };
  }

  async confirmPayment(reservation: QuestionReservation): Promise<PaymentReceipt> {
    return {
      signature: simulatedSignature('payment'),
      amountLamports: reservation.amountLamports,
    };
  }

  async refund(_reservation: QuestionReservation): Promise<string> {
    return simulatedSignature('refund');
  }

  async recordReveal(_round: RoundRecord): Promise<string> {
    return simulatedSignature('reveal');
  }

  async payout(_round: RoundRecord, _winnerAddress: string): Promise<string> {
    return simulatedSignature('payout');
  }
}
