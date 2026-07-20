import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupertonicModelId,
  supertonicPresetForModel,
} from '../../src/local-agent/runtime/SupertonicRuntime';

test('Supertonic model IDs select deterministic denoising presets', () => {
  assert.equal(isSupertonicModelId('supertonic-2-instant-webgpu'), true);
  assert.equal(isSupertonicModelId('supertonic-2-quality-webgpu'), true);
  assert.equal(isSupertonicModelId('kokoro-82m-q8-wasm'), false);
  assert.deepEqual(supertonicPresetForModel('supertonic-2-instant-webgpu'), {
    preset: 'instant',
    numInferenceSteps: 2,
  });
  assert.deepEqual(supertonicPresetForModel('supertonic-2-quality-webgpu'), {
    preset: 'quality',
    numInferenceSteps: 5,
  });
});
