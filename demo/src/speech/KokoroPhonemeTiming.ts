import { normalizePhoneForRig } from './CoarticulationEngine';
import type { PhonemeInterval, PhonemeTimingSource } from './types';

export type KokoroPhonemeInput = string | readonly PhonemeInterval[];

export type EstimatedLocalPhonemeTimingSource = Extract<
  PhonemeTimingSource,
  'estimated-from-kokoro-phonemes' | 'estimated-from-local-phonemes'
>;

export interface KokoroPhonemeToken {
  phone: string;
  normalizedPhone: string;
  stress: 0 | 1 | 2;
  wordIndex: number | null;
}

const MULTI_SYMBOL_PHONES = [
  't͡ʃ',
  'd͡ʒ',
  'tʃ',
  'dʒ',
  'aɪ',
  'ɑɪ',
  'aʊ',
  'ɑʊ',
  'eɪ',
  'oʊ',
  'əʊ',
  'ɔɪ',
  'oɪ',
  'ɪə',
  'eə',
  'ʊə',
] as const;

const VOWEL_PATTERN = /[ɑɒæaɐɛəɜɚɝʌiɪyɔouʊᵻ]/u;
const PUNCTUATION_PATTERN = /^[,;:!?–—…]$/u;
const SENTENCE_PUNCTUATION_PATTERN = /^[.!?…]$/u;
const PHONETIC_MODIFIER_PATTERN = /^[ʰʲʷˠˤⁿˡ]$/u;

function isVowel(phone: string): boolean {
  return VOWEL_PATTERN.test(normalizePhoneForRig(phone));
}

function durationWeight(token: KokoroPhonemeToken): number {
  if (token.normalizedPhone === 'sil') return 1.18;
  if (isVowel(token.phone)) {
    const diphthongOrLong =
      token.phone.includes('ː') || token.phone.includes('ˑ') ||
      Array.from(token.normalizedPhone).filter((symbol) =>
        VOWEL_PATTERN.test(symbol),
      ).length > 1;
    return (diphthongOrLong ? 1.9 : 1.55) *
      (token.stress === 2 ? 1.14 : token.stress === 1 ? 1.07 : 1);
  }
  if (/^(tʃ|dʒ)$/u.test(token.normalizedPhone)) return 1.15;
  if (/^[pbtdkg]$/u.test(token.normalizedPhone)) return 0.72;
  if (/^[fvθðszʃʒh]$/u.test(token.normalizedPhone)) return 1.05;
  return 1;
}

function textWords(text: string): string[] {
  return Array.from(
    text.normalize('NFKC').matchAll(
      /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu,
    ),
    (match) => match[0],
  );
}

/**
 * Tokenizes the IPA string emitted by Kokoro/Misaki without any server or
 * phonemizer dependency. Affricates, diphthongs, length, combining marks,
 * lexical stress, word boundaries, and explicit punctuation pauses survive.
 */
export function tokenizeKokoroIpa(ipa: string): KokoroPhonemeToken[] {
  const input = ipa.normalize('NFC').trim();
  if (!input) return [];

  const tokens: KokoroPhonemeToken[] = [];
  let pendingStress: 0 | 1 | 2 = 0;
  let currentWordIndex = 0;
  let wordHasPhone = false;
  let pendingWordBoundary = false;

  const beginWordIfNeeded = (): void => {
    if (pendingWordBoundary && wordHasPhone) currentWordIndex += 1;
    if (pendingWordBoundary) wordHasPhone = false;
    pendingWordBoundary = false;
  };

  const appendPhone = (phone: string): void => {
    beginWordIfNeeded();
    const stress = isVowel(phone) ? pendingStress : 0;
    tokens.push({
      phone,
      normalizedPhone: normalizePhoneForRig(phone),
      stress,
      wordIndex: currentWordIndex,
    });
    wordHasPhone = true;
    if (isVowel(phone)) pendingStress = 0;
  };

  const updateLastPhone = (suffix: string): void => {
    const last = tokens[tokens.length - 1];
    if (!last || last.normalizedPhone === 'sil') return;
    last.phone += suffix;
    last.normalizedPhone = normalizePhoneForRig(last.phone);
  };

  const appendPause = (): void => {
    const last = tokens[tokens.length - 1];
    if (!last || last.normalizedPhone === 'sil') return;
    tokens.push({
      phone: 'sil',
      normalizedPhone: 'sil',
      stress: 0,
      wordIndex: null,
    });
  };

  for (let offset = 0; offset < input.length;) {
    const remainder = input.slice(offset);
    const multiSymbol = MULTI_SYMBOL_PHONES.find((phone) =>
      remainder.startsWith(phone),
    );
    if (multiSymbol) {
      appendPhone(multiSymbol);
      offset += multiSymbol.length;
      continue;
    }

    const codePoint = input.codePointAt(offset);
    if (codePoint === undefined) break;
    const symbol = String.fromCodePoint(codePoint);
    offset += symbol.length;

    if (symbol === 'ˈ' || symbol === 'ˌ') {
      pendingStress = symbol === 'ˈ' ? 2 : 1;
      continue;
    }
    if (/^\s$/u.test(symbol) || symbol === '|' || symbol === '_') {
      pendingWordBoundary = wordHasPhone;
      continue;
    }
    if (PUNCTUATION_PATTERN.test(symbol) || symbol === '.') {
      appendPause();
      pendingWordBoundary = wordHasPhone;
      if (SENTENCE_PUNCTUATION_PATTERN.test(symbol)) pendingStress = 0;
      continue;
    }
    if (/^[()[\]{}"'“”]$/u.test(symbol)) continue;
    if (/^[ːˑ]$/u.test(symbol) || /^\p{M}$/u.test(symbol)) {
      updateLastPhone(symbol);
      continue;
    }
    if (symbol === '͡') {
      const nextCodePoint = input.codePointAt(offset);
      if (nextCodePoint !== undefined) {
        const next = String.fromCodePoint(nextCodePoint);
        updateLastPhone(symbol + next);
        offset += next.length;
      }
      continue;
    }
    if (PHONETIC_MODIFIER_PATTERN.test(symbol)) {
      updateLastPhone(symbol);
      continue;
    }
    if (/^\p{L}$/u.test(symbol) || symbol === 'ʔ') appendPhone(symbol);
  }

  while (tokens.at(-1)?.normalizedPhone === 'sil') tokens.pop();
  return tokens;
}

/** Converts Kokoro IPA to a deterministic duration-scaled GNM timeline. */
export function kokoroPhonemesToIntervals(
  ipa: string,
  durationSeconds: number,
  text = '',
  timingSource: EstimatedLocalPhonemeTimingSource =
    'estimated-from-kokoro-phonemes',
): PhonemeInterval[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Audio duration must be a positive finite number.');
  }
  const tokens = tokenizeKokoroIpa(ipa);
  if (tokens.length === 0) {
    throw new TypeError('Kokoro phonemes must contain at least one IPA phone.');
  }

  const words = textWords(text);
  const weights = tokens.map(durationWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const secondsPerWeight = durationSeconds / Math.max(totalWeight, 1e-6);
  const speakingRate = Math.min(
    1.65,
    Math.max(0.62, 0.082 / Math.max(0.025, secondsPerWeight)),
  );
  let elapsedWeight = 0;

  return tokens.map((token, index) => {
    const startTime = durationSeconds * (elapsedWeight / totalWeight);
    elapsedWeight += weights[index];
    const endTime = index === tokens.length - 1
      ? durationSeconds
      : durationSeconds * (elapsedWeight / totalWeight);
    const silence = token.normalizedPhone === 'sil';
    return {
      phone: token.phone,
      normalizedPhone: token.normalizedPhone,
      startTime,
      endTime,
      word: silence || token.wordIndex === null
        ? null
        : words[token.wordIndex] ?? null,
      wordIndex: silence ? null : token.wordIndex,
      source: silence ? 'silence-gap' : timingSource,
      stress: token.stress,
      emphasis: token.stress === 2 ? 1.12 : token.stress === 1 ? 1.055 : 1,
      speakingRate,
    };
  });
}

function validatedIntervals(
  intervals: readonly PhonemeInterval[],
  durationSeconds: number,
): PhonemeInterval[] {
  if (intervals.length === 0) {
    throw new TypeError('Kokoro phoneme intervals cannot be empty.');
  }
  let previousEnd = 0;
  return intervals.map((interval, index) => {
    if (!interval || typeof interval.phone !== 'string' || !interval.phone.trim()) {
      throw new TypeError(`Kokoro phoneme ${index} has no phone.`);
    }
    if (
      !Number.isFinite(interval.startTime) ||
      !Number.isFinite(interval.endTime) ||
      interval.startTime < previousEnd ||
      interval.endTime < interval.startTime ||
      interval.endTime > durationSeconds + 1e-6
    ) {
      throw new TypeError(`Kokoro phoneme ${index} has invalid timing.`);
    }
    previousEnd = interval.endTime;
    const normalizedPhone = normalizePhoneForRig(interval.phone);
    return {
      ...interval,
      normalizedPhone,
      source: normalizedPhone === 'sil'
        ? 'silence-gap'
        : interval.source ?? 'estimated-from-kokoro-phonemes',
    };
  });
}

/** Resolves either Kokoro's IPA string or an already-timed interval track. */
export function resolveKokoroPhonemeIntervals(
  input: KokoroPhonemeInput,
  durationSeconds: number,
  text = '',
  timingSource: EstimatedLocalPhonemeTimingSource =
    'estimated-from-kokoro-phonemes',
): PhonemeInterval[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('Audio duration must be a positive finite number.');
  }
  return typeof input === 'string'
    ? kokoroPhonemesToIntervals(input, durationSeconds, text, timingSource)
    : validatedIntervals(input, durationSeconds);
}
