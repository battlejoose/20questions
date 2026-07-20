import type { MicVAD } from '@ricky0123/vad-web';
import { ONNX_WASM_BASE_URL } from './RuntimeAssetUrls';

export interface VadRuntimeCallbacks {
  onSpeechStart(): void;
  onSpeechConfirmed(): void;
  onSpeechEnd(audio: Float32Array): void;
  onMisfire(): void;
  onLevel?(rms: number, speechProbability: number): void;
}

export class VadRuntime {
  private vad: MicVAD | null = null;

  constructor(private callbacks: VadRuntimeCallbacks) {}

  setCallbacks(callbacks: VadRuntimeCallbacks): void {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (!this.vad) {
      const { MicVAD } = await import('@ricky0123/vad-web');
      this.vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/local-models/vad/',
        onnxWASMBasePath: ONNX_WASM_BASE_URL,
        positiveSpeechThreshold: 0.82,
        negativeSpeechThreshold: 0.38,
        redemptionMs: 560,
        preSpeechPadMs: 220,
        minSpeechMs: 180,
        submitUserSpeechOnPause: true,
        getStream: () => navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        onSpeechStart: () => this.callbacks.onSpeechStart(),
        onSpeechRealStart: () => this.callbacks.onSpeechConfirmed(),
        onSpeechEnd: (audio) => this.callbacks.onSpeechEnd(audio),
        onVADMisfire: () => this.callbacks.onMisfire(),
        onFrameProcessed: (probabilities, frame) => {
          if (!this.callbacks.onLevel) return;
          let energy = 0;
          for (const sample of frame) energy += sample * sample;
          this.callbacks.onLevel(
            Math.sqrt(energy / Math.max(1, frame.length)),
            probabilities.isSpeech,
          );
        },
      });
    }
    await this.vad.start();
  }

  async pause(): Promise<void> {
    await this.vad?.pause();
    this.callbacks.onLevel?.(0, 0);
  }

  async dispose(): Promise<void> {
    await this.vad?.destroy();
    this.vad = null;
    this.callbacks.onLevel?.(0, 0);
  }
}
