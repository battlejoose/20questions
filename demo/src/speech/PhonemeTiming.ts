import { normalizePhoneForRig } from './CoarticulationEngine';
import type {
  CharacterAlignment,
  PhonemeInterval,
  WordTiming,
} from './types';

export type WordPhonemizer = (
  word: string,
  language: string,
) => Promise<string | readonly string[]>;

export interface PhonemeTimelineOptions {
  language?: string;
  phonemizeWord?: WordPhonemizer;
  minSilenceSeconds?: number;
}

interface CharacterSegment {
  characterIndex: number;
  textStart: number;
  textEnd: number;
  startTime: number;
  endTime: number;
}

interface AnnotatedPhone {
  phone: string;
  stress: 0 | 1 | 2;
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

function assertFiniteTiming(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite, non-negative number.`);
  }
}

export function validateCharacterAlignment(
  alignment: CharacterAlignment,
): void {
  const { characters, characterStartTimesSeconds, characterEndTimesSeconds } =
    alignment;

  if (
    characters.length === 0 ||
    characters.length !== characterStartTimesSeconds.length ||
    characters.length !== characterEndTimesSeconds.length
  ) {
    throw new TypeError('Character alignment arrays must have equal, non-zero lengths.');
  }

  let previousStart = -1;
  for (let index = 0; index < characters.length; index += 1) {
    const start = characterStartTimesSeconds[index];
    const end = characterEndTimesSeconds[index];
    assertFiniteTiming(start, `Character ${index} start`);
    assertFiniteTiming(end, `Character ${index} end`);

    if (end < start) {
      throw new TypeError(`Character ${index} ends before it starts.`);
    }
    if (start < previousStart) {
      throw new TypeError('Character alignment starts must be monotonic.');
    }
    previousStart = start;
  }
}

function characterSegments(alignment: CharacterAlignment): CharacterSegment[] {
  let textOffset = 0;
  return alignment.characters.map((character, characterIndex) => {
    const textStart = textOffset;
    textOffset += character.length;
    return {
      characterIndex,
      textStart,
      textEnd: textOffset,
      startTime: alignment.characterStartTimesSeconds[characterIndex],
      endTime: alignment.characterEndTimesSeconds[characterIndex],
    };
  });
}

/** Extracts Unicode word spans while retaining exact ElevenLabs timing indices. */
export function extractWordTimings(
  alignment: CharacterAlignment,
): WordTiming[] {
  validateCharacterAlignment(alignment);
  const text = alignment.characters.join('');
  const segments = characterSegments(alignment);
  const wordPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const words: WordTiming[] = [];

  for (const match of text.matchAll(wordPattern)) {
    const textStart = match.index;
    const textEnd = textStart + match[0].length;
    const overlapping = segments.filter(
      (segment) => segment.textEnd > textStart && segment.textStart < textEnd,
    );

    if (overlapping.length === 0) {
      continue;
    }

    const first = overlapping[0];
    const last = overlapping[overlapping.length - 1];
    words.push({
      text: match[0],
      wordIndex: words.length,
      startTime: first.startTime,
      endTime: last.endTime,
      characterStart: first.characterIndex,
      characterEnd: last.characterIndex + 1,
    });
  }

  return words;
}

function tokenizeIpaAnnotated(ipa: string): AnnotatedPhone[] {
  const input = ipa.normalize('NFC');
  const phones: AnnotatedPhone[] = [];
  let pendingStress: 0 | 1 | 2 = 0;

  const appendPhone = (phone: string): void => {
    const normalized = normalizePhoneForRig(phone);
    const isVowel = /[ɑɒæaɐɛeəɜɚɝʌiɪyɔouʊ]/u.test(normalized);
    phones.push({ phone, stress: isVowel ? pendingStress : 0 });
    if (isVowel) pendingStress = 0;
  };

  for (let offset = 0; offset < input.length; ) {
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
    if (codePoint === undefined) {
      break;
    }
    const symbol = String.fromCodePoint(codePoint);
    offset += symbol.length;

    if (symbol === 'ˈ' || symbol === 'ˌ') {
      pendingStress = symbol === 'ˈ' ? 2 : 1;
      continue;
    }
    if (/^[\s._|,;:!?()[\]{}"“”]+$/u.test(symbol)) {
      continue;
    }
    if (/^[ːˑ]$/u.test(symbol)) {
      if (phones.length > 0) {
        phones[phones.length - 1].phone += symbol;
      }
      continue;
    }
    if (symbol === '͡') {
      const nextCodePoint = input.codePointAt(offset);
      if (phones.length > 0 && nextCodePoint !== undefined) {
        const next = String.fromCodePoint(nextCodePoint);
        phones[phones.length - 1].phone += symbol + next;
        offset += next.length;
      }
      continue;
    }
    if (/^\p{M}$/u.test(symbol)) {
      if (phones.length > 0) {
        phones[phones.length - 1].phone += symbol;
      }
      continue;
    }
    if (/^\p{L}$/u.test(symbol) || symbol === 'ʔ') {
      appendPhone(symbol);
    }
  }

  return phones;
}

/** Splits eSpeak IPA output into phones while preserving affricates/diphthongs. */
export function tokenizeIpa(ipa: string): string[] {
  return tokenizeIpaAnnotated(ipa).map(({ phone }) => phone);
}

export const espeakWordPhonemizer: WordPhonemizer = async (
  word,
  language,
) => {
  const { phonemize } = await import('phonemizer');
  const [ipa = ''] = await phonemize(word, language);
  return ipa;
};

function durationWeight(phone: string): number {
  const normalized = normalizePhoneForRig(phone);
  if (/[ɑɒæaɐɛeəɜɚɝʌiɪyɔouʊ]/u.test(normalized)) {
    return normalized.length > 1 ? 1.9 : 1.55;
  }
  if (/^(tʃ|dʒ)$/u.test(normalized)) {
    return 1.15;
  }
  if (/^[pbtdkg]$/u.test(normalized)) {
    return 0.72;
  }
  if (/^[fvθðszʃʒh]$/u.test(normalized)) {
    return 1.05;
  }
  return 1;
}

function intervalsForWord(
  word: WordTiming,
  phones: readonly AnnotatedPhone[],
): PhonemeInterval[] {
  if (phones.length === 0) {
    throw new Error(`Phonemizer returned no phones for word ${word.wordIndex}.`);
  }

  const weights = phones.map(({ phone, stress }) =>
    durationWeight(phone) * (stress === 2 ? 1.14 : stress === 1 ? 1.07 : 1),
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const duration = Math.max(0, word.endTime - word.startTime);
  const secondsPerWeight = duration / Math.max(totalWeight, 1e-6);
  const speakingRate = Math.min(1.65, Math.max(0.62, 0.082 / Math.max(0.025, secondsPerWeight)));
  let accumulatedWeight = 0;

  return phones.map(({ phone, stress }, phoneIndex) => {
    const startTime =
      word.startTime + duration * (accumulatedWeight / totalWeight);
    accumulatedWeight += weights[phoneIndex];
    const endTime =
      phoneIndex === phones.length - 1
        ? word.endTime
        : word.startTime + duration * (accumulatedWeight / totalWeight);

    return {
      phone,
      normalizedPhone: normalizePhoneForRig(phone),
      startTime,
      endTime,
      word: word.text,
      wordIndex: word.wordIndex,
      source: 'estimated-from-character-alignment',
      stress,
      emphasis: stress === 2 ? 1.12 : stress === 1 ? 1.055 : 1,
      speakingRate,
    };
  });
}

export async function buildPhonemeTimeline(
  alignment: CharacterAlignment,
  options: PhonemeTimelineOptions = {},
): Promise<PhonemeInterval[]> {
  const language = options.language ?? 'en-us';
  const phonemizeWord = options.phonemizeWord ?? espeakWordPhonemizer;
  const minSilenceSeconds = Math.max(0, options.minSilenceSeconds ?? 0.03);
  const words = extractWordTimings(alignment);
  const pronunciations = new Map<string, Promise<string | readonly string[]>>();
  const pronunciationFor = (word: string): Promise<string | readonly string[]> => {
    const cacheKey = `${language}\0${word.toLocaleLowerCase('en-US')}`;
    let pending = pronunciations.get(cacheKey);
    if (!pending) {
      pending = phonemizeWord(word, language);
      pronunciations.set(cacheKey, pending);
    }
    return pending;
  };
  // Browser-side G2P can be more noticeable than the network round trip on a
  // long phrase. Resolve distinct words concurrently, then assemble intervals
  // in the original deterministic order.
  const phonemeResults = await Promise.all(
    words.map((word) => pronunciationFor(word.text)),
  );
  const intervals: PhonemeInterval[] = [];
  let previousWordEnd: number | undefined;

  for (const [wordIndex, word] of words.entries()) {
    if (
      previousWordEnd !== undefined &&
      word.startTime - previousWordEnd >= minSilenceSeconds
    ) {
      intervals.push({
        phone: 'sil',
        normalizedPhone: 'sil',
        startTime: previousWordEnd,
        endTime: word.startTime,
        word: null,
        wordIndex: null,
        source: 'silence-gap',
      });
    }

    const result = phonemeResults[wordIndex];
    const phones = typeof result === 'string'
      ? tokenizeIpaAnnotated(result)
      : Array.from(result, (phone) => ({ phone, stress: 0 as const }));
    intervals.push(...intervalsForWord(word, phones));
    previousWordEnd = word.endTime;
  }

  return intervals;
}
