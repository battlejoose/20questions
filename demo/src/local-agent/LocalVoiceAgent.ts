import { ConversationHistory } from './ConversationHistory';
import {
  isAbortError,
  LocalAgentAbortError,
  throwIfAborted,
  toError,
} from './errors';
import { SequentialTtsQueue } from './SequentialTtsQueue';
import { StableClauseSegmenter } from './StableClauseSegmenter';
import { ReasoningStreamFilter } from './ReasoningStreamFilter';
import {
  PerformanceDirectiveStream,
  inferPerformanceIntent,
  type PerformanceIntent,
} from '../speech/PerformanceIntent';
import type {
  AgentEvent,
  AgentMetric,
  BrainRequest,
  ConversationMessage,
  InstallablePort,
  InterruptReason,
  LocalAgentOptions,
  LocalAgentSnapshot,
  LocalAgentState,
  PlaybackRequest,
  RequestContext,
  RequestPhase,
  TtsRequest,
} from './types';

interface SpeechQueueMetadata {
  readonly performanceIntent: PerformanceIntent;
  readonly userText: string;
}

interface ActiveTurn<TSynthesis> {
  readonly id: number;
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly queue: SequentialTtsQueue<TSynthesis, SpeechQueueMetadata>;
  completedSpoken: string;
  activeSpoken: string;
  generationComplete: boolean;
  userText: string;
  directiveIntent: PerformanceIntent | null;
}

interface RequestRecord {
  readonly context: RequestContext;
  readonly phase: RequestPhase;
  readonly startedAt: number;
}

const DEFAULT_MAX_HISTORY_MESSAGES = 12;
const DEFAULT_MAX_HISTORY_CHARACTERS = 6_000;
const DEFAULT_MAX_BUFFERED_CLAUSES = 3;
const DEFAULT_MAX_CLAUSE_CHARACTERS = 180;
const MAX_VISIBLE_REASONING_CHARACTERS = 4_000;
const TOKEN_PAUSE_FLUSH_MS = 620;
const TOKEN_PAUSE_MINIMUM_CHARACTERS = 32;

const joinSpokenText = (left: string, right: string): string => {
  if (!left) return right.trim();
  if (!right) return left.trim();
  return `${left.trimEnd()} ${right.trimStart()}`;
};

/**
 * Framework-neutral orchestration for a local conversational voice loop.
 *
 * Ports own capture/inference/audio details. This class owns turn identity,
 * cancellation, stale-result guards, bounded context, streaming segmentation,
 * and the invariant that assistant history contains only playback-confirmed
 * text.
 */
export class LocalVoiceAgent<TUtterance, TSynthesis> {
  private readonly options: LocalAgentOptions<TUtterance, TSynthesis>;
  private readonly history: ConversationHistory;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private state: LocalAgentState = 'installing';
  private lastError: Error | undefined;
  private turnSequence = 0;
  private requestSequence = 0;
  private initialized = false;
  private initialization: Promise<void> | undefined;
  private listenerController: AbortController | undefined;
  private activeTurn: ActiveTurn<TSynthesis> | undefined;

  constructor(options: LocalAgentOptions<TUtterance, TSynthesis>) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.history = new ConversationHistory({
      maxMessages: options.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
      maxCharacters:
        options.maxHistoryCharacters ?? DEFAULT_MAX_HISTORY_CHARACTERS,
    });
  }

  snapshot(): LocalAgentSnapshot {
    return {
      state: this.state,
      turnId: this.turnSequence,
      requestId: this.requestSequence,
      history: this.history.snapshot(),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    if (this.state === 'unsupported' || this.initialized) return;
    if (this.initialization) return this.initialization;

    this.transition('installing');
    this.lastError = undefined;
    const controller = new AbortController();
    const run = this.initializePorts(controller.signal)
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        this.setError(error, 0);
        throw error;
      })
      .finally(() => {
        if (this.initialization === run) this.initialization = undefined;
      });
    this.initialization = run;
    return run;
  }

  async startListening(): Promise<void> {
    await this.initialize();
    if (this.state === 'unsupported') {
      throw new Error('Local voice-agent ports are unsupported in this environment.');
    }
    if (this.listenerController && !this.listenerController.signal.aborted) {
      if (!this.activeTurn) this.transition('listening');
      return;
    }

    const controller = new AbortController();
    this.listenerController = controller;
    try {
      await this.runRequest(
        'vad',
        0,
        controller.signal,
        (context) =>
          this.options.ports.vad.start({
            ...context,
            onSpeechStart: () => this.handleVadSpeechStart(controller),
            onUtterance: (utterance) =>
              this.handleVadUtterance(controller, utterance),
            onError: (error) => this.handleVadError(controller, error),
          }),
        () => this.listenerController === controller,
      );
      if (!this.activeTurn) this.transition('listening');
    } catch (error) {
      if (isAbortError(error)) return;
      if (this.listenerController === controller) {
        this.listenerController = undefined;
        this.setError(error, 0);
      }
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    const listener = this.listenerController;
    this.listenerController = undefined;
    listener?.abort('stopped');
    await this.options.ports.vad.stop?.();
    this.interrupt('stopped');
    this.transition('idle');
  }

  async submitUtterance(utterance: TUtterance): Promise<void> {
    await this.submitTurn(utterance);
  }

  /**
   * Submit an already-transcribed turn through the same brain, TTS, playback,
   * history, cancellation, and performance-directive pipeline as microphone
   * input. This keeps typed accessibility and deterministic integration checks
   * from fabricating audio merely to re-enter the pipeline after STT.
   */
  async submitTranscript(transcript: string): Promise<void> {
    await this.submitTurn(undefined, transcript);
  }

  private async submitTurn(
    utterance: TUtterance | undefined,
    transcriptOverride?: string,
  ): Promise<void> {
    await this.initialize();
    if (this.state === 'unsupported') {
      throw new Error('Local voice-agent ports are unsupported in this environment.');
    }

    if (this.activeTurn) this.interrupt('superseded');

    const controller = new AbortController();
    const turnId = ++this.turnSequence;
    const startedAt = this.now();
    let turn: ActiveTurn<TSynthesis>;
    turn = {
      id: turnId,
      startedAt,
      controller,
      completedSpoken: '',
      activeSpoken: '',
      generationComplete: false,
      userText: '',
      directiveIntent: null,
      queue: new SequentialTtsQueue<TSynthesis, SpeechQueueMetadata>({
        maxBufferedClauses:
          this.options.maxBufferedClauses ?? DEFAULT_MAX_BUFFERED_CLAUSES,
        signal: controller.signal,
        synthesize: (text, signal, metadata) =>
          this.synthesize(turn, text, signal, metadata),
        play: (synthesis, text, signal, onProgress, metadata) =>
          this.play(turn, synthesis, text, signal, onProgress, metadata),
        onDepthChange: (depth) => {
          this.metric({
            type: 'queue-depth',
            at: this.now(),
            turnId,
            depth,
          });
        },
        onClauseStarted: () => {
          if (this.isCurrentTurn(turn)) this.transition('speaking');
        },
        onClauseProgress: (spokenPrefix) => {
          if (!this.isCurrentTurn(turn)) return;
          turn.activeSpoken = spokenPrefix;
          this.syncSpokenHistory(turn);
        },
        onClauseSettled: (spokenPrefix) => {
          if (!this.isCurrentTurn(turn)) return;
          turn.completedSpoken = joinSpokenText(
            turn.completedSpoken,
            spokenPrefix,
          );
          turn.activeSpoken = '';
          this.syncSpokenHistory(turn);
        },
      }),
    };
    this.activeTurn = turn;
    this.emit({ type: 'turn-started', turnId });
    this.metric({ type: 'turn', at: startedAt, status: 'started', turnId });

    try {
      await this.processTurn(turn, utterance, transcriptOverride);
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentTurn(turn)) return;
      controller.abort(error);
      turn.queue.cancel(error);
      this.setError(error, turnId);
      throw error;
    } finally {
      if (this.activeTurn === turn && this.state !== 'error') {
        this.activeTurn = undefined;
      }
    }
  }

  bargeIn(): boolean {
    const turn = this.activeTurn;
    if (!turn) return false;
    this.emit({ type: 'barge-in', turnId: turn.id });
    return this.interrupt('barge-in');
  }

  interrupt(reason: InterruptReason = 'cancelled'): boolean {
    const turn = this.activeTurn;
    if (!turn) return false;

    turn.controller.abort(reason);
    turn.queue.cancel(reason);
    if (this.activeTurn === turn) this.activeTurn = undefined;
    this.transition('interrupted');
    this.emit({ type: 'interrupted', turnId: turn.id, reason });
    this.metric({
      type: 'turn',
      at: this.now(),
      status: 'interrupted',
      turnId: turn.id,
      durationMs: this.now() - turn.startedAt,
    });
    return true;
  }

  clearHistory(): void {
    this.history.clear();
  }

  private async initializePorts(signal: AbortSignal): Promise<void> {
    const ports: readonly InstallablePort[] = [
      this.options.ports.vad,
      this.options.ports.stt,
      this.options.ports.brain,
      this.options.ports.tts,
      this.options.ports.playback,
    ];

    for (const port of ports) {
      if (!port.isSupported) continue;
      const supported = await this.runRequest(
        'support',
        0,
        signal,
        (context) => port.isSupported?.(context) ?? true,
      );
      if (!supported) {
        this.transition('unsupported');
        return;
      }
    }

    for (const port of ports) {
      if (!port.install) continue;
      await this.runRequest('install', 0, signal, (context) =>
        port.install?.(context),
      );
    }
    this.initialized = true;
    this.transition('idle');
  }

  private async processTurn(
    turn: ActiveTurn<TSynthesis>,
    utterance: TUtterance | undefined,
    transcriptOverride?: string,
  ): Promise<void> {
    let transcript: string;
    if (transcriptOverride === undefined) {
      if (utterance === undefined) {
        throw new Error('A captured utterance is required for transcription.');
      }
      this.transition('transcribing');
      transcript = (
        await this.runRequest(
          'stt',
          turn.id,
          turn.controller.signal,
          (context) => this.options.ports.stt.transcribe(utterance, context),
          () => this.isCurrentTurn(turn),
        )
      ).trim();
    } else {
      transcript = transcriptOverride.trim();
    }
    this.assertCurrentTurn(turn);

    if (!transcript) {
      this.completeTurn(turn);
      return;
    }

    this.history.appendUser(turn.id, transcript);
    turn.userText = transcript;
    this.emit({ type: 'transcript', turnId: turn.id, text: transcript });
    this.transition('thinking');

    await this.streamResponse(turn, transcript, this.history.snapshot());
    this.assertCurrentTurn(turn);
    turn.generationComplete = true;
    await turn.queue.waitForIdle();
    this.assertCurrentTurn(turn);
    this.completeTurn(turn);
  }

  private async streamResponse(
    turn: ActiveTurn<TSynthesis>,
    transcript: string,
    history: readonly ConversationMessage[],
  ): Promise<void> {
    const request = this.beginRequest('brain', turn.id, turn.controller.signal);
    const segmenter = new StableClauseSegmenter({
      maxClauseCharacters:
        this.options.maxClauseCharacters ?? DEFAULT_MAX_CLAUSE_CHARACTERS,
      firstClauseCharacters: this.options.firstClauseCharacters,
    });
    const reasoningFilter = new ReasoningStreamFilter();
    const performanceStream = new PerformanceDirectiveStream();
    let visibleReasoning = '';
    let firstAnswerTokenSeen = false;
    let idleFlushTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let clauseCommit = Promise.resolve();
    let activeDirectiveIntent: PerformanceIntent | null = null;

    const commitClauses = (
      clauses: readonly string[],
      directiveIntent = activeDirectiveIntent,
    ): Promise<void> => {
      if (clauses.length === 0) return clauseCommit;
      clauseCommit = clauseCommit.then(async () => {
        for (const clause of clauses) {
          await this.enqueueClause(turn, clause, directiveIntent);
        }
      });
      return clauseCommit;
    };

    const scheduleIdleFlush = (): void => {
      if (idleFlushTimer !== undefined) globalThis.clearTimeout(idleFlushTimer);
      idleFlushTimer = globalThis.setTimeout(() => {
        idleFlushTimer = undefined;
        void commitClauses(
          segmenter.flushPendingProsodicPrefix(TOKEN_PAUSE_MINIMUM_CHARACTERS),
        );
      }, TOKEN_PAUSE_FLUSH_MS);
    };

    const consumePart = async (
      channel: 'answer' | 'reasoning',
      text: string,
    ): Promise<void> => {
      if (channel === 'reasoning') {
        visibleReasoning = `${visibleReasoning}${text}`.slice(
          -MAX_VISIBLE_REASONING_CHARACTERS,
        );
        if (visibleReasoning.trim()) {
          this.emit({
            type: 'reasoning',
            turnId: turn.id,
            text: visibleReasoning.trim(),
          });
        }
        return;
      }
      for (const part of performanceStream.feedParts(text)) {
        if (part.type === 'text') {
          await commitClauses(segmenter.feed(part.text));
          continue;
        }
        // A directive is an immutable semantic boundary. Flush preceding text
        // with its previous metadata before changing the following action.
        await commitClauses(segmenter.flush());
        if (part.type === 'intent') {
          activeDirectiveIntent = part.intent;
          turn.directiveIntent = part.intent;
          this.emit({
            type: 'performance-intent',
            turnId: turn.id,
            intent: part.intent,
          });
        } else {
          this.emit({
            type: 'performance-action',
            turnId: turn.id,
            action: part.action,
          });
        }
      }
      scheduleIdleFlush();
    };

    try {
      const brainRequest: BrainRequest = {
        ...request.context,
        transcript,
        history,
      };
      const stream = await this.options.ports.brain.stream(brainRequest);
      this.assertRequestCurrent(request, () => this.isCurrentTurn(turn));

      for await (const token of stream) {
        this.assertRequestCurrent(request, () => this.isCurrentTurn(turn));
        for (const part of reasoningFilter.feed(token)) {
          if (part.channel === 'answer' && part.text && !firstAnswerTokenSeen) {
            firstAnswerTokenSeen = true;
            this.metric({
              type: 'milestone',
              at: this.now(),
              stage: 'llm-first-token',
              turnId: turn.id,
              durationMs: this.now() - request.startedAt,
            });
          }
          await consumePart(part.channel, part.text);
        }
      }

      for (const part of reasoningFilter.flush()) {
        await consumePart(part.channel, part.text);
      }
      for (const part of performanceStream.flushParts()) {
        if (part.type === 'text') {
          await commitClauses(segmenter.feed(part.text));
          continue;
        }
        await commitClauses(segmenter.flush());
        if (part.type === 'intent') {
          activeDirectiveIntent = part.intent;
          turn.directiveIntent = part.intent;
          this.emit({
            type: 'performance-intent',
            turnId: turn.id,
            intent: part.intent,
          });
        } else {
          this.emit({
            type: 'performance-action',
            turnId: turn.id,
            action: part.action,
          });
        }
      }

      if (idleFlushTimer !== undefined) globalThis.clearTimeout(idleFlushTimer);
      idleFlushTimer = undefined;
      await clauseCommit;
      await commitClauses(segmenter.flush());
      this.assertRequestCurrent(request, () => this.isCurrentTurn(turn));
      this.finishRequest(request, 'completed');
    } catch (error) {
      if (idleFlushTimer !== undefined) globalThis.clearTimeout(idleFlushTimer);
      idleFlushTimer = undefined;
      if (
        isAbortError(error) ||
        request.context.signal.aborted ||
        !this.isCurrentTurn(turn)
      ) {
        this.finishRequest(request, 'stale');
        throw new LocalAgentAbortError();
      }
      this.finishRequest(request, 'failed');
      throw error;
    }
  }

  private async enqueueClause(
    turn: ActiveTurn<TSynthesis>,
    clause: string,
    directiveIntent: PerformanceIntent | null = turn.directiveIntent,
  ): Promise<void> {
    this.assertCurrentTurn(turn);
    const fallback = inferPerformanceIntent({
      userText: turn.userText,
      assistantText: clause,
    });
    // Explicit user performance requests take precedence over a small model
    // that emits a literal or contradictory directive.
    const performanceIntent = fallback.source === 'requested-emotion'
      ? fallback
      : directiveIntent ?? fallback;
    this.emit({
      type: 'performance-intent',
      turnId: turn.id,
      intent: performanceIntent,
    });
    this.emit({ type: 'clause', turnId: turn.id, text: clause });
    this.metric({
      type: 'clause',
      at: this.now(),
      turnId: turn.id,
      characters: clause.length,
    });
    await turn.queue.enqueue(clause, {
      performanceIntent,
      userText: turn.userText,
    });
  }

  private synthesize(
    turn: ActiveTurn<TSynthesis>,
    text: string,
    signal: AbortSignal,
    metadata: SpeechQueueMetadata,
  ): Promise<TSynthesis> {
    return this.runRequest(
      'tts',
      turn.id,
      signal,
      (context) => {
        const request: TtsRequest = {
          ...context,
          text,
          performanceIntent: metadata.performanceIntent,
          performanceUserText: metadata.userText,
        };
        return this.options.ports.tts.synthesize(request);
      },
      () => this.isCurrentTurn(turn),
    );
  }

  private play(
    turn: ActiveTurn<TSynthesis>,
    synthesis: TSynthesis,
    text: string,
    signal: AbortSignal,
    onProgress: PlaybackRequest<TSynthesis>['onProgress'],
    metadata: SpeechQueueMetadata,
  ) {
    return this.runRequest(
      'playback',
      turn.id,
      signal,
      (context) =>
        this.options.ports.playback.play({
          ...context,
          synthesis,
          text,
          performanceIntent: metadata.performanceIntent,
          performanceUserText: metadata.userText,
          onProgress,
        }),
      () => this.isCurrentTurn(turn),
    );
  }

  private completeTurn(turn: ActiveTurn<TSynthesis>): void {
    this.assertCurrentTurn(turn);
    this.emit({ type: 'turn-completed', turnId: turn.id });
    this.metric({
      type: 'turn',
      at: this.now(),
      status: 'completed',
      turnId: turn.id,
      durationMs: this.now() - turn.startedAt,
    });
    this.activeTurn = undefined;
    this.transition(this.isListening() ? 'listening' : 'idle');
  }

  private syncSpokenHistory(turn: ActiveTurn<TSynthesis>): void {
    const spoken = joinSpokenText(turn.completedSpoken, turn.activeSpoken);
    this.history.upsertAssistant(turn.id, spoken);
    this.emit({ type: 'assistant-spoken', turnId: turn.id, text: spoken });
  }

  private handleVadSpeechStart(controller: AbortController): void {
    if (controller !== this.listenerController || controller.signal.aborted) return;
    const turnId = this.activeTurn?.id ?? this.turnSequence;
    this.emit({ type: 'speech-start', turnId });
    if (this.activeTurn) this.bargeIn();
    this.transition('listening');
  }

  private handleVadUtterance(
    controller: AbortController,
    utterance: TUtterance,
  ): void {
    if (controller !== this.listenerController || controller.signal.aborted) return;
    void this.submitUtterance(utterance).catch(() => {
      // submitUtterance already transitions to error for non-cancellation failures.
    });
  }

  private handleVadError(controller: AbortController, error: unknown): void {
    if (controller !== this.listenerController || controller.signal.aborted) return;
    this.setError(error, this.activeTurn?.id ?? 0);
  }

  private isListening(): boolean {
    return Boolean(
      this.listenerController && !this.listenerController.signal.aborted,
    );
  }

  private isCurrentTurn(turn: ActiveTurn<TSynthesis>): boolean {
    return this.activeTurn === turn && !turn.controller.signal.aborted;
  }

  private assertCurrentTurn(turn: ActiveTurn<TSynthesis>): void {
    if (!this.isCurrentTurn(turn)) throw new LocalAgentAbortError();
  }

  private async runRequest<T>(
    phase: RequestPhase,
    turnId: number,
    signal: AbortSignal,
    execute: (context: RequestContext) => T | Promise<T>,
    isCurrent: () => boolean = () => !signal.aborted,
  ): Promise<T> {
    const request = this.beginRequest(phase, turnId, signal);
    try {
      const result = await execute(request.context);
      this.assertRequestCurrent(request, isCurrent);
      this.finishRequest(request, 'completed');
      return result;
    } catch (error) {
      if (isAbortError(error) || signal.aborted || !isCurrent()) {
        this.finishRequest(request, 'stale');
        throw new LocalAgentAbortError();
      }
      this.finishRequest(request, 'failed');
      throw error;
    }
  }

  private beginRequest(
    phase: RequestPhase,
    turnId: number,
    signal: AbortSignal,
  ): RequestRecord {
    throwIfAborted(signal);
    const requestId = ++this.requestSequence;
    const startedAt = this.now();
    const request: RequestRecord = {
      context: { turnId, requestId, signal },
      phase,
      startedAt,
    };
    this.metric({
      type: 'request',
      at: startedAt,
      phase,
      status: 'started',
      turnId,
      requestId,
    });
    return request;
  }

  private assertRequestCurrent(
    request: RequestRecord,
    isCurrent: () => boolean,
  ): void {
    if (request.context.signal.aborted || !isCurrent()) {
      throw new LocalAgentAbortError();
    }
  }

  private finishRequest(
    request: RequestRecord,
    status: 'completed' | 'stale' | 'failed',
  ): void {
    const at = this.now();
    this.metric({
      type: 'request',
      at,
      phase: request.phase,
      status,
      turnId: request.context.turnId,
      requestId: request.context.requestId,
      durationMs: at - request.startedAt,
    });
    if (status === 'stale' && request.context.turnId > 0) {
      this.emit({
        type: 'stale-result',
        turnId: request.context.turnId,
        requestId: request.context.requestId,
        phase: request.phase,
      });
    }
  }

  private transition(next: LocalAgentState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;
    if (next !== 'error') this.lastError = undefined;
    const snapshot = this.snapshot();
    this.emit({ type: 'state', from, to: next, snapshot });
    this.metric({
      type: 'state-transition',
      at: this.now(),
      from,
      to: next,
      turnId: this.turnSequence,
    });
  }

  private setError(error: unknown, turnId: number): void {
    this.lastError = toError(error);
    this.transition('error');
    this.emit({ type: 'error', error: this.lastError, turnId });
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Observability hooks must not perturb orchestration.
      }
    }
  }

  private metric(metric: AgentMetric): void {
    try {
      this.options.onMetric?.(metric);
    } catch {
      // Metrics are intentionally non-fatal.
    }
  }
}
