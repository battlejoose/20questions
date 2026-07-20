import { LocalAgentAbortError, throwIfAborted } from './errors';
import type { PlaybackProgress, PlaybackResult } from './types';

export interface SequentialTtsQueueOptions<TSynthesis, TMetadata = undefined> {
  readonly maxBufferedClauses: number;
  readonly signal?: AbortSignal;
  readonly synthesize: (
    text: string,
    signal: AbortSignal,
    metadata: TMetadata,
  ) => Promise<TSynthesis>;
  readonly play: (
    synthesis: TSynthesis,
    text: string,
    signal: AbortSignal,
    onProgress: (progress: PlaybackProgress) => void,
    metadata: TMetadata,
  ) => Promise<PlaybackResult | void>;
  readonly onDepthChange?: (depth: number) => void;
  readonly onClauseStarted?: (text: string) => void;
  readonly onClauseProgress?: (spokenPrefix: string) => void;
  readonly onClauseSettled?: (
    spokenPrefix: string,
    completed: boolean,
  ) => void;
}

interface QueueJob<TSynthesis, TMetadata> {
  readonly text: string;
  readonly metadata: TMetadata;
  readonly synthesis: Promise<TSynthesis>;
}

interface CapacityWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

const clampCharacters = (value: number, text: string): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(text.length, Math.max(0, Math.floor(value)));
};

/**
 * A bounded two-stage synthesis/playback queue. Synthesis begins as soon as a
 * clause is admitted, while playback remains strictly ordered. This lets the
 * worker prepare clause N+1 during playback of N without unbounded buffering.
 */
export class SequentialTtsQueue<TSynthesis, TMetadata = undefined> {
  private readonly options: SequentialTtsQueueOptions<TSynthesis, TMetadata>;
  private readonly controller = new AbortController();
  private readonly pending: QueueJob<TSynthesis, TMetadata>[] = [];
  private readonly capacityWaiters: CapacityWaiter[] = [];
  private active: QueueJob<TSynthesis, TMetadata> | undefined;
  private reservations = 0;
  private processing: Promise<void> | undefined;
  private failure: unknown;
  private parentAbortCleanup: (() => void) | undefined;

  constructor(options: SequentialTtsQueueOptions<TSynthesis, TMetadata>) {
    if (
      !Number.isInteger(options.maxBufferedClauses) ||
      options.maxBufferedClauses < 1
    ) {
      throw new RangeError('maxBufferedClauses must be a positive integer.');
    }
    this.options = options;

    const parentSignal = options.signal;
    if (parentSignal) {
      const onAbort = (): void => this.cancel(parentSignal.reason);
      if (parentSignal.aborted) {
        onAbort();
      } else {
        parentSignal.addEventListener('abort', onAbort, { once: true });
        this.parentAbortCleanup = () =>
          parentSignal.removeEventListener('abort', onAbort);
      }
    }
  }

  get bufferedCount(): number {
    return this.pending.length + (this.active ? 1 : 0) + this.reservations;
  }

  async enqueue(text: string, metadata?: TMetadata): Promise<void> {
    const normalized = text.trim();
    if (!normalized) return;

    await this.reserveCapacity();
    // Cancellation clears reservations before already-resolved enqueue
    // continuations resume, so keep the accounting non-negative.
    this.reservations = Math.max(0, this.reservations - 1);
    try {
      throwIfAborted(this.controller.signal);
      if (this.failure) throw this.failure;
      const synthesis = Promise.resolve().then(() =>
        this.options.synthesize(
          normalized,
          this.controller.signal,
          metadata as TMetadata,
        ),
      );
      // A queued clause can be cancelled before processJob awaits it. Attach a
      // rejection observer now so cancellation never creates an unhandled
      // promise; processJob still receives the original rejection when active.
      void synthesis.catch(() => undefined);
      this.pending.push({
        text: normalized,
        metadata: metadata as TMetadata,
        synthesis,
      });
      this.emitDepth();
      this.startProcessing();
    } catch (error) {
      this.notifyCapacity();
      throw error;
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.processing) {
      await this.processing;
    }
    if (this.failure) throw this.failure;
    throwIfAborted(this.controller.signal);
  }

  cancel(reason?: unknown): void {
    if (this.controller.signal.aborted) return;

    this.controller.abort(reason);
    this.pending.length = 0;
    this.reservations = 0;
    const error = new LocalAgentAbortError();
    for (const waiter of this.capacityWaiters.splice(0)) {
      waiter.cleanup();
      waiter.reject(error);
    }
    this.emitDepth();
    this.parentAbortCleanup?.();
    this.parentAbortCleanup = undefined;
  }

  private async reserveCapacity(): Promise<void> {
    throwIfAborted(this.controller.signal);
    if (this.failure) throw this.failure;

    if (this.bufferedCount < this.options.maxBufferedClauses) {
      this.reservations += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.capacityWaiters.indexOf(waiter);
        if (index >= 0) this.capacityWaiters.splice(index, 1);
        waiter.cleanup();
        reject(new LocalAgentAbortError());
      };
      const waiter: CapacityWaiter = {
        resolve,
        reject,
        cleanup: () =>
          this.controller.signal.removeEventListener('abort', onAbort),
      };
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
      this.capacityWaiters.push(waiter);
    });
  }

  private startProcessing(): void {
    if (this.processing || this.controller.signal.aborted) return;

    let observed: Promise<void>;
    observed = this.runLoop()
      .catch((error: unknown) => {
        this.failure = error;
        this.pending.length = 0;
        this.reservations = 0;
        for (const waiter of this.capacityWaiters.splice(0)) {
          waiter.cleanup();
          waiter.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })
      .finally(() => {
        if (this.processing === observed) this.processing = undefined;
        this.notifyCapacity();
        this.emitDepth();
        if (this.pending.length > 0 && !this.controller.signal.aborted) {
          this.startProcessing();
        }
      });
    this.processing = observed;
  }

  private async runLoop(): Promise<void> {
    while (!this.controller.signal.aborted && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.active = job;
      this.emitDepth();

      try {
        await this.processJob(job);
      } finally {
        this.active = undefined;
        this.notifyCapacity();
        this.emitDepth();
      }
    }
    throwIfAborted(this.controller.signal);
  }

  private async processJob(job: QueueJob<TSynthesis, TMetadata>): Promise<void> {
    const { signal } = this.controller;
    throwIfAborted(signal);
    const synthesis = await job.synthesis;
    throwIfAborted(signal);

    let confirmedCharacters = 0;
    let playbackStarted = false;
    const updateProgress = (progress: PlaybackProgress): void => {
      if (signal.aborted) return;
      confirmedCharacters = Math.max(
        confirmedCharacters,
        clampCharacters(progress.spokenCharacters, job.text),
      );
      this.options.onClauseProgress?.(
        job.text.slice(0, confirmedCharacters),
      );
    };

    try {
      playbackStarted = true;
      this.options.onClauseStarted?.(job.text);
      const result = await this.options.play(
        synthesis,
        job.text,
        signal,
        updateProgress,
        job.metadata,
      );
      throwIfAborted(signal);

      const completed = result?.completed ?? true;
      if (completed) {
        confirmedCharacters = job.text.length;
      } else if (result) {
        confirmedCharacters = Math.max(
          confirmedCharacters,
          clampCharacters(result.spokenCharacters, job.text),
        );
      }
      this.options.onClauseProgress?.(
        job.text.slice(0, confirmedCharacters),
      );
      this.options.onClauseSettled?.(
        job.text.slice(0, confirmedCharacters),
        completed,
      );
    } catch (error) {
      if (playbackStarted) {
        this.options.onClauseSettled?.(
          job.text.slice(0, confirmedCharacters),
          false,
        );
      }
      throw error;
    }
  }

  private notifyCapacity(): void {
    if (this.controller.signal.aborted || this.failure) return;

    while (
      this.capacityWaiters.length > 0 &&
      this.bufferedCount < this.options.maxBufferedClauses
    ) {
      const waiter = this.capacityWaiters.shift();
      if (!waiter) break;
      this.reservations += 1;
      waiter.cleanup();
      waiter.resolve();
    }
  }

  private emitDepth(): void {
    this.options.onDepthChange?.(this.bufferedCount);
  }
}
