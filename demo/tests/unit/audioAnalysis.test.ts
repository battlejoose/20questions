import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeSpeechAudio,
  refinePhonemeTimelineWithAudio,
  sampleSpeechAcoustics,
  type PcmAudioLike,
} from '../../src/speech/AudioAnalysis';
import type { PhonemeInterval } from '../../src/speech/types';

function audioFromSamples(samples: Float32Array, sampleRate: number): PcmAudioLike {
  return {
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

function interval(
  phone: string,
  startTime: number,
  endTime: number,
): PhonemeInterval {
  return {
    phone,
    normalizedPhone: phone,
    startTime,
    endTime,
    word: 'pa',
    wordIndex: 0,
    source: 'estimated-from-character-alignment',
  };
}

test('analysis distinguishes voiced energy from silence without learned inference', () => {
  const sampleRate = 8_000;
  const samples = new Float32Array(sampleRate);
  for (let index = sampleRate / 2; index < samples.length; index += 1) {
    const time = index / sampleRate;
    samples[index] = Math.sin(time * Math.PI * 2 * 160) * 0.45;
  }
  const frames = analyzeSpeechAudio(audioFromSamples(samples, sampleRate));
  const silence = sampleSpeechAcoustics(frames, 0.2);
  const voice = sampleSpeechAcoustics(frames, 0.75);

  assert.ok(voice.energy > silence.energy + 0.7);
  assert.ok(voice.voicing > 0.45);
  assert.ok(voice.pitchHz > 130 && voice.pitchHz < 200);
});

test('acoustic sampling interpolates normalized frame values', () => {
  const value = sampleSpeechAcoustics(
    [
      { time: 0, energy: 0, voicing: 0, pitchHz: 0, transient: 0, highFrequency: 0 },
      { time: 1, energy: 1, voicing: 0.8, pitchHz: 200, transient: 0.6, highFrequency: 0.4 },
    ],
    0.5,
  );
  assert.equal(value.energy, 0.5);
  assert.equal(value.voicing, 0.4);
  assert.equal(value.pitchHz, 100);
  assert.equal(value.transient, 0.3);
});

test('waveform refinement moves an internal plosive release toward its transient', () => {
  const frames = Array.from({ length: 61 }, (_, index) => {
    const time = index * 0.01;
    const afterRelease = time >= 0.34;
    return {
      time,
      energy: afterRelease ? 0.9 : 0.06,
      voicing: afterRelease ? 0.75 : 0.03,
      pitchHz: afterRelease ? 150 : 0,
      transient: Math.abs(time - 0.34) < 0.006 ? 1 : 0,
      highFrequency: Math.abs(time - 0.34) < 0.02 ? 0.8 : 0.1,
    };
  });
  const refined = refinePhonemeTimelineWithAudio(
    [interval('p', 0.2, 0.3), interval('ɑ', 0.3, 0.55)],
    frames,
  );

  assert.ok(Math.abs(refined[0].endTime - 0.34) < 0.011);
  assert.equal(refined[0].endTime, refined[1].startTime);
  assert.equal(refined[0].source, 'waveform-refined');
});

test('word edges and silence intervals remain provider locked', () => {
  const frames = [
    { time: 0.1, energy: 0, voicing: 0, pitchHz: 0, transient: 0, highFrequency: 0 },
    { time: 0.2, energy: 1, voicing: 1, pitchHz: 120, transient: 1, highFrequency: 1 },
    { time: 0.3, energy: 0, voicing: 0, pitchHz: 0, transient: 0, highFrequency: 0 },
  ];
  const first = interval('ɑ', 0, 0.15);
  const silence = { ...interval('sil', 0.15, 0.25), word: null, wordIndex: null };
  const second = { ...interval('m', 0.25, 0.4), word: 'ma', wordIndex: 1 };
  const refined = refinePhonemeTimelineWithAudio([first, silence, second], frames);
  assert.deepEqual(refined, [first, silence, second]);
});

test('waveform refinement may move a duration-only Kokoro word edge', () => {
  const frames = Array.from({ length: 61 }, (_, index) => {
    const time = index * 0.01;
    const afterRelease = time >= 0.34;
    return {
      time,
      energy: afterRelease ? 0.9 : 0.04,
      voicing: afterRelease ? 0.8 : 0.02,
      pitchHz: afterRelease ? 150 : 0,
      transient: Math.abs(time - 0.34) < 0.006 ? 1 : 0,
      highFrequency: Math.abs(time - 0.34) < 0.02 ? 0.8 : 0.1,
    };
  });
  const first = {
    ...interval('p', 0.2, 0.3),
    word: 'up',
    wordIndex: 0,
    source: 'estimated-from-kokoro-phonemes' as const,
  };
  const second = {
    ...interval('ɑ', 0.3, 0.55),
    word: 'ahead',
    wordIndex: 1,
    source: 'estimated-from-kokoro-phonemes' as const,
  };
  const refined = refinePhonemeTimelineWithAudio([first, second], frames);

  assert.ok(Math.abs(refined[0].endTime - 0.34) < 0.011);
  assert.equal(refined[0].endTime, refined[1].startTime);
});
