import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProgressSnapshot,
  deriveAgentReadiness,
  deriveModelReadiness,
  evaluateModelCompatibility,
  LANGUAGE_MODELS,
  SAFE_DEFAULT_MODEL_SELECTION,
  type BrowserCapabilitySnapshot,
  type ModelCacheEntrySnapshot,
} from '../../src/local-agent';

const capabilities: BrowserCapabilitySnapshot = {
  checkedAtEpochMs: 1,
  secureContext: true,
  crossOriginIsolated: false,
  webgpu: { apiAvailable: true, adapterAvailable: true, shaderF16: true },
  wasm: { available: true, simd: true, threads: false },
  storage: {
    cacheStorage: true,
    indexedDb: true,
    opfs: true,
    persisted: false,
    quotaBytes: 2_000_000_000,
    usageBytes: 0,
  },
};

function cache(
  state: ModelCacheEntrySnapshot['state'],
): ModelCacheEntrySnapshot {
  return {
    modelId: 'qwen2.5-0.5b-instruct-q4f16',
    state,
    cacheKey: 'model/qwen2.5/revision',
    revision: null,
    expectedBytes: 100,
    cachedBytes: state === 'ready' ? 100 : 0,
    updatedAtEpochMs: null,
    verifiedAtEpochMs: null,
  };
}

test('progress snapshots clamp invalid byte counts and compute a fraction', () => {
  const progress = createProgressSnapshot({
    modelId: 'qwen2.5-0.5b-instruct-q4f16',
    phase: 'downloading',
    loadedBytes: 140,
    totalBytes: 100,
    filesCompleted: -2,
    updatedAtEpochMs: 8,
  });
  assert.equal(progress.loadedBytes, 100);
  assert.equal(progress.fraction, 1);
  assert.equal(progress.filesCompleted, 0);
});

test('readiness requires compatibility, consent where applicable, and a ready cache', () => {
  const model = LANGUAGE_MODELS['qwen2.5-0.5b-instruct-q4f16'];
  const compatibility = evaluateModelCompatibility(model, capabilities);
  const idle = createProgressSnapshot({
    modelId: model.id,
    phase: 'idle',
    updatedAtEpochMs: 1,
  });
  const missing = deriveModelReadiness({
    compatibility,
    cache: cache('missing'),
    progress: idle,
    consentGranted: false,
    requiresExplicitConsent: false,
    allowDownload: true,
  });
  assert.equal(missing.state, 'not-cached');
  assert.equal(missing.mayDownload, true);
  assert.equal(missing.mayInitialize, false);

  const ready = deriveModelReadiness({
    compatibility,
    cache: cache('ready'),
    progress: { ...idle, phase: 'ready', fraction: 1 },
    consentGranted: false,
    requiresExplicitConsent: false,
    allowDownload: true,
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.mayInitialize, true);
  assert.equal(ready.selectedRuntime, 'webllm');
  assert.equal(ready.selectedBackend, 'webgpu');
});

test('a consent-gated Gemma readiness stops before download', () => {
  const model = LANGUAGE_MODELS['gemma-3-1b-it-q4f16'];
  const compatibility = evaluateModelCompatibility(model, capabilities);
  const readiness = deriveModelReadiness({
    compatibility,
    cache: { ...cache('missing'), modelId: model.id },
    progress: createProgressSnapshot({
      modelId: model.id,
      phase: 'awaiting-consent',
      updatedAtEpochMs: 2,
    }),
    consentGranted: false,
    requiresExplicitConsent: true,
    allowDownload: false,
  });
  assert.equal(readiness.state, 'consent-required');
  assert.equal(readiness.mayDownload, false);
  assert.equal(readiness.mayInitialize, false);
});

test('agent readiness aggregates unavailable, loading, and ready states deterministically', () => {
  const base = {
    modelId: 'qwen2.5-0.5b-instruct-q4f16' as const,
    compatibility: evaluateModelCompatibility(
      LANGUAGE_MODELS['qwen2.5-0.5b-instruct-q4f16'],
      capabilities,
    ),
    cache: cache('ready'),
    progress: createProgressSnapshot({
      modelId: 'qwen2.5-0.5b-instruct-q4f16',
      phase: 'ready',
      updatedAtEpochMs: 3,
    }),
    selectedRuntime: 'webllm' as const,
    selectedBackend: 'webgpu' as const,
    mayDownload: false,
    mayInitialize: true,
    message: 'ready',
  };
  const loading = deriveAgentReadiness(
    SAFE_DEFAULT_MODEL_SELECTION,
    [
      { ...base, state: 'ready' },
      { ...base, state: 'loading', mayInitialize: false },
      { ...base, state: 'ready' },
    ],
    9,
  );
  assert.equal(loading.state, 'loading');

  const ready = deriveAgentReadiness(
    SAFE_DEFAULT_MODEL_SELECTION,
    [
      { ...base, state: 'ready' },
      { ...base, state: 'ready' },
      { ...base, state: 'ready' },
    ],
    10,
  );
  assert.equal(ready.state, 'ready');

  const unavailable = deriveAgentReadiness(
    { ...SAFE_DEFAULT_MODEL_SELECTION, llm: null },
    [{ ...base, state: 'ready' }],
    11,
  );
  assert.equal(unavailable.state, 'unavailable');
});
