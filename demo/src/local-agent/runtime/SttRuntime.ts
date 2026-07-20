import type { SpeechToTextModelId } from '../modelRegistry';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';

export interface SttTranscript {
  text: string;
  chunks: readonly { text: string; timestamp: [number, number] }[];
  elapsedMs: number;
}

export class SttRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private modelId: SpeechToTextModelId | null = null;

  async load(
    modelId: SpeechToTextModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    const client = this.ensureClient();
    await client.request('load', { modelId }, [], onProgress);
    this.modelId = modelId;
  }

  async transcribe(audio: Float32Array, sampleRate = 16_000): Promise<SttTranscript> {
    if (!this.modelId) throw new Error('Install speech recognition before talking.');
    const owned = new Float32Array(audio);
    return this.ensureClient().request<SttTranscript>(
      'transcribe',
      { audio: owned, sampleRate },
      [owned.buffer],
    );
  }

  async dispose(): Promise<void> {
    if (!this.client) return;
    await this.client.request('dispose').catch(() => undefined);
    this.client.terminate('Speech recognition disposed.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
    this.client = new RpcWorkerClient(this.worker, 'Speech recognition');
    return this.client;
  }
}
