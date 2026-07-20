// The WebGPU entry registers both WebGPU and WASM execution providers.
import * as ort from 'onnxruntime-web/webgpu';
import { phonemize } from 'phonemizer';
import type { WorkerProgress } from './RpcWorkerClient';
import { ONNX_WASM_BASE_URL } from './RuntimeAssetUrls';
import { parseKittenVoices, type KittenVoiceEmbedding } from './KittenNpz';
import {
  type KittenTtsBackend,
  type KittenTtsVoice,
  joinKittenPhonemeTokens,
  splitKittenPunctuation,
  tokenizeKittenPhonemes,
  trimKittenWaveform,
} from './KittenTtsModel';

export interface KittenTtsAudio {
  readonly text: string;
  /** Exact IPA string tokenized for the ONNX graph. It has no native timing. */
  readonly phonemes: string;
  readonly audio: Float32Array;
  readonly sampleRate: 24_000;
}

const MODEL_REVISION = '7a1db645b1f3ab9420761d87428e042b9cec3f26';
const MODEL_BASE =
  `https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32/resolve/${MODEL_REVISION}`;
const MODEL_FILE = 'kitten_tts_nano_v0_8.onnx';
const VOICES_FILE = 'voices.npz';
const MODEL_BYTES = 56_767_095;
const VOICES_BYTES = 3_278_902;
const TOTAL_BYTES = MODEL_BYTES + VOICES_BYTES;
const SAMPLE_RATE = 24_000 as const;

const VOICE_ALIASES: Readonly<Record<KittenTtsVoice, string>> = {
  Bella: 'expr-voice-2-f',
  Jasper: 'expr-voice-2-m',
  Luna: 'expr-voice-3-f',
  Bruno: 'expr-voice-3-m',
  Rosie: 'expr-voice-4-f',
  Hugo: 'expr-voice-4-m',
  Kiki: 'expr-voice-5-f',
  Leo: 'expr-voice-5-m',
};

const SPEED_PRIORS: Readonly<Record<string, number>> = {
  'expr-voice-2-f': 0.8,
  'expr-voice-2-m': 0.8,
  'expr-voice-3-f': 0.8,
  'expr-voice-3-m': 0.8,
  'expr-voice-4-f': 0.8,
  'expr-voice-4-m': 0.9,
  'expr-voice-5-f': 0.8,
  'expr-voice-5-m': 0.8,
};

async function fetchAsset(
  filename: string,
  expectedBytes: number,
  onLoaded: (loadedBytes: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(`${MODEL_BASE}/${filename}`, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`KittenTTS asset request failed (${response.status}): ${filename}`);
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onLoaded(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    onLoaded(Math.min(expectedBytes, loadedBytes));
  }
  if (loadedBytes <= 0) throw new Error(`KittenTTS downloaded an empty ${filename}.`);
  const output = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onLoaded(loadedBytes);
  return output.buffer;
}

async function phonemizeForKitten(text: string): Promise<string> {
  const parts = splitKittenPunctuation(text);
  const raw = (
    await Promise.all(parts.map(async ({ punctuation, text: part }) => {
      if (punctuation) return part;
      return (await phonemize(part, 'en-us')).join(' ');
    }))
  ).join('');
  const joined = joinKittenPhonemeTokens(raw.normalize('NFC'));
  if (!joined) throw new Error('KittenTTS could not phonemize the clause.');
  return joined;
}

function tensorFloats(tensor: ort.Tensor | undefined): Float32Array {
  if (!tensor) throw new Error('KittenTTS did not return a waveform.');
  if (tensor.data instanceof Float32Array) return tensor.data;
  if (ArrayBuffer.isView(tensor.data)) {
    return Float32Array.from(tensor.data as unknown as ArrayLike<number>);
  }
  throw new Error('KittenTTS returned an invalid waveform tensor.');
}

function validateWaveform(audio: Float32Array): void {
  if (audio.length === 0) throw new Error('KittenTTS returned empty audio.');
  for (let index = 0; index < audio.length; index += 1) {
    if (!Number.isFinite(audio[index])) {
      throw new Error('KittenTTS produced invalid audio on this inference backend.');
    }
  }
}

function sessionOptions(backend: KittenTtsBackend): ort.InferenceSession.SessionOptions {
  return {
    executionProviders: [backend],
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    ...(backend === 'wasm' ? { intraOpNumThreads: 1, interOpNumThreads: 1 } : {}),
  };
}

/**
 * Browser adaptation of KittenML's Apache-2.0 v0.8 ONNX inference pipeline.
 * Model and voice assets are pinned to an immutable official revision.
 */
export class KittenTtsEngine {
  private constructor(
    readonly backend: KittenTtsBackend,
    private readonly session: ort.InferenceSession,
    private readonly voices: ReadonlyMap<string, KittenVoiceEmbedding>,
  ) {}

  static async load(
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<KittenTtsEngine> {
    ort.env.wasm.wasmPaths = ONNX_WASM_BASE_URL;
    ort.env.wasm.numThreads = 1;
    const loaded = new Map<string, number>([
      [MODEL_FILE, 0],
      [VOICES_FILE, 0],
    ]);
    const report = (filename: string, expectedBytes: number, value: number): void => {
      loaded.set(filename, Math.min(expectedBytes, value));
      const loadedBytes = Array.from(loaded.values()).reduce((total, bytes) => total + bytes, 0);
      onProgress?.({
        loadedBytes,
        totalBytes: TOTAL_BYTES,
        fraction: loadedBytes / TOTAL_BYTES,
        file: filename,
        message: `loading KittenTTS Nano · ${filename}`,
      });
    };
    const [modelBuffer, voicesBuffer] = await Promise.all([
      fetchAsset(MODEL_FILE, MODEL_BYTES, (value) => report(MODEL_FILE, MODEL_BYTES, value)),
      fetchAsset(VOICES_FILE, VOICES_BYTES, (value) => report(VOICES_FILE, VOICES_BYTES, value)),
    ]);
    const voices = await parseKittenVoices(voicesBuffer);
    const canTryWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const backends: readonly KittenTtsBackend[] = canTryWebGpu
      ? ['webgpu', 'wasm']
      : ['wasm'];
    let lastError: unknown;
    for (const backend of backends) {
      let session: ort.InferenceSession | null = null;
      try {
        onProgress?.({
          loadedBytes: TOTAL_BYTES,
          totalBytes: TOTAL_BYTES,
          fraction: 1,
          file: MODEL_FILE,
          message: `compiling KittenTTS Nano · ${backend.toUpperCase()}`,
        });
        session = await ort.InferenceSession.create(
          new Uint8Array(modelBuffer.slice(0)),
          sessionOptions(backend),
        );
        const engine = new KittenTtsEngine(backend, session, voices);
        // Validate graph execution now so a broken WebGPU path falls back during install.
        await engine.synthesize('Ready.', 'Jasper', 1.05);
        return engine;
      } catch (error) {
        lastError = error;
        await session?.release().catch(() => undefined);
        if (backend === 'webgpu') {
          onProgress?.({
            loadedBytes: TOTAL_BYTES,
            totalBytes: TOTAL_BYTES,
            fraction: 1,
            file: MODEL_FILE,
            message: `KittenTTS WebGPU unavailable; retrying with WASM (${error instanceof Error ? error.message : 'session error'})`,
          });
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('KittenTTS could not initialize a local inference backend.');
  }

  async synthesize(
    text: string,
    voice: KittenTtsVoice = 'Jasper',
    speed = 1.05,
  ): Promise<KittenTtsAudio> {
    const clean = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!clean) throw new Error('KittenTTS received an empty clause.');
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      throw new RangeError('KittenTTS speed must be between 0.5 and 2.');
    }
    const voiceId = VOICE_ALIASES[voice];
    const embedding = this.voices.get(voiceId);
    if (!embedding) throw new Error(`KittenTTS voice "${voice}" is unavailable.`);
    const phonemes = await phonemizeForKitten(clean);
    const tokenIds = tokenizeKittenPhonemes(phonemes);
    const referenceRow = Math.min(clean.length, embedding.rows - 1);
    const referenceOffset = referenceRow * embedding.columns;
    const styleData = embedding.data.slice(
      referenceOffset,
      referenceOffset + embedding.columns,
    );
    const inputIds = new ort.Tensor(
      'int64',
      BigInt64Array.from(tokenIds, (value) => BigInt(value)),
      [1, tokenIds.length],
    );
    const style = new ort.Tensor('float32', styleData, [1, embedding.columns]);
    const adjustedSpeed = speed * (SPEED_PRIORS[voiceId] ?? 1);
    const speedTensor = new ort.Tensor('float32', new Float32Array([adjustedSpeed]), [1]);
    let outputTensor: ort.Tensor | undefined;
    try {
      const output = await this.session.run({
        input_ids: inputIds,
        style,
        speed: speedTensor,
      });
      outputTensor = output[this.session.outputNames[0]];
      const audio = trimKittenWaveform(new Float32Array(tensorFloats(outputTensor)));
      validateWaveform(audio);
      return { text: clean, phonemes, audio, sampleRate: SAMPLE_RATE };
    } finally {
      inputIds.dispose();
      style.dispose();
      speedTensor.dispose();
      outputTensor?.dispose();
    }
  }

  async dispose(): Promise<void> {
    await this.session.release();
  }
}
