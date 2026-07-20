import assert from 'node:assert/strict';
import test from 'node:test';
import {
  kokoroPhonemesToIntervals,
  resolveKokoroPhonemeIntervals,
  tokenizeKokoroIpa,
} from '../../src/speech/KokoroPhonemeTiming';
import type { PhonemeInterval } from '../../src/speech/types';

test('Kokoro IPA tokenization preserves speech-critical symbols and stress', () => {
  const tokens = tokenizeKokoroIpa('ˈt͡ʃaɪ dʒuː');

  assert.deepEqual(
    tokens.map(({ phone }) => phone),
    ['t͡ʃ', 'aɪ', 'dʒ', 'uː'],
  );
  assert.deepEqual(
    tokens.map(({ normalizedPhone }) => normalizedPhone),
    ['tʃ', 'aɪ', 'dʒ', 'u'],
  );
  assert.deepEqual(tokens.map(({ stress }) => stress), [0, 2, 0, 0]);
  assert.deepEqual(tokens.map(({ wordIndex }) => wordIndex), [0, 0, 1, 1]);
});

test('Kokoro IPA intervals fill PCM duration and retain word and pause metadata', () => {
  const intervals = kokoroPhonemesToIntervals(
    'həˈloʊ, wɜːld',
    2.4,
    'Hello, world!',
  );

  assert.equal(intervals[0].startTime, 0);
  assert.equal(intervals.at(-1)?.endTime, 2.4);
  assert.ok(intervals.every((phone, index) =>
    phone.endTime >= phone.startTime &&
    (index === 0 || phone.startTime === intervals[index - 1].endTime)
  ));
  assert.ok(intervals.some((phone) =>
    phone.normalizedPhone === 'sil' &&
    phone.source === 'silence-gap' &&
    phone.wordIndex === null
  ));
  assert.equal(intervals.find((phone) => phone.wordIndex === 0)?.word, 'Hello');
  assert.equal(intervals.find((phone) => phone.wordIndex === 1)?.word, 'world');
  assert.ok(intervals.some((phone) =>
    phone.stress === 2 && phone.emphasis === 1.12
  ));
});

test('generic local IPA preserves its non-Kokoro timing provenance', () => {
  const intervals = resolveKokoroPhonemeIntervals(
    'həˈloʊ',
    0.8,
    'hello',
    'estimated-from-local-phonemes',
  );

  assert.ok(intervals.length > 0);
  assert.ok(intervals.every((phone) =>
    phone.source === 'estimated-from-local-phonemes' ||
    phone.source === 'silence-gap'
  ));
});

test('pre-timed Kokoro intervals are copied, normalized, and range checked', () => {
  const input: PhonemeInterval[] = [
    {
      phone: 'ɡ',
      normalizedPhone: 'wrong',
      startTime: 0,
      endTime: 0.2,
      word: 'go',
      wordIndex: 0,
      source: 'estimated-from-kokoro-phonemes',
    },
    {
      phone: 'oʊ',
      normalizedPhone: 'wrong',
      startTime: 0.2,
      endTime: 0.5,
      word: 'go',
      wordIndex: 0,
      source: 'estimated-from-kokoro-phonemes',
    },
  ];
  const resolved = resolveKokoroPhonemeIntervals(input, 0.5, 'go');

  assert.notEqual(resolved, input);
  assert.deepEqual(resolved.map(({ normalizedPhone }) => normalizedPhone), ['g', 'oʊ']);
  assert.throws(
    () => resolveKokoroPhonemeIntervals(
      [{ ...input[0], endTime: 0.6 }],
      0.5,
    ),
    /invalid timing/i,
  );
});
