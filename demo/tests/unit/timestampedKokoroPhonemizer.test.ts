import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTimestampedKokoroPhonemeFixups,
  phonemizeForTimestampedKokoro,
} from '../../src/local-agent/runtime/TimestampedKokoroPhonemizer';

test('timestamped Kokoro removes eSpeak syllabic marks before token-duration alignment', () => {
  assert.equal(
    applyTimestampedKokoroPhonemeFixups('sˈɜːʔn̩li'),
    'sˈɜːʔnli',
  );
});

test('timestamped Kokoro mirrors its tokenizer normalizer for unsupported punctuation', () => {
  assert.equal(
    applyTimestampedKokoroPhonemeFixups('həˈloʊ [smˈaɪl] ¿'),
    'həˈloʊ smˈaɪl',
  );
});

test('the reported certainly-and-smile path produces tokenizer-compatible IPA', async () => {
  const ipa = await phonemizeForTimestampedKokoro(
    'Certainly! Consider this my happiest smile.',
  );
  assert.equal(ipa.includes('̩'), false);
  assert.match(ipa, /sˈɜːʔnli/u);
});
