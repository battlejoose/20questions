import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpeechAcousticFrame } from '../../src/speech/AudioAnalysis';
import type { AudioClock } from '../../src/speech/CoarticulationEngine';
import {
  ExpressivePerformanceController,
  calibrateExpressionIntensity,
  inferTextAffect,
  normalizePitchHz,
  planExpressivePerformance,
  protectSmileForOralContact,
  robustPitchStatistics,
  sampleSemanticAffectEnvelope,
  speechCompatibleExpressionWeight,
  suppressCompetingExpression,
  type ExpressivePerformanceInput,
} from '../../src/speech/ExpressivePerformanceController';
import type { PhonemeInterval } from '../../src/speech/types';

class TestClock implements AudioClock {
  currentTime = 0;
}

function frame(
  time: number,
  overrides: Partial<SpeechAcousticFrame> = {},
): SpeechAcousticFrame {
  return {
    time,
    energy: 0.35,
    voicing: 0.75,
    pitchHz: 150,
    transient: 0.05,
    highFrequency: 0.2,
    ...overrides,
  };
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
    source: 'estimated-from-local-phonemes',
    ...overrides,
  };
}

function acousticTrack(durationSeconds = 5): SpeechAcousticFrame[] {
  const result: SpeechAcousticFrame[] = [];
  for (let time = 0; time <= durationSeconds; time += 0.05) {
    const firstPeak = Math.exp(-((time - 1.1) ** 2) / 0.025);
    const secondPeak = Math.exp(-((time - 3.15) ** 2) / 0.035);
    const peak = Math.max(firstPeak, secondPeak);
    result.push(frame(time, {
      energy: 0.25 + peak * 0.7,
      pitchHz: 135 + peak * 85,
      transient: peak * 0.75,
      voicing: 0.82,
    }));
  }
  return result;
}

function input(overrides: Partial<ExpressivePerformanceInput> = {}): ExpressivePerformanceInput {
  return {
    text: 'This is good, and this is important.',
    durationSeconds: 5,
    acousticFrames: acousticTrack(),
    phonemes: [
      phone('ð', 0, 1.8, { stress: 1 }),
      phone('sil', 1.8, 2.12),
      phone('ɑ', 2.12, 5, { stress: 2 }),
    ],
    seed: 42,
    ...overrides,
  };
}

function advance(
  controller: ExpressivePerformanceController,
  clock: TestClock,
  to: number,
  step = 1 / 60,
): void {
  while (clock.currentTime + step < to) {
    clock.currentTime += step;
    controller.update();
  }
  clock.currentTime = to;
  controller.update();
}

test('pitch normalization is robust to unvoiced frames and extreme outliers', () => {
  const frames = [
    frame(0, { pitchHz: 0, voicing: 0 }),
    frame(0.1, { pitchHz: 105 }),
    frame(0.2, { pitchHz: 145 }),
    frame(0.3, { pitchHz: 165 }),
    frame(0.4, { pitchHz: 205 }),
    frame(0.5, { pitchHz: 1_200 }),
  ];
  const statistics = robustPitchStatistics(frames);
  assert.ok(statistics.medianHz >= 140 && statistics.medianHz <= 170);
  assert.ok(normalizePitchHz(105, statistics) < 0.5);
  assert.ok(normalizePitchHz(205, statistics) > 0.5);
  assert.equal(normalizePitchHz(0, statistics), 0.5);
});

test('plain text intent remains conservative and deterministic', () => {
  assert.equal(inferTextAffect('The result is ready.'), 'neutral');
  assert.equal(inferTextAffect('Would you like another example?'), 'question');
  assert.equal(inferTextAffect('Yes, that is wonderful. Thanks!'), 'warm');
  assert.equal(inferTextAffect('Sorry, there is a risk we should consider.'), 'concerned');
  assert.equal(inferTextAffect('This is absolutely important!'), 'emphatic');
});

test('the same seed produces the same sparse performance schedule', () => {
  const first = planExpressivePerformance(input());
  const second = planExpressivePerformance(input());
  assert.deepEqual(first.cues, second.cues);
  assert.deepEqual(first.blinks, second.blinks);
  assert.deepEqual(first.boundaries, second.boundaries);
  assert.equal(first.affect, second.affect);
  assert.equal(first.seed, second.seed);
});

test('typed model intent wins over ambiguous prose and remains observable', () => {
  const plan = planExpressivePerformance(input({
    text: 'I can provide that information.',
    performanceIntent: {
      affect: 'surprise',
      intensity: 0.91,
      discourseAct: 'statement',
      confidence: 0.9,
      source: 'llm-directive',
    },
  }));
  assert.equal(plan.affect, 'surprise');
  assert.equal(plan.intentSource, 'llm-directive');
  assert.equal(plan.intentConfidence, 0.9);
  assert.ok(plan.intensity >= 0.91);
});

test('perceptual intensity adds contrast without losing bounded model control', () => {
  assert.equal(calibrateExpressionIntensity(0), 0);
  assert.ok(calibrateExpressionIntensity(0.3) >= 0.28);
  assert.ok(calibrateExpressionIntensity(0.85) > 0.94);
  assert.equal(calibrateExpressionIntensity(1), 1);
  assert.equal(calibrateExpressionIntensity(3), 1);
});

test('semantic affect is an impulse with an apex, decay, and restrained residue', () => {
  const surprise = planExpressivePerformance(input({
    performanceIntent: {
      affect: 'surprise',
      intensity: 0.9,
      discourseAct: 'statement',
      confidence: 1,
      source: 'llm-directive',
    },
  }));
  const envelope = surprise.affectEnvelope;
  assert.equal(sampleSemanticAffectEnvelope(envelope, envelope.apexTime), 1);
  assert.ok(
    sampleSemanticAffectEnvelope(envelope, envelope.releaseEndTime + 0.2) <= 0.06,
  );
  assert.ok(envelope.apexTime < 0.5);
  assert.ok(envelope.releaseEndTime < 1.2);
});

test('affect anticipates audio and is already legible at the first phoneme', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input({
    performanceIntent: {
      affect: 'warm',
      intensity: 0.88,
      discourseAct: 'appreciation',
      confidence: 1,
      source: 'contextual-fallback',
    },
  }));
  controller.startAt(0.06);
  const anticipation = controller.update();
  assert.equal(anticipation.diagnostics.envelopePhase, 'anticipation');
  assert.ok(anticipation.morphs.cheekRaise > 0.02);
  clock.currentTime = 0.06;
  const firstPhoneme = controller.update();
  assert.equal(firstPhoneme.diagnostics.envelopePhase, 'active');
  assert.ok(firstPhoneme.diagnostics.maximumMorphWeight > 0.04);
});

test('all speaking affects resolve to distinct, perceptible whole-face signatures', () => {
  const intents = [
    ['warm', 'appreciation'],
    ['surprise', 'statement'],
    ['question', 'question'],
    ['concerned', 'warning'],
    ['emphatic', 'affirmation'],
  ] as const;
  const signatures = new Map<string, string>();
  const expectedMouthTarget = {
    warm: 'smileMouth',
    surprise: 'surpriseMouth',
    question: 'curiosityMouth',
    concerned: 'concernMouth',
    emphatic: 'emphasisMouth',
  } as const;
  for (const [affect, discourseAct] of intents) {
    const clock = new TestClock();
    const controller = new ExpressivePerformanceController(clock);
    controller.prepare(input({
      performanceIntent: {
        affect,
        intensity: 0.9,
        discourseAct,
        confidence: 1,
        source: 'contextual-fallback',
      },
    }));
    const plan = controller.getPlan();
    assert.ok(plan);
    controller.startAt(0);
    advance(controller, clock, Math.min(4.7, plan.affectEnvelope.apexTime + 0.2));
    const sampled = controller.update();
    assert.ok(
      sampled.diagnostics.maximumMorphWeight >= 0.25,
      `${affect} maximum was ${sampled.diagnostics.maximumMorphWeight}`,
    );
    const mouthTarget = expectedMouthTarget[affect];
    assert.ok(
      sampled.morphs[mouthTarget] >= 0.16,
      `${affect} ${mouthTarget} was ${sampled.morphs[mouthTarget]}`,
    );
    const signature = [
      sampled.morphs.browConcern,
      sampled.morphs.browLift,
      sampled.morphs.browFurrow,
      sampled.morphs.eyeWiden,
      sampled.morphs.eyeSquint,
      sampled.morphs.cheekRaise,
      sampled.morphs.smile,
      sampled.morphs.smileMouth,
      sampled.morphs.surpriseMouth,
      sampled.morphs.concernMouth,
      sampled.morphs.curiosityMouth,
      sampled.morphs.emphasisMouth,
    ].map((value) => value.toFixed(2)).join(',');
    assert.equal(signatures.has(signature), false, `${affect} duplicated ${signature}`);
    signatures.set(signature, affect);
  }
});

test('a strong surprise visibly decays instead of becoming a sustained pose', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  const plan = controller.prepare(input({
    performanceIntent: {
      affect: 'surprise',
      intensity: 0.95,
      discourseAct: 'statement',
      confidence: 1,
      source: 'llm-directive',
    },
  }));
  controller.startAt(0);
  advance(controller, clock, plan.affectEnvelope.apexTime + 0.22);
  const peak = controller.update().diagnostics.maximumMorphWeight;
  advance(controller, clock, plan.affectEnvelope.releaseEndTime + 0.65);
  const residue = controller.update().diagnostics.maximumMorphWeight;
  assert.ok(peak > 0.35);
  assert.ok(residue < peak * 0.4, `${residue} should decay below ${peak}`);
  assert.equal(controller.update().diagnostics.envelopePhase, 'residue');
});

test('repeated sentence affect is attenuated until the semantic affect changes', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.setConversationState('thinking');
  const intent = {
    affect: 'warm' as const,
    intensity: 0.9,
    discourseAct: 'appreciation' as const,
    confidence: 1,
    source: 'llm-directive' as const,
  };
  const first = controller.prepare(input({ performanceIntent: intent })).intensity;
  const repeated = controller.prepare(input({ performanceIntent: intent })).intensity;
  const changed = controller.prepare(input({
    performanceIntent: { ...intent, affect: 'surprise' },
  })).intensity;
  assert.ok(repeated < first * 0.85);
  assert.ok(changed > repeated);
});

test('prominence cues are sparse with brow anticipation and head follow-through', () => {
  const plan = planExpressivePerformance(input());
  assert.ok(plan.cues.length >= 2);
  for (let index = 1; index < plan.cues.length; index += 1) {
    assert.ok(plan.cues[index].time - plan.cues[index - 1].time >= 0.48);
  }
  for (const cue of plan.cues) {
    assert.ok(cue.browTime < cue.time);
    assert.ok(cue.headTime > cue.time);
    assert.ok(cue.strength >= 0.2 && cue.strength <= 1);
  }
});

test('blink planning prefers phrase pauses and retains natural asymmetry', () => {
  const plan = planExpressivePerformance(input());
  const pauseBlink = plan.blinks.find((blink) => blink.boundaryPreferred);
  assert.ok(pauseBlink);
  assert.ok(plan.boundaries.some((boundary) => Math.abs(boundary - pauseBlink.time) < 0.08));
  assert.ok(
    pauseBlink.leftStrength !== pauseBlink.rightStrength || pauseBlink.rightDelay !== 0,
  );

  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input());
  controller.startAt(0);
  clock.currentTime = pauseBlink.time + 0.052;
  const sampled = controller.update();
  assert.ok(Math.max(sampled.morphs.blinkLeft, sampled.morphs.blinkRight) > 0.9);
});

test('thinking averts gaze, listening restores it, and the head follows the eyes', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.setConversationState('thinking');
  advance(controller, clock, 0.8);
  const thinkingGaze = controller.update().morphs.gazeLeft;
  const thinkingHead = controller.update().headYaw;
  assert.ok(thinkingGaze > 0.25);
  assert.ok(thinkingHead < -0.01);

  controller.setConversationState('listening');
  advance(controller, clock, 1.6);
  const listening = controller.update();
  assert.ok(listening.morphs.gazeLeft < thinkingGaze * 0.25);
  assert.ok(Math.abs(listening.headYaw) < Math.abs(thinkingHead) * 0.35);
});

test('speaking gaze returns to the viewer before the utterance ends', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input({ durationSeconds: 3 }));
  controller.setConversationState('speaking');
  controller.startAt(0);
  advance(controller, clock, 0.16);
  const openingGaze = Math.max(
    controller.update().morphs.gazeLeft,
    controller.update().morphs.gazeRight,
  );
  advance(controller, clock, 2.75);
  const closingGaze = Math.max(
    controller.update().morphs.gazeLeft,
    controller.update().morphs.gazeRight,
  );
  assert.ok(openingGaze > 0.015);
  assert.ok(closingGaze < openingGaze * 0.35);
});

test('affect transitions remain continuous across streamed clauses', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input({ text: 'Yes, this is wonderful!' }));
  controller.startAt(0);
  advance(controller, clock, 1.1);
  const warmSmile = controller.update().morphs.smileMouth;
  assert.ok(warmSmile > 0.045);

  controller.prepare(input({ text: 'The next clause is neutral.', seed: 43 }));
  controller.startAt(1.15);
  clock.currentTime = 1.15;
  const firstNeutralFrame = controller.update().morphs.smileMouth;
  assert.ok(firstNeutralFrame > 0.025, 'the new clause must not snap to neutral');
  assert.ok(firstNeutralFrame <= warmSmile);
});

test('interruption immediately clears speech-linked expression and pose', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.performAction({
    gesture: 'smile', intensity: 0.8, onset: 'immediate', holdSeconds: 2,
    releaseSeconds: 0.5, valence: 0.7, arousal: 0.2, dominance: 0,
    source: 'llm-directive',
  });
  controller.prepare(input({ text: 'Would you like to continue?' }));
  controller.setConversationState('speaking');
  controller.startAt(0);
  advance(controller, clock, 1);
  assert.ok(controller.update().morphs.browLift > 0.05);
  controller.setConversationState('interrupted');
  const reset = controller.update();
  assert.equal(reset.diagnostics.cueCount, 0);
  assert.equal(reset.diagnostics.actionGesture, 'none');
  assert.equal(reset.diagnostics.actionPhase, 'idle');
  assert.ok(reset.morphs.browLift < 0.001);
  assert.ok(Math.abs(reset.headYaw) < 0.001);
  assert.ok(Math.abs(reset.headPitch) < 0.001);
});

test('reduced motion preserves restrained affect but suppresses gaze, head beats, and blinks', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.setReducedMotion(true);
  controller.setConversationState('thinking');
  controller.prepare(input({ text: 'Yes, this is wonderful!' }));
  controller.startAt(0);
  advance(controller, clock, 1.2);
  const sampled = controller.update();
  assert.ok(sampled.morphs.smileMouth > 0.08);
  assert.equal(sampled.morphs.gazeLeft, 0);
  assert.equal(sampled.morphs.gazeRight, 0);
  assert.equal(sampled.morphs.blinkLeft, 0);
  assert.equal(sampled.morphs.blinkRight, 0);
  assert.equal(sampled.headPitch, 0);
  assert.equal(sampled.headYaw, 0);
});

test('an immediate LLM smile action performs before speech and releases naturally', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.setConversationState('thinking');
  controller.performAction({
    gesture: 'smile',
    intensity: 0.86,
    onset: 'immediate',
    holdSeconds: 1.1,
    releaseSeconds: 0.65,
    valence: 0.8,
    arousal: 0.25,
    dominance: 0.05,
    source: 'llm-directive',
  });
  advance(controller, clock, 0.85);
  const performed = controller.update();
  assert.equal(performed.diagnostics.actionGesture, 'smile');
  assert.equal(performed.diagnostics.actionPhase, 'hold');
  assert.ok(performed.morphs.smileMouth > 0.45);
  assert.ok(performed.morphs.cheekRaise > 0.5);
  const performedSmile = performed.morphs.smileMouth;

  advance(controller, clock, 3.1);
  const released = controller.update();
  assert.equal(released.diagnostics.actionGesture, 'none');
  assert.equal(released.diagnostics.actionPhase, 'idle');
  assert.ok(released.morphs.smileMouth < performedSmile * 0.25);
});

test('a speech-onset action waits for the shared audio clock', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.performAction({
    gesture: 'surprise',
    intensity: 0.9,
    onset: 'speech',
    holdSeconds: 0.45,
    releaseSeconds: 0.5,
    valence: 0.15,
    arousal: 0.8,
    dominance: 0,
    source: 'llm-directive',
  });
  advance(controller, clock, 0.5);
  const waiting = controller.update();
  assert.equal(waiting.diagnostics.actionPhase, 'waiting');
  assert.ok(waiting.morphs.eyeWiden < 0.01);

  controller.prepare(input({ text: 'Now watch this.', durationSeconds: 2 }));
  controller.startAt(0.65);
  advance(controller, clock, 0.88);
  const active = controller.update();
  assert.equal(active.diagnostics.actionGesture, 'surprise');
  assert.ok(active.morphs.eyeWiden > 0.3);
  assert.ok(active.morphs.browLift > 0.25);
});

test('LLM nod uses a readable primary cycle, rebound, and smaller declined cycle', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.performAction({
    gesture: 'nod',
    intensity: 0.9,
    onset: 'immediate',
    holdSeconds: 0.8,
    releaseSeconds: 0.4,
    valence: 0,
    arousal: 0,
    dominance: 0.4,
    source: 'llm-directive',
  });
  let primaryDown = 0;
  let rebound = 0;
  let secondDown = 0;
  for (let index = 0; index <= 120; index += 1) {
    clock.currentTime = index / 120;
    const sampled = controller.update();
    if (clock.currentTime <= 0.39) primaryDown = Math.min(primaryDown, sampled.headPitch);
    if (clock.currentTime >= 0.39 && clock.currentTime <= 0.53) {
      rebound = Math.max(rebound, sampled.headPitch);
    }
    if (clock.currentTime >= 0.52 && clock.currentTime <= 0.7) {
      secondDown = Math.min(secondDown, sampled.headPitch);
    }
    assert.ok(Math.abs(sampled.headYaw) < 0.01);
    assert.ok(sampled.morphs.smileMouth < 0.02);
  }
  assert.ok(primaryDown < -0.06, `primary nod peak was ${primaryDown}`);
  assert.ok(rebound > 0.018, `nod rebound was ${rebound}`);
  assert.ok(secondDown < -0.025, `second nod peak was ${secondDown}`);
  assert.ok(Math.abs(secondDown) < Math.abs(primaryDown));
  assert.ok(Math.abs(controller.update().headPitch) < 0.02);
});

test('LLM shake crosses both sides visibly and settles with a smaller final cycle', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.performAction({
    gesture: 'shake', intensity: 0.9, onset: 'immediate', holdSeconds: 0.9,
    releaseSeconds: 0.35, valence: -0.1, arousal: 0.3, dominance: 0.4,
    source: 'llm-directive',
  });
  let left = 0;
  let right = 0;
  let finalCycle = 0;
  for (let index = 0; index <= 132; index += 1) {
    clock.currentTime = index / 120;
    const yaw = controller.update().headYaw;
    left = Math.min(left, yaw);
    right = Math.max(right, yaw);
    if (clock.currentTime >= 0.63 && clock.currentTime <= 0.86) {
      finalCycle = Math.max(finalCycle, Math.abs(yaw));
    }
  }
  assert.ok(left < -0.065, `left shake peak was ${left}`);
  assert.ok(right > 0.055, `right shake peak was ${right}`);
  assert.ok(finalCycle < Math.max(Math.abs(left), right) * 0.8);
  assert.ok(Math.abs(controller.update().headYaw) < 0.02);
});

test('the compositor bounds conflicts and gives oral contacts priority', () => {
  assert.equal(protectSmileForOralContact(2, 0), 1);
  assert.ok(Math.abs(protectSmileForOralContact(0.8, 1) - 0.144) < 1e-9);
  assert.equal(protectSmileForOralContact(-1, 0.5), 0);
  assert.ok(Math.abs(speechCompatibleExpressionWeight(0.8, 1, 0.12) - 0.096) < 1e-9);
  assert.ok(Math.abs(speechCompatibleExpressionWeight(0.8, 1, 0.04) - 0.032) < 1e-9);
  assert.equal(suppressCompetingExpression(1, 1, 0.75), 0.25);
  assert.ok(suppressCompetingExpression(0.8, 0.4, 0.5) < 0.8);
});

test('every sampled performance value stays finite and bounded', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input({ text: 'Sorry, but would this work? It absolutely must!' }));
  controller.performAction({
    gesture: 'surprise', intensity: 1, onset: 'immediate', holdSeconds: 2,
    releaseSeconds: 0.5, valence: -0.3, arousal: 1, dominance: 0.6,
    source: 'llm-directive',
  });
  controller.setConversationState('speaking');
  controller.startAt(0);
  for (let index = 0; index < 800; index += 1) {
    clock.currentTime = index / 120;
    const sampled = controller.update();
    for (const value of Object.values(sampled.morphs)) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= 0 && value <= 1);
    }
    for (const value of [sampled.headPitch, sampled.headYaw, sampled.headRoll]) {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) <= 0.161);
    }
  }
});

test('allocation-free frame sampling remains below the 0.2 ms budget', () => {
  const clock = new TestClock();
  const controller = new ExpressivePerformanceController(clock);
  controller.prepare(input());
  controller.startAt(0);
  const startedAt = performance.now();
  for (let index = 0; index < 40_000; index += 1) {
    clock.currentTime = index / 120;
    controller.update();
  }
  const averageMs = (performance.now() - startedAt) / 40_000;
  assert.ok(averageMs < 0.2, `average sampler time was ${averageMs.toFixed(4)} ms`);
});
