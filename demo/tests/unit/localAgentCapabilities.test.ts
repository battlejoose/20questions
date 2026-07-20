import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectBrowserCapabilities,
  evaluateModelCompatibility,
  LANGUAGE_MODELS,
  type BrowserCapabilityEnvironment,
} from '../../src/local-agent';

test('capability detection reports WebGPU f16, WASM, cache, and storage without writes', async () => {
  let storageWrites = 0;
  const environment: BrowserCapabilityEnvironment = {
    isSecureContext: true,
    crossOriginIsolated: true,
    navigator: {
      gpu: {
        requestAdapter: async () => ({ features: new Set(['shader-f16']) }),
      },
      storage: {
        estimate: async () => ({ quota: 2_000, usage: 500 }),
        persisted: async () => true,
        getDirectory: async () => {
          storageWrites += 1;
          return {};
        },
      },
    },
    caches: { open: async () => ({}) },
    indexedDB: { open: () => ({}) },
    WebAssembly: { validate: () => true },
    SharedArrayBuffer,
    Atomics,
  };

  const snapshot = await detectBrowserCapabilities(environment, () => 42);
  assert.equal(snapshot.checkedAtEpochMs, 42);
  assert.equal(snapshot.webgpu.adapterAvailable, true);
  assert.equal(snapshot.webgpu.shaderF16, true);
  assert.deepEqual(snapshot.wasm, { available: true, simd: true, threads: true });
  assert.equal(snapshot.storage.cacheStorage, true);
  assert.equal(snapshot.storage.indexedDb, true);
  assert.equal(snapshot.storage.opfs, true);
  assert.equal(snapshot.storage.persisted, true);
  assert.equal(snapshot.storage.quotaBytes, 2_000);
  assert.equal(snapshot.storage.usageBytes, 500);
  assert.equal(storageWrites, 0);
});

test('adapter failure is captured and causes WebGPU model incompatibility', async () => {
  const snapshot = await detectBrowserCapabilities({
    navigator: {
      gpu: {
        requestAdapter: async () => {
          throw new Error('adapter denied');
        },
      },
    },
  });
  assert.equal(snapshot.webgpu.apiAvailable, true);
  assert.equal(snapshot.webgpu.adapterAvailable, false);
  assert.match(snapshot.webgpu.error ?? '', /adapter denied/);

  const compatibility = evaluateModelCompatibility(
    LANGUAGE_MODELS['qwen2.5-0.5b-instruct-q4f16'],
    snapshot,
  );
  assert.equal(compatibility.supported, false);
  assert.deepEqual(
    compatibility.backends[0].missingCapabilities,
    ['webgpu', 'shader-f16'],
  );
});

test('WebGPU without shader-f16 does not qualify for q4f16 model profiles', async () => {
  const snapshot = await detectBrowserCapabilities({
    isSecureContext: true,
    navigator: {
      gpu: {
        requestAdapter: async () => ({ features: new Set<string>() }),
      },
    },
    WebAssembly: { validate: () => true },
  });
  const compatibility = evaluateModelCompatibility(
    LANGUAGE_MODELS['qwen2.5-0.5b-instruct-q4f16'],
    snapshot,
  );
  assert.equal(snapshot.webgpu.adapterAvailable, true);
  assert.equal(compatibility.supported, false);
  assert.deepEqual(compatibility.backends[0].missingCapabilities, ['shader-f16']);
});
