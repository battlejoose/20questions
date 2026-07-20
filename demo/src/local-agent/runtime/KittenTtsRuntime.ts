import type {
  LocalTtsAudioChunk,
  LocalTtsSynthesisResult,
} from './LocalTtsTypes';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';
import {
  KITTEN_TTS_CAPABILITIES,
  type KittenTtsCapabilities,
  type KittenTtsModelId,
  type KittenTtsVoice,
  isKittenTtsModelId,
} from './KittenTtsModel';

export interface KittenTtsAudioChunk extends LocalTtsAudioChunk {
  phonemes: string;
}

export interface KittenTtsSynthesisResult
  extends Omit<LocalTtsSynthesisResult, 'engine' | 'chunks'> {
  engine: 'kitten-tts-nano';
  chunks: readonly KittenTtsAudioChunk[];
  timingCapabilities: KittenTtsCapabilities;
}

export { KITTEN_TTS_CAPABILITIES, isKittenTtsModelId };
export type { KittenTtsModelId, KittenTtsVoice };

export class KittenTtsRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private modelId: KittenTtsModelId | null = null;
  private desiredModelId: KittenTtsModelId | null = null;

  async load(
    modelId: KittenTtsModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    this.desiredModelId = modelId;
    await this.ensureClient().request('load', { modelId }, [], onProgress);
    this.modelId = modelId;
  }

  async synthesize(
    text: string,
    voice: KittenTtsVoice = 'Jasper',
    speed = 1.05,
  ): Promise<KittenTtsSynthesisResult> {
    if (!this.modelId && this.desiredModelId) await this.load(this.desiredModelId);
    if (!this.modelId) {
      throw new Error('Install KittenTTS Nano before starting a conversation.');
    }
    return this.ensureClient().request<KittenTtsSynthesisResult>('synthesize', {
      text,
      voice,
      speed,
    });
  }

  cancelInFlight(): void {
    if (!this.client) return;
    this.client.terminate('KittenTTS synthesis interrupted.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
  }

  async dispose(): Promise<void> {
    if (!this.client) return;
    await this.client.request('dispose').catch(() => undefined);
    this.client.terminate('KittenTTS disposed.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
    this.desiredModelId = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./kitten.worker.ts', import.meta.url), { type: 'module' });
    this.client = new RpcWorkerClient(this.worker, 'KittenTTS Nano speech');
    return this.client;
  }
}
