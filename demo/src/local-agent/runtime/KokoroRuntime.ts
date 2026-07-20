import type { TextToSpeechModelId } from '../modelRegistry';
import type { LocalTtsAudioChunk, LocalTtsSynthesisResult } from './LocalTtsTypes';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';

export interface KokoroAudioChunk extends LocalTtsAudioChunk {}

export interface KokoroSynthesisResult extends LocalTtsSynthesisResult {
  engine: 'kokoro';
  preset: 'standard';
  chunks: readonly KokoroAudioChunk[];
}

export class KokoroRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private modelId: TextToSpeechModelId | null = null;
  private desiredModelId: TextToSpeechModelId | null = null;

  async load(
    modelId: TextToSpeechModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    this.desiredModelId = modelId;
    const client = this.ensureClient();
    await client.request('load', { modelId }, [], onProgress);
    this.modelId = modelId;
  }

  async synthesize(
    text: string,
    voice = 'am_michael',
    speed = 1.05,
  ): Promise<KokoroSynthesisResult> {
    if (!this.modelId && this.desiredModelId) await this.load(this.desiredModelId);
    if (!this.modelId) throw new Error('Install Kokoro before starting a conversation.');
    return this.ensureClient().request<KokoroSynthesisResult>('synthesize', {
      text,
      voice,
      speed,
    });
  }

  cancelInFlight(): void {
    if (!this.client) return;
    this.client.terminate('Kokoro synthesis interrupted.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
  }

  async dispose(): Promise<void> {
    if (!this.client) return;
    await this.client.request('dispose').catch(() => undefined);
    this.client.terminate('Kokoro disposed.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
    this.desiredModelId = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
    this.client = new RpcWorkerClient(this.worker, 'Kokoro speech');
    return this.client;
  }
}
