import type {
  PlayerSession,
  PublicConfig,
  PublicRound,
  QuestionKind,
  ReserveResponse,
} from './types';

const SESSION_KEY = 'twenty-questions-session-v1';

export class GameApi {
  session: PlayerSession | undefined = restoreSession();

  async getConfig(): Promise<PublicConfig> {
    return this.request('/api/config');
  }

  async getRound(): Promise<PublicRound> {
    return this.request('/api/round');
  }

  async joinSimulation(): Promise<PlayerSession> {
    const session = await this.request<PlayerSession>('/api/auth/guest', { method: 'POST' });
    this.setSession(session);
    return session;
  }

  async challenge(address: string): Promise<{ address: string; message: string; expiresAt: number }> {
    return this.request('/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
  }

  async verifyWallet(input: {
    address: string;
    message: string;
    signatureBase64: string;
    publicKeyBase64: string;
  }): Promise<PlayerSession> {
    const session = await this.request<PlayerSession>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    this.setSession(session);
    return session;
  }

  async reserve(kind: QuestionKind, text: string): Promise<ReserveResponse> {
    return this.request('/api/questions/reserve', {
      method: 'POST',
      body: JSON.stringify({ kind, text }),
      authenticated: true,
    });
  }

  async confirm(reservationId: string, signature: string): Promise<{
    round: PublicRound;
    entry?: ReserveResponse['entry'];
    refundSignature?: string;
  }> {
    return this.request('/api/questions/confirm', {
      method: 'POST',
      body: JSON.stringify({ reservationId, signature }),
      authenticated: true,
    });
  }

  streamRounds(onRound: (round: PublicRound) => void, onError: () => void): AbortController {
    const controller = new AbortController();
    void this.readEventStream(controller.signal, onRound).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.warn('Round event stream disconnected:', error);
        onError();
      }
    });
    return controller;
  }

  clearSession(): void {
    this.session = undefined;
    localStorage.removeItem(SESSION_KEY);
  }

  private setSession(session: PlayerSession): void {
    this.session = session;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  private async readEventStream(
    signal: AbortSignal,
    onRound: (round: PublicRound) => void,
  ): Promise<void> {
    const response = await fetch('/api/events', { signal, headers: { accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new Error(`Event stream returned ${response.status}.`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let separator = buffer.indexOf('\n\n');
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice(6);
        if (data) onRound(JSON.parse(data) as PublicRound);
        separator = buffer.indexOf('\n\n');
      }
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit & { authenticated?: boolean } = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('content-type', 'application/json');
    if (options.authenticated) {
      if (!this.session) throw new Error('Join the game before submitting a question.');
      headers.set('authorization', `Bearer ${this.session.token}`);
    }
    const response = await fetch(path, { ...options, headers });
    const payload = (await response.json()) as T & { error?: string; refundSignature?: string };
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      const refundDetail = payload.refundSignature
        ? ` Refund transaction: ${payload.refundSignature}`
        : '';
      throw new Error(`${payload.error ?? `Request failed with HTTP ${response.status}.`}${refundDetail}`);
    }
    return payload;
  }
}

function restoreSession(): PlayerSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as PlayerSession;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return undefined;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return undefined;
  }
}
