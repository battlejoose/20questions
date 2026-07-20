// The WebGPU entry also registers the WASM execution provider used by our
// automatic fallback. The package root does not register WebGPU in all builds.
import * as ort from 'onnxruntime-web/webgpu';
import { normalizeSpokenText } from '../SpokenTextNormalizer';
import { ONNX_WASM_BASE_URL } from './RuntimeAssetUrls';

export type SupertonicBackend = 'webgpu' | 'wasm';

export interface SupertonicLoadProgress {
  loadedBytes: number;
  totalBytes: number;
  fraction: number;
  file: string | null;
  message: string;
}

export interface SupertonicAudio {
  audio: Float32Array;
  sampleRate: number;
  predictedDurationSeconds: number;
}

interface SupertonicConfig {
  ae: {
    sample_rate: number;
    base_chunk_size: number;
  };
  ttl: {
    chunk_compress_factor: number;
    latent_dim: number;
  };
}

interface VoiceStyleTensorJson {
  dims: number[];
  data: unknown[];
}

interface VoiceStyleJson {
  style_ttl: VoiceStyleTensorJson;
  style_dp: VoiceStyleTensorJson;
}

interface SupertonicResources {
  config: SupertonicConfig;
  unicodeIndexer: number[];
  voiceStyle: VoiceStyleJson;
}

interface VoiceStyle {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

const SUPERTONIC_2_REVISION = '75e6727618a02f323c720cba9478152d4bc16ca4';
const SUPERTONIC_2_BASE =
  `https://huggingface.co/Supertone/supertonic-2/resolve/${SUPERTONIC_2_REVISION}`;
const ONNX_BASE = `${SUPERTONIC_2_BASE}/onnx`;

const MODEL_FILES = [
  { name: 'duration predictor', file: 'duration_predictor.onnx', bytes: 1_520_000 },
  { name: 'text encoder', file: 'text_encoder.onnx', bytes: 27_400_000 },
  { name: 'vector estimator', file: 'vector_estimator.onnx', bytes: 132_000_000 },
  { name: 'vocoder', file: 'vocoder.onnx', bytes: 101_000_000 },
] as const;

const MODEL_BYTES = MODEL_FILES.reduce((total, model) => total + model.bytes, 0);

function flattenNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.flat(Infinity).map(Number);
  return [];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Supertonic asset request failed (${response.status}): ${url.split('/').at(-1)}`);
  }
  return response.json() as Promise<T>;
}

function validateConfig(value: SupertonicConfig): SupertonicConfig {
  const numbers = [
    value?.ae?.sample_rate,
    value?.ae?.base_chunk_size,
    value?.ttl?.chunk_compress_factor,
    value?.ttl?.latent_dim,
  ];
  if (numbers.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    throw new Error('Supertonic returned an invalid model configuration.');
  }
  return value;
}

function createVoiceStyle(value: VoiceStyleJson): VoiceStyle {
  const ttlDims = value?.style_ttl?.dims;
  const dpDims = value?.style_dp?.dims;
  const ttlData = new Float32Array(flattenNumbers(value?.style_ttl?.data));
  const dpData = new Float32Array(flattenNumbers(value?.style_dp?.data));
  if (
    !Array.isArray(ttlDims) ||
    !Array.isArray(dpDims) ||
    ttlDims.reduce((total, size) => total * size, 1) !== ttlData.length ||
    dpDims.reduce((total, size) => total * size, 1) !== dpData.length
  ) {
    throw new Error('Supertonic returned an invalid M1 voice style.');
  }
  return {
    ttl: new ort.Tensor('float32', ttlData, ttlDims),
    dp: new ort.Tensor('float32', dpData, dpDims),
  };
}

function disposeTensor(tensor: ort.Tensor | undefined): void {
  try {
    tensor?.dispose();
  } catch {
    // A CPU-backed tensor can already be released by its session.
  }
}

function floatTensorData(tensor: ort.Tensor | undefined, label: string): Float32Array {
  if (!tensor) throw new Error(`Supertonic did not return ${label}.`);
  const data = tensor.data;
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) {
    return Float32Array.from(data as unknown as ArrayLike<number>);
  }
  throw new Error(`Supertonic returned an invalid ${label} tensor.`);
}

function preprocessText(input: string, language: 'en'): string {
  const text = normalizeSpokenText(input);
  if (!text) throw new Error('Supertonic received an empty clause.');
  return `<${language}>${text}</${language}>`;
}

function encodeText(
  text: string,
  indexer: readonly number[],
): { ids: BigInt64Array; mask: Float32Array; length: number } {
  const normalized = preprocessText(text, 'en');
  const codePoints = Array.from(normalized, (character) => character.codePointAt(0) ?? -1);
  const ids = new BigInt64Array(codePoints.length);
  for (let index = 0; index < codePoints.length; index += 1) {
    const codePoint = codePoints[index];
    ids[index] = BigInt(codePoint >= 0 && codePoint < indexer.length ? indexer[codePoint] : -1);
  }
  return {
    ids,
    mask: new Float32Array(codePoints.length).fill(1),
    length: codePoints.length,
  };
}

function sampleNormal(length: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 2) {
    const first = Math.max(0.0001, Math.random());
    const second = Math.random();
    const radius = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    output[index] = radius * Math.cos(angle);
    if (index + 1 < length) output[index + 1] = radius * Math.sin(angle);
  }
  return output;
}

async function loadResources(): Promise<SupertonicResources> {
  const [config, unicodeIndexer, voiceStyle] = await Promise.all([
    fetchJson<SupertonicConfig>(`${ONNX_BASE}/tts.json`),
    fetchJson<number[]>(`${ONNX_BASE}/unicode_indexer.json`),
    fetchJson<VoiceStyleJson>(`${SUPERTONIC_2_BASE}/voice_styles/M1.json`),
  ]);
  if (!Array.isArray(unicodeIndexer) || unicodeIndexer.length === 0) {
    throw new Error('Supertonic returned an invalid Unicode index.');
  }
  return { config: validateConfig(config), unicodeIndexer, voiceStyle };
}

function sessionOptions(backend: SupertonicBackend): ort.InferenceSession.SessionOptions {
  return {
    executionProviders: [backend],
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    ...(backend === 'wasm' ? { intraOpNumThreads: 1, interOpNumThreads: 1 } : {}),
  };
}

/**
 * Thin TypeScript adaptation of Supertone's MIT-licensed browser reference.
 * Model weights stay remote and are pinned to the OpenRAIL-M Supertonic 2 revision.
 */
export class SupertonicEngine {
  private constructor(
    readonly backend: SupertonicBackend,
    private readonly config: SupertonicConfig,
    private readonly unicodeIndexer: readonly number[],
    private readonly style: VoiceStyle,
    private readonly durationPredictor: ort.InferenceSession,
    private readonly textEncoder: ort.InferenceSession,
    private readonly vectorEstimator: ort.InferenceSession,
    private readonly vocoder: ort.InferenceSession,
  ) {}

  get sampleRate(): number {
    return this.config.ae.sample_rate;
  }

  static async load(
    onProgress?: (progress: SupertonicLoadProgress) => void,
    preferredBackend: 'auto' | 'wasm' = 'auto',
  ): Promise<SupertonicEngine> {
    ort.env.wasm.wasmPaths = ONNX_WASM_BASE_URL;
    // Cross-origin isolation is not guaranteed in the desktop in-app browser.
    // A single WASM thread is slower but avoids the worker crashes seen there.
    ort.env.wasm.numThreads = 1;
    const resources = await loadResources();
    const canTryWebGpu =
      preferredBackend !== 'wasm' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator;
    if (canTryWebGpu) {
      try {
        return await this.loadWithBackend(resources, 'webgpu', onProgress);
      } catch (error) {
        onProgress?.({
          loadedBytes: 0,
          totalBytes: MODEL_BYTES,
          fraction: 0,
          file: null,
          message: `WebGPU unavailable; retrying Supertonic with WASM (${error instanceof Error ? error.message : 'session error'})`,
        });
      }
    }
    return this.loadWithBackend(resources, 'wasm', onProgress);
  }

  private static async loadWithBackend(
    resources: SupertonicResources,
    backend: SupertonicBackend,
    onProgress?: (progress: SupertonicLoadProgress) => void,
  ): Promise<SupertonicEngine> {
    const sessions: ort.InferenceSession[] = [];
    let style: VoiceStyle | null = null;
    let loadedBytes = 0;
    try {
      style = createVoiceStyle(resources.voiceStyle);
      for (const model of MODEL_FILES) {
        onProgress?.({
          loadedBytes,
          totalBytes: MODEL_BYTES,
          fraction: loadedBytes / MODEL_BYTES,
          file: model.file,
          message: `loading ${model.name} · ${backend.toUpperCase()}`,
        });
        sessions.push(await ort.InferenceSession.create(
          `${ONNX_BASE}/${model.file}`,
          sessionOptions(backend),
        ));
        loadedBytes += model.bytes;
        onProgress?.({
          loadedBytes,
          totalBytes: MODEL_BYTES,
          fraction: loadedBytes / MODEL_BYTES,
          file: model.file,
          message: `loaded ${model.name} · ${backend.toUpperCase()}`,
        });
      }
      return new SupertonicEngine(
        backend,
        resources.config,
        resources.unicodeIndexer,
        style,
        sessions[0],
        sessions[1],
        sessions[2],
        sessions[3],
      );
    } catch (error) {
      await Promise.all(sessions.map((session) => session.release().catch(() => undefined)));
      disposeTensor(style?.ttl);
      disposeTensor(style?.dp);
      throw error;
    }
  }

  async synthesize(
    text: string,
    numInferenceSteps: number,
    speed = 1.05,
  ): Promise<SupertonicAudio> {
    if (!Number.isInteger(numInferenceSteps) || numInferenceSteps < 1 || numInferenceSteps > 50) {
      throw new Error('Supertonic inference steps must be an integer between 1 and 50.');
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error('Supertonic speed must be a positive finite number.');
    }

    const encoded = encodeText(text, this.unicodeIndexer);
    const textIds = new ort.Tensor('int64', encoded.ids, [1, encoded.length]);
    const textMask = new ort.Tensor('float32', encoded.mask, [1, 1, encoded.length]);
    let textEmbedding: ort.Tensor | undefined;
    let latentMask: ort.Tensor | undefined;
    let totalStepTensor: ort.Tensor | undefined;
    let finalLatent: ort.Tensor | undefined;

    try {
      const durationOutputs = await this.durationPredictor.run({
        text_ids: textIds,
        style_dp: this.style.dp,
        text_mask: textMask,
      });
      const rawDuration = floatTensorData(durationOutputs.duration, 'duration')[0];
      Object.values(durationOutputs).forEach(disposeTensor);
      const durationSeconds = rawDuration / speed;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error('Supertonic predicted an invalid audio duration.');
      }

      const encoderOutputs = await this.textEncoder.run({
        text_ids: textIds,
        style_ttl: this.style.ttl,
        text_mask: textMask,
      });
      textEmbedding = encoderOutputs.text_emb;
      if (!textEmbedding) throw new Error('Supertonic did not return a text embedding.');
      for (const [name, tensor] of Object.entries(encoderOutputs)) {
        if (name !== 'text_emb') disposeTensor(tensor);
      }

      const chunkSize =
        this.config.ae.base_chunk_size * this.config.ttl.chunk_compress_factor;
      const waveformLength = Math.max(1, Math.floor(durationSeconds * this.sampleRate));
      const latentLength = Math.max(1, Math.ceil(waveformLength / chunkSize));
      const latentChannels =
        this.config.ttl.latent_dim * this.config.ttl.chunk_compress_factor;
      let latentData = sampleNormal(latentChannels * latentLength);
      latentMask = new ort.Tensor(
        'float32',
        new Float32Array(latentLength).fill(1),
        [1, 1, latentLength],
      );
      totalStepTensor = new ort.Tensor(
        'float32',
        new Float32Array([numInferenceSteps]),
        [1],
      );

      for (let step = 0; step < numInferenceSteps; step += 1) {
        const noisyLatent = new ort.Tensor(
          'float32',
          latentData,
          [1, latentChannels, latentLength],
        );
        const currentStep = new ort.Tensor('float32', new Float32Array([step]), [1]);
        try {
          const vectorOutputs = await this.vectorEstimator.run({
            noisy_latent: noisyLatent,
            text_emb: textEmbedding,
            style_ttl: this.style.ttl,
            latent_mask: latentMask,
            text_mask: textMask,
            current_step: currentStep,
            total_step: totalStepTensor,
          });
          latentData = new Float32Array(
            floatTensorData(vectorOutputs.denoised_latent, 'denoised latent'),
          );
          Object.values(vectorOutputs).forEach(disposeTensor);
        } finally {
          disposeTensor(noisyLatent);
          disposeTensor(currentStep);
        }
      }

      finalLatent = new ort.Tensor(
        'float32',
        latentData,
        [1, latentChannels, latentLength],
      );
      const vocoderOutputs = await this.vocoder.run({ latent: finalLatent });
      const rawAudio = floatTensorData(vocoderOutputs.wav_tts, 'waveform');
      const trimmedLength = Math.min(rawAudio.length, Math.ceil(durationSeconds * this.sampleRate));
      const audio = new Float32Array(rawAudio.slice(0, trimmedLength));
      Object.values(vocoderOutputs).forEach(disposeTensor);
      return {
        audio,
        sampleRate: this.sampleRate,
        predictedDurationSeconds: durationSeconds,
      };
    } finally {
      disposeTensor(textIds);
      disposeTensor(textMask);
      disposeTensor(textEmbedding);
      disposeTensor(latentMask);
      disposeTensor(totalStepTensor);
      disposeTensor(finalLatent);
    }
  }

  async dispose(): Promise<void> {
    disposeTensor(this.style.ttl);
    disposeTensor(this.style.dp);
    await Promise.all([
      this.durationPredictor.release().catch(() => undefined),
      this.textEncoder.release().catch(() => undefined),
      this.vectorEstimator.release().catch(() => undefined),
      this.vocoder.release().catch(() => undefined),
    ]);
  }
}
