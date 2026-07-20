import type { TextToSpeechModelId } from '../modelRegistry';
import type {
  LocalTtsAudioChunk,
  LocalTtsSynthesisResult,
} from './LocalTtsTypes';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';

export type SupertonicModelId =
  | 'supertonic-2-instant-webgpu'
  | 'supertonic-2-quality-webgpu';

export type SupertonicPreset = 'instant' | 'quality';

export interface SupertonicAudioChunk extends LocalTtsAudioChunk {}

export interface SupertonicSynthesisResult extends LocalTtsSynthesisResult {
  engine: 'supertonic-2';
  preset: SupertonicPreset;
  numInferenceSteps: 2 | 5;
  chunks: readonly SupertonicAudioChunk[];
}

export function isSupertonicModelId(modelId: TextToSpeechModelId): modelId is SupertonicModelId {
  return modelId === 'supertonic-2-instant-webgpu' ||
    modelId === 'supertonic-2-quality-webgpu';
}

export function supertonicPresetForModel(
  modelId: SupertonicModelId,
): { preset: SupertonicPreset; numInferenceSteps: 2 | 5 } {
  return modelId === 'supertonic-2-instant-webgpu'
    ? { preset: 'instant', numInferenceSteps: 2 }
    : { preset: 'quality', numInferenceSteps: 5 };
}

export class SupertonicRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private modelId: SupertonicModelId | null = null;
  private desiredModelId: SupertonicModelId | null = null;

  async load(
    modelId: SupertonicModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    this.desiredModelId = modelId;
    const client = this.ensureClient();
    await client.request('load', { modelId }, [], onProgress);
    this.modelId = modelId;
  }

  async synthesize(
    text: string,
    speed = 1.05,
  ): Promise<SupertonicSynthesisResult> {
    if (!this.modelId && this.desiredModelId) await this.load(this.desiredModelId);
    if (!this.modelId) throw new Error('Install Supertonic before starting a conversation.');
    return this.ensureClient().request<SupertonicSynthesisResult>('synthesize', {
      text,
      speed,
    });
  }

  cancelInFlight(): void {
    if (!this.client) return;
    this.client.terminate('Supertonic synthesis interrupted.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
  }

  async dispose(): Promise<void> {
    if (!this.client) return;
    await this.client.request('dispose').catch(() => undefined);
    this.client.terminate('Supertonic disposed.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
    this.desiredModelId = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./supertonic.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.client = new RpcWorkerClient(this.worker, 'Supertonic speech');
    return this.client;
  }
}
