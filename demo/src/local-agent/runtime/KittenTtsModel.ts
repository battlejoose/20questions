export const KITTEN_TTS_MODEL_ID = 'kitten-tts-nano-0.8-fp32-webgpu' as const;

export type KittenTtsModelId = typeof KITTEN_TTS_MODEL_ID;
export type KittenTtsBackend = 'webgpu' | 'wasm';
export type KittenTtsVoice =
  | 'Bella'
  | 'Jasper'
  | 'Luna'
  | 'Bruno'
  | 'Rosie'
  | 'Hugo'
  | 'Kiki'
  | 'Leo';

export interface KittenTtsCapabilities {
  readonly audio: 'pcm-f32';
  readonly sampleRate: 24_000;
  readonly exactInputPhonemes: true;
  readonly nativePhonemeTimings: false;
  readonly nativeWordTimings: false;
  readonly timingNote: string;
}

/**
 * Kitten's public ONNX graph has one waveform output. The IPA returned by this
 * adapter is exactly what was fed to that graph, but the model does not export
 * its internal duration prediction. Callers must not label heuristic timings
 * derived from this IPA as synthesis-native.
 */
export const KITTEN_TTS_CAPABILITIES: KittenTtsCapabilities = Object.freeze({
  audio: 'pcm-f32',
  sampleRate: 24_000,
  exactInputPhonemes: true,
  nativePhonemeTimings: false,
  nativeWordTimings: false,
  timingNote:
    'KittenTTS 0.8 exports waveform audio only; lip timing requires the shared heuristic or a separate aligner.',
});

export const KITTEN_TTS_VOICES: readonly KittenTtsVoice[] = Object.freeze([
  'Bella',
  'Jasper',
  'Luna',
  'Bruno',
  'Rosie',
  'Hugo',
  'Kiki',
  'Leo',
]);

export function isKittenTtsModelId(value: string): value is KittenTtsModelId {
  return value === KITTEN_TTS_MODEL_ID;
}

const PUNCTUATION = ';:,.!?¡¿—…“”«»()[]{}';
const PUNCTUATION_RUN = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}]+\\s*)+`,
  'gu',
);

export interface KittenTextPart {
  readonly punctuation: boolean;
  readonly text: string;
}

export function splitKittenPunctuation(text: string): KittenTextPart[] {
  const result: KittenTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PUNCTUATION_RUN)) {
    const index = match.index;
    if (index > cursor) {
      result.push({ punctuation: false, text: text.slice(cursor, index) });
    }
    if (match[0]) result.push({ punctuation: true, text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    result.push({ punctuation: false, text: text.slice(cursor) });
  }
  return result;
}

const PAD = '$';
// Keep duplicate quote symbols: the official Python table contains them and
// their positions determine every following token ID.
const MODEL_PUNCTUATION = ';:,.!?¡¿—…"«»"" ';
const ASCII_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const IPA_LETTERS =
  "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
const MODEL_SYMBOLS = [PAD, ...MODEL_PUNCTUATION, ...ASCII_LETTERS, ...IPA_LETTERS];
const MODEL_SYMBOL_INDEX = new Map(MODEL_SYMBOLS.map((symbol, index) => [symbol, index]));

/** Mirrors KittenML's Python `basic_english_tokenize` with Unicode word chars. */
export function joinKittenPhonemeTokens(phonemes: string): string {
  return (phonemes.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []).join(' ');
}

/** Mirrors the official TextCleaner, including its start and two end tokens. */
export function tokenizeKittenPhonemes(phonemes: string): number[] {
  const joined = joinKittenPhonemeTokens(phonemes.normalize('NFC'));
  const tokens: number[] = [];
  for (const symbol of joined) {
    const index = MODEL_SYMBOL_INDEX.get(symbol);
    if (index !== undefined) tokens.push(index);
  }
  tokens.unshift(0);
  tokens.push(10, 0);
  return tokens;
}

export function trimKittenWaveform(audio: Float32Array): Float32Array {
  // The official Python runtime removes the model's fixed 5,000-sample tail.
  const outputLength = Math.max(0, audio.length - 5_000);
  return audio.slice(0, outputLength);
}
