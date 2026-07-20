import { normalizeSpokenText } from '../SpokenTextNormalizer';
import { KittenTtsEngine } from './KittenTtsEngine';
import {
  KITTEN_TTS_CAPABILITIES,
  type KittenTtsModelId,
  type KittenTtsVoice,
} from './KittenTtsModel';
import {
  postWorkerError,
  postWorkerProgress,
  postWorkerResult,
  type RpcWorkerRequest,
} from './workerProtocol';

interface LoadPayload {
  modelId: KittenTtsModelId;
}

interface SynthesizePayload {
  text: string;
  voice: KittenTtsVoice;
  speed: number;
}

let engine: KittenTtsEngine | null = null;
let loadedModel: KittenTtsModelId | null = null;
let queue = Promise.resolve();

async function loadModel(id: number, payload: LoadPayload): Promise<void> {
  if (engine && loadedModel === payload.modelId) {
    postWorkerResult(id, {
      modelId: payload.modelId,
      cached: true,
      backend: engine.backend,
      capabilities: KITTEN_TTS_CAPABILITIES,
    });
    return;
  }
  await engine?.dispose();
  engine = null;
  loadedModel = null;
  engine = await KittenTtsEngine.load((progress) => postWorkerProgress(id, progress));
  loadedModel = payload.modelId;
  postWorkerResult(id, {
    modelId: payload.modelId,
    cached: false,
    backend: engine.backend,
    capabilities: KITTEN_TTS_CAPABILITIES,
  });
}

async function synthesize(id: number, payload: SynthesizePayload): Promise<void> {
  if (!engine || !loadedModel) throw new Error('KittenTTS is not installed.');
  const text = normalizeSpokenText(payload.text);
  if (!text) throw new Error('KittenTTS received an empty clause after speech normalization.');
  const startedAt = performance.now();
  const chunk = await engine.synthesize(text, payload.voice, payload.speed);
  const elapsedMs = performance.now() - startedAt;
  const audioDurationSeconds = chunk.audio.length / chunk.sampleRate;
  postWorkerResult(id, {
    engine: 'kitten-tts-nano',
    backend: engine.backend,
    preset: 'standard',
    timingCapabilities: KITTEN_TTS_CAPABILITIES,
    chunks: [chunk],
    elapsedMs,
    audioDurationSeconds,
    realTimeFactor: elapsedMs / Math.max(1, audioDurationSeconds * 1000),
  }, [chunk.audio.buffer]);
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
    throw new Error(`Unknown KittenTTS worker operation: ${message.operation}`);
  }
}

globalThis.addEventListener('message', (event: MessageEvent<RpcWorkerRequest>) => {
  queue = queue.then(() => handle(event.data)).catch((error: unknown) => {
    postWorkerError(event.data.id, error);
  });
});
