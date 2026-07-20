import type { TextToSpeechModelId } from '../modelRegistry';
import {
  isKittenTtsModelId,
  KittenTtsRuntime,
} from './KittenTtsRuntime';
import { KokoroRuntime } from './KokoroRuntime';
import type { LocalTtsSynthesisResult } from './LocalTtsTypes';
import {
  isSupertonicModelId,
  SupertonicRuntime,
} from './SupertonicRuntime';
import {
  isTimestampedKokoroModelId,
  TimestampedKokoroRuntime,
} from './TimestampedKokoroRuntime';
import type { WorkerProgress } from './RpcWorkerClient';

type ActiveRuntime =
  | KittenTtsRuntime
  | KokoroRuntime
  | SupertonicRuntime
  | TimestampedKokoroRuntime;

/** Selects one local TTS worker while keeping both engines behind one port. */
export class LocalTtsRuntime {
  private active: ActiveRuntime | null = null;

  async load(
    modelId: TextToSpeechModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    await this.active?.dispose();
    if (isKittenTtsModelId(modelId)) {
      const next = new KittenTtsRuntime();
      this.active = next;
      await next.load(modelId, onProgress);
    } else if (isTimestampedKokoroModelId(modelId)) {
      const next = new TimestampedKokoroRuntime();
      this.active = next;
      await next.load(modelId, onProgress);
    } else if (isSupertonicModelId(modelId)) {
      const next = new SupertonicRuntime();
      this.active = next;
      await next.load(modelId, onProgress);
    } else {
      const next = new KokoroRuntime();
      this.active = next;
      await next.load(modelId, onProgress);
    }
  }

  async synthesize(text: string): Promise<LocalTtsSynthesisResult> {
    if (!this.active) throw new Error('Install a local speech engine before starting a conversation.');
    return this.active.synthesize(text);
  }

  cancelInFlight(): void {
    this.active?.cancelInFlight();
  }

  async dispose(): Promise<void> {
    await this.active?.dispose();
    this.active = null;
  }
}
