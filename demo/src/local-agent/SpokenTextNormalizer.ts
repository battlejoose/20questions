const SMALL_NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

const SCALES = [
  { value: 1_000_000_000_000, name: 'trillion' },
  { value: 1_000_000_000, name: 'billion' },
  { value: 1_000_000, name: 'million' },
  { value: 1_000, name: 'thousand' },
] as const;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const UNIT_NAMES: Readonly<Record<string, string>> = {
  km: 'kilometers',
  m: 'meters',
  cm: 'centimeters',
  mm: 'millimeters',
  kg: 'kilograms',
  g: 'grams',
  mg: 'milligrams',
  lb: 'pounds',
  lbs: 'pounds',
  oz: 'ounces',
  mph: 'miles per hour',
  kph: 'kilometers per hour',
  hz: 'hertz',
  khz: 'kilohertz',
  mhz: 'megahertz',
  ghz: 'gigahertz',
  kb: 'kilobytes',
  mb: 'megabytes',
  gb: 'gigabytes',
  tb: 'terabytes',
  ms: 'milliseconds',
  sec: 'seconds',
  min: 'minutes',
  hr: 'hours',
  hrs: 'hours',
  c: 'degrees celsius',
  f: 'degrees fahrenheit',
};

const LETTER_NAMES: Readonly<Record<string, string>> = {
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I',
  J: 'J', K: 'K', L: 'L', M: 'M', N: 'N', O: 'O', P: 'P', Q: 'Q', R: 'R',
  S: 'S', T: 'T', U: 'U', V: 'V', W: 'W', X: 'X', Y: 'Y', Z: 'Z',
};

function underOneThousand(value: number): string {
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const remainder = value % 10;
    return remainder ? `${tens} ${SMALL_NUMBERS[remainder]}` : tens;
  }
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  return remainder
    ? `${SMALL_NUMBERS[hundreds]} hundred ${underOneThousand(remainder)}`
    : `${SMALL_NUMBERS[hundreds]} hundred`;
}

export function integerToSpokenWords(value: number): string {
  if (!Number.isSafeInteger(value)) return String(value);
  if (value < 0) return `minus ${integerToSpokenWords(Math.abs(value))}`;
  if (value < 1_000) return underOneThousand(value);
  for (const scale of SCALES) {
    if (value >= scale.value) {
      const leading = Math.floor(value / scale.value);
      const remainder = value % scale.value;
      return remainder
        ? `${integerToSpokenWords(leading)} ${scale.name} ${integerToSpokenWords(remainder)}`
        : `${integerToSpokenWords(leading)} ${scale.name}`;
    }
  }
  return String(value);
}

function decimalToWords(raw: string): string {
  const normalized = raw.replaceAll(',', '');
  const [whole, fraction] = normalized.split('.');
  const wholeNumber = Number.parseInt(whole, 10);
  if (!fraction) return integerToSpokenWords(wholeNumber);
  return `${integerToSpokenWords(wholeNumber)} point ${Array.from(fraction, (digit) => SMALL_NUMBERS[Number(digit)]).join(' ')}`;
}

function ordinalToWords(raw: string): string {
  const value = Number.parseInt(raw, 10);
  const exceptions: Readonly<Record<number, string>> = {
    1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth',
    12: 'twelfth', 20: 'twentieth', 30: 'thirtieth', 40: 'fortieth',
    50: 'fiftieth', 60: 'sixtieth', 70: 'seventieth', 80: 'eightieth',
    90: 'ninetieth',
  };
  if (exceptions[value]) return exceptions[value];
  if (value > 20 && value < 100) {
    const remainder = value % 10;
    return `${TENS[Math.floor(value / 10)]} ${exceptions[remainder] ?? `${SMALL_NUMBERS[remainder]}th`}`;
  }
  return `${integerToSpokenWords(value)}th`;
}

function spellInitialism(value: string): string {
  return Array.from(value, (letter) => LETTER_NAMES[letter] ?? letter).join(' ');
}

function spokenUrl(raw: string): string {
  const withoutProtocol = raw.replace(/^https?:\/\//iu, '').replace(/^www\./iu, '');
  return withoutProtocol
    .replace(/[?#].*$/u, '')
    .replace(/\.(?=[\p{L}\p{N}])/gu, ' dot ')
    .replace(/\//gu, ' slash ')
    .replace(/-/gu, ' dash ')
    .replace(/_/gu, ' underscore ');
}

function spokenEmail(raw: string): string {
  return raw
    .replace('@', ' at ')
    .replace(/\./gu, ' dot ')
    .replace(/-/gu, ' dash ')
    .replace(/_/gu, ' underscore ');
}

function currencyWords(symbol: string, amount: string): string {
  const numeric = Number(amount.replaceAll(',', ''));
  if (!Number.isFinite(numeric)) return `${symbol}${amount}`;
  const whole = Math.floor(numeric);
  const cents = Math.round((numeric - whole) * 100);
  const currency = symbol === '$'
    ? whole === 1 ? 'dollar' : 'dollars'
    : symbol === '€'
      ? whole === 1 ? 'euro' : 'euros'
      : whole === 1 ? 'pound' : 'pounds';
  const main = `${integerToSpokenWords(whole)} ${currency}`;
  return cents > 0
    ? `${main} and ${integerToSpokenWords(cents)} ${cents === 1 ? 'cent' : 'cents'}`
    : main;
}

function normalizeIsoDate(year: string, month: string, day: string): string {
  const monthIndex = Number.parseInt(month, 10) - 1;
  const dayNumber = Number.parseInt(day, 10);
  const yearNumber = Number.parseInt(year, 10);
  if (!MONTHS[monthIndex] || dayNumber < 1 || dayNumber > 31) {
    return `${year} ${month} ${day}`;
  }
  return `${MONTHS[monthIndex]} ${ordinalToWords(day)}, ${integerToSpokenWords(yearNumber)}`;
}

/**
 * Produces one deterministic, engine-neutral English speech string. The same
 * output must be sent to synthesis, G2P, and any forced-alignment stage.
 * Display text intentionally remains separate from this canonical form.
 */
export function normalizeSpokenText(input: string): string {
  let text = input.normalize('NFKC');
  text = text
    // Model families occasionally leak XML-like chat/template wrappers. Strip
    // the complete tag before punctuation cleanup so its name is never spoken.
    .replace(/<\|[^<>|]+\|>/gu, ' ')
    .replace(/<\/?[A-Za-z][A-Za-z0-9_.:-]*(?:\s[^<>]*?)?\s*\/?>/gu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, ' ')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’´`]/gu, "'")
    .replace(/[–—‑]/gu, '-');

  text = text
    .replace(/\bhttps?:\/\/[^\s<>()]+/giu, (match) => spokenUrl(match))
    .replace(/\bwww\.[^\s<>()]+/giu, (match) => spokenUrl(match))
    .replace(/\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu, (match) => spokenEmail(match))
    .replace(/\be\.g\.(?=\s|,|$)/giu, 'for example')
    .replace(/\bi\.e\.(?=\s|,|$)/giu, 'that is')
    .replace(/\betc\.(?=\s|,|$)/giu, 'and so on')
    .replace(/\bDr\.(?=\s)/gu, 'doctor')
    .replace(/\bProf\.(?=\s)/gu, 'professor')
    .replace(/\bMr\.(?=\s)/gu, 'mister')
    .replace(/\bMrs\.(?=\s)/gu, 'missus')
    .replace(/\bMs\.(?=\s)/gu, 'miss');

  text = text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, (_match, year: string, month: string, day: string) =>
      normalizeIsoDate(year, month, day))
    .replace(/\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?\b/giu,
      (_match, hour: string, minute: string, meridiem?: string) => {
        const minuteNumber = Number.parseInt(minute, 10);
        const minuteWords = minuteNumber === 0
          ? "o'clock"
          : minuteNumber < 10
            ? `oh ${integerToSpokenWords(minuteNumber)}`
            : integerToSpokenWords(minuteNumber);
        const suffix = meridiem ? ` ${meridiem.toLowerCase()} m` : '';
        return `${integerToSpokenWords(Number.parseInt(hour, 10))} ${minuteWords}${suffix}`;
      })
    .replace(/([$€£])\s*(\d[\d,]*(?:\.\d{1,2})?)/gu,
      (_match, symbol: string, amount: string) => currencyWords(symbol, amount))
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*%/gu,
      (_match, amount: string) => `${decimalToWords(amount)} percent`)
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*°\s*([CF])\b/giu,
      (_match, amount: string, unit: string) =>
        `${decimalToWords(amount)} ${UNIT_NAMES[unit.toLowerCase()]}`)
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*(km|cm|mm|kg|mg|lbs?|oz|mph|kph|[kmg]hz|[kmgt]b|ms|sec|min|hrs?)\b/giu,
      (_match, amount: string, unit: string) =>
        `${decimalToWords(amount)} ${UNIT_NAMES[unit.toLowerCase()]}`)
    .replace(/\b(\d+)(st|nd|rd|th)\b/giu, (_match, value: string) => ordinalToWords(value))
    .replace(/(?<![\p{L}\p{N}])(\d[\d,]*\.\d+)(?![\p{L}\p{N}])/gu,
      (_match, value: string) => decimalToWords(value))
    .replace(/(?<![\p{L}\p{N}])(\d[\d,]*)(?![\p{L}\p{N}])/gu,
      (_match, value: string) => integerToSpokenWords(Number.parseInt(value.replaceAll(',', ''), 10)));

  text = text
    .replace(/\b[A-Z]{2,6}\b/gu, (match) => spellInitialism(match))
    .replace(/&/gu, ' and ')
    .replace(/@/gu, ' at ')
    .replace(/\+/gu, ' plus ')
    .replace(/=/gu, ' equals ')
    .replace(/\//gu, ' slash ')
    .replace(/[_|#<>\\]/gu, ' ')
    .replace(/\s+([,.!?;:])/gu, '$1')
    .replace(/([,.!?;:]){2,}/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();

  if (text && !/[.!?;:]$/u.test(text)) text += '.';
  return text;
}
