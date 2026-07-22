import { GnmHead } from '../portrait/GnmHead';
import { GameApi } from './api';
import { SolanaWallet } from './SolanaWallet';
import type { GameEntry, PlayerSession, PublicConfig, PublicRound, QuestionKind } from './types';

export class GameApp {
  private readonly api = new GameApi();
  private readonly wallet = new SolanaWallet(this.api);
  private readonly head: GnmHead;
  private config: PublicConfig | undefined;
  private round: PublicRound | undefined;
  private serverAvailable = false;
  private animationFrame = 0;
  private lastFrame = performance.now();
  private startedAt = this.lastFrame;
  private eventStream: AbortController | undefined;
  private reconnectTimer: number | undefined;
  private readonly knownEntryIds = new Set<string>();
  private speakingTimer: number | undefined;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.head = new GnmHead(canvas, (progress) => {
      const modelStatus = element('#model-status');
      modelStatus.textContent = progress.ratio === null
        ? 'loading native GNM head'
        : `loading native GNM head · ${Math.round(progress.ratio * 100)}%`;
    });
    this.bindControls();
  }

  async start(): Promise<void> {
    this.animate();
    this.head.setPreviewState('idle');
    void this.loadHead();
    try {
      const [config, round] = await Promise.all([this.api.getConfig(), this.api.getRound()]);
      this.serverAvailable = true;
      this.config = config;
      this.round = round;
      for (const entry of round.entries) this.knownEntryIds.add(entry.id);
      this.renderConfig();
      this.renderIdentity(this.api.session);
      await this.renderRound(round);
      this.connectEvents();
    } catch (error) {
      this.renderUnavailable();
      this.setStatus(errorMessage(error), true);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.eventStream?.abort();
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.speakingTimer) window.clearInterval(this.speakingTimer);
    window.speechSynthesis?.cancel();
    this.wallet.destroy();
    this.head.dispose();
  }

  private bindControls(): void {
    element<HTMLTextAreaElement>('#question-input').addEventListener('input', () => {
      const input = element<HTMLTextAreaElement>('#question-input');
      element('#character-count').textContent = `${input.value.length} / 240`;
    });
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="question-kind"]')) {
      radio.addEventListener('change', () => this.renderQuestionMode());
    }
    element<HTMLFormElement>('#question-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitQuestion();
    });
    element<HTMLButtonElement>('#join-simulation').addEventListener('click', () => {
      void this.joinSimulation();
    });
    element<HTMLButtonElement>('#connect-wallet').addEventListener('click', () => {
      void this.connectWallet();
    });
    element<HTMLButtonElement>('#disconnect-wallet').addEventListener('click', () => {
      void this.signOut();
    });
    element<HTMLButtonElement>('#copy-commitment').addEventListener('click', () => {
      if (this.round) void navigator.clipboard.writeText(this.round.commitment);
    });
  }

  private async loadHead(): Promise<void> {
    try {
      await this.head.load();
      element('#keeper-status').textContent = 'THE KEEPER IS LISTENING';
      element('#model-status').textContent = 'native GNM head · realtime speech';
    } catch (error) {
      element('#keeper-status').textContent = 'KEEPER VISUAL UNAVAILABLE';
      element('#model-status').textContent = errorMessage(error);
    }
  }

  private renderConfig(): void {
    if (!this.config) return;
    const mainnet = this.config.paymentMode === 'mainnet';
    element('#network-label').textContent = mainnet ? 'SOLANA MAINNET' : 'SIMULATED SOL';
    const refereeLabel = `OPENAI · ${this.config.refereeModel}`;
    element('#payment-label').textContent = `${mainnet ? 'LIVE PAYMENTS' : 'FAKE PAYMENTS'} · ${refereeLabel}`;
    element('#network-dot').classList.toggle('network-dot--live', mainnet);
    element('#submit-price').textContent = formatSol(this.config.questionPriceLamports);
    element<HTMLButtonElement>('#join-simulation').hidden = mainnet;
    const select = element<HTMLSelectElement>('#wallet-select');
    const connect = element<HTMLButtonElement>('#connect-wallet');
    select.hidden = !mainnet;
    connect.hidden = !mainnet;
    select.replaceChildren();
    if (!mainnet) return;
    const options = this.wallet.options;
    if (options.length === 0) {
      select.add(new Option('No wallet detected', ''));
      select.disabled = true;
      connect.disabled = true;
    } else {
      for (const option of options) select.add(new Option(option.name, option.id));
    }
  }

  private async renderRound(round: PublicRound): Promise<void> {
    this.round = round;
    element('#round-number').textContent = `ROUND ${String(round.number).padStart(3, '0')}`;
    element('#pot-value').textContent = formatSol(round.potLamports);
    element('#turns-value').textContent = String(round.turnsRemaining);
    element('#category-value').textContent = round.category.toUpperCase();
    element('#commitment-value').textContent = `${round.commitment.slice(0, 18)}…${round.commitment.slice(-10)}`;
    element<HTMLButtonElement>('#submit-question').disabled =
      !this.serverAvailable || !this.api.session || round.phase !== 'active';
    const proofStatus = element('#proof-status');
    if (round.phase === 'won' && round.reveal) {
      const verified = await verifyReveal(round);
      proofStatus.textContent = verified
        ? `Verified reveal: ${round.reveal.secret}. The original commitment matches.`
        : 'Warning: the reveal does not match the original commitment.';
      proofStatus.classList.toggle('proof-error', !verified);
      element('#round-title').innerHTML = `The secret was<br />${escapeHtml(round.reveal.secret)}.`;
      element('#keeper-status').textContent = 'ROUND COMPLETE';
    } else {
      proofStatus.textContent = round.commitmentSignature
        ? `Commit transaction: ${shortSignature(round.commitmentSignature)}`
        : 'The commitment is being written.';
    }
    this.renderEntries(round.entries);
  }

  private renderEntries(entries: GameEntry[]): void {
    const list = element<HTMLOListElement>('#question-list');
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No questions yet. The secret is waiting.';
      list.append(empty);
      return;
    }
    for (const [offset, entry] of [...entries].reverse().entries()) {
      const item = document.createElement('li');
      item.className = `question-entry question-entry--${entry.verdict}`;
      const index = entries.length - offset;
      const meta = document.createElement('div');
      meta.className = 'entry-meta';
      meta.innerHTML = `<span>#${String(index).padStart(2, '0')} · ${entry.kind.toUpperCase()}</span><strong></strong><time></time>`;
      meta.querySelector('strong')!.textContent = entry.playerName;
      meta.querySelector('time')!.textContent = new Date(entry.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const question = document.createElement('p');
      question.className = 'entry-question';
      question.textContent = entry.text;
      const answer = document.createElement('p');
      answer.className = 'entry-answer';
      answer.innerHTML = '<span>KEEPER</span><strong></strong>';
      answer.querySelector('strong')!.textContent = entry.answer;
      item.append(meta, question, answer);
      list.append(item);
    }
  }

  private renderIdentity(session: PlayerSession | undefined): void {
    const submit = element<HTMLButtonElement>('#submit-question');
    const disconnect = element<HTMLButtonElement>('#disconnect-wallet');
    if (session) {
      element('#identity-title').textContent = session.simulated ? 'Simulation player' : 'Wallet verified';
      element('#identity-address').textContent = session.wallet;
      element('#identity-help').textContent = session.simulated
        ? 'Questions use fake 0.01 SOL payments stored by the server.'
        : 'Wallet ownership was verified with a free signed message.';
      disconnect.hidden = false;
      submit.disabled = this.round?.phase !== 'active';
      element('#submit-label').textContent = 'SEND TO KEEPER';
    } else {
      element('#identity-title').textContent = 'Join the round';
      element('#identity-address').textContent = 'NOT CONNECTED';
      disconnect.hidden = true;
      submit.disabled = true;
      element('#submit-label').textContent = 'JOIN TO ASK';
    }
  }

  private renderQuestionMode(): void {
    const kind = selectedKind();
    const input = element<HTMLTextAreaElement>('#question-input');
    element('#question-label').textContent = kind === 'guess' ? 'Your exact guess' : 'Your yes-or-no question';
    input.placeholder = kind === 'guess' ? 'octopus' : 'Is it alive?';
  }

  private async joinSimulation(): Promise<void> {
    this.setBusy(true);
    try {
      const session = await this.api.joinSimulation();
      this.renderIdentity(session);
      this.setStatus('Simulation identity created. Ask when ready.');
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private async connectWallet(): Promise<void> {
    const connectorId = element<HTMLSelectElement>('#wallet-select').value;
    if (!connectorId) return;
    this.setBusy(true);
    this.setStatus('Open the wallet and sign the free login message.');
    try {
      const session = await this.wallet.connect(connectorId);
      this.renderIdentity(session);
      this.setStatus('Wallet verified. No funds moved.');
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private async signOut(): Promise<void> {
    await this.wallet.disconnect();
    this.renderIdentity(undefined);
    this.setStatus('Signed out. The public round is still live.');
  }

  private async submitQuestion(): Promise<void> {
    const input = element<HTMLTextAreaElement>('#question-input');
    const text = input.value.trim();
    if (!text) return;
    this.setBusy(true);
    this.setStatus(this.config?.paymentMode === 'mainnet' ? 'Reserving your question…' : 'Simulating 0.01 SOL payment…');
    try {
      const reserved = await this.api.reserve(selectedKind(), text);
      let round = reserved.round;
      let entry = reserved.entry;
      if (reserved.payment.mode === 'mainnet') {
        if (!reserved.payment.treasuryAddress) throw new Error('Treasury address is missing.');
        this.setStatus(`Approve ${formatSol(reserved.payment.amountLamports)} in your wallet…`);
        const signature = await this.wallet.pay(
          reserved.payment.treasuryAddress,
          reserved.payment.amountLamports,
        );
        this.setStatus('Payment sent. Waiting for finalized mainnet confirmation…');
        const confirmed = await this.api.confirm(reserved.payment.reservationId, signature);
        round = confirmed.round;
        entry = confirmed.entry;
        if (confirmed.refundSignature) {
          this.setStatus(`The round ended; your payment was refunded: ${shortSignature(confirmed.refundSignature)}`);
        }
      }
      await this.receiveRound(round, true);
      input.value = '';
      element('#character-count').textContent = '0 / 240';
      if (entry) this.setStatus(`Accepted. ${entry.answer}`);
    } catch (error) {
      this.setStatus(errorMessage(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private connectEvents(): void {
    this.eventStream?.abort();
    this.eventStream = this.api.streamRounds(
      (round) => void this.receiveRound(round, true),
      () => {
        if (!this.disposed) {
          this.renderUnavailable();
          this.reconnectTimer = window.setTimeout(() => this.connectEvents(), 2_000);
        }
      },
    );
  }

  private async receiveRound(round: PublicRound, speakNew: boolean): Promise<void> {
    const wasUnavailable = !this.serverAvailable;
    this.serverAvailable = true;
    if (wasUnavailable && this.config) {
      this.renderConfig();
      this.renderIdentity(this.api.session);
      this.setStatus('OpenAI referee connected. The game is available.');
      element('#keeper-status').textContent = 'THE KEEPER IS LISTENING';
    }
    const unseen = round.entries.filter((entry) => !this.knownEntryIds.has(entry.id));
    for (const entry of round.entries) this.knownEntryIds.add(entry.id);
    await this.renderRound(round);
    if (speakNew && unseen.length > 0) this.speak(unseen.at(-1)!.answer);
  }

  private speak(text: string): void {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (this.speakingTimer) window.clearInterval(this.speakingTimer);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 0.82;
    const states = ['speaking', 'open-vowel', 'rounded-vowel', 'bilabial-contact'] as const;
    let index = 0;
    utterance.onstart = () => {
      element('#keeper-status').textContent = 'THE KEEPER IS SPEAKING';
      this.speakingTimer = window.setInterval(() => {
        this.head.setPreviewState(states[index % states.length]);
        index += 1;
      }, 115);
    };
    utterance.onend = utterance.onerror = () => {
      if (this.speakingTimer) window.clearInterval(this.speakingTimer);
      this.speakingTimer = undefined;
      this.head.setPreviewState('idle');
      element('#keeper-status').textContent = this.round?.phase === 'won'
        ? 'ROUND COMPLETE'
        : 'THE KEEPER IS LISTENING';
    };
    window.speechSynthesis.speak(utterance);
  }

  private setBusy(busy: boolean): void {
    const sessionReady = Boolean(
      this.serverAvailable && this.api.session && this.round?.phase === 'active',
    );
    element<HTMLButtonElement>('#submit-question').disabled = busy || !sessionReady;
    element<HTMLButtonElement>('#join-simulation').disabled = busy || !this.serverAvailable;
    const mainnet = this.config?.paymentMode === 'mainnet';
    element<HTMLButtonElement>('#connect-wallet').disabled =
      busy || !this.serverAvailable || !mainnet || (mainnet && this.wallet.options.length === 0);
  }

  private renderUnavailable(): void {
    this.serverAvailable = false;
    element('#network-label').textContent = 'AI OFFLINE';
    element('#payment-label').textContent = 'GAME UNAVAILABLE';
    element('#keeper-status').textContent = 'AI REFEREE OFFLINE';
    element<HTMLButtonElement>('#submit-question').disabled = true;
    element<HTMLButtonElement>('#join-simulation').disabled = true;
    element<HTMLButtonElement>('#connect-wallet').disabled = true;
  }

  private setStatus(message: string, error = false): void {
    const status = element('#action-status');
    status.textContent = message;
    status.classList.toggle('action-status--error', error);
  }

  private animate = (now = performance.now()): void => {
    const delta = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.head.update(delta, (now - this.startedAt) / 1000);
    this.head.render();
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}

function element<T extends Element = HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing required element ${selector}.`);
  return value;
}

function selectedKind(): QuestionKind {
  return element<HTMLInputElement>('input[name="question-kind"]:checked').value as QuestionKind;
}

function formatSol(lamports: number): string {
  return `${(lamports / 1_000_000_000).toFixed(2)} SOL`;
}

function shortSignature(signature: string): string {
  return signature.length > 28 ? `${signature.slice(0, 14)}…${signature.slice(-8)}` : signature;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function verifyReveal(round: PublicRound): Promise<boolean> {
  if (!round.reveal) return false;
  const normalized = round.reveal.secret
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/^(a|an|the)\s+/, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
  const input = `20Q:SECRET:v1:${round.id}:${normalized}:${round.reveal.salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return hash === round.commitment;
}

function escapeHtml(value: string): string {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}
