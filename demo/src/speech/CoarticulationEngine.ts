import {
  sampleSpeechAcoustics,
  type SpeechAcousticFrame,
} from './AudioAnalysis';
import {
  SPEECH_RIG_TARGETS,
  type PhonemeInterval,
  type SpeechGestureKind,
  type SpeechRigPose,
  type SpeechRigTarget,
  type SpeechRigWeights,
  type VisemeInterval,
} from './types';

export interface AudioClock {
  readonly currentTime: number;
}

export interface CoarticulationEngineOptions {
  /**
   * Backward-compatible master scale for the per-articulator dynamics. A value
   * of 0.04 leaves the physically distinct jaw/lip/tongue/contact defaults
   * unchanged; it is no longer one global spring time.
   */
  smoothingSeconds?: number;
  /** Optional deterministic waveform features sampled in playback time. */
  acousticFrames?: readonly SpeechAcousticFrame[];
}

interface PreparedViseme extends VisemeInterval {
  normalizedPhone: string;
  gestureKind: SpeechGestureKind;
  peakStartTime: number;
  releaseStartTime: number;
  startPose: SpeechRigPose;
  endPose: SpeechRigPose;
  dominance: number;
  strength: number;
}

const SILENCE_PHONES = new Set(['sil', 'sp', 'pau']);
const BILABIALS = new Set(['p', 'b', 'm']);
const PLOSIVES = new Set(['p', 'b', 't', 'd', 'k', 'g', 'tʃ', 'dʒ']);
const NASALS = new Set(['m', 'n', 'ŋ']);
const LABIODENTALS = new Set(['f', 'v']);
const DENTALS = new Set(['θ', 'ð']);
const ALVEOLAR_STOPS = new Set(['t', 'd', 'n']);
const SIBILANTS = new Set(['s', 'z']);
const POST_ALVEOLARS = new Set(['ʃ', 'ʒ', 'tʃ', 'dʒ']);
const VELARS = new Set(['k', 'g', 'ŋ']);
const FRICATIVES = new Set(['f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h']);
const VOWEL_PATTERN = /[ɑɒæaɐɛeəɜɚɝʌiɪyɔouʊ]/u;

const MOUTH_SHAPE_TARGETS: readonly SpeechRigTarget[] = [
  'mouthAA',
  'mouthAH',
  'mouthE',
  'mouthIH',
  'mouthI',
  'mouthO',
  'mouthU',
  'mouthR',
  'mouthSHCH',
  'mouthSZ',
];

const TONGUE_CONTACT_TARGETS: readonly SpeechRigTarget[] = [
  'contactDental',
  'contactAlveolar',
  'contactLateral',
  'contactVelar',
];

const HARD_CONTACT_TARGETS = new Set<SpeechRigTarget>([
  'lipsTogether',
  'contactBilabial',
  'contactLabiodental',
  'contactDental',
  'contactAlveolar',
  'contactLateral',
  'contactVelar',
]);

const JAW_TARGETS = new Set<SpeechRigTarget>(['jawOpen', 'jawForward']);
const VOWEL_TARGETS = new Set<SpeechRigTarget>(MOUTH_SHAPE_TARGETS);
const TONGUE_TARGETS = new Set<SpeechRigTarget>([
  'tongueTipUp',
  'tongueTipLateral',
  'tongueBladeUp',
  'tongueBladeGroove',
  'tongueBetweenTeeth',
  'tongueDorsumUp',
  'tongueBodyHigh',
  'tongueBodyBack',
  'tongueBodyLow',
  'tongueForward',
  'tongueRetract',
  'correctiveSibilantGroove',
  ...TONGUE_CONTACT_TARGETS,
]);
const LIP_TARGETS = new Set<SpeechRigTarget>([
  'upperLipRaise',
  'lowerLipDepress',
  'lipsTogether',
  'lipCompress',
  'lipRollIn',
  'lipRollOut',
  'lipPucker',
  'lipFunnel',
  'lipStretch',
  'mouthStretch',
  'mouthCornersUp',
  'mouthCornersDown',
  'lowerLipToTeeth',
  'contactBilabial',
  'contactLabiodental',
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function makeWeights(): SpeechRigWeights {
  return Object.fromEntries(
    SPEECH_RIG_TARGETS.map((target) => [target, 0]),
  ) as SpeechRigWeights;
}

/** Normalizes common eSpeak/IPA variants to the symbols used by the pose map. */
export function normalizePhoneForRig(phone: string): string {
  return phone
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ˈˌ.\s]/gu, '')
    .replace(/[ːˑ]/gu, '')
    .replace(/͡/gu, '')
    .replace(/ɡ/gu, 'g')
    .replace(/ɹ/gu, 'r')
    .replace(/ʧ/gu, 'tʃ')
    .replace(/ʤ/gu, 'dʒ');
}

function interpolatePoses(
  first: SpeechRigPose,
  second: SpeechRigPose,
  mix: number,
): SpeechRigPose {
  const pose: SpeechRigPose = {};
  const amount = clamp01(mix);
  for (const target of SPEECH_RIG_TARGETS) {
    const value = (first[target] ?? 0) * (1 - amount) +
      (second[target] ?? 0) * amount;
    if (value > 1e-6) pose[target] = clamp01(value);
  }
  return pose;
}

function monophthongPose(phone: string): SpeechRigPose | undefined {
  if (/[ɑɒæaɐ]/u.test(phone)) {
    return {
      jawOpen: 0.76,
      lowerLipDepress: 0.16,
      mouthAA: 0.92,
      tongueBodyLow: 0.68,
      tongueForward: phone.includes('æ') ? 0.42 : 0.15,
    };
  }
  if (/[ɛe]/u.test(phone)) {
    return {
      jawOpen: 0.38,
      lipStretch: 0.18,
      mouthStretch: 0.16,
      mouthE: 0.82,
      tongueBodyHigh: 0.25,
      tongueForward: 0.38,
    };
  }
  if (/[əɜɚɝʌ]/u.test(phone)) {
    return {
      jawOpen: 0.4,
      lowerLipDepress: 0.06,
      mouthAH: 0.88,
      tongueBodyLow: 0.3,
      tongueRetract: phone.includes('ɝ') || phone.includes('ɚ') ? 0.26 : 0.08,
    };
  }
  if (/[iy]/u.test(phone)) {
    return {
      jawOpen: 0.2,
      lipStretch: 0.58,
      mouthStretch: 0.52,
      mouthI: 0.88,
      tongueBodyHigh: 0.72,
      tongueForward: 0.76,
    };
  }
  if (phone.includes('ɪ')) {
    return {
      jawOpen: 0.25,
      lipStretch: 0.34,
      mouthStretch: 0.3,
      mouthIH: 0.9,
      tongueBodyHigh: 0.58,
      tongueForward: 0.62,
    };
  }
  if (/[ɔo]/u.test(phone)) {
    return {
      jawOpen: 0.47,
      jawForward: 0.06,
      lipFunnel: 0.55,
      lipPucker: 0.22,
      lipRollOut: 0.12,
      mouthO: 0.88,
      tongueBodyBack: 0.55,
      tongueBodyLow: 0.2,
    };
  }
  if (/[uʊ]/u.test(phone)) {
    return {
      jawOpen: 0.24,
      jawForward: 0.1,
      lipPucker: 0.72,
      lipFunnel: 0.35,
      lipRollOut: 0.22,
      mouthU: 0.9,
      tongueBodyHigh: 0.62,
      tongueBodyBack: 0.7,
    };
  }
  return undefined;
}

function diphthongPoses(
  phone: string,
): { start: SpeechRigPose; end: SpeechRigPose } | undefined {
  if (phone.includes('aɪ') || phone.includes('ɑɪ')) {
    return {
      start: monophthongPose('ɑ') ?? {},
      end: monophthongPose('ɪ') ?? {},
    };
  }
  if (phone.includes('aʊ') || phone.includes('ɑʊ')) {
    return {
      start: monophthongPose('ɑ') ?? {},
      end: monophthongPose('ʊ') ?? {},
    };
  }
  if (phone.includes('eɪ')) {
    return {
      start: monophthongPose('e') ?? {},
      end: monophthongPose('ɪ') ?? {},
    };
  }
  if (phone.includes('ɔɪ') || phone.includes('oɪ')) {
    return {
      start: monophthongPose('ɔ') ?? {},
      end: monophthongPose('ɪ') ?? {},
    };
  }
  if (phone.includes('oʊ') || phone.includes('əʊ')) {
    return {
      start: monophthongPose('o') ?? {},
      end: monophthongPose('ʊ') ?? {},
    };
  }
  if (phone.includes('ɪə')) {
    return {
      start: monophthongPose('ɪ') ?? {},
      end: monophthongPose('ə') ?? {},
    };
  }
  if (phone.includes('eə')) {
    return {
      start: monophthongPose('e') ?? {},
      end: monophthongPose('ə') ?? {},
    };
  }
  if (phone.includes('ʊə')) {
    return {
      start: monophthongPose('ʊ') ?? {},
      end: monophthongPose('ə') ?? {},
    };
  }
  return undefined;
}

/** Maps an IPA phone to independently controllable jaw, lip, and tongue poses. */
export function poseForPhone(phone: string): SpeechRigPose {
  const normalized = normalizePhoneForRig(phone);

  if (!normalized || SILENCE_PHONES.has(normalized)) return {};
  if (BILABIALS.has(normalized)) {
    const isNasal = normalized === 'm';
    return {
      jawOpen: 0.025,
      lipsTogether: 1,
      lipCompress: isNasal ? 0.48 : 0.72,
      lipRollIn: isNasal ? 0.12 : 0.2,
      contactBilabial: 1,
    };
  }
  if (LABIODENTALS.has(normalized)) {
    return {
      jawOpen: 0.16,
      lowerLipToTeeth: 1,
      lipRollIn: 0.18,
      lipStretch: 0.12,
      mouthStretch: 0.1,
      contactLabiodental: 1,
    };
  }
  if (DENTALS.has(normalized)) {
    return {
      jawOpen: 0.23,
      tongueBetweenTeeth: 0.92,
      tongueForward: 0.86,
      contactDental: 0.94,
    };
  }
  if (POST_ALVEOLARS.has(normalized)) {
    return {
      jawOpen: 0.28,
      lipPucker: 0.2,
      mouthSHCH: 0.95,
      tongueBladeUp: 0.74,
      tongueBladeGroove: 0.62,
      tongueDorsumUp: 0.42,
      tongueBodyHigh: 0.4,
    };
  }
  if (SIBILANTS.has(normalized)) {
    return {
      jawOpen: 0.12,
      lipStretch: 0.24,
      mouthStretch: 0.22,
      mouthSZ: 0.96,
      tongueBladeUp: 0.72,
      tongueBladeGroove: 1,
      tongueForward: 0.26,
      correctiveSibilantGroove: 1,
    };
  }
  if (normalized === 'l') {
    return {
      jawOpen: 0.3,
      tongueTipLateral: 1,
      tongueBladeUp: 0.66,
      contactLateral: 1,
    };
  }
  if (ALVEOLAR_STOPS.has(normalized)) {
    return {
      jawOpen: 0.2,
      tongueTipUp: normalized === 'n' ? 0.82 : 0.9,
      tongueBladeUp: 0.62,
      contactAlveolar: normalized === 'n' ? 0.9 : 1,
    };
  }
  if (VELARS.has(normalized)) {
    return {
      jawOpen: 0.25,
      tongueDorsumUp: 0.9,
      tongueBodyHigh: 0.72,
      tongueBodyBack: 0.92,
      contactVelar: normalized === 'ŋ' ? 0.9 : 1,
    };
  }
  if (normalized === 'r' || normalized.endsWith('r')) {
    return {
      jawOpen: 0.29,
      lipPucker: 0.13,
      mouthR: 0.9,
      tongueBodyHigh: 0.35,
      tongueRetract: 0.62,
    };
  }
  if (normalized === 'w') {
    return {
      jawOpen: 0.14,
      jawForward: 0.12,
      lipPucker: 0.82,
      lipFunnel: 0.24,
      lipRollOut: 0.18,
      mouthU: 0.76,
      tongueBodyHigh: 0.44,
      tongueBodyBack: 0.56,
    };
  }

  const trajectory = diphthongPoses(normalized);
  if (trajectory) return interpolatePoses(trajectory.start, trajectory.end, 0.5);
  return monophthongPose(normalized) ?? { jawOpen: 0.16 };
}

function isRoundedPose(pose: SpeechRigPose): boolean {
  return (pose.lipPucker ?? 0) > 0.3 || (pose.lipFunnel ?? 0) > 0.3;
}

function gestureKindForPhone(
  phone: string,
  trajectory: ReturnType<typeof diphthongPoses>,
): SpeechGestureKind {
  if (!phone || SILENCE_PHONES.has(phone)) return 'silence';
  if (trajectory) return 'diphthong';
  if (VOWEL_PATTERN.test(phone)) return 'vowel';
  if (PLOSIVES.has(phone)) return 'stop';
  if (NASALS.has(phone)) return 'nasal-closure';
  if (FRICATIVES.has(phone)) return 'fricative';
  return 'approximant';
}

function phaseTiming(
  interval: PhonemeInterval,
  pose: SpeechRigPose,
  kind: SpeechGestureKind,
  hasPreviousSpeech: boolean,
): Pick<
  PreparedViseme,
  | 'anticipationStartTime'
  | 'peakStartTime'
  | 'releaseStartTime'
  | 'releaseEndTime'
> {
  const duration = Math.max(0.001, interval.endTime - interval.startTime);
  const rate = clamp(interval.speakingRate ?? 1, 0.65, 1.6);
  let anticipation = isRoundedPose(pose)
    ? 0.105
    : kind === 'vowel' || kind === 'diphthong'
      ? 0.068
      : kind === 'stop' || kind === 'nasal-closure'
        ? 0.048
        : 0.055;
  anticipation /= Math.sqrt(rate);
  if (!hasPreviousSpeech) anticipation *= 0.72;

  const peakOffset = kind === 'stop' || kind === 'nasal-closure'
    ? Math.min(0.018, duration * 0.24)
    : kind === 'fricative'
      ? Math.min(0.025, duration * 0.22)
      : kind === 'vowel' || kind === 'diphthong'
        ? Math.min(0.018, duration * 0.12)
        : Math.min(0.022, duration * 0.18);

  const releaseLead = kind === 'stop'
    ? Math.min(0.012, duration * 0.16)
    : kind === 'fricative'
      ? Math.min(0.018, duration * 0.14)
      : kind === 'nasal-closure'
        ? Math.min(0.01, duration * 0.12)
        : kind === 'approximant'
          ? Math.min(0.008, duration * 0.08)
          : 0;
  const releaseTail = kind === 'stop'
    ? 0.018
    : kind === 'nasal-closure'
      ? 0.03
      : kind === 'fricative'
        ? 0.04
        : kind === 'vowel' || kind === 'diphthong'
          ? 0.07
          : 0.045;

  return {
    anticipationStartTime: interval.startTime - anticipation,
    peakStartTime: interval.startTime + peakOffset,
    releaseStartTime: interval.endTime - releaseLead,
    releaseEndTime: interval.endTime + releaseTail,
  };
}

function prosodicStrength(interval: PhonemeInterval): number {
  const markedStress = interval.phone.includes('ˈ')
    ? 2
    : interval.phone.includes('ˌ')
      ? 1
      : interval.stress;
  const stressGain = markedStress === 2 ? 1.08 : markedStress === 1 ? 1.04 : 1;
  const emphasis = clamp(interval.emphasis ?? 1, 0.82, 1.2);
  const rate = clamp(interval.speakingRate ?? 1, 0.65, 1.6);
  const rateGain = clamp(1.04 - (rate - 1) * 0.08, 0.94, 1.08);
  return clamp(stressGain * emphasis * rateGain, 0.82, 1.24);
}

function buildViseme(
  interval: PhonemeInterval,
  previous: PhonemeInterval | undefined,
  next: PhonemeInterval | undefined,
): PreparedViseme {
  const normalizedPhone = normalizePhoneForRig(
    interval.normalizedPhone || interval.phone,
  );
  const trajectory = diphthongPoses(normalizedPhone);
  const pose = poseForPhone(normalizedPhone);
  const gestureKind = gestureKindForPhone(normalizedPhone, trajectory);
  const previousPhone = previous
    ? normalizePhoneForRig(previous.normalizedPhone || previous.phone)
    : '';
  const nextPhone = next
    ? normalizePhoneForRig(next.normalizedPhone || next.phone)
    : '';
  const duration = Math.max(0, interval.endTime - interval.startTime);
  let dominance = gestureKind === 'stop'
    ? 1.18
    : gestureKind === 'nasal-closure'
      ? 1.12
      : gestureKind === 'fricative'
        ? 1.08
        : gestureKind === 'vowel'
          ? 0.92
          : gestureKind === 'diphthong'
            ? 0.96
            : 1;
  if (duration < 0.055 && gestureKind === 'stop') dominance += 0.08;
  if (
    (gestureKind === 'stop' || gestureKind === 'nasal-closure') &&
    (VOWEL_PATTERN.test(previousPhone) || VOWEL_PATTERN.test(nextPhone))
  ) {
    dominance += 0.03;
  }
  dominance = clamp(dominance, 0.8, 1.3);

  return {
    phone: interval.phone,
    normalizedPhone,
    startTime: interval.startTime,
    endTime: interval.endTime,
    ...phaseTiming(
      interval,
      pose,
      gestureKind,
      Boolean(previousPhone && !SILENCE_PHONES.has(previousPhone)),
    ),
    pose,
    gestureKind,
    startPose: trajectory?.start ?? pose,
    endPose: trajectory?.end ?? pose,
    dominance,
    strength: prosodicStrength(interval),
  };
}

function envelopeAt(interval: PreparedViseme, time: number): number {
  if (
    interval.gestureKind === 'silence' ||
    time < interval.anticipationStartTime ||
    time > interval.releaseEndTime
  ) {
    return 0;
  }
  if (time < interval.peakStartTime) {
    return smoothstep(
      interval.anticipationStartTime,
      interval.peakStartTime,
      time,
    );
  }
  if (time <= interval.releaseStartTime) return 1;
  return 1 - smoothstep(
    interval.releaseStartTime,
    interval.releaseEndTime,
    time,
  );
}

function poseAt(interval: PreparedViseme, time: number): SpeechRigPose {
  if (interval.gestureKind !== 'diphthong') return interval.pose;
  const duration = Math.max(0.001, interval.endTime - interval.startTime);
  const progress = clamp01((time - interval.startTime) / duration);
  const transition = smoothstep(0.16, 0.86, progress);
  return interpolatePoses(interval.startPose, interval.endPose, transition);
}

function burstAt(interval: PreparedViseme, time: number): number {
  if (interval.gestureKind !== 'stop') return 0;
  const start = interval.releaseStartTime;
  const end = interval.releaseEndTime;
  if (time < start || time > end) return 0;
  const peak = start + (end - start) * 0.36;
  return time <= peak
    ? smoothstep(start, peak, time)
    : 1 - smoothstep(peak, end, time);
}

function normalizeGroup(
  weights: SpeechRigWeights,
  targets: readonly SpeechRigTarget[],
): void {
  const sum = targets.reduce((total, target) => total + weights[target], 0);
  if (sum <= 1) return;
  for (const target of targets) weights[target] /= sum;
}

function applyArticulationConstraints(weights: SpeechRigWeights): void {
  normalizeGroup(weights, MOUTH_SHAPE_TARGETS);
  normalizeGroup(weights, TONGUE_CONTACT_TARGETS);
  normalizeGroup(weights, ['tongueBodyHigh', 'tongueBodyLow']);
  normalizeGroup(weights, ['tongueForward', 'tongueRetract']);
  normalizeGroup(weights, ['lipRollIn', 'lipRollOut']);
  normalizeGroup(weights, ['mouthCornersUp', 'mouthCornersDown']);

  const bilabialClosure = Math.max(
    weights.lipsTogether,
    weights.contactBilabial,
  );
  weights.jawOpen *= 1 - bilabialClosure * 0.965;
  weights.lipPucker *= 1 - weights.contactLabiodental * 0.7;
  weights.lipRollOut *= 1 - weights.contactLabiodental * 0.78;

  if (weights.contactDental > 0.45) {
    const inhibition = 1 - weights.contactDental * 0.86;
    weights.tongueTipUp *= inhibition;
    weights.tongueTipLateral *= inhibition;
    weights.tongueDorsumUp *= 1 - weights.contactDental * 0.55;
  }
  if (weights.contactLateral > 0.45) {
    weights.tongueTipUp *= 1 - weights.contactLateral * 0.88;
  }
  if (weights.contactAlveolar > 0.45) {
    weights.tongueTipLateral *= 1 - weights.contactAlveolar * 0.88;
  }

  for (const target of SPEECH_RIG_TARGETS) {
    weights[target] = clamp01(weights[target]);
  }
}

function contributionScale(target: SpeechRigTarget, strength: number): number {
  if (HARD_CONTACT_TARGETS.has(target)) return Math.max(1, strength);
  if (TONGUE_TARGETS.has(target)) return 0.96 + (strength - 1) * 0.45;
  return strength;
}

function addContribution(
  weights: SpeechRigWeights,
  target: SpeechRigTarget,
  contribution: number,
  dominance: number,
): void {
  const effective = clamp01(
    contribution * clamp(0.9 + (dominance - 0.8) * 0.28, 0.9, 1.04),
  );
  if (HARD_CONTACT_TARGETS.has(target)) {
    weights[target] = Math.max(weights[target], effective);
    return;
  }
  // A dominance-aware saturating union preserves independent coarticulators
  // while preventing two overlapping gestures from exceeding the rig range.
  weights[target] = 1 - (1 - weights[target]) * (1 - effective);
}

function applyAcousticConditioning(
  weights: SpeechRigWeights,
  acoustic: SpeechAcousticFrame | undefined,
): void {
  if (!acoustic) return;
  const energy = clamp01(acoustic.energy);
  const voicing = clamp01(acoustic.voicing);
  const pitchOffset = acoustic.pitchHz > 0
    ? clamp((acoustic.pitchHz - 165) / 300, -0.25, 0.25)
    : 0;
  const jawGain = 0.9 + energy * 0.16 + voicing * 0.025;
  const vowelGain = 0.94 + energy * 0.1 + voicing * 0.025 + pitchOffset * 0.04;
  const lipGain = 0.96 + energy * 0.07;

  weights.jawOpen *= jawGain;
  weights.jawForward *= 0.97 + energy * 0.06;
  for (const target of MOUTH_SHAPE_TARGETS) weights[target] *= vowelGain;
  for (const target of [
    'lipPucker',
    'lipFunnel',
    'lipStretch',
    'mouthStretch',
  ] as const) {
    weights[target] *= lipGain;
  }
  if (weights.correctiveSibilantGroove > 0) {
    weights.correctiveSibilantGroove *=
      0.94 + clamp01(acoustic.highFrequency) * 0.1;
  }
}

function dynamicsSeconds(
  target: SpeechRigTarget,
  rising: boolean,
  masterScale: number,
): number {
  let seconds: number;
  if (HARD_CONTACT_TARGETS.has(target)) seconds = rising ? 0.01 : 0.012;
  else if (JAW_TARGETS.has(target)) seconds = rising ? 0.04 : 0.055;
  else if (TONGUE_TARGETS.has(target)) seconds = rising ? 0.018 : 0.025;
  else if (LIP_TARGETS.has(target)) seconds = rising ? 0.022 : 0.03;
  else if (VOWEL_TARGETS.has(target)) seconds = rising ? 0.032 : 0.044;
  else seconds = rising ? 0.028 : 0.036;
  return Math.max(0.003, seconds * masterScale);
}

export class CoarticulationEngine {
  private readonly dynamicsScale: number;
  private readonly current = makeWeights();
  private readonly velocity = makeWeights();
  private visemes: PreparedViseme[];
  private acousticFrames: readonly SpeechAcousticFrame[];
  private audioStartTime: number | undefined;
  private lastClockTime: number;

  constructor(
    private readonly audioClock: AudioClock,
    phonemes: readonly PhonemeInterval[],
    options: CoarticulationEngineOptions = {},
  ) {
    const smoothingSeconds = Math.max(0.005, options.smoothingSeconds ?? 0.04);
    this.dynamicsScale = smoothingSeconds / 0.04;
    this.visemes = this.prepareTimeline(phonemes);
    this.acousticFrames = this.prepareAcousticFrames(options.acousticFrames ?? []);
    this.lastClockTime = audioClock.currentTime;
  }

  private prepareTimeline(phonemes: readonly PhonemeInterval[]): PreparedViseme[] {
    return phonemes.map((interval, index) =>
      buildViseme(interval, phonemes[index - 1], phonemes[index + 1])
    );
  }

  private prepareAcousticFrames(
    frames: readonly SpeechAcousticFrame[],
  ): readonly SpeechAcousticFrame[] {
    return frames
      .filter((frame) => Number.isFinite(frame.time))
      .slice()
      .sort((first, second) => first.time - second.time);
  }

  setTimeline(phonemes: readonly PhonemeInterval[]): void {
    this.visemes = this.prepareTimeline(phonemes);
    this.reset();
  }

  /** Replaces optional deterministic waveform conditioning without changing timing. */
  setAcousticFrames(frames: readonly SpeechAcousticFrame[]): void {
    this.acousticFrames = this.prepareAcousticFrames(frames);
  }

  getVisemeIntervals(): readonly VisemeInterval[] {
    return this.visemes;
  }

  /** Use the same absolute Web Audio time passed to AudioBufferSourceNode.start(). */
  startAt(audioStartTime: number): void {
    if (!Number.isFinite(audioStartTime)) {
      throw new TypeError('audioStartTime must be finite.');
    }
    this.reset();
    this.audioStartTime = audioStartTime;
    this.lastClockTime = this.audioClock.currentTime;
  }

  reset(): void {
    this.audioStartTime = undefined;
    this.lastClockTime = this.audioClock.currentTime;
    for (const target of SPEECH_RIG_TARGETS) {
      this.current[target] = 0;
      this.velocity[target] = 0;
    }
  }

  /** Pure, unsmoothed coarticulated target weights at a playback time. */
  sampleAt(playbackTime: number): SpeechRigWeights {
    const weights = makeWeights();
    const acoustic = this.acousticFrames.length > 0
      ? sampleSpeechAcoustics(this.acousticFrames, playbackTime)
      : undefined;

    for (const viseme of this.visemes) {
      const envelope = envelopeAt(viseme, playbackTime);
      if (envelope <= 0) continue;
      const pose = poseAt(viseme, playbackTime);
      for (const target of SPEECH_RIG_TARGETS) {
        const poseWeight = pose[target] ?? 0;
        if (poseWeight <= 0) continue;
        const contribution = poseWeight * envelope *
          contributionScale(target, viseme.strength);
        addContribution(weights, target, contribution, viseme.dominance);
      }

      const burst = burstAt(viseme, playbackTime);
      if (burst > 0) {
        const transientGain = acoustic
          ? 0.82 + clamp01(acoustic.transient) * 0.4
          : 1;
        const visibleBurst = burst * transientGain;
        addContribution(weights, 'jawOpen', visibleBurst * 0.045, 1.2);
        if (BILABIALS.has(viseme.normalizedPhone)) {
          addContribution(weights, 'lowerLipDepress', visibleBurst * 0.1, 1.2);
          addContribution(weights, 'lipRollOut', visibleBurst * 0.12, 1.2);
        }
      }
    }

    applyAcousticConditioning(weights, acoustic);
    applyArticulationConstraints(weights);
    return weights;
  }

  /**
   * Samples the Web Audio clock and advances independent critically damped
   * jaw, lip, tongue, contact, and vowel responses.
   */
  update(): Readonly<SpeechRigWeights> {
    const now = this.audioClock.currentTime;
    const elapsed = Math.max(0, now - this.lastClockTime);
    this.lastClockTime = now;
    if (this.audioStartTime === undefined) return this.current;

    const targetWeights = this.sampleAt(now - this.audioStartTime);
    if (elapsed > 0.25) {
      for (const target of SPEECH_RIG_TARGETS) {
        this.current[target] = targetWeights[target];
        this.velocity[target] = 0;
      }
      return this.current;
    }

    for (const target of SPEECH_RIG_TARGETS) {
      const responseSeconds = dynamicsSeconds(
        target,
        targetWeights[target] >= this.current[target],
        this.dynamicsScale,
      );
      const omega = 2 / responseSeconds;
      const decay = Math.exp(-omega * elapsed);
      const displacement = this.current[target] - targetWeights[target];
      const transient = (this.velocity[target] + omega * displacement) * elapsed;
      this.current[target] = clamp01(
        targetWeights[target] + (displacement + transient) * decay,
      );
      this.velocity[target] =
        (this.velocity[target] - omega * transient) * decay;
    }
    return this.current;
  }
}
