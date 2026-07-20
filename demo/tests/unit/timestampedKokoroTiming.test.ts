import assert from 'node:assert/strict';
import test from 'node:test';
import {
  kokoroContentDurations,
  kokoroNativeDurationsToIntervals,
} from '../../src/local-agent/runtime/TimestampedKokoroTiming';
import { isTimestampedKokoroModelId } from '../../src/local-agent/runtime/TimestampedKokoroRuntime';

test('timestamped Kokoro model IDs are explicit and do not capture standard Kokoro', () => {
  assert.equal(isTimestampedKokoroModelId('kokoro-82m-timestamped-q8-wasm'), true);
  assert.equal(isTimestampedKokoroModelId('kokoro-82m-timestamped-fp32-webgpu'), true);
  assert.equal(isTimestampedKokoroModelId('kokoro-82m-q8-wasm'), false);
  assert.equal(isTimestampedKokoroModelId('supertonic-2-instant-webgpu'), false);
});

test('timestamped Kokoro strips BOS and EOS only after checking token parity', () => {
  assert.deepEqual(
    kokoroContentDurations('hˈaɪ', [0, 2, 0, 4, 5, 0]),
    [2, 0, 4, 5],
  );
  assert.throws(
    () => kokoroContentDurations('hˈaɪ', [0, 2, 4, 5, 0]),
    /expected BOS \+ symbols \+ EOS/i,
  );
});

test('native duration conversion preserves phone proportions and exact PCM extent', () => {
  // BOS, h, primary stress, a, diphthong tail, space, w, ɜ, length, l, d, EOS
  const intervals = kokoroNativeDurationsToIntervals({
    text: 'Hi world',
    phonemes: 'hˈaɪ wɜːld',
    modelDurationsFrames: [0, 2, 0, 4, 5, 2, 2, 5, 1, 2, 2, 0],
    audioDurationSeconds: 2.5,
  });

  assert.deepEqual(
    intervals.map(({ phone }) => phone),
    ['h', 'aɪ', 'sil', 'w', 'ɜː', 'l', 'd'],
  );
  assert.equal(intervals[0].startTime, 0);
  assert.equal(intervals.at(-1)?.endTime, 2.5);
  assert.ok(intervals.every((interval) => interval.timingOrigin === 'synthesis-native'));
  assert.equal(intervals.find(({ phone }) => phone === 'h')?.word, 'Hi');
  assert.equal(intervals.find(({ phone }) => phone === 'w')?.word, 'world');
  assert.equal(intervals.find(({ phone }) => phone === 'aɪ')?.stress, 2);

  const diphthong = intervals.find(({ phone }) => phone === 'aɪ');
  const initial = intervals.find(({ phone }) => phone === 'h');
  assert.ok(diphthong && initial);
  assert.ok(
    diphthong.endTime - diphthong.startTime >
      4 * (initial.endTime - initial.startTime),
  );
  assert.ok(intervals.every((interval, index) =>
    interval.endTime >= interval.startTime &&
    (index === 0 || interval.startTime === intervals[index - 1].endTime)
  ));
});

test('punctuation duration becomes an explicit closed-mouth interval', () => {
  const intervals = kokoroNativeDurationsToIntervals({
    text: 'Go, now.',
    phonemes: 'ɡˈoʊ, nˈaʊ.',
    // BOS + 11 content symbols + EOS
    modelDurationsFrames: [0, 2, 0, 4, 3, 4, 1, 2, 0, 3, 3, 5, 0],
    audioDurationSeconds: 1.35,
  });

  const silences = intervals.filter(({ normalizedPhone }) => normalizedPhone === 'sil');
  assert.equal(silences.length, 2);
  assert.ok(silences.every(({ source }) => source === 'silence-gap'));
  assert.equal(intervals.at(-1)?.normalizedPhone, 'sil');
  assert.equal(intervals.at(-1)?.endTime, 1.35);
});

test('invalid native duration output fails closed instead of drifting the mouth', () => {
  assert.throws(
    () => kokoroNativeDurationsToIntervals({
      text: 'Hi',
      phonemes: 'haɪ',
      modelDurationsFrames: [0, 0, 0, 0, 0],
      audioDurationSeconds: 0.4,
    }),
    /empty duration track/i,
  );
  assert.throws(
    () => kokoroNativeDurationsToIntervals({
      text: 'Hi',
      phonemes: 'haɪ',
      modelDurationsFrames: [0, 1, -1, 1, 0],
      audioDurationSeconds: 0.4,
    }),
    /non-negative finite number/i,
  );
});
