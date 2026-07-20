import type { SpeechAcousticFrame } from './AudioAnalysis';
import type { AudioClock } from './CoarticulationEngine';
import type { PhonemeInterval } from './types';
import {
  inferPerformanceIntent,
  type PerformanceAction,
  type PerformanceAffect,
  type PerformanceDiscourseAct,
  type PerformanceIntent,
  type PerformanceIntentSource,
} from './PerformanceIntent';

export type ExpressiveAffect = PerformanceAffect;

export type ConversationalPerformanceState =
  | 'unsupported'
  | 'installing'
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export const EXPRESSIVE_MORPH_TARGETS = [
  'blinkLeft',
  'blinkRight',
  'eyeOpen',
  'browConcern',
  'smile',
  'browLift',
  'browLiftLeft',
  'browLiftRight',
  'browFurrow',
  'eyeWiden',
  'eyeSquint',
  'cheekRaise',
  'smileMouth',
  'surpriseMouth',
  'concernMouth',
  'curiosityMouth',
  'emphasisMouth',
  'gazeLeft',
  'gazeRight',
  'gazeUp',
  'gazeDown',
] as const;

export type ExpressiveMorphTarget = (typeof EXPRESSIVE_MORPH_TARGETS)[number];
export type ExpressiveMorphWeights = Record<ExpressiveMorphTarget, number>;

export interface PitchStatistics {
  lowHz: number;
  medianHz: number;
  highHz: number;
}

export interface ProsodicCue {
  readonly time: number;
  readonly strength: number;
  /** Brows anticipate the acoustic prominence. */
  readonly browTime: number;
  /** Head response intentionally follows the acoustic prominence. */
  readonly headTime: number;
  readonly direction: -1 | 1;
}

export interface BlinkCue {
  readonly time: number;
  readonly leftStrength: number;
  readonly rightStrength: number;
  readonly rightDelay: number;
  readonly boundaryPreferred: boolean;
  readonly doubleBlink: boolean;
}

export interface ExpressiveAffectTargets {
  readonly browConcern: number;
  readonly browLift: number;
  readonly browFurrow: number;
  readonly eyeWiden: number;
  readonly eyeSquint: number;
  readonly cheekRaise: number;
  readonly smile: number;
  readonly smileMouth: number;
  readonly surpriseMouth: number;
  readonly concernMouth: number;
  readonly curiosityMouth: number;
  readonly emphasisMouth: number;
}

export interface SemanticAffectEnvelope {
  /** The visible reaction may begin just before the first phoneme. */
  readonly onsetTime: number;
  readonly apexTime: number;
  readonly releaseEndTime: number;
  /** Restrained tone that remains while the sentence continues. */
  readonly baseline: number;
  /** Small residual after the expressive impulse has decayed. */
  readonly residue: number;
}

export interface ExpressivePerformancePlan {
  readonly seed: number;
  readonly durationSeconds: number;
  readonly affect: ExpressiveAffect;
  readonly intensity: number;
  readonly discourseAct: PerformanceDiscourseAct;
  readonly intentSource: PerformanceIntentSource;
  readonly intentConfidence: number;
  readonly affectTargets: ExpressiveAffectTargets;
  readonly affectEnvelope: SemanticAffectEnvelope;
  readonly asymmetryDirection: -1 | 1;
  readonly pitch: PitchStatistics;
  readonly cues: readonly ProsodicCue[];
  readonly blinks: readonly BlinkCue[];
  readonly boundaries: readonly number[];
  readonly plannerMs: number;
}

export interface ExpressivePerformanceInput {
  readonly text: string;
  readonly phonemes: readonly PhonemeInterval[];
  readonly acousticFrames: readonly SpeechAcousticFrame[];
  readonly durationSeconds: number;
  readonly performanceIntent?: PerformanceIntent;
  readonly userText?: string;
  readonly seed?: number;
}

export interface ExpressivePerformanceDiagnostics {
  affect: ExpressiveAffect;
  intensity: number;
  discourseAct: PerformanceDiscourseAct;
  intentSource: PerformanceIntentSource;
  intentConfidence: number;
  envelopePhase: 'idle' | 'anticipation' | 'active' | 'release' | 'residue' | 'ended';
  maximumMorphWeight: number;
  gazeState: ConversationalPerformanceState;
  blinkPhase: 'open' | 'closing' | 'closed' | 'opening';
  cueCount: number;
  plannerMs: number;
  speechTime: number;
  actionGesture: PerformanceAction['gesture'];
  actionPhase: 'idle' | 'waiting' | 'attack' | 'hold' | 'release';
}

export interface ExpressivePerformanceFrame {
  readonly morphs: ExpressiveMorphWeights;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  readonly diagnostics: ExpressivePerformanceDiagnostics;
}

const SILENCE_PHONES = new Set(['sil', 'sp', 'pau']);
const AFFECT_ANTICIPATION_SECONDS = 0.18;

const AFFECT_TARGETS: Record<ExpressiveAffect, ExpressiveAffectTargets> = {
  neutral: {
    browConcern: 0.035,
    browLift: 0,
    browFurrow: 0,
    eyeWiden: 0,
    eyeSquint: 0,
    cheekRaise: 0,
    smile: 0,
    smileMouth: 0,
    surpriseMouth: 0,
    concernMouth: 0,
    curiosityMouth: 0,
    emphasisMouth: 0,
  },
  warm: {
    browConcern: 0.012,
    browLift: 0.18,
    browFurrow: 0,
    eyeWiden: 0.025,
    eyeSquint: 0.24,
    cheekRaise: 0.82,
    smile: 0,
    smileMouth: 0.72,
    surpriseMouth: 0,
    concernMouth: 0,
    curiosityMouth: 0,
    emphasisMouth: 0,
  },
  surprise: {
    browConcern: 0,
    browLift: 0.88,
    browFurrow: 0,
    eyeWiden: 0.92,
    eyeSquint: 0,
    cheekRaise: 0.08,
    smile: 0,
    smileMouth: 0,
    surpriseMouth: 0.62,
    concernMouth: 0,
    curiosityMouth: 0,
    emphasisMouth: 0,
  },
  question: {
    browConcern: 0.02,
    browLift: 0.62,
    browFurrow: 0,
    eyeWiden: 0.36,
    eyeSquint: 0,
    cheekRaise: 0.07,
    smile: 0,
    smileMouth: 0,
    surpriseMouth: 0,
    concernMouth: 0,
    curiosityMouth: 0.38,
    emphasisMouth: 0,
  },
  concerned: {
    browConcern: 0.68,
    browLift: 0.16,
    browFurrow: 0.55,
    eyeWiden: 0,
    eyeSquint: 0.23,
    cheekRaise: 0.05,
    smile: 0,
    smileMouth: 0,
    surpriseMouth: 0,
    concernMouth: 0.58,
    curiosityMouth: 0,
    emphasisMouth: 0,
  },
  emphatic: {
    browConcern: 0.15,
    browLift: 0,
    browFurrow: 0.72,
    eyeWiden: 0,
    eyeSquint: 0.22,
    cheekRaise: 0.05,
    smile: 0,
    smileMouth: 0,
    surpriseMouth: 0,
    concernMouth: 0,
    curiosityMouth: 0,
    emphasisMouth: 0.46,
  },
};

const ACTION_AFFECT: Readonly<Partial<Record<PerformanceAction['gesture'], ExpressiveAffect>>> = {
  smile: 'warm',
  surprise: 'surprise',
  concern: 'concerned',
  curiosity: 'question',
  emphasis: 'emphatic',
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Retains the compatible part of a slower expression during a speech contact.
 * A closed-lip smile can keep its corners and cheeks; a surprised jaw drop
 * cannot. The caller supplies the target-specific retention instead of
 * suppressing every full-face expression by the same amount.
 */
export function speechCompatibleExpressionWeight(
  weight: number,
  contact: number,
  retentionAtFullContact: number,
): number {
  return clamp01(weight) * (
    1 - clamp01(contact) * (1 - clamp01(retentionAtFullContact))
  );
}

/** Legacy compatibility helper for the old coupled smile target. */
export function protectSmileForOralContact(smile: number, contact: number): number {
  return speechCompatibleExpressionWeight(smile, contact, 0.18);
}

/** Perceptual rather than linear mapping, model-independent by design. */
export function calibrateExpressionIntensity(intensity: number): number {
  const value = clamp01(intensity);
  if (value <= 0) return 0;
  const contrasted = clamp01(0.5 + (value - 0.5) * 1.3);
  return clamp01(Math.pow(contrasted, 0.82) * 1.03);
}

/** Keeps anatomically competing upper-face shapes bounded without hard switching. */
export function suppressCompetingExpression(
  secondary: number,
  primary: number,
  suppression: number,
): number {
  return clamp01(secondary) * (1 - clamp01(primary) * clamp01(suppression));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((first, second) => first - second);
  const position = clamp01(fraction) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function nearestBoundary(
  boundaries: readonly number[],
  time: number,
  maximumDistance: number,
): number | undefined {
  let nearest: number | undefined;
  let distance = maximumDistance;
  for (const boundary of boundaries) {
    const candidateDistance = Math.abs(boundary - time);
    if (candidateDistance <= distance) {
      nearest = boundary;
      distance = candidateDistance;
    }
  }
  return nearest;
}

function activePhonemeStress(
  phonemes: readonly PhonemeInterval[],
  time: number,
  cursor: { index: number },
): number {
  while (
    cursor.index < phonemes.length - 1 &&
    phonemes[cursor.index].endTime < time
  ) {
    cursor.index += 1;
  }
  const phone = phonemes[cursor.index];
  if (!phone || time < phone.startTime || time > phone.endTime) return 0;
  const stress = phone.stress === 2 ? 1 : phone.stress === 1 ? 0.58 : 0;
  const emphasis = clamp((phone.emphasis ?? 1) - 1, 0, 0.35) / 0.35;
  return Math.max(stress, emphasis);
}

function deduplicateTimes(times: number[], durationSeconds: number): number[] {
  times.sort((first, second) => first - second);
  const result: number[] = [];
  for (const value of times) {
    const bounded = clamp(value, 0, durationSeconds);
    const previous = result[result.length - 1];
    if (previous === undefined || bounded - previous > 0.09) result.push(bounded);
  }
  return result;
}

function collectBoundaries(
  text: string,
  phonemes: readonly PhonemeInterval[],
  durationSeconds: number,
): number[] {
  const times: number[] = [];
  for (let index = 0; index < phonemes.length; index += 1) {
    const phone = phonemes[index];
    if (SILENCE_PHONES.has(phone.normalizedPhone) && phone.endTime - phone.startTime >= 0.08) {
      times.push((phone.startTime + phone.endTime) * 0.5);
    }
    const next = phonemes[index + 1];
    if (next && next.startTime - phone.endTime >= 0.11) {
      times.push((phone.endTime + next.startTime) * 0.5);
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    if (!/[,:;.!?]/u.test(text[index])) continue;
    const fraction = (index + 1) / Math.max(1, text.length);
    times.push(fraction * durationSeconds);
  }
  return deduplicateTimes(times, durationSeconds).filter(
    (time) => time >= 0.28 && time <= durationSeconds - 0.12,
  );
}

export function inferTextAffect(text: string): ExpressiveAffect {
  return inferPerformanceIntent({ assistantText: text }).affect;
}

export function robustPitchStatistics(
  frames: readonly SpeechAcousticFrame[],
): PitchStatistics {
  const voicedPitch: number[] = [];
  for (const frame of frames) {
    if (frame.voicing >= 0.28 && frame.pitchHz >= 55 && frame.pitchHz <= 520) {
      voicedPitch.push(frame.pitchHz);
    }
  }
  if (voicedPitch.length === 0) return { lowHz: 90, medianHz: 160, highHz: 260 };
  const medianHz = percentile(voicedPitch, 0.5);
  const lowHz = Math.min(medianHz, percentile(voicedPitch, 0.18));
  const highHz = Math.max(medianHz, percentile(voicedPitch, 0.82));
  return {
    lowHz,
    medianHz,
    highHz: highHz <= lowHz + 2 ? lowHz + 2 : highHz,
  };
}

export function normalizePitchHz(value: number, statistics: PitchStatistics): number {
  if (!Number.isFinite(value) || value <= 0) return 0.5;
  if (value <= statistics.medianHz) {
    return 0.5 * clamp01(
      (value - statistics.lowHz) /
      Math.max(1, statistics.medianHz - statistics.lowHz),
    );
  }
  return 0.5 + 0.5 * clamp01(
    (value - statistics.medianHz) /
    Math.max(1, statistics.highHz - statistics.medianHz),
  );
}

function planProsodicCues(
  frames: readonly SpeechAcousticFrame[],
  phonemes: readonly PhonemeInterval[],
  pitch: PitchStatistics,
  seed: number,
): ProsodicCue[] {
  if (frames.length < 3) return [];
  const stressCursor = { index: 0 };
  const scores = new Float32Array(frames.length);
  let maximumIndex = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const pitchHeight = frame.voicing > 0.25
      ? normalizePitchHz(frame.pitchHz, pitch)
      : 0.35;
    const stress = activePhonemeStress(phonemes, frame.time, stressCursor);
    scores[index] = clamp01(
      frame.energy * 0.39 +
      pitchHeight * frame.voicing * 0.24 +
      frame.transient * 0.17 +
      frame.voicing * 0.1 +
      stress * 0.16,
    );
    if (scores[index] > scores[maximumIndex]) maximumIndex = index;
  }
  const scoreValues = Array.from(scores);
  const threshold = Math.max(0.54, percentile(scoreValues, 0.72));
  const candidates: Array<{ index: number; score: number }> = [];
  for (let index = 1; index < frames.length - 1; index += 1) {
    if (
      scores[index] >= threshold &&
      scores[index] >= scores[index - 1] &&
      scores[index] >= scores[index + 1] &&
      frames[index].energy >= 0.22
    ) {
      candidates.push({ index, score: scores[index] });
    }
  }
  if (candidates.length === 0 && scores[maximumIndex] >= 0.4) {
    candidates.push({ index: maximumIndex, score: scores[maximumIndex] });
  }
  candidates.sort((first, second) => second.score - first.score);
  const selected: Array<{ index: number; score: number }> = [];
  for (const candidate of candidates) {
    const time = frames[candidate.index].time;
    if (selected.some((item) => Math.abs(frames[item.index].time - time) < 0.48)) continue;
    selected.push(candidate);
  }
  selected.sort((first, second) => frames[first.index].time - frames[second.index].time);
  return selected.map((candidate, index) => {
    const time = frames[candidate.index].time;
    const direction: -1 | 1 = ((seed + index) & 1) === 0 ? -1 : 1;
    return {
      time,
      strength: clamp((candidate.score - 0.38) / 0.62, 0.2, 1),
      browTime: Math.max(0, time - 0.065),
      headTime: time + 0.085,
      direction,
    };
  });
}

function planBlinkCues(
  durationSeconds: number,
  boundaries: readonly number[],
  seed: number,
): BlinkCue[] {
  if (durationSeconds < 0.55) return [];
  const random = makeRandom(seed ^ 0xa511e9b3);
  const result: BlinkCue[] = [];
  const addBlink = (time: number, boundaryPreferred: boolean): void => {
    if (time < 0.35 || time > durationSeconds - 0.12) return;
    if (result.some((blink) => Math.abs(blink.time - time) < 1.15)) return;
    result.push({
      time,
      leftStrength: 0.94 + random() * 0.06,
      rightStrength: 0.9 + random() * 0.08,
      rightDelay: (random() - 0.5) * 0.018,
      boundaryPreferred,
      doubleBlink: random() < 0.085,
    });
  };

  for (const boundary of boundaries) {
    if (random() < 0.64) addBlink(boundary + (random() - 0.5) * 0.07, true);
  }
  if (!result.some((blink) => blink.boundaryPreferred)) {
    const firstBoundary = boundaries.find(
      (boundary) => boundary >= 0.35 && boundary <= durationSeconds - 0.12,
    );
    if (firstBoundary !== undefined) addBlink(firstBoundary, true);
  }
  let cursor = 1.15 + random() * 1.2;
  while (cursor < durationSeconds - 0.12) {
    const preferred = nearestBoundary(boundaries, cursor, 0.42);
    addBlink(preferred ?? cursor, preferred !== undefined);
    cursor += 2.65 + random() * 2.8;
  }
  result.sort((first, second) => first.time - second.time);
  return result;
}

function planSemanticAffectEnvelope(
  affect: ExpressiveAffect,
  durationSeconds: number,
  cues: readonly ProsodicCue[],
): SemanticAffectEnvelope {
  const duration = Math.max(0.25, durationSeconds);
  const firstProminence = cues.find((cue) => cue.time >= 0.1)?.time;
  const finalProminence = [...cues].reverse().find(
    (cue) => cue.time <= duration - 0.12,
  )?.time;

  let apexTime: number;
  let attackSeconds: number;
  let releaseSeconds: number;
  let baseline: number;
  let residue: number;
  switch (affect) {
    case 'surprise':
      apexTime = Math.min(0.3, Math.max(0.16, duration * 0.2));
      attackSeconds = 0.2;
      releaseSeconds = 0.68;
      baseline = 0.06;
      residue = 0.04;
      break;
    case 'warm':
      apexTime = Math.min(0.48, Math.max(0.25, duration * 0.25));
      attackSeconds = 0.34;
      releaseSeconds = 1.05;
      baseline = 0.18;
      residue = 0.13;
      break;
    case 'question':
      apexTime = clamp(
        finalProminence ?? duration * 0.72,
        Math.min(0.22, duration * 0.4),
        Math.max(0.24, duration - 0.14),
      );
      attackSeconds = 0.28;
      releaseSeconds = 0.52;
      baseline = 0.12;
      residue = 0.07;
      break;
    case 'concerned':
      apexTime = Math.min(0.52, Math.max(0.3, duration * 0.28));
      attackSeconds = 0.36;
      releaseSeconds = 1.18;
      baseline = 0.22;
      residue = 0.17;
      break;
    case 'emphatic':
      apexTime = clamp(
        firstProminence ?? Math.min(0.36, duration * 0.26),
        0.16,
        Math.max(0.18, duration - 0.16),
      );
      attackSeconds = 0.2;
      releaseSeconds = 0.72;
      baseline = 0.1;
      residue = 0.07;
      break;
    default:
      apexTime = Math.min(0.42, duration * 0.25);
      attackSeconds = 0.3;
      releaseSeconds = 0.62;
      baseline = 0.08;
      residue = 0.05;
      break;
  }

  return {
    // Nonverbal intent normally appears just before the voice. Starting the
    // rise here also prevents a neutral first word followed by a facial snap.
    onsetTime: Math.max(
      -AFFECT_ANTICIPATION_SECONDS,
      Math.min(-0.12, apexTime - attackSeconds),
    ),
    apexTime,
    releaseEndTime: Math.min(duration + 0.18, apexTime + releaseSeconds),
    baseline,
    residue,
  };
}

export function sampleSemanticAffectEnvelope(
  envelope: SemanticAffectEnvelope,
  speechTime: number,
): number {
  if (speechTime <= envelope.onsetTime) return 0;
  if (speechTime < envelope.apexTime) {
    const rise = smoothstep01(
      (speechTime - envelope.onsetTime) /
      Math.max(0.001, envelope.apexTime - envelope.onsetTime),
    );
    return envelope.baseline + (1 - envelope.baseline) * rise;
  }
  if (speechTime < envelope.releaseEndTime) {
    const release = smoothstep01(
      (speechTime - envelope.apexTime) /
      Math.max(0.001, envelope.releaseEndTime - envelope.apexTime),
    );
    return envelope.residue + (1 - envelope.residue) * (1 - release);
  }
  return envelope.residue;
}

export function planExpressivePerformance(
  input: ExpressivePerformanceInput,
): ExpressivePerformancePlan {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const durationSeconds = Math.max(0, input.durationSeconds);
  const seed = (input.seed ?? hashText(`${input.text}\u241f${durationSeconds.toFixed(3)}`)) >>> 0;
  const intent = input.performanceIntent ?? inferPerformanceIntent({
    userText: input.userText,
    assistantText: input.text,
  });
  const affect = intent.affect;
  const pitch = robustPitchStatistics(input.acousticFrames);
  const boundaries = collectBoundaries(input.text, input.phonemes, durationSeconds);
  const cues = planProsodicCues(input.acousticFrames, input.phonemes, pitch, seed);
  const blinks = planBlinkCues(durationSeconds, boundaries, seed);
  const affectEnvelope = planSemanticAffectEnvelope(affect, durationSeconds, cues);
  const cueStrength = cues.length > 0
    ? cues.reduce((sum, cue) => sum + cue.strength, 0) / cues.length
    : 0;
  const intensity = clamp(
    intent.intensity + Math.max(0, cueStrength - 0.45) * 0.16,
    affect === 'neutral' ? 0.18 : 0.3,
    1,
  );
  const endedAt = globalThis.performance?.now?.() ?? Date.now();
  return {
    seed,
    durationSeconds,
    affect,
    intensity,
    discourseAct: intent.discourseAct,
    intentSource: intent.source,
    intentConfidence: intent.confidence,
    affectTargets: AFFECT_TARGETS[affect],
    affectEnvelope,
    asymmetryDirection: (seed & 1) === 0 ? -1 : 1,
    pitch,
    cues,
    blinks,
    boundaries,
    plannerMs: Math.max(0, endedAt - startedAt),
  };
}

function emptyMorphs(): ExpressiveMorphWeights {
  return Object.fromEntries(
    EXPRESSIVE_MORPH_TARGETS.map((target) => [target, 0]),
  ) as ExpressiveMorphWeights;
}

function response(
  current: number,
  target: number,
  deltaSeconds: number,
  attackSeconds: number,
  releaseSeconds: number,
): number {
  const seconds = target > current ? attackSeconds : releaseSeconds;
  const blend = 1 - Math.exp(-deltaSeconds / Math.max(0.001, seconds));
  return current + (target - current) * blend;
}

function pulse(time: number, center: number, attack: number, release: number): number {
  if (time <= center - attack || time >= center + release) return 0;
  if (time < center) return smoothstep01((time - (center - attack)) / attack);
  return 1 - smoothstep01((time - center) / release);
}

function sampleEyelid(time: number, start: number, strength: number): number {
  const closeSeconds = 0.052;
  const holdSeconds = 0.018;
  const openSeconds = 0.105;
  const local = time - start;
  if (local < 0 || local >= closeSeconds + holdSeconds + openSeconds) return 0;
  if (local < closeSeconds) return strength * smoothstep01(local / closeSeconds);
  if (local < closeSeconds + holdSeconds) return strength;
  return strength * (1 - smoothstep01(
    (local - closeSeconds - holdSeconds) / openSeconds,
  ));
}

interface DynamicChannels {
  browConcern: number;
  browLift: number;
  browFurrow: number;
  eyeWiden: number;
  eyeSquint: number;
  cheekRaise: number;
  smile: number;
  smileMouth: number;
  surpriseMouth: number;
  concernMouth: number;
  curiosityMouth: number;
  emphasisMouth: number;
  gazeX: number;
  gazeY: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
}

function zeroChannels(): DynamicChannels {
  return {
    browConcern: AFFECT_TARGETS.neutral.browConcern,
    browLift: 0,
    browFurrow: 0,
    eyeWiden: 0,
    eyeSquint: 0,
    cheekRaise: 0,
    smile: AFFECT_TARGETS.neutral.smile,
    smileMouth: 0,
    surpriseMouth: 0,
    concernMouth: 0,
    curiosityMouth: 0,
    emphasisMouth: 0,
    gazeX: 0,
    gazeY: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
  };
}

interface ActivePerformanceAction {
  readonly action: PerformanceAction;
  readonly attackSeconds: number;
  readonly direction: -1 | 1;
  startAt: number;
}

function actionAttackSeconds(gesture: PerformanceAction['gesture']): number {
  switch (gesture) {
    case 'surprise': return 0.14;
    case 'nod':
    case 'shake': return 0.16;
    case 'smile': return 0.5;
    case 'concern': return 0.36;
    default: return 0.22;
  }
}

function samplePerformanceActionScale(
  active: ActivePerformanceAction | null,
  now: number,
): number {
  if (!active || !Number.isFinite(active.startAt)) return 0;
  const localTime = now - active.startAt;
  if (localTime < 0) return 0;
  if (localTime < active.attackSeconds) {
    return smoothstep01(localTime / Math.max(0.001, active.attackSeconds));
  }
  const holdEnd = active.attackSeconds + active.action.holdSeconds;
  if (localTime <= holdEnd) return 1;
  const releaseTime = localTime - holdEnd;
  if (releaseTime < active.action.releaseSeconds) {
    return 1 - smoothstep01(releaseTime / active.action.releaseSeconds);
  }
  return 0;
}

function performanceActionPhase(
  active: ActivePerformanceAction | null,
  now: number,
): ExpressivePerformanceDiagnostics['actionPhase'] {
  if (!active) return 'idle';
  if (!Number.isFinite(active.startAt) || now < active.startAt) return 'waiting';
  const localTime = now - active.startAt;
  if (localTime < active.attackSeconds) return 'attack';
  const holdEnd = active.attackSeconds + active.action.holdSeconds;
  if (localTime <= holdEnd) return 'hold';
  return localTime < holdEnd + active.action.releaseSeconds ? 'release' : 'idle';
}

/**
 * Samples a preplanned, deterministic performance from the same Web Audio
 * clock as the coarticulation engine. Planning may allocate; update() does not.
 */
export class ExpressivePerformanceController {
  private plan: ExpressivePerformancePlan | null = null;
  private readonly channels = zeroChannels();
  private readonly frame: ExpressivePerformanceFrame = {
    morphs: emptyMorphs(),
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    diagnostics: {
      affect: 'neutral',
      intensity: 0,
      discourseAct: 'statement',
      intentSource: 'text-fallback',
      intentConfidence: 0,
      envelopePhase: 'idle',
      maximumMorphWeight: 0,
      gazeState: 'idle',
      blinkPhase: 'open',
      cueCount: 0,
      plannerMs: 0,
      speechTime: 0,
      actionGesture: 'none',
      actionPhase: 'idle',
    },
  };
  private state: ConversationalPerformanceState = 'idle';
  private playbackStartAt = Number.POSITIVE_INFINITY;
  private lastUpdateAt = Number.NaN;
  private reducedMotion = false;
  private ambientRandom = makeRandom(0x91e10da5);
  private ambientBlinkAt = Number.POSITIVE_INFINITY;
  private ambientBlinkLeft = 0.98;
  private ambientBlinkRight = 0.94;
  private ambientBlinkRightDelay = 0.007;
  private ambientGazeNextAt = Number.POSITIVE_INFINITY;
  private ambientGazeReleaseAt = Number.NEGATIVE_INFINITY;
  private ambientGazeX = 0;
  private ambientGazeY = 0;
  private previousPreparedAffect: ExpressiveAffect | null = null;
  private repeatedAffectCount = 0;
  private activeAction: ActivePerformanceAction | null = null;
  private actionSequence = 0;

  constructor(private readonly clock: AudioClock) {}

  prepare(input: ExpressivePerformanceInput): Readonly<ExpressivePerformancePlan> {
    const planned = planExpressivePerformance(input);
    if (planned.affect !== 'neutral' && planned.affect === this.previousPreparedAffect) {
      this.repeatedAffectCount += 1;
    } else {
      this.repeatedAffectCount = 0;
    }
    this.previousPreparedAffect = planned.affect;
    const repetitionScale = planned.affect === 'neutral'
      ? 1
      : Math.max(0.62, 1 - this.repeatedAffectCount * 0.18);
    this.plan = repetitionScale < 1
      ? { ...planned, intensity: planned.intensity * repetitionScale }
      : planned;
    this.ambientRandom = makeRandom(this.plan.seed ^ 0x7f4a7c15);
    this.frame.diagnostics.affect = this.plan.affect;
    this.frame.diagnostics.intensity = this.plan.intensity;
    this.frame.diagnostics.discourseAct = this.plan.discourseAct;
    this.frame.diagnostics.intentSource = this.plan.intentSource;
    this.frame.diagnostics.intentConfidence = this.plan.intentConfidence;
    this.frame.diagnostics.envelopePhase = 'anticipation';
    this.frame.diagnostics.cueCount = this.plan.cues.length;
    this.frame.diagnostics.plannerMs = this.plan.plannerMs;
    this.ambientGazeNextAt = Number.POSITIVE_INFINITY;
    return this.plan;
  }

  startAt(audioTime: number): void {
    this.playbackStartAt = audioTime;
    // Prime one bounded response interval so the affect reads by the first
    // phoneme instead of waiting until the first clause is already underway.
    this.lastUpdateAt = Math.min(
      this.clock.currentTime,
      audioTime - AFFECT_ANTICIPATION_SECONDS,
    );
    this.scheduleAmbientBlink(audioTime, 2.1);
    if (this.activeAction && !Number.isFinite(this.activeAction.startAt)) {
      this.activeAction.startAt = audioTime - 0.08;
    }
  }

  /** Starts an LLM-selected semantic action without exposing raw rig weights. */
  performAction(action: PerformanceAction): void {
    if (action.gesture === 'none' || action.gesture === 'reset' || action.intensity <= 0) {
      this.cancelAction(false);
      return;
    }
    this.actionSequence += 1;
    this.activeAction = {
      action,
      attackSeconds: actionAttackSeconds(action.gesture),
      direction: (this.actionSequence & 1) === 0 ? -1 : 1,
      startAt: action.onset === 'immediate'
        ? this.clock.currentTime
        : Number.POSITIVE_INFINITY,
    };
    this.frame.diagnostics.actionGesture = action.gesture;
    this.frame.diagnostics.actionPhase = action.onset === 'immediate' ? 'attack' : 'waiting';
  }

  cancelAction(immediate = false): void {
    this.activeAction = null;
    this.frame.diagnostics.actionGesture = 'none';
    this.frame.diagnostics.actionPhase = 'idle';
    if (immediate) {
      const neutral = zeroChannels();
      Object.assign(this.channels, neutral);
    }
  }

  setConversationState(state: ConversationalPerformanceState): void {
    if (state === this.state) return;
    this.state = state;
    this.frame.diagnostics.gazeState = state;
    if (state === 'thinking') {
      // A new answer starts a fresh semantic performance sequence.
      this.previousPreparedAffect = null;
      this.repeatedAffectCount = 0;
    }
    if (state === 'interrupted' || state === 'error') {
      this.previousPreparedAffect = null;
      this.repeatedAffectCount = 0;
      this.cancelAll(true);
    }
    else if (!Number.isFinite(this.ambientBlinkAt)) this.scheduleAmbientBlink(this.clock.currentTime, 1.4);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /** Deterministic, audio-free pose used by the hidden visual review hook. */
  setDeterministicPreview(intent: PerformanceIntent): void {
    this.cancelAction(true);
    const prepared = this.prepare({
      text: `${intent.affect} expression preview.`,
      phonemes: [],
      acousticFrames: [],
      durationSeconds: 30,
      performanceIntent: intent,
      seed: 0x5eedface,
    });
    this.plan = {
      ...prepared,
      cues: [],
      blinks: [],
      boundaries: [],
      affectEnvelope: {
        onsetTime: -AFFECT_ANTICIPATION_SECONDS,
        apexTime: 0,
        releaseEndTime: 30,
        baseline: 1,
        residue: 1,
      },
    };
    this.setConversationState('speaking');
    this.startAt(this.clock.currentTime - 0.8);
  }

  cancelSpeech(immediate = true): void {
    this.playbackStartAt = Number.POSITIVE_INFINITY;
    this.plan = null;
    this.frame.diagnostics.affect = 'neutral';
    this.frame.diagnostics.intensity = 0;
    this.frame.diagnostics.discourseAct = 'statement';
    this.frame.diagnostics.intentSource = 'text-fallback';
    this.frame.diagnostics.intentConfidence = 0;
    this.frame.diagnostics.envelopePhase = 'idle';
    this.frame.diagnostics.maximumMorphWeight = 0;
    this.frame.diagnostics.cueCount = 0;
    this.frame.diagnostics.plannerMs = 0;
    this.frame.diagnostics.speechTime = 0;
    if (immediate) {
      const neutral = zeroChannels();
      Object.assign(this.channels, neutral);
      const morphs = this.frame.morphs;
      for (const target of EXPRESSIVE_MORPH_TARGETS) morphs[target] = 0;
      morphs.browConcern = AFFECT_TARGETS.neutral.browConcern;
      morphs.smile = AFFECT_TARGETS.neutral.smile;
      this.frame.headPitch = 0;
      this.frame.headYaw = 0;
      this.frame.headRoll = 0;
      this.frame.diagnostics.blinkPhase = 'open';
    }
  }

  cancelAll(immediate = true): void {
    this.cancelAction(immediate);
    this.cancelSpeech(immediate);
  }

  getPlan(): Readonly<ExpressivePerformancePlan> | null {
    return this.plan;
  }

  update(): Readonly<ExpressivePerformanceFrame> {
    const now = this.clock.currentTime;
    const deltaSeconds = Number.isFinite(this.lastUpdateAt)
      ? clamp(now - this.lastUpdateAt, 0, 0.1)
      : 1 / 60;
    this.lastUpdateAt = now;
    const plan = this.plan;
    const speechTime = Number.isFinite(this.playbackStartAt)
      ? now - this.playbackStartAt
      : Number.NEGATIVE_INFINITY;
    const speechActive = Boolean(
      plan &&
        speechTime >= -AFFECT_ANTICIPATION_SECONDS &&
        speechTime <= plan.durationSeconds + 0.4,
    );
    const speechFade = plan && speechActive
      ? speechTime < 0
        ? smoothstep01(
          (speechTime + AFFECT_ANTICIPATION_SECONDS) /
          AFFECT_ANTICIPATION_SECONDS,
        )
        : speechTime > plan.durationSeconds
          ? 1 - smoothstep01((speechTime - plan.durationSeconds) / 0.4)
          : 1
      : 0;
    this.frame.diagnostics.speechTime = Number.isFinite(speechTime) ? speechTime : 0;

    let browPulse = 0;
    let headPitchPulse = 0;
    let headYawPulse = 0;
    if (plan && speechActive && !this.reducedMotion) {
      for (const cue of plan.cues) {
        const brow = pulse(speechTime, cue.browTime, 0.16, 0.24) * cue.strength;
        const head = pulse(speechTime, cue.headTime, 0.19, 0.34) * cue.strength;
        browPulse = Math.max(browPulse, brow);
        headPitchPulse += head * 0.017;
        headYawPulse += head * cue.direction * 0.006;
      }
    }

    const affect = plan && speechActive ? plan.affectTargets : AFFECT_TARGETS.neutral;
    const motionScale = calibrateExpressionIntensity(plan?.intensity ?? 0) *
      (this.reducedMotion ? 0.68 : 1);
    const semanticEnvelope = plan && speechActive
      ? sampleSemanticAffectEnvelope(plan.affectEnvelope, speechTime)
      : 0;
    // Small timing offsets keep the face from moving as one rigid mask: brows
    // lead, lids follow, then cheeks and the slower mouth-corner residue.
    const browAffectScale = speechFade * motionScale * (plan && speechActive
      ? sampleSemanticAffectEnvelope(plan.affectEnvelope, speechTime + 0.035)
      : 0);
    const eyeAffectScale = speechFade * motionScale * semanticEnvelope;
    const cheekAffectScale = speechFade * motionScale * (plan && speechActive
      ? sampleSemanticAffectEnvelope(plan.affectEnvelope, speechTime - 0.045)
      : 0);
    const smileAffectScale = speechFade * motionScale * (plan && speechActive
      ? sampleSemanticAffectEnvelope(plan.affectEnvelope, speechTime - 0.085)
      : 0);
    const semanticImpulse = plan
      ? Math.max(0, semanticEnvelope - plan.affectEnvelope.baseline)
      : 0;
    const activeAction = this.activeAction;
    const actionPhase = performanceActionPhase(activeAction, now);
    const action = activeAction?.action;
    const actionEnvelope = samplePerformanceActionScale(activeAction, now);
    const actionScale = actionEnvelope * calibrateExpressionIntensity(
      action?.intensity ?? 0,
    ) * (this.reducedMotion ? 0.68 : 1);
    const actionAffect = action ? ACTION_AFFECT[action.gesture] : undefined;
    const actionTargets = actionAffect
      ? AFFECT_TARGETS[actionAffect]
      : AFFECT_TARGETS.neutral;
    const positiveValence = Math.max(0, action?.valence ?? 0) * actionScale;
    const negativeValence = Math.max(0, -(action?.valence ?? 0)) * actionScale;
    const positiveArousal = Math.max(0, action?.arousal ?? 0) * actionScale;
    const negativeArousal = Math.max(0, -(action?.arousal ?? 0)) * actionScale;
    const highDominance = Math.max(0, action?.dominance ?? 0) * actionScale;
    const lowDominance = Math.max(0, -(action?.dominance ?? 0)) * actionScale;
    // Semantic delivery and an explicit physical action are independent
    // directors. Use the stronger target per channel so matching plans do not
    // double-add into an exaggerated mask.
    const semanticConcernTarget = AFFECT_TARGETS.neutral.browConcern +
      (affect.browConcern - AFFECT_TARGETS.neutral.browConcern) * browAffectScale;
    const actionConcernTarget = AFFECT_TARGETS.neutral.browConcern +
      (actionTargets.browConcern - AFFECT_TARGETS.neutral.browConcern) * actionScale +
      negativeValence * 0.16 + lowDominance * 0.06;
    const semanticLiftTarget = affect.browLift * browAffectScale;
    const actionLiftTarget = actionTargets.browLift * actionScale + positiveArousal * 0.12;
    const semanticFurrowTarget = affect.browFurrow * browAffectScale;
    const actionFurrowTarget = actionTargets.browFurrow * actionScale +
      negativeValence * 0.12 + highDominance * 0.1;
    const semanticWidenTarget = affect.eyeWiden * eyeAffectScale;
    const actionWidenTarget = actionTargets.eyeWiden * actionScale + positiveArousal * 0.2;
    const semanticSquintTarget = affect.eyeSquint * eyeAffectScale;
    const actionSquintTarget = actionTargets.eyeSquint * actionScale + negativeArousal * 0.09;
    const semanticCheekTarget = affect.cheekRaise * cheekAffectScale;
    const actionCheekTarget = actionTargets.cheekRaise * actionScale + positiveValence * 0.22;
    const semanticSmileTarget = AFFECT_TARGETS.neutral.smile +
      (affect.smile - AFFECT_TARGETS.neutral.smile) * smileAffectScale;
    const actionSmileTarget = AFFECT_TARGETS.neutral.smile +
      (actionTargets.smile - AFFECT_TARGETS.neutral.smile) * actionScale +
      positiveValence * 0.04;
    const semanticSmileMouthTarget = affect.smileMouth * smileAffectScale;
    const actionSmileMouthTarget = actionTargets.smileMouth * actionScale +
      (action?.gesture === 'smile' ? positiveValence * 0.1 : 0);
    const semanticSurpriseMouthTarget = affect.surpriseMouth * eyeAffectScale;
    const actionSurpriseMouthTarget = actionTargets.surpriseMouth * actionScale +
      (action?.gesture === 'surprise' ? positiveArousal * 0.08 : 0);
    const semanticConcernMouthTarget = affect.concernMouth * cheekAffectScale;
    const actionConcernMouthTarget = actionTargets.concernMouth * actionScale +
      (action?.gesture === 'concern' ? negativeValence * 0.08 : 0);
    const semanticCuriosityMouthTarget = affect.curiosityMouth * smileAffectScale;
    const actionCuriosityMouthTarget = actionTargets.curiosityMouth * actionScale;
    const semanticEmphasisMouthTarget = affect.emphasisMouth * cheekAffectScale;
    const actionEmphasisMouthTarget = actionTargets.emphasisMouth * actionScale +
      (action?.gesture === 'emphasis' ? highDominance * 0.06 : 0);
    const stateConcern = this.state === 'thinking' ? 0.035 : 0;
    const stateLift = this.state === 'listening' ? 0.026 : 0;
    const stateSquint = this.state === 'thinking' ? 0.02 : 0;
    this.channels.browConcern = response(
      this.channels.browConcern,
      Math.max(semanticConcernTarget, actionConcernTarget) + stateConcern,
      deltaSeconds,
      0.17,
      0.32,
    );
    this.channels.browLift = response(
      this.channels.browLift,
      Math.max(semanticLiftTarget, actionLiftTarget) + browPulse * 0.16 + stateLift,
      deltaSeconds,
      0.12,
      0.28,
    );
    this.channels.browFurrow = response(
      this.channels.browFurrow,
      Math.max(semanticFurrowTarget, actionFurrowTarget),
      deltaSeconds,
      0.15,
      0.3,
    );
    this.channels.eyeWiden = response(
      this.channels.eyeWiden,
      Math.max(semanticWidenTarget, actionWidenTarget) + browPulse * 0.025,
      deltaSeconds,
      0.1,
      0.25,
    );
    this.channels.eyeSquint = response(
      this.channels.eyeSquint,
      Math.max(semanticSquintTarget, actionSquintTarget) + stateSquint,
      deltaSeconds,
      0.16,
      0.3,
    );
    this.channels.cheekRaise = response(
      this.channels.cheekRaise,
      Math.max(semanticCheekTarget, actionCheekTarget),
      deltaSeconds,
      0.2,
      0.38,
    );
    this.channels.smile = response(
      this.channels.smile,
      Math.max(semanticSmileTarget, actionSmileTarget),
      deltaSeconds,
      0.24,
      0.42,
    );
    this.channels.smileMouth = response(
      this.channels.smileMouth,
      Math.max(semanticSmileMouthTarget, actionSmileMouthTarget),
      deltaSeconds,
      0.3,
      0.52,
    );
    this.channels.surpriseMouth = response(
      this.channels.surpriseMouth,
      Math.max(semanticSurpriseMouthTarget, actionSurpriseMouthTarget),
      deltaSeconds,
      0.1,
      0.34,
    );
    this.channels.concernMouth = response(
      this.channels.concernMouth,
      Math.max(semanticConcernMouthTarget, actionConcernMouthTarget),
      deltaSeconds,
      0.24,
      0.56,
    );
    this.channels.curiosityMouth = response(
      this.channels.curiosityMouth,
      Math.max(semanticCuriosityMouthTarget, actionCuriosityMouthTarget),
      deltaSeconds,
      0.2,
      0.44,
    );
    this.channels.emphasisMouth = response(
      this.channels.emphasisMouth,
      Math.max(semanticEmphasisMouthTarget, actionEmphasisMouthTarget),
      deltaSeconds,
      0.14,
      0.34,
    );

    let gazeX = 0;
    let gazeY = 0;
    if (!this.reducedMotion) {
      if (this.state === 'thinking') {
        gazeX = -0.46;
        gazeY = 0.14;
      } else if (this.state === 'transcribing') {
        gazeX = 0.18;
        gazeY = 0.08;
      } else if (this.state === 'installing') {
        gazeX = -0.1;
        gazeY = -0.06;
      } else if (plan && speechActive && speechTime < plan.durationSeconds - 0.52) {
        const opening = smoothstep01((speechTime + 0.04) / 0.34);
        gazeX = (((plan.seed & 1) === 0 ? -1 : 1) * 0.12) * (1 - opening);
        gazeY = -0.025 * (1 - opening);
      } else if (!speechActive && (this.state === 'idle' || this.state === 'listening')) {
        if (!Number.isFinite(this.ambientGazeNextAt)) {
          this.ambientGazeNextAt = now + 0.85 + this.ambientRandom() * 1.7;
        }
        if (now >= this.ambientGazeNextAt) this.scheduleAmbientGaze(now);
        if (now < this.ambientGazeReleaseAt) {
          const scale = this.state === 'listening' ? 0.42 : 1;
          gazeX = this.ambientGazeX * scale;
          gazeY = this.ambientGazeY * scale;
        }
      }
      if (plan && speechActive) {
        gazeX += plan.asymmetryDirection * semanticImpulse * 0.024;
        gazeY += (plan.affect === 'surprise' || plan.affect === 'question' ? 1 : -0.35) *
          semanticImpulse * 0.016;
      }
      if (action?.gesture === 'glance_left') gazeX -= actionScale * 0.52;
      else if (action?.gesture === 'glance_right') gazeX += actionScale * 0.52;
    }
    this.channels.gazeX = response(this.channels.gazeX, gazeX, deltaSeconds, 0.075, 0.16);
    this.channels.gazeY = response(this.channels.gazeY, gazeY, deltaSeconds, 0.08, 0.18);

    const semanticHeadYaw = plan && speechActive
      ? semanticImpulse * plan.asymmetryDirection * 0.0045
      : 0;
    const semanticHeadPitch = plan && speechActive
      ? semanticImpulse * (plan.affect === 'concerned' ? 0.006 : -0.003)
      : 0;
    const actionLocalTime = activeAction && Number.isFinite(activeAction.startAt)
      ? now - activeAction.startAt
      : 0;
    let actionHeadPitch = 0;
    let actionHeadYaw = 0;
    if (!this.reducedMotion && activeAction && action) {
      if (action.gesture === 'nod') {
        // Two conversational cycles: a readable primary beat, rebound, then
        // a smaller declined cycle and soft final return.
        actionHeadPitch = (
          -pulse(actionLocalTime, 0.28, 0.15, 0.12) * 0.112 +
          pulse(actionLocalTime, 0.46, 0.09, 0.09) * 0.062 -
          pulse(actionLocalTime, 0.61, 0.08, 0.08) * 0.066 +
          pulse(actionLocalTime, 0.76, 0.07, 0.12) * 0.032
        ) * actionScale;
      } else if (action.gesture === 'shake') {
        actionHeadYaw = activeAction.direction * (
          pulse(actionLocalTime, 0.2, 0.12, 0.1) * 0.11 -
          pulse(actionLocalTime, 0.38, 0.08, 0.09) * 0.142 +
          pulse(actionLocalTime, 0.55, 0.08, 0.08) * 0.096 -
          pulse(actionLocalTime, 0.7, 0.07, 0.12) * 0.048
        ) * actionScale;
      } else if (action.gesture === 'emphasis') {
        actionHeadPitch = -pulse(actionLocalTime, 0.34, 0.18, 0.24) * 0.036 * actionScale;
      }
    }
    const targetHeadYaw = this.reducedMotion
      ? 0
      : this.channels.gazeX * 0.055 + headYawPulse + semanticHeadYaw + actionHeadYaw;
    const targetHeadPitch = this.reducedMotion
      ? 0
      : this.channels.gazeY * -0.03 + headPitchPulse + semanticHeadPitch + actionHeadPitch;
    const targetHeadRoll = this.reducedMotion
      ? 0
      : headYawPulse * -0.28 - semanticHeadYaw * 0.42;
    const directedHeadGesture = action?.gesture === 'nod' || action?.gesture === 'shake';
    this.channels.headYaw = response(
      this.channels.headYaw,
      targetHeadYaw,
      deltaSeconds,
      directedHeadGesture ? 0.045 : 0.2,
      directedHeadGesture ? 0.06 : 0.35,
    );
    this.channels.headPitch = response(
      this.channels.headPitch,
      targetHeadPitch,
      deltaSeconds,
      directedHeadGesture ? 0.045 : 0.2,
      directedHeadGesture ? 0.06 : 0.34,
    );
    this.channels.headRoll = response(this.channels.headRoll, targetHeadRoll, deltaSeconds, 0.22, 0.38);

    let blinkLeft = 0;
    let blinkRight = 0;
    if (!this.reducedMotion) {
      if (plan && speechActive) {
        for (const blink of plan.blinks) {
          blinkLeft = Math.max(
            blinkLeft,
            sampleEyelid(speechTime, blink.time, blink.leftStrength),
          );
          blinkRight = Math.max(
            blinkRight,
            sampleEyelid(speechTime, blink.time + blink.rightDelay, blink.rightStrength),
          );
          if (blink.doubleBlink) {
            blinkLeft = Math.max(
              blinkLeft,
              sampleEyelid(speechTime, blink.time + 0.255, blink.leftStrength * 0.9),
            );
            blinkRight = Math.max(
              blinkRight,
              sampleEyelid(
                speechTime,
                blink.time + 0.255 + blink.rightDelay,
                blink.rightStrength * 0.9,
              ),
            );
          }
        }
      }
      if (!speechActive) {
        if (!Number.isFinite(this.ambientBlinkAt)) this.scheduleAmbientBlink(now, 1.1);
        if (now > this.ambientBlinkAt + 0.21) this.scheduleAmbientBlink(now, 2.55);
        blinkLeft = sampleEyelid(now, this.ambientBlinkAt, this.ambientBlinkLeft);
        blinkRight = sampleEyelid(
          now,
          this.ambientBlinkAt + this.ambientBlinkRightDelay,
          this.ambientBlinkRight,
        );
      }
    }

    const morphs = this.frame.morphs;
    morphs.blinkLeft = clamp01(blinkLeft);
    morphs.blinkRight = clamp01(blinkRight);
    morphs.eyeOpen = 0;
    morphs.browConcern = clamp01(this.channels.browConcern);
    morphs.smile = clamp01(this.channels.smile);
    morphs.browLift = clamp01(this.channels.browLift);
    const semanticBrowAsymmetry = plan && speechActive
      ? plan.asymmetryDirection * semanticImpulse *
        (plan.affect === 'question' ? 0.24 : 0.075)
      : 0;
    const actionBrowAsymmetry = action?.gesture === 'curiosity'
      ? (activeAction?.direction ?? 1) * actionScale * 0.24
      : 0;
    const asymmetrySource = clamp(
      semanticBrowAsymmetry + actionBrowAsymmetry,
      -0.34,
      0.34,
    );
    morphs.browLiftLeft = clamp01(asymmetrySource < 0
      ? this.channels.browLift * -asymmetrySource
      : 0);
    morphs.browLiftRight = clamp01(asymmetrySource > 0
      ? this.channels.browLift * asymmetrySource
      : 0);
    morphs.browFurrow = clamp01(this.channels.browFurrow);
    morphs.eyeWiden = clamp01(this.channels.eyeWiden);
    morphs.eyeSquint = clamp01(this.channels.eyeSquint);
    morphs.cheekRaise = clamp01(this.channels.cheekRaise);
    morphs.smileMouth = clamp01(this.channels.smileMouth);
    morphs.surpriseMouth = clamp01(this.channels.surpriseMouth);
    morphs.concernMouth = clamp01(this.channels.concernMouth);
    morphs.curiosityMouth = clamp01(this.channels.curiosityMouth);
    morphs.emphasisMouth = clamp01(this.channels.emphasisMouth);
    morphs.gazeLeft = clamp01(-this.channels.gazeX);
    morphs.gazeRight = clamp01(this.channels.gazeX);
    morphs.gazeUp = clamp01(this.channels.gazeY);
    morphs.gazeDown = clamp01(-this.channels.gazeY);
    this.frame.diagnostics.maximumMorphWeight = Math.max(
      morphs.browConcern,
      morphs.smile,
      morphs.browLift,
      morphs.browLiftLeft,
      morphs.browLiftRight,
      morphs.browFurrow,
      morphs.eyeWiden,
      morphs.eyeSquint,
      morphs.cheekRaise,
      morphs.smileMouth,
      morphs.surpriseMouth,
      morphs.concernMouth,
      morphs.curiosityMouth,
      morphs.emphasisMouth,
    );
    this.frame.diagnostics.envelopePhase = !plan
      ? 'idle'
      : speechTime < 0
        ? 'anticipation'
        : speechTime <= plan.affectEnvelope.apexTime
          ? 'active'
          : speechTime <= plan.affectEnvelope.releaseEndTime
            ? 'release'
            : speechTime <= plan.durationSeconds
              ? 'residue'
              : speechTime <= plan.durationSeconds + 0.4
                ? 'release'
                : 'ended';
    this.frame.diagnostics.actionGesture = actionPhase === 'idle'
      ? 'none'
      : action?.gesture ?? 'none';
    this.frame.diagnostics.actionPhase = actionPhase;
    if (activeAction && actionPhase === 'idle' && now > activeAction.startAt) {
      this.activeAction = null;
    }
    this.frame.headPitch = clamp(this.channels.headPitch, -0.14, 0.1);
    this.frame.headYaw = clamp(this.channels.headYaw, -0.16, 0.16);
    this.frame.headRoll = clamp(this.channels.headRoll, -0.032, 0.032);
    const maximumBlink = Math.max(blinkLeft, blinkRight);
    this.frame.diagnostics.blinkPhase = maximumBlink <= 0.01
      ? 'open'
      : maximumBlink >= 0.92
        ? 'closed'
        : this.isBlinkClosing(speechActive ? plan : null, speechActive ? speechTime : now)
          ? 'closing'
          : 'opening';
    return this.frame;
  }

  private isBlinkClosing(
    plan: ExpressivePerformancePlan | null,
    time: number,
  ): boolean {
    if (plan) {
      for (const blink of plan.blinks) {
        const local = time - blink.time;
        if (local >= 0 && local <= 0.052) return true;
        if (blink.doubleBlink) {
          const second = time - blink.time - 0.255;
          if (second >= 0 && second <= 0.052) return true;
        }
      }
      return false;
    }
    const local = time - this.ambientBlinkAt;
    return local >= 0 && local <= 0.052;
  }

  private scheduleAmbientBlink(now: number, minimumDelay: number): void {
    this.ambientBlinkAt = now + minimumDelay + this.ambientRandom() * 2.85;
    this.ambientBlinkLeft = 0.94 + this.ambientRandom() * 0.06;
    this.ambientBlinkRight = 0.9 + this.ambientRandom() * 0.08;
    this.ambientBlinkRightDelay = (this.ambientRandom() - 0.5) * 0.018;
  }

  private scheduleAmbientGaze(now: number): void {
    this.ambientGazeX = (this.ambientRandom() - 0.5) * 0.13;
    this.ambientGazeY = (this.ambientRandom() - 0.5) * 0.075;
    this.ambientGazeReleaseAt = now + 0.32 + this.ambientRandom() * 0.7;
    this.ambientGazeNextAt = this.ambientGazeReleaseAt + 1.4 + this.ambientRandom() * 2.8;
    if (this.ambientRandom() < 0.22) {
      this.ambientBlinkAt = Math.min(this.ambientBlinkAt, now + 0.025);
    }
  }
}
