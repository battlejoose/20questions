import { getLocalModel, type LanguageModelId } from '../modelRegistry';
import {
  localBrainAbortError,
  type BrainConversationMessage,
  type BrainGenerationOptions,
  type BrainLoadProgress,
  type LocalBrainRuntime,
} from './BrainContracts';
import { LiteRtLlmRuntime } from './LiteRtLlmRuntime';
import { WebLlmRuntime } from './WebLlmRuntime';

function createRuntime(modelId: LanguageModelId): LocalBrainRuntime {
  const runtime = getLocalModel(modelId).backends[0]?.runtime;
  if (runtime === 'webllm') return new WebLlmRuntime();
  if (runtime === 'litert-lm') return new LiteRtLlmRuntime();
  throw new Error('The selected local brain does not have an enabled browser runtime.');
}

/**
 * Switchable browser-brain facade. Only one heavyweight LLM runtime is retained
 * at a time so WebGPU memory is released before another model initializes.
 */
export class BrowserBrainRuntime implements LocalBrainRuntime {
  private active: LocalBrainRuntime | null = null;
  private activeLoad: Promise<void> | null = null;
  private loadController: AbortController | null = null;
  private operation = 0;

  async isCached(modelId: LanguageModelId): Promise<boolean> {
    const runtime = createRuntime(modelId);
    try {
      return await runtime.isCached(modelId);
    } finally {
      await runtime.dispose();
    }
  }

  async load(
    modelId: LanguageModelId,
    onProgress?: (progress: BrainLoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const operation = ++this.operation;
    const previousLoad = this.activeLoad;
    this.loadController?.abort('superseded');
    const controller = new AbortController();
    this.loadController = controller;
    const forwardAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    const run = this.performLoad(
      previousLoad,
      operation,
      controller,
      modelId,
      onProgress,
    );
    this.activeLoad = run;
    try {
      await run;
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      if (this.loadController === controller) this.loadController = null;
      if (this.activeLoad === run) this.activeLoad = null;
    }
  }

  async generate(
    history: readonly BrainConversationMessage[],
    options: BrainGenerationOptions,
  ): Promise<string> {
    const runtime = this.requireActive();
    return runtime.generate(history, options);
  }

  async *stream(
    history: readonly BrainConversationMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    const runtime = this.requireActive();
    for await (const token of runtime.stream(history, signal)) yield token;
  }

  interrupt(): void {
    this.active?.interrupt();
  }

  runtimeStats(): Promise<string> {
    return this.active?.runtimeStats() ?? Promise.resolve('Local brain is not loaded.');
  }

  async dispose(): Promise<void> {
    ++this.operation;
    this.loadController?.abort('disposed');
    this.loadController = null;
    const loading = this.activeLoad;
    const runtime = this.active;
    this.active = null;
    runtime?.interrupt();
    await runtime?.dispose();
    await loading?.catch(() => undefined);
  }

  private async performLoad(
    previousLoad: Promise<void> | null,
    operation: number,
    controller: AbortController,
    modelId: LanguageModelId,
    onProgress?: (progress: BrainLoadProgress) => void,
  ): Promise<void> {
    await previousLoad?.catch(() => undefined);
    const previous = this.active;
    this.active = null;
    previous?.interrupt();
    await previous?.dispose();
    if (controller.signal.aborted || operation !== this.operation) {
      throw localBrainAbortError();
    }

    const runtime = createRuntime(modelId);
    this.active = runtime;
    try {
      await runtime.load(modelId, onProgress, controller.signal);
      if (controller.signal.aborted || operation !== this.operation) {
        throw localBrainAbortError();
      }
    } catch (error) {
      if (this.active === runtime) this.active = null;
      await runtime.dispose();
      throw error;
    }
  }

  private requireActive(): LocalBrainRuntime {
    if (!this.active) throw new Error('Install the local language model before talking.');
    return this.active;
  }
}
