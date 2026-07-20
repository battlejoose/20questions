import type { ConversationMessage } from './types';

export interface ConversationHistoryLimits {
  readonly maxMessages: number;
  readonly maxCharacters: number;
}

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
};

/**
 * A small, deterministic conversation window. Assistant messages are upserted
 * by turn so playback progress can extend a message without ever storing text
 * that has not been audibly confirmed.
 */
export class ConversationHistory {
  private readonly limits: ConversationHistoryLimits;
  private messages: ConversationMessage[] = [];

  constructor(limits: ConversationHistoryLimits) {
    assertPositiveInteger('maxMessages', limits.maxMessages);
    assertPositiveInteger('maxCharacters', limits.maxCharacters);
    this.limits = limits;
  }

  snapshot(): readonly ConversationMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  appendUser(turnId: number, content: string): void {
    const normalized = content.trim();
    if (!normalized) return;

    this.messages.push({ role: 'user', content: normalized, turnId });
    this.trimToLimits();
  }

  upsertAssistant(turnId: number, spokenContent: string): void {
    const normalized = spokenContent.trim();
    const existingIndex = this.messages.findIndex(
      (message) => message.role === 'assistant' && message.turnId === turnId,
    );

    if (!normalized) {
      if (existingIndex >= 0) this.messages.splice(existingIndex, 1);
      return;
    }

    const message: ConversationMessage = {
      role: 'assistant',
      content: normalized,
      turnId,
    };
    if (existingIndex >= 0) {
      this.messages[existingIndex] = message;
    } else {
      this.messages.push(message);
    }
    this.trimToLimits();
  }

  clear(): void {
    this.messages = [];
  }

  private trimToLimits(): void {
    while (
      this.messages.length > this.limits.maxMessages ||
      this.characterCount() > this.limits.maxCharacters
    ) {
      this.messages.shift();
    }
  }

  private characterCount(): number {
    return this.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
  }
}
