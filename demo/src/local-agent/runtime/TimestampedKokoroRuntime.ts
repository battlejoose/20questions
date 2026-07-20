import { normalizeSpokenText } from '../SpokenTextNormalizer';
import type {
  LocalTtsAudioChunk,
  LocalTtsSynthesisResult,
} from './LocalTtsTypes';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';
import type { SynthesisNativePhonemeInterval } from './TimestampedKokoroTiming';

export type TimestampedKokoroModelId =
  | 'kokoro-82m-timestamped-q8-wasm'
  | 'kokoro-82m-timestamped-fp32-webgpu';

export interface TimestampedKokoroAudioChunk extends LocalTtsAudioChunk {
  phonemes: readonly SynthesisNativePhonemeInterval[];
}

export interface TimestampedKokoroSynthesisResult extends LocalTtsSynthesisResult {
  engine: 'kokoro-timestamped';
  preset: 'standard';
  chunks: readonly TimestampedKokoroAudioChunk[];
}

export function isTimestampedKokoroModelId(
  modelId: string,
): modelId is TimestampedKokoroModelId {
  return modelId === 'kokoro-82m-timestamped-q8-wasm' ||
    modelId === 'kokoro-82m-timestamped-fp32-webgpu';
}

/** Browser worker facade for Kokoro's synthesis-native duration export. */
export class TimestampedKokoroRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private modelId: TimestampedKokoroModelId | null = null;
  private desiredModelId: TimestampedKokoroModelId | null = null;

  async load(
    modelId: TimestampedKokoroModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    this.desiredModelId = modelId;
    const client = this.ensureClient();
    await client.request('load', {
      modelId,
      warmupVoice: 'am_michael',
    }, [], onProgress);
    this.modelId = modelId;
  }

  async synthesize(
    text: string,
    voice = 'am_michael',
    speed = 1.05,
  ): Promise<TimestampedKokoroSynthesisResult> {
    if (!this.modelId && this.desiredModelId) await this.load(this.desiredModelId);
    if (!this.modelId) {
      throw new Error('Install timestamped Kokoro before starting a conversation.');
    }
    const speechText = normalizeSpokenText(text);
    if (!speechText) throw new Error('Timestamped Kokoro received no speakable text.');
    return this.ensureClient().request<TimestampedKokoroSynthesisResult>('synthesize', {
      text: speechText,
      voice,
      speed,
    });
  }

  cancelInFlight(): void {
    if (!this.client) return;
    this.client.terminate('Timestamped Kokoro synthesis interrupted.');
    this.client = null;
    this.worker = null;
    this.modelId = null;
  }

  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.request('dispose').catch(() => undefined);
      this.client.terminate('Timestamped Kokoro disposed.');
    }
    this.client = null;
    this.worker = null;
    this.modelId = null;
    this.desiredModelId = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./timestamped-kokoro.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.client = new RpcWorkerClient(this.worker, 'Timestamped Kokoro speech');
    return this.client;
  }
}
