import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KITTEN_TTS_CAPABILITIES,
  KITTEN_TTS_MODEL_ID,
  isKittenTtsModelId,
  joinKittenPhonemeTokens,
  splitKittenPunctuation,
  tokenizeKittenPhonemes,
  trimKittenWaveform,
} from '../../src/local-agent/runtime/KittenTtsModel';

test('KittenTTS capability contract never mislabels heuristic timing as native', () => {
  assert.equal(KITTEN_TTS_CAPABILITIES.audio, 'pcm-f32');
  assert.equal(KITTEN_TTS_CAPABILITIES.sampleRate, 24_000);
  assert.equal(KITTEN_TTS_CAPABILITIES.exactInputPhonemes, true);
  assert.equal(KITTEN_TTS_CAPABILITIES.nativePhonemeTimings, false);
  assert.equal(KITTEN_TTS_CAPABILITIES.nativeWordTimings, false);
});

test('KittenTTS model ID guard accepts only the pinned stable fp32 graph', () => {
  assert.equal(isKittenTtsModelId(KITTEN_TTS_MODEL_ID), true);
  assert.equal(isKittenTtsModelId('kitten-tts-nano-0.8-int8-wasm'), false);
  assert.equal(isKittenTtsModelId('kokoro-82m-q8-wasm'), false);
});

test('Kitten phoneme preparation matches the official token framing', () => {
  const ipa = 'həlˈoʊ, wˈɜːld!';
  assert.equal(joinKittenPhonemeTokens(ipa), 'həlˈoʊ , wˈɜːld !');
  const tokens = tokenizeKittenPhonemes(ipa);
  // Reference output from KittenML's Python TextCleaner at v0.8.1.
  assert.deepEqual(tokens, [
    0, 50, 83, 54, 156, 57, 135, 16, 3, 16, 65, 156, 87, 158, 54, 46, 16, 5, 10, 0,
  ]);
});

test('Kitten punctuation splitting preserves punctuation passed to the model', () => {
  assert.deepEqual(splitKittenPunctuation('Hello, world!'), [
    { punctuation: false, text: 'Hello' },
    { punctuation: true, text: ', ' },
    { punctuation: false, text: 'world' },
    { punctuation: true, text: '!' },
  ]);
});

test('Kitten waveform trimming follows the official fixed tail removal', () => {
  const audio = Float32Array.from({ length: 5_006 }, (_, index) => index);
  assert.deepEqual(Array.from(trimKittenWaveform(audio)), [0, 1, 2, 3, 4, 5]);
  assert.equal(trimKittenWaveform(new Float32Array(100)).length, 0);
});
