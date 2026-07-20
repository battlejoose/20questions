import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpeechAcousticFrame } from '../../src/speech/AudioAnalysis';
import {
  CoarticulationEngine,
  poseForPhone,
  type AudioClock,
} from '../../src/speech/CoarticulationEngine';
import {
  SPEECH_RIG_TARGETS,
  type PhonemeInterval,
} from '../../src/speech/types';

class TestAudioClock implements AudioClock {
  currentTime = 0;
}

function phone(
  value: string,
  startTime: number,
  endTime: number,
  overrides: Partial<PhonemeInterval> = {},
): PhonemeInterval {
  return {
    phone: value,
    normalizedPhone: value,
    startTime,
    endTime,
    word: 'test',
    wordIndex: 0,
    source: 'estimated-from-character-alignment',
    ...overrides,
  };
}

function acousticFrame(
  time: number,
  overrides: Partial<SpeechAcousticFrame> = {},
): SpeechAcousticFrame {
  return {
    time,
    energy: 0.5,
    voicing: 0.5,
    pitchHz: 160,
    transient: 0,
    highFrequency: 0,
    ...overrides,
  };
}

test('phone poses expose independent physical jaw, lip, and tongue controls', () => {
  const bilabial = poseForPhone('m');
  assert.equal(bilabial.lipsTogether, 1);
  assert.equal(bilabial.contactBilabial, 1);
  assert.equal(bilabial.lipCompress, 0.48);

  const labiodental = poseForPhone('f');
  assert.equal(labiodental.lowerLipToTeeth, 1);
  assert.equal(labiodental.contactLabiodental, 1);

  const dental = poseForPhone('θ');
  assert.equal(dental.tongueBetweenTeeth, 0.92);
  assert.equal(dental.contactDental, 0.94);
});

test('L lateral gesture is independent from T/D/N apical contact', () => {
  const lateral = poseForPhone('l');
  assert.equal(lateral.tongueTipLateral, 1);
  assert.equal(lateral.contactLateral, 1);
  assert.equal(lateral.tongueTipUp, undefined);
  assert.equal(lateral.contactAlveolar, undefined);

  for (const value of ['t', 'd', 'n']) {
    const alveolar = poseForPhone(value);
    assert.ok((alveolar.tongueTipUp ?? 0) > 0.8);
    assert.ok((alveolar.contactAlveolar ?? 0) >= 0.9);
    assert.equal(alveolar.tongueTipLateral, undefined);
    assert.equal(alveolar.contactLateral, undefined);
  }
});

test('bilabial plosive has explicit anticipation, closure, hold, and release', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('p', 0.1, 0.2),
    phone('ɑ', 0.2, 0.5),
  ]);
  const gesture = engine.getVisemeIntervals()[0];
  assert.equal(gesture.gestureKind, 'stop');
  assert.ok((gesture.peakStartTime ?? 0) > gesture.startTime);
  assert.ok((gesture.releaseStartTime ?? 1) < gesture.endTime);

  const anticipated = engine.sampleAt(0.07);
  const held = engine.sampleAt(0.16);
  const releasing = engine.sampleAt(0.2);
  const released = engine.sampleAt(0.22);

  assert.ok(anticipated.lipsTogether > 0);
  assert.ok(held.lipsTogether > 0.99);
  assert.ok(held.contactBilabial > 0.99);
  assert.ok(held.jawOpen < 0.08);
  assert.ok(releasing.lipsTogether < held.lipsTogether);
  assert.ok(releasing.lowerLipDepress > 0);
  assert.ok(released.lipsTogether < 0.01);
});

test('plosive release pulse is brief and does not become a second plateau', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('p', 0.1, 0.2),
  ]);
  const before = engine.sampleAt(0.17);
  const burst = engine.sampleAt(0.199);
  const after = engine.sampleAt(0.225);

  assert.equal(before.lowerLipDepress, 0);
  assert.ok(burst.lowerLipDepress > 0.06);
  assert.equal(after.lowerLipDepress, 0);
  assert.equal(after.contactBilabial, 0);
});

test('diphthongs travel from their opening vowel to their closing vowel', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('aɪ', 0, 0.4),
  ]);
  const gesture = engine.getVisemeIntervals()[0];
  assert.equal(gesture.gestureKind, 'diphthong');

  const opening = engine.sampleAt(0.04);
  const middle = engine.sampleAt(0.2);
  const closing = engine.sampleAt(0.36);
  assert.ok(opening.mouthAA > 0.8);
  assert.ok(opening.mouthIH < 0.05);
  assert.ok(middle.mouthAA > 0.1 && middle.mouthIH > 0.1);
  assert.ok(closing.mouthIH > 0.78);
  assert.ok(closing.mouthAA < 0.05);
  assert.ok(opening.jawOpen > closing.jawOpen * 2.5);
  assert.ok(closing.lipStretch > opening.lipStretch);
});

test('AH and IH vowels drive their dedicated baked GNM targets', () => {
  const ah = poseForPhone('ʌ');
  const ih = poseForPhone('ɪ');
  assert.ok((ah.mouthAH ?? 0) > 0.8);
  assert.equal(ah.mouthE, undefined);
  assert.ok((ih.mouthIH ?? 0) > 0.8);
  assert.equal(ih.mouthI, undefined);
  assert.ok((poseForPhone('i').mouthI ?? 0) > 0.8);
  assert.ok((poseForPhone('ɛ').mouthE ?? 0) > 0.8);
});

test('context dominance preserves a stop contact while allowing vowel anticipation', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('u', 0, 0.12),
    phone('p', 0.12, 0.2),
    phone('i', 0.2, 0.42),
  ]);
  const closure = engine.sampleAt(0.16);
  assert.ok(closure.contactBilabial > 0.99);
  assert.ok(closure.lipsTogether > 0.99);
  assert.ok(closure.jawOpen < 0.04);
  assert.ok(closure.mouthI > 0, 'the next vowel should still be anticipated');
});

test('very short stops still reach closure and release within bounded time', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('p', 0.1, 0.13),
  ]);
  const closed = engine.sampleAt(0.115);
  const released = engine.sampleAt(0.15);
  assert.ok(closed.contactBilabial > 0.99);
  assert.ok(closed.lipsTogether > 0.99);
  assert.equal(released.contactBilabial, 0);
  assert.equal(released.lipsTogether, 0);
});

test('stress and speaking rate deterministically condition gesture strength', () => {
  const neutral = new CoarticulationEngine(new TestAudioClock(), [
    phone('ɑ', 0, 0.3),
  ]).sampleAt(0.15);
  const emphasized = new CoarticulationEngine(new TestAudioClock(), [
    phone('ɑ', 0, 0.3, { stress: 2, emphasis: 1.1, speakingRate: 0.8 }),
  ]).sampleAt(0.15);

  assert.ok(emphasized.jawOpen > neutral.jawOpen);
  assert.ok(emphasized.mouthAA > neutral.mouthAA);
});

test('waveform energy and release transients subtly condition motion', () => {
  const quietFrames = [
    acousticFrame(0, { energy: 0, voicing: 0, transient: 0 }),
    acousticFrame(1, { energy: 0, voicing: 0, transient: 0 }),
  ];
  const energeticFrames = [
    acousticFrame(0, { energy: 1, voicing: 1, transient: 1 }),
    acousticFrame(1, { energy: 1, voicing: 1, transient: 1 }),
  ];
  const quietVowel = new CoarticulationEngine(
    new TestAudioClock(),
    [phone('ɑ', 0, 0.4)],
    { acousticFrames: quietFrames },
  ).sampleAt(0.2);
  const energeticVowel = new CoarticulationEngine(
    new TestAudioClock(),
    [phone('ɑ', 0, 0.4)],
    { acousticFrames: energeticFrames },
  ).sampleAt(0.2);
  assert.ok(energeticVowel.jawOpen > quietVowel.jawOpen);
  assert.ok(energeticVowel.mouthAA > quietVowel.mouthAA);

  const quietBurst = new CoarticulationEngine(
    new TestAudioClock(),
    [phone('p', 0.1, 0.2)],
    { acousticFrames: quietFrames },
  ).sampleAt(0.199);
  const energeticBurst = new CoarticulationEngine(
    new TestAudioClock(),
    [phone('p', 0.1, 0.2)],
    { acousticFrames: energeticFrames },
  ).sampleAt(0.199);
  assert.ok(energeticBurst.lowerLipDepress > quietBurst.lowerLipDepress);
});

test('update uses distinct fast contact and slower jaw dynamics on Web Audio time', () => {
  const clock = new TestAudioClock();
  const engine = new CoarticulationEngine(clock, [phone('f', 0, 0.3)]);
  engine.startAt(0);
  clock.currentTime = 0.01;
  const current = engine.update();
  const target = engine.sampleAt(0.01);

  const contactProgress = current.contactLabiodental / target.contactLabiodental;
  const jawProgress = current.jawOpen / target.jawOpen;
  assert.ok(contactProgress > jawProgress * 2);
  assert.ok(current.contactLabiodental > 0);
  assert.ok(current.jawOpen > 0);
});

test('scheduled playback uses pre-roll for anticipatory motion', () => {
  const clock = new TestAudioClock();
  clock.currentTime = 4;
  const engine = new CoarticulationEngine(clock, [phone('u', 0, 0.3)]);
  engine.startAt(4.1);

  clock.currentTime = 4.04;
  const weights = engine.update();
  assert.ok(weights.lipPucker > 0);
});

test('all sampled rig weights remain finite and in the normalized range', () => {
  const engine = new CoarticulationEngine(new TestAudioClock(), [
    phone('aɪ', 0, 0.24, { stress: 2, emphasis: 1.2 }),
    phone('p', 0.24, 0.28),
    phone('f', 0.28, 0.34),
    phone('θ', 0.34, 0.4),
    phone('l', 0.4, 0.47),
    phone('t', 0.47, 0.52),
    phone('s', 0.52, 0.62),
    phone('k', 0.62, 0.69),
    phone('u', 0.69, 0.9),
  ]);

  for (let time = -0.15; time <= 1.1; time += 0.0025) {
    const weights = engine.sampleAt(time);
    for (const target of SPEECH_RIG_TARGETS) {
      assert.ok(Number.isFinite(weights[target]), `${target} is finite at ${time}`);
      assert.ok(weights[target] >= 0, `${target} is non-negative at ${time}`);
      assert.ok(weights[target] <= 1, `${target} is <= 1 at ${time}`);
    }
  }
});
