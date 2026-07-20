import type { PhonemeInterval } from '../../speech/types';

export type LocalTtsEngine =
  | 'kokoro'
  | 'kokoro-timestamped'
  | 'supertonic-2'
  | 'kitten-tts-nano';

export type LocalTtsBackend = 'wasm' | 'webgpu';

export type LocalTtsPreset = 'standard' | 'instant' | 'quality';

export interface LocalTtsAudioChunk {
  text: string;
  /** IPA, or synthesis-native phone intervals when the engine exposes them. */
  phonemes: string | readonly PhonemeInterval[];
  audio: Float32Array;
  sampleRate: number;
}

export interface LocalTtsSynthesisResult {
  engine: LocalTtsEngine;
  backend: LocalTtsBackend;
  preset: LocalTtsPreset;
  chunks: readonly LocalTtsAudioChunk[];
  elapsedMs: number;
  audioDurationSeconds: number;
  realTimeFactor: number;
}
