import { phonemize } from 'phonemizer';

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
// Exact non-special symbol alphabet published by the timestamped Kokoro
// tokenizer. Its own normalizer silently drops everything else. Filtering the
// IPA here keeps the string used for duration alignment identical to the
// model's content-token sequence. In particular, eSpeak may emit U+0329
// (syllabic consonant) for words such as "certainly", which Kokoro omits.
const TIMESTAMPED_KOKORO_SYMBOLS = new Set(Array.from(
  ';:,.!?—…"()“” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊ' +
  'abcdefghijklmnopqrstuvwxyz' +
  'ɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪɝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔ' +
  'ˈˌːʰʲ↓→↗↘ᵻ',
));
const PUNCTUATION_RUN = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`,
  'gu',
);

interface TextPart {
  punctuation: boolean;
  text: string;
}

function splitPunctuation(text: string): TextPart[] {
  const result: TextPart[] = [];
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

/** Kokoro-specific IPA substitutions used by its published English frontend. */
export function applyTimestampedKokoroPhonemeFixups(ipa: string): string {
  const fixed = ipa
    .replace(/kəkˈoːɹoʊ/gu, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/gu, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/gu, 'j')
    .replace(/r/gu, 'ɹ')
    .replace(/x/gu, 'k')
    .replace(/ɬ/gu, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/gu, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/gu, 'z')
    .replace(/(?<=nˈaɪn)ti(?!ː)/gu, 'di')
    .trim();
  return Array.from(fixed.normalize('NFC'))
    .filter((symbol) => TIMESTAMPED_KOKORO_SYMBOLS.has(symbol))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Convert already-normalized American English speech text to the exact IPA
 * alphabet expected by Kokoro. Written-form expansion belongs to the shared
 * SpokenTextNormalizer so the LLM subtitle, G2P, and synthesizer stay aligned.
 */
export async function phonemizeForTimestampedKokoro(text: string): Promise<string> {
  const clean = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!clean) throw new Error('Timestamped Kokoro received an empty clause.');

  const parts = splitPunctuation(clean);
  const ipa = (
    await Promise.all(parts.map(async ({ punctuation, text: part }) =>
      punctuation ? part : (await phonemize(part, 'en-us')).join(' ')
    ))
  ).join('');
  const compatible = applyTimestampedKokoroPhonemeFixups(ipa);
  if (!compatible) throw new Error('Timestamped Kokoro could not phonemize the clause.');
  return compatible;
}
