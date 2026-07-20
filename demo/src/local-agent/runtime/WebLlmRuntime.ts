import type {
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import type { LanguageModelId } from '../modelRegistry';
import {
  BRAIN_SYSTEM_PROMPT,
  localBrainAbortError,
  throwIfBrainAborted,
  type BrainConversationMessage,
  type BrainGenerationOptions,
  type BrainLoadProgress,
  type LocalBrainRuntime,
} from './BrainContracts';

const WEBLLM_MODEL_IDS: Partial<Record<LanguageModelId, string>> = {
  'qwen2.5-0.5b-instruct-q4f16': 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'qwen3.5-0.8b-q4f16': 'Qwen3.5-0.8B-q4f16_1-MLC',
  'qwen3.5-2b-q4f16': 'Qwen3.5-2B-q4f16_1-MLC',
  'qwen3.5-4b-q4f16': 'Qwen3.5-4B-q4f16_1-MLC',
};

export class WebLlmRuntime implements LocalBrainRuntime {
  private worker: Worker | null = null;
  private engine: WebWorkerMLCEngine | null = null;
  private modelId: LanguageModelId | null = null;

  async isCached(modelId: LanguageModelId): Promise<boolean> {
    const runtimeId = this.runtimeModelId(modelId);
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return hasModelInCache(runtimeId);
  }

  async load(
    modelId: LanguageModelId,
    onProgress?: (progress: BrainLoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const runtimeId = this.runtimeModelId(modelId);
    await this.dispose();
    throwIfBrainAborted(signal);
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
    const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const abortLoad = (): void => {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    signal?.addEventListener('abort', abortLoad, { once: true });
    try {
      const engine = await CreateWebWorkerMLCEngine(
        worker,
        runtimeId,
        {
          initProgressCallback: (progress) => onProgress?.({
            progress: progress.progress,
            text: progress.text,
          }),
          logLevel: 'WARN',
        },
        {
          context_window_size: 4096,
        },
      );
      if (signal?.aborted || this.worker !== worker) {
        await engine.unload().catch(() => undefined);
        throw localBrainAbortError();
      }
      this.engine = engine;
      this.modelId = modelId;
    } finally {
      signal?.removeEventListener('abort', abortLoad);
    }
  }

  async generate(
    history: readonly BrainConversationMessage[],
    options: BrainGenerationOptions,
  ): Promise<string> {
    let reply = '';
    for await (const token of this.stream(history, options.signal)) {
      reply += token;
      options.onToken(token);
    }
    return reply.trim();
  }

  async *stream(
    history: readonly BrainConversationMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    if (!this.engine || !this.modelId) {
      throw new Error('Install the local language model before talking.');
    }
    const abort = (): void => this.engine?.interruptGenerate();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const stream = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: BRAIN_SYSTEM_PROMPT },
          ...history.slice(-8),
        ],
        stream: true,
        max_tokens: 128,
        temperature: 0.62,
        top_p: 0.9,
        extra_body: { enable_thinking: false },
      });
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const token = chunk.choices[0]?.delta.content ?? '';
        if (!token) continue;
        yield token;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  interrupt(): void {
    this.engine?.interruptGenerate();
  }

  async runtimeStats(): Promise<string> {
    return this.engine?.runtimeStatsText() ?? 'Local brain is not loaded.';
  }

  async dispose(): Promise<void> {
    const engine = this.engine;
    const worker = this.worker;
    this.worker = null;
    this.engine = null;
    this.modelId = null;
    if (engine) await engine.unload().catch(() => undefined);
    worker?.terminate();
  }

  private runtimeModelId(modelId: LanguageModelId): string {
    const runtimeId = WEBLLM_MODEL_IDS[modelId];
    if (!runtimeId) {
      throw new Error('This experimental brain is registered for comparison but not enabled in the browser runtime.');
    }
    return runtimeId;
  }
}
