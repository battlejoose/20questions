import { tokenizeKokoroIpa } from '../../speech/KokoroPhonemeTiming';
import type { PhonemeInterval } from '../../speech/types';

export const KOKORO_SAMPLE_RATE = 24_000;
export const KOKORO_DURATION_FRAME_RATE = 40;

export interface SynthesisNativePhonemeInterval extends PhonemeInterval {
  /** The relative boundary came from the duration predictor used by synthesis. */
  timingOrigin: 'synthesis-native';
}

export interface NativeTimingInput {
  text: string;
  phonemes: string;
  /** Durations returned by the timestamped model, including BOS and EOS. */
  modelDurationsFrames: ArrayLike<number>;
  audioDurationSeconds: number;
}

const STRESS_SYMBOL = /^[ˈˌ]$/u;

function wordsIn(text: string): string[] {
  return Array.from(
    text.normalize('NFKC').matchAll(
      /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu,
    ),
    (match) => match[0],
  );
}

function emphasisForStress(stress: 0 | 1 | 2): number {
  return stress === 2 ? 1.12 : stress === 1 ? 1.055 : 1;
}

function speakingRateFor(
  speechDurationSeconds: number,
  phoneCount: number,
): number {
  if (phoneCount === 0 || speechDurationSeconds <= 0) return 1;
  const secondsPerPhone = speechDurationSeconds / phoneCount;
  return Math.min(1.65, Math.max(0.62, 0.082 / Math.max(0.025, secondsPerPhone)));
}

function numericDurations(values: ArrayLike<number>): number[] {
  return Array.from(values, (value, index) => {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError(`Kokoro duration ${index} is not a non-negative finite number.`);
    }
    return duration;
  });
}

/**
 * Remove Kokoro's BOS/EOS duration entries and verify the character-token
 * invariant used by the model's own tokenizer. Keeping this check explicit is
 * preferable to silently assigning a duration to the wrong articulator.
 */
export function kokoroContentDurations(
  phonemes: string,
  modelDurationsFrames: ArrayLike<number>,
): number[] {
  const symbolCount = Array.from(phonemes.normalize('NFC')).length;
  const durations = numericDurations(modelDurationsFrames);
  if (durations.length !== symbolCount + 2) {
    throw new Error(
      `Timestamped Kokoro returned ${durations.length} durations for ` +
      `${symbolCount} phoneme symbols (expected BOS + symbols + EOS).`,
    );
  }
  return durations.slice(1, -1);
}

interface SymbolSpan {
  start: number;
  end: number;
}

function findPhoneSpans(phonemes: string): Array<{
  phone: ReturnType<typeof tokenizeKokoroIpa>[number];
  span: SymbolSpan;
}> {
  const symbols = Array.from(phonemes.normalize('NFC'));
  const phones = tokenizeKokoroIpa(phonemes);
  const result: Array<{
    phone: ReturnType<typeof tokenizeKokoroIpa>[number];
    span: SymbolSpan;
  }> = [];
  let cursor = 0;

  for (const phone of phones) {
    if (phone.normalizedPhone === 'sil') continue;
    const target = Array.from(phone.phone.normalize('NFC'));
    let foundAt = -1;
    for (let start = cursor; start <= symbols.length - target.length; start += 1) {
      if (target.every((symbol, offset) => symbols[start + offset] === symbol)) {
        foundAt = start;
        break;
      }
    }
    if (foundAt < 0) {
      throw new Error(`Could not align Kokoro phone "${phone.phone}" to its tokenizer symbols.`);
    }
    let spanStart = foundAt;
    while (spanStart > cursor && STRESS_SYMBOL.test(symbols[spanStart - 1])) {
      spanStart -= 1;
    }
    const spanEnd = foundAt + target.length;
    result.push({ phone, span: { start: spanStart, end: spanEnd } });
    cursor = spanEnd;
  }
  return result;
}

function sum(values: readonly number[], start: number, end: number): number {
  let total = 0;
  for (let index = start; index < end; index += 1) total += values[index] ?? 0;
  return total;
}

/**
 * Converts the durations used by Kokoro's waveform generator into a GNM-ready
 * phone track. Timings are uniformly scaled to the actual PCM duration to
 * absorb sub-frame rounding while retaining every native relative boundary.
 */
export function kokoroNativeDurationsToIntervals(
  input: NativeTimingInput,
): SynthesisNativePhonemeInterval[] {
  if (!Number.isFinite(input.audioDurationSeconds) || input.audioDurationSeconds <= 0) {
    throw new TypeError('Kokoro PCM duration must be a positive finite number.');
  }
  const rawPhonemes = input.phonemes.normalize('NFC');
  const symbols = Array.from(rawPhonemes);
  const durations = kokoroContentDurations(rawPhonemes, input.modelDurationsFrames);
  const phoneSpans = findPhoneSpans(rawPhonemes);
  if (phoneSpans.length === 0) {
    throw new TypeError('Timestamped Kokoro returned no speakable phonemes.');
  }

  const modelFrameTotal = durations.reduce((total, value) => total + value, 0);
  if (!(modelFrameTotal > 0)) {
    throw new Error('Timestamped Kokoro returned an empty duration track.');
  }
  const secondsPerFrame = input.audioDurationSeconds / modelFrameTotal;
  const words = wordsIn(input.text);
  const intervals: SynthesisNativePhonemeInterval[] = [];
  const speechFrameTotal = phoneSpans.reduce(
    (total, item) => total + sum(durations, item.span.start, item.span.end),
    0,
  );
  const rate = speakingRateFor(
    speechFrameTotal * secondsPerFrame,
    phoneSpans.length,
  );
  let cursor = 0;
  let elapsedFrames = 0;

  const appendSilence = (start: number, end: number): void => {
    // Symbols omitted by the visual phone tokenizer are punctuation,
    // whitespace, or non-articulated marks. Preserve all of their duration as
    // an explicit closed-mouth interval rather than leaving an uncovered gap.
    const silenceFrames = sum(durations, start, end);
    if (silenceFrames <= 0) return;
    const startTime = elapsedFrames * secondsPerFrame;
    elapsedFrames += silenceFrames;
    intervals.push({
      phone: 'sil',
      normalizedPhone: 'sil',
      startTime,
      endTime: elapsedFrames * secondsPerFrame,
      word: null,
      wordIndex: null,
      source: 'silence-gap',
      stress: 0,
      emphasis: 1,
      speakingRate: rate,
      timingOrigin: 'synthesis-native',
    });
  };

  for (const { phone, span } of phoneSpans) {
    appendSilence(cursor, span.start);
    const startTime = elapsedFrames * secondsPerFrame;
    elapsedFrames += sum(durations, span.start, span.end);
    const endTime = elapsedFrames * secondsPerFrame;
    const wordIndex = phone.wordIndex;
    intervals.push({
      phone: phone.phone,
      normalizedPhone: phone.normalizedPhone,
      startTime,
      endTime,
      word: wordIndex === null ? null : words[wordIndex] ?? null,
      wordIndex,
      source: 'estimated-from-kokoro-phonemes',
      stress: phone.stress,
      emphasis: emphasisForStress(phone.stress),
      speakingRate: rate,
      timingOrigin: 'synthesis-native',
    });
    cursor = span.end;
  }

  appendSilence(cursor, symbols.length);
  const accountedFrames = elapsedFrames;
  if (accountedFrames < modelFrameTotal) {
    // BOS/EOS are excluded above; this catches only content symbols that have
    // no visual articulation. Preserve them as a terminal closed-mouth hold.
    const startTime = accountedFrames * secondsPerFrame;
    intervals.push({
      phone: 'sil',
      normalizedPhone: 'sil',
      startTime,
      endTime: input.audioDurationSeconds,
      word: null,
      wordIndex: null,
      source: 'silence-gap',
      stress: 0,
      emphasis: 1,
      speakingRate: rate,
      timingOrigin: 'synthesis-native',
    });
  } else {
    const last = intervals.at(-1);
    if (last) last.endTime = input.audioDurationSeconds;
  }

  // Numerical noise must never violate SpeechController's range check.
  let previousEnd = 0;
  for (const interval of intervals) {
    interval.startTime = Math.max(previousEnd, Math.min(input.audioDurationSeconds, interval.startTime));
    interval.endTime = Math.max(
      interval.startTime,
      Math.min(input.audioDurationSeconds, interval.endTime),
    );
    previousEnd = interval.endTime;
  }
  return intervals.filter((interval) => interval.endTime > interval.startTime);
}
