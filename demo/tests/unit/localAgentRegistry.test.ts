import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LANGUAGE_MODELS,
  LOCAL_MODELS,
  SAFE_DEFAULT_MODEL_SELECTION,
  TEXT_TO_SPEECH_MODELS,
  getLocalModelsByKind,
  mayAutomaticallyDownload,
  selectLocalAgentModels,
  type BrowserCapabilitySnapshot,
} from '../../src/local-agent';

function capableBrowser(): BrowserCapabilitySnapshot {
  return {
    checkedAtEpochMs: 1,
    secureContext: true,
    crossOriginIsolated: true,
    webgpu: {
      apiAvailable: true,
      adapterAvailable: true,
      shaderF16: true,
    },
    wasm: { available: true, simd: true, threads: true },
    storage: {
      cacheStorage: true,
      indexedDb: true,
      opfs: true,
      persisted: true,
      quotaBytes: 10_000_000_000,
      usageBytes: 0,
    },
  };
}

test('registry has unique typed models and one safe default per agent role', () => {
  assert.equal(new Set(LOCAL_MODELS.map((model) => model.id)).size, LOCAL_MODELS.length);
  assert.equal(getLocalModelsByKind('stt').length, 2);
  assert.equal(getLocalModelsByKind('llm').length, 7);
  assert.equal(getLocalModelsByKind('tts').length, 7);
  assert.deepEqual(SAFE_DEFAULT_MODEL_SELECTION, {
    stt: 'moonshine-tiny-q8',
    llm: 'qwen2.5-0.5b-instruct-q4f16',
    tts: 'kokoro-82m-q8-wasm',
  });
});

test('safe selection chooses Moonshine, Qwen2.5, and WASM Kokoro', () => {
  const result = selectLocalAgentModels(capableBrowser());
  assert.deepEqual(result.selection, SAFE_DEFAULT_MODEL_SELECTION);
  assert.equal(result.readyToResolveArtifacts, true);
  assert.ok(result.decisions.every((decision) => decision.automatic));
});

test('Gemma 4 is opt-in, warned, LiteRT-backed, and never auto-downloads', () => {
  const gemma4 = LANGUAGE_MODELS['gemma-4-e2b-it-litert-web'];
  assert.equal(gemma4.policy.releaseChannel, 'optional');
  assert.equal(gemma4.policy.requiresExplicitConsent, false);
  assert.equal(gemma4.policy.allowAutomaticDownload, false);
  assert.ok((gemma4.policy.warning?.length ?? 0) > 20);
  assert.equal(mayAutomaticallyDownload(gemma4.id), false);
  assert.equal(gemma4.backends[0].runtime, 'litert-lm');

  const selected = selectLocalAgentModels(capableBrowser(), { llm: gemma4.id });
  assert.equal(selected.selection.llm, gemma4.id);
});

test('Qwen3.5 and fp32 Kokoro are explicit opt-ins', () => {
  const qwen = LANGUAGE_MODELS['qwen3.5-0.8b-q4f16'];
  const kokoro = TEXT_TO_SPEECH_MODELS['kokoro-82m-fp32-webgpu'];
  assert.equal(qwen.policy.releaseChannel, 'optional');
  assert.equal(kokoro.policy.releaseChannel, 'optional');
  assert.equal(mayAutomaticallyDownload(qwen.id), false);
  assert.equal(mayAutomaticallyDownload(kokoro.id), false);

  const selected = selectLocalAgentModels(capableBrowser(), {
    llm: qwen.id,
    tts: kokoro.id,
  });
  assert.equal(selected.selection.llm, qwen.id);
  assert.equal(selected.selection.tts, kokoro.id);
});

test('Supertonic presets are explicit opt-ins with a CPU fallback', () => {
  const instant = TEXT_TO_SPEECH_MODELS['supertonic-2-instant-webgpu'];
  const quality = TEXT_TO_SPEECH_MODELS['supertonic-2-quality-webgpu'];
  assert.equal(instant.policy.releaseChannel, 'optional');
  assert.equal(quality.policy.releaseChannel, 'optional');
  assert.equal(mayAutomaticallyDownload(instant.id), false);
  assert.ok(instant.backends.some((backend) => backend.execution === 'webgpu'));
  assert.ok(instant.backends.some((backend) => backend.execution === 'wasm'));

  const capabilities = capableBrowser();
  capabilities.webgpu.adapterAvailable = false;
  capabilities.webgpu.shaderF16 = false;
  const selected = selectLocalAgentModels(capabilities, { tts: instant.id });
  assert.equal(selected.selection.tts, instant.id);
});

test('KittenTTS Nano is an explicit tiny comparison voice with a CPU fallback', () => {
  const kitten = TEXT_TO_SPEECH_MODELS['kitten-tts-nano-0.8-fp32-webgpu'];
  assert.equal(kitten.policy.releaseChannel, 'experimental');
  assert.equal(kitten.producesNativeVisemeTiming, false);
  assert.equal(kitten.voices, 'kitten');
  assert.equal(mayAutomaticallyDownload(kitten.id), false);
  assert.ok(kitten.backends.some((backend) => backend.execution === 'webgpu'));
  assert.ok(kitten.backends.some((backend) => backend.execution === 'wasm'));
});

test('a browser without WebGPU keeps WASM speech models but blocks the LLM', () => {
  const capabilities = capableBrowser();
  capabilities.webgpu.adapterAvailable = false;
  capabilities.webgpu.shaderF16 = false;
  const result = selectLocalAgentModels(capabilities);
  assert.equal(result.selection.stt, 'moonshine-tiny-q8');
  assert.equal(result.selection.llm, null);
  assert.equal(result.selection.tts, 'kokoro-82m-q8-wasm');
  assert.equal(result.readyToResolveArtifacts, false);
});
