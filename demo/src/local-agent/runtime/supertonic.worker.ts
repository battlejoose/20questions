import { phonemize } from 'phonemizer';
import { normalizeSpokenText } from '../SpokenTextNormalizer';
import { SupertonicEngine } from './SupertonicEngine';
import {
  supertonicPresetForModel,
  type SupertonicModelId,
} from './SupertonicRuntime';
import {
  postWorkerError,
  postWorkerProgress,
  postWorkerResult,
  type RpcWorkerRequest,
} from './workerProtocol';

interface LoadPayload {
  modelId: SupertonicModelId;
}

interface SynthesizePayload {
  text: string;
  speed: number;
}

let engine: SupertonicEngine | null = null;
let loadedModel: SupertonicModelId | null = null;
let queue = Promise.resolve();

async function localPhonemes(text: string): Promise<string> {
  const result = await phonemize(text, 'en-us');
  const ipa = result.join(' ').normalize('NFC').trim();
  if (!ipa) throw new Error('The local phonemizer returned no speech phones.');
  return ipa;
}

async function loadModel(id: number, payload: LoadPayload): Promise<void> {
  if (engine && loadedModel === payload.modelId) {
    postWorkerResult(id, {
      modelId: payload.modelId,
      cached: true,
      backend: engine.backend,
    });
    return;
  }
  await engine?.dispose();
  engine = null;
  loadedModel = null;
  engine = await SupertonicEngine.load((progress) => postWorkerProgress(id, progress));

  // Warm every ONNX session and the eSpeak phonemizer during installation.
  try {
    await engine.synthesize('Ready.', 2, 1.05);
  } catch (error) {
    if (engine.backend !== 'webgpu') throw error;
    postWorkerProgress(id, {
      loadedBytes: 0,
      totalBytes: 263_000_000,
      fraction: 0,
      file: null,
      message: 'WebGPU warmup failed; retrying Supertonic with WASM',
    });
    await engine.dispose();
    engine = await SupertonicEngine.load(
      (progress) => postWorkerProgress(id, progress),
      'wasm',
    );
    await engine.synthesize('Ready.', 2, 1.05);
  }
  await localPhonemes('Ready.');
  loadedModel = payload.modelId;
  postWorkerResult(id, {
    modelId: payload.modelId,
    cached: false,
    backend: engine.backend,
  });
}

async function synthesize(id: number, payload: SynthesizePayload): Promise<void> {
  if (!engine || !loadedModel) throw new Error('Supertonic is not installed.');
  const text = normalizeSpokenText(payload.text);
  if (!text) throw new Error('Supertonic received an empty clause.');
  const { preset, numInferenceSteps } = supertonicPresetForModel(loadedModel);
  const startedAt = performance.now();
  const phonemesPromise = localPhonemes(text);
  const output = await engine.synthesize(text, numInferenceSteps, payload.speed);
  const phonemes = await phonemesPromise;
  const elapsedMs = performance.now() - startedAt;
  const audioDurationSeconds = output.audio.length / output.sampleRate;
  const chunk = {
    text,
    phonemes,
    audio: output.audio,
    sampleRate: output.sampleRate,
  };
  postWorkerResult(id, {
    engine: 'supertonic-2',
    backend: engine.backend,
    preset,
    numInferenceSteps,
    chunks: [chunk],
    elapsedMs,
    audioDurationSeconds,
    realTimeFactor: elapsedMs / Math.max(1, audioDurationSeconds * 1000),
  }, [output.audio.buffer]);
}

async function handle(message: RpcWorkerRequest): Promise<void> {
  if (message.operation === 'load') {
    await loadModel(message.id, message.payload as LoadPayload);
  } else if (message.operation === 'synthesize') {
    await synthesize(message.id, message.payload as SynthesizePayload);
  } else if (message.operation === 'dispose') {
    await engine?.dispose();
    engine = null;
    loadedModel = null;
    postWorkerResult(message.id, undefined);
  } else {
    throw new Error(`Unknown Supertonic worker operation: ${message.operation}`);
  }
}

globalThis.addEventListener('message', (event: MessageEvent<RpcWorkerRequest>) => {
  queue = queue.then(() => handle(event.data)).catch((error: unknown) => {
    postWorkerError(event.data.id, error);
  });
});
