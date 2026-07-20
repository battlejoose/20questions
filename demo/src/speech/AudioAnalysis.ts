import type { PhonemeInterval } from './types';

/**
 * Deterministic short-time acoustic measurements extracted from decoded PCM.
 * These are deliberately small DSP features, not learned embeddings or model
 * inference. Values are normalized to 0..1 except pitchHz.
 */
export interface SpeechAcousticFrame {
  time: number;
  energy: number;
  voicing: number;
  pitchHz: number;
  transient: number;
  highFrequency: number;
}

export interface PcmAudioLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AcousticAnalysisOptions {
  frameSeconds?: number;
  hopSeconds?: number;
  minimumPitchHz?: number;
  maximumPitchHz?: number;
}

const VOWEL_PATTERN = /[ɑɒæaɐɛeəɜɚɝʌiɪyɔouʊ]/u;
const PLOSIVES = new Set(['p', 'b', 't', 'd', 'k', 'g']);
const FRICATIVES = new Set(['f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h']);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((first, second) => first - second);
  const position = clamp01(fraction) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function normalizeRange(
  value: number,
  floor: number,
  ceiling: number,
): number {
  if (ceiling <= floor + 1e-9) return value > floor ? 1 : 0;
  return clamp01((value - floor) / (ceiling - floor));
}

function downmix(audio: PcmAudioLike): Float32Array {
  const mono = new Float32Array(audio.length);
  const channels = Math.max(1, audio.numberOfChannels);
  for (let channel = 0; channel < channels; channel += 1) {
    const source = audio.getChannelData(channel);
    const count = Math.min(source.length, mono.length);
    for (let index = 0; index < count; index += 1) {
      mono[index] += source[index] / channels;
    }
  }
  return mono;
}

function normalizedAutocorrelation(
  samples: Float32Array,
  start: number,
  count: number,
  lag: number,
): number {
  let correlation = 0;
  let firstEnergy = 0;
  let secondEnergy = 0;
  // A stride of two retains more than enough resolution for a prosody cue and
  // keeps analysis inexpensive for longer generated phrases.
  for (let offset = 0; offset + lag < count; offset += 2) {
    const first = samples[start + offset] ?? 0;
    const second = samples[start + offset + lag] ?? 0;
    correlation += first * second;
    firstEnergy += first * first;
    secondEnergy += second * second;
  }
  const denominator = Math.sqrt(firstEnergy * secondEnergy);
  return denominator > 1e-10 ? correlation / denominator : 0;
}

/** Extracts a compact acoustic track at a default 100 Hz update rate. */
export function analyzeSpeechAudio(
  audio: PcmAudioLike,
  options: AcousticAnalysisOptions = {},
): SpeechAcousticFrame[] {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    throw new TypeError('Audio sampleRate must be a positive finite number.');
  }
  if (!Number.isInteger(audio.length) || audio.length < 0) {
    throw new TypeError('Audio length must be a non-negative integer.');
  }
  if (audio.length === 0) return [];

  const frameSize = Math.max(
    32,
    Math.round(audio.sampleRate * (options.frameSeconds ?? 0.025)),
  );
  const hopSize = Math.max(
    1,
    Math.round(audio.sampleRate * (options.hopSeconds ?? 0.01)),
  );
  const minimumPitchHz = Math.max(45, options.minimumPitchHz ?? 70);
  const maximumPitchHz = Math.max(
    minimumPitchHz + 1,
    options.maximumPitchHz ?? 360,
  );
  const minimumLag = Math.max(2, Math.floor(audio.sampleRate / maximumPitchHz));
  const maximumLag = Math.min(
    frameSize - 2,
    Math.ceil(audio.sampleRate / minimumPitchHz),
  );
  const mono = downmix(audio);
  const raw: Array<SpeechAcousticFrame & { rawEnergy: number; rawTransient: number }> = [];
  let previousEnergy = 0;

  for (let start = 0; start < mono.length; start += hopSize) {
    const count = Math.min(frameSize, mono.length - start);
    if (count < 16) break;
    let squareSum = 0;
    let differenceSquareSum = 0;
    let zeroCrossings = 0;
    let previous = mono[start] ?? 0;
    for (let offset = 0; offset < count; offset += 1) {
      const sample = mono[start + offset] ?? 0;
      squareSum += sample * sample;
      if (offset > 0) {
        const difference = sample - previous;
        differenceSquareSum += difference * difference;
        if ((sample >= 0) !== (previous >= 0)) zeroCrossings += 1;
      }
      previous = sample;
    }

    const rms = Math.sqrt(squareSum / count);
    const differenceRms = Math.sqrt(differenceSquareSum / Math.max(1, count - 1));
    const zeroCrossingRate = zeroCrossings / Math.max(1, count - 1);
    const highFrequency = clamp01(
      differenceRms / Math.max(0.0001, rms * 1.7) * 0.72 +
        zeroCrossingRate * 0.9,
    );

    let bestCorrelation = 0;
    let bestLag = 0;
    if (rms > 1e-5 && maximumLag >= minimumLag) {
      for (let lag = minimumLag; lag <= maximumLag; lag += 2) {
        const correlation = normalizedAutocorrelation(
          mono,
          start,
          count,
          lag,
        );
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestLag = lag;
        }
      }
    }
    const voicing = clamp01((bestCorrelation - 0.18) / 0.68);
    const rawTransient = Math.max(0, rms - previousEnergy) +
      Math.abs(rms - previousEnergy) * highFrequency * 0.35;
    previousEnergy = rms;
    raw.push({
      time: (start + count * 0.5) / audio.sampleRate,
      energy: 0,
      voicing,
      pitchHz: voicing > 0.12 && bestLag > 0 ? audio.sampleRate / bestLag : 0,
      transient: 0,
      highFrequency,
      rawEnergy: rms,
      rawTransient,
    });
  }

  const noiseFloor = percentile(raw.map((frame) => frame.rawEnergy), 0.12);
  const speechCeiling = percentile(raw.map((frame) => frame.rawEnergy), 0.94);
  const transientCeiling = percentile(
    raw.map((frame) => frame.rawTransient),
    0.95,
  );
  return raw.map(({ rawEnergy, rawTransient, ...frame }) => ({
    ...frame,
    energy: normalizeRange(rawEnergy, noiseFloor, speechCeiling),
    transient: normalizeRange(rawTransient, 0, transientCeiling),
  }));
}

/** Linearly samples the analysis track at an arbitrary playback time. */
export function sampleSpeechAcoustics(
  frames: readonly SpeechAcousticFrame[],
  time: number,
): SpeechAcousticFrame {
  const silent: SpeechAcousticFrame = {
    time,
    energy: 0,
    voicing: 0,
    pitchHz: 0,
    transient: 0,
    highFrequency: 0,
  };
  if (frames.length === 0 || !Number.isFinite(time)) return silent;
  if (time <= frames[0].time) return { ...frames[0], time };
  if (time >= frames[frames.length - 1].time) {
    return { ...frames[frames.length - 1], time };
  }

  let low = 0;
  let high = frames.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }
  const first = frames[low];
  const second = frames[high];
  const mix = clamp01((time - first.time) / Math.max(1e-9, second.time - first.time));
  const interpolate = (a: number, b: number): number => a + (b - a) * mix;
  return {
    time,
    energy: interpolate(first.energy, second.energy),
    voicing: interpolate(first.voicing, second.voicing),
    pitchHz: interpolate(first.pitchHz, second.pitchHz),
    transient: interpolate(first.transient, second.transient),
    highFrequency: interpolate(first.highFrequency, second.highFrequency),
  };
}

function phoneContrastScore(
  frames: readonly SpeechAcousticFrame[],
  index: number,
  previousPhone: string,
  nextPhone: string,
): number {
  const before = frames[Math.max(0, index - 1)];
  const current = frames[index];
  const after = frames[Math.min(frames.length - 1, index + 1)];
  const energyDelta = Math.abs(after.energy - before.energy);
  const voicingDelta = Math.abs(after.voicing - before.voicing);
  const highFrequencyDelta = Math.abs(after.highFrequency - before.highFrequency);
  let score = energyDelta * 0.8 + voicingDelta * 0.85 + highFrequencyDelta * 0.55;

  if (PLOSIVES.has(previousPhone)) {
    score += current.transient * 1.35 + Math.max(0, after.energy - before.energy) * 0.75;
  } else if (PLOSIVES.has(nextPhone)) {
    score += (1 - current.energy) * 0.28 + highFrequencyDelta * 0.4;
  }
  if (VOWEL_PATTERN.test(previousPhone) !== VOWEL_PATTERN.test(nextPhone)) {
    score += voicingDelta * 0.65 + energyDelta * 0.35;
  }
  if (FRICATIVES.has(previousPhone) || FRICATIVES.has(nextPhone)) {
    score += highFrequencyDelta * 0.75;
  }
  return score;
}

function isDurationEstimatedLocalSource(
  source: PhonemeInterval['source'],
): boolean {
  return source === 'estimated-from-kokoro-phonemes' ||
    source === 'estimated-from-local-phonemes';
}

/**
 * Refines phone boundaries near their estimated time using local waveform
 * changes. Provider word edges remain locked; duration-only local IPA estimates
 * may move across text word boundaries because they have no provider clock.
 */
export function refinePhonemeTimelineWithAudio(
  phonemes: readonly PhonemeInterval[],
  frames: readonly SpeechAcousticFrame[],
): PhonemeInterval[] {
  const refined = phonemes.map((interval) => ({ ...interval }));
  if (frames.length < 3 || refined.length < 2) return refined;

  for (let index = 0; index < refined.length - 1; index += 1) {
    const previous = refined[index];
    const next = refined[index + 1];
    const localEstimatedBoundary =
      isDurationEstimatedLocalSource(phonemes[index].source) &&
      isDurationEstimatedLocalSource(phonemes[index + 1].source);
    if (
      previous.wordIndex === null ||
      (!localEstimatedBoundary && previous.wordIndex !== next.wordIndex) ||
      previous.normalizedPhone === 'sil' ||
      next.normalizedPhone === 'sil'
    ) {
      continue;
    }

    const estimate = previous.endTime;
    const previousDuration = estimate - previous.startTime;
    const nextDuration = next.endTime - estimate;
    const searchRadius = Math.min(
      0.05,
      previousDuration * 0.36,
      nextDuration * 0.36,
    );
    if (searchRadius < 0.006) continue;
    const lower = Math.max(previous.startTime + 0.018, estimate - searchRadius);
    const upper = Math.min(next.endTime - 0.018, estimate + searchRadius);
    if (upper <= lower) continue;

    let bestTime = estimate;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let frameIndex = 1; frameIndex < frames.length - 1; frameIndex += 1) {
      const frame = frames[frameIndex];
      if (frame.time < lower || frame.time > upper) continue;
      const displacementPenalty = Math.abs(frame.time - estimate) /
        Math.max(searchRadius, 1e-6) * 0.24;
      const score = phoneContrastScore(
        frames,
        frameIndex,
        previous.normalizedPhone,
        next.normalizedPhone,
      ) - displacementPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestTime = frame.time;
      }
    }

    if (bestScore > 0.12 && Math.abs(bestTime - estimate) >= 0.002) {
      previous.endTime = bestTime;
      next.startTime = bestTime;
      // Preserve provenance so diagnostics distinguish the estimated boundary
      // from the boundary selected from decoded PCM features.
      previous.source = 'waveform-refined';
      next.source = 'waveform-refined';
    }
  }
  return refined;
}
