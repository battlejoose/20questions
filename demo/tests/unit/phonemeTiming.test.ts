import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPhonemeTimeline,
  extractWordTimings,
  tokenizeIpa,
  validateCharacterAlignment,
} from '../../src/speech/PhonemeTiming';
import type { CharacterAlignment } from '../../src/speech/types';

function helloWorldAlignment(): CharacterAlignment {
  const characters = Array.from('Hello world');
  const characterStartTimesSeconds = [
    0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.32, 0.36, 0.4, 0.44, 0.48,
  ];
  const characterEndTimesSeconds = [
    0.04, 0.08, 0.12, 0.16, 0.2, 0.32, 0.36, 0.4, 0.44, 0.48, 0.54,
  ];
  return {
    characters,
    characterStartTimesSeconds,
    characterEndTimesSeconds,
  };
}

test('tokenizeIpa preserves affricates, diphthongs, and length marks', () => {
  assert.deepEqual(tokenizeIpa('ˈt͡ʃaɪ dʒuː'), [
    't͡ʃ',
    'aɪ',
    'dʒ',
    'uː',
  ]);
});

test('phoneme timing preserves lexical stress and deterministic speaking rate', async () => {
  const timeline = await buildPhonemeTimeline(helloWorldAlignment(), {
    phonemizeWord: async (word) => word === 'Hello' ? 'həˈloʊ' : 'ˌwɜːld',
  });
  const primary = timeline.find((interval) => interval.normalizedPhone === 'oʊ');
  const secondary = timeline.find((interval) => interval.normalizedPhone === 'ɜ');
  assert.equal(primary?.stress, 2);
  assert.equal(primary?.emphasis, 1.12);
  assert.equal(secondary?.stress, 1);
  assert.ok((secondary?.speakingRate ?? 0) > 0);
});

test('extractWordTimings retains character and audio spans', () => {
  const words = extractWordTimings(helloWorldAlignment());
  assert.deepEqual(words, [
    {
      text: 'Hello',
      wordIndex: 0,
      startTime: 0,
      endTime: 0.2,
      characterStart: 0,
      characterEnd: 5,
    },
    {
      text: 'world',
      wordIndex: 1,
      startTime: 0.32,
      endTime: 0.54,
      characterStart: 6,
      characterEnd: 11,
    },
  ]);
});

test('buildPhonemeTimeline phonemizes each word and fills the timed gap', async () => {
  const calls: string[] = [];
  const timeline = await buildPhonemeTimeline(helloWorldAlignment(), {
    phonemizeWord: async (word, language) => {
      calls.push(`${language}:${word}`);
      return word === 'Hello' ? 'həlˈoʊ' : 'wˈɜːld';
    },
  });

  assert.deepEqual(calls, ['en-us:Hello', 'en-us:world']);
  assert.deepEqual(
    timeline.map((interval) => interval.phone),
    ['h', 'ə', 'l', 'oʊ', 'sil', 'w', 'ɜː', 'l', 'd'],
  );

  const silence = timeline.find((interval) => interval.phone === 'sil');
  assert.equal(silence?.startTime, 0.2);
  assert.equal(silence?.endTime, 0.32);
  assert.equal(timeline[0].startTime, 0);
  assert.equal(timeline[timeline.length - 1].endTime, 0.54);

  for (let index = 1; index < timeline.length; index += 1) {
    assert.ok(timeline[index].startTime >= timeline[index - 1].endTime - 1e-9);
  }
});

test('alignment validation rejects mismatched and non-monotonic arrays', () => {
  assert.throws(
    () =>
      validateCharacterAlignment({
        characters: ['a', 'b'],
        characterStartTimesSeconds: [0],
        characterEndTimesSeconds: [0.1, 0.2],
      }),
    /equal, non-zero lengths/u,
  );

  assert.throws(
    () =>
      validateCharacterAlignment({
        characters: ['a', 'b'],
        characterStartTimesSeconds: [0.2, 0.1],
        characterEndTimesSeconds: [0.3, 0.2],
      }),
    /monotonic/u,
  );
});
