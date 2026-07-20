export const PERFORMANCE_AFFECTS = [
  'neutral',
  'warm',
  'surprise',
  'question',
  'concerned',
  'emphatic',
] as const;

export type PerformanceAffect = (typeof PERFORMANCE_AFFECTS)[number];

export const PERFORMANCE_DISCOURSE_ACTS = [
  'statement',
  'affirmation',
  'negation',
  'question',
  'request',
  'warning',
  'appreciation',
] as const;

export type PerformanceDiscourseAct = (typeof PERFORMANCE_DISCOURSE_ACTS)[number];

export type PerformanceIntentSource =
  | 'llm-directive'
  | 'requested-emotion'
  | 'contextual-fallback'
  | 'text-fallback';

export interface PerformanceIntent {
  readonly affect: PerformanceAffect;
  readonly intensity: number;
  readonly discourseAct: PerformanceDiscourseAct;
  readonly confidence: number;
  readonly source: PerformanceIntentSource;
}

export interface PerformanceIntentInferenceInput {
  readonly userText?: string;
  readonly assistantText: string;
}

export const PERFORMANCE_GESTURES = [
  'none',
  'smile',
  'surprise',
  'concern',
  'curiosity',
  'emphasis',
  'nod',
  'shake',
  'glance_left',
  'glance_right',
  'reset',
] as const;

export type PerformanceGesture = (typeof PERFORMANCE_GESTURES)[number];
export type PerformanceActionOnset = 'immediate' | 'speech';

/** A semantic physical action selected by the LLM, never raw rig weights. */
export interface PerformanceAction {
  readonly gesture: PerformanceGesture;
  readonly intensity: number;
  readonly onset: PerformanceActionOnset;
  readonly holdSeconds: number;
  readonly releaseSeconds: number;
  readonly valence: number;
  readonly arousal: number;
  readonly dominance: number;
  readonly source: 'llm-directive';
}

export type PerformanceDirectivePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'intent'; readonly intent: PerformanceIntent }
  | { readonly type: 'action'; readonly action: PerformanceAction };

export const PERFORMANCE_DIRECTIVE_PREFIX = '[[face:';
export const PERFORMANCE_ACTION_DIRECTIVE_PREFIX = '[[perform:';
const MAX_DIRECTIVE_CHARACTERS = 320;

const AFFECT_SET = new Set<string>(PERFORMANCE_AFFECTS);
const DISCOURSE_SET = new Set<string>(PERFORMANCE_DISCOURSE_ACTS);
const GESTURE_SET = new Set<string>(PERFORMANCE_GESTURES);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function recoverSpeechFromMalformedDirective(value: string): string {
  const body = value
    .replace(/^\[\[/u, '')
    .replace(/\]\]$/u, '')
    .trim();
  const match = body.match(
    /^face\s*:\s*[a-z]+\s*:\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*:\s*[a-z]+\s+(.+)$/isu,
  );
  const recovered = match?.[1]?.trim() ?? '';
  return /[\p{L}\p{N}]/u.test(recovered) ? recovered : '';
}

const REQUESTED_AFFECT_PATTERNS: ReadonlyArray<readonly [PerformanceAffect, RegExp]> = [
  ['surprise', /\b(?:act|look|sound|be|seem|respond|speak|express|show|pretend)\b.{0,32}\b(?:surpris(?:ed|ing)|astonished|amazed|shocked|startled)\b|\bwith (?:a |an )?(?:surpris(?:ed|ing)|astonished|amazed)\b/iu],
  ['warm', /\b(?:act|look|sound|be|seem|respond|speak|express|show|pretend)\b.{0,32}\b(?:happy|joyful|cheerful|warm|friendly|delighted|excited|smiling)\b|\bwith (?:a )?(?:warmth|joy|delight|smile)\b/iu],
  ['concerned', /\b(?:act|look|sound|be|seem|respond|speak|express|show|pretend)\b.{0,32}\b(?:sad|concerned|worried|sympathetic|gentle|apologetic)\b|\bwith (?:a )?(?:concern|sadness|sympathy)\b/iu],
  ['emphatic', /\b(?:act|look|sound|be|seem|respond|speak|express|show|pretend)\b.{0,32}\b(?:serious|stern|angry|firm|emphatic|confident)\b|\bwith (?:a )?(?:serious|stern|firm|emphatic) (?:tone|expression|voice)\b/iu],
  ['question', /\b(?:act|look|sound|be|seem|respond|speak|express|show|pretend)\b.{0,32}\b(?:curious|inquisitive|questioning|wondering)\b|\bwith (?:a )?(?:curious|inquisitive|questioning) (?:tone|expression|look)\b/iu],
];

const POSITIVE_PATTERN = /\b(?:yes|yeah|great|good|glad|happy|love|thanks?|wonderful|excellent|beautiful|relaxing|delight(?:ed|ful)?|absolutely|certainly)\b/iu;
const SURPRISE_PATTERN = /\b(?:wow|amazing|astonishing|incredible|unexpected|surpris(?:e|ed|ing)|remarkable)\b/iu;
const CONCERN_PATTERN = /\b(?:sorry|unfortunately|concern(?:ed)?|careful|worry|worried|difficult|problem|risk|afraid|cannot|can't|sad)\b/iu;
const EMPHATIC_PATTERN = /\b(?:must|never|always|important|definitely|exactly|strongly|crucial|essential)\b/iu;

function normalize(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function requestedAffect(userText: string): PerformanceAffect | undefined {
  for (const [affect, pattern] of REQUESTED_AFFECT_PATTERNS) {
    if (pattern.test(userText)) return affect;
  }
  return undefined;
}

function inferDiscourseAct(
  userText: string,
  assistantText: string,
): PerformanceDiscourseAct {
  const combined = `${userText} ${assistantText}`;
  if (/\b(?:warning|warn|danger|dangerous|risk|careful|avoid)\b/iu.test(combined)) return 'warning';
  if (/\b(?:thank|appreciat|wonderful|beautiful|love)\b/iu.test(assistantText)) return 'appreciation';
  if (/\b(?:no|not|never|cannot|can't|won't|do not|don't)\b/iu.test(assistantText)) return 'negation';
  if (/\b(?:yes|agree|certainly|absolutely|correct|indeed)\b/iu.test(assistantText)) return 'affirmation';
  if (/\?/u.test(assistantText) || /\?/u.test(userText)) return 'question';
  if (/\b(?:please|could you|would you|can you|will you)\b/iu.test(userText)) return 'request';
  return 'statement';
}

function textualAffect(text: string): PerformanceAffect {
  if (SURPRISE_PATTERN.test(text)) return 'surprise';
  if (CONCERN_PATTERN.test(text)) return 'concerned';
  if (/\?/u.test(text)) return 'question';
  const positive = POSITIVE_PATTERN.test(text);
  if (EMPHATIC_PATTERN.test(text) || (/!/u.test(text) && !positive)) return 'emphatic';
  if (positive) return 'warm';
  return 'neutral';
}

export function inferPerformanceIntent(
  input: PerformanceIntentInferenceInput,
): PerformanceIntent {
  const userText = normalize(input.userText);
  const assistantText = normalize(input.assistantText);
  const requested = requestedAffect(userText);
  const affect = requested ?? textualAffect(assistantText);
  const discourseAct = inferDiscourseAct(userText, assistantText);
  const punctuationBoost = /!/u.test(assistantText) ? 0.08 : 0;
  const intensityByAffect: Record<PerformanceAffect, number> = {
    neutral: 0.32,
    warm: 0.72,
    surprise: 0.84,
    question: 0.68,
    concerned: 0.7,
    emphatic: 0.76,
  };
  return {
    affect,
    intensity: clamp01(intensityByAffect[affect] + punctuationBoost + (requested ? 0.08 : 0)),
    discourseAct,
    confidence: requested ? 0.96 : affect === 'neutral' ? 0.46 : 0.72,
    source: requested
      ? 'requested-emotion'
      : userText
        ? 'contextual-fallback'
        : 'text-fallback',
  };
}

export function parsePerformanceDirective(value: string): PerformanceIntent | null {
  const match = value.trim().match(
    /^\[\[face:([a-z]+):(0(?:\.\d+)?|1(?:\.0+)?):([a-z]+)\]\]$/u,
  );
  if (!match) return null;
  const [, rawAffect, rawIntensity, rawAct] = match;
  if (!AFFECT_SET.has(rawAffect) || !DISCOURSE_SET.has(rawAct)) return null;
  const intensity = Number(rawIntensity);
  if (!Number.isFinite(intensity)) return null;
  return {
    affect: rawAffect as PerformanceAffect,
    intensity: clamp01(intensity),
    discourseAct: rawAct as PerformanceDiscourseAct,
    confidence: 0.9,
    source: 'llm-directive',
  };
}

function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

export function parsePerformanceActionDirective(value: string): PerformanceAction | null {
  const match = value.trim().match(/^\[\[perform:([^\]]+)\]\]$/iu);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const item of match[1].split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) return null;
    const key = item.slice(0, separator).trim().toLowerCase();
    const fieldValue = item.slice(separator + 1).trim().toLowerCase();
    if (!key || !fieldValue || fields.has(key)) return null;
    fields.set(key, fieldValue);
  }
  const allowed = new Set([
    'gesture', 'intensity', 'onset', 'hold', 'release',
    'valence', 'arousal', 'dominance',
  ]);
  if ([...fields.keys()].some((key) => !allowed.has(key))) return null;
  const gesture = fields.get('gesture');
  if (!gesture || !GESTURE_SET.has(gesture)) return null;
  const onset = fields.get('onset') ?? 'immediate';
  if (onset !== 'immediate' && onset !== 'speech') return null;
  const intensity = parseBoundedNumber(fields.get('intensity'), gesture === 'none' ? 0 : 0.65, 0, 1);
  const holdSeconds = parseBoundedNumber(fields.get('hold'), 1.2, 0, 4);
  const releaseSeconds = parseBoundedNumber(fields.get('release'), 0.65, 0.1, 3);
  const valence = parseBoundedNumber(fields.get('valence'), 0, -1, 1);
  const arousal = parseBoundedNumber(fields.get('arousal'), 0, -1, 1);
  const dominance = parseBoundedNumber(fields.get('dominance'), 0, -1, 1);
  if (
    intensity === null || holdSeconds === null || releaseSeconds === null ||
    valence === null || arousal === null || dominance === null
  ) return null;
  return {
    gesture: gesture as PerformanceGesture,
    intensity,
    onset,
    holdSeconds,
    releaseSeconds,
    valence,
    arousal,
    dominance,
    source: 'llm-directive',
  };
}

const DIRECTIVE_MARKERS = ['[[face', '[[perform'] as const;

function firstDirectiveMarker(value: string): number {
  const lower = value.toLowerCase();
  let result = -1;
  for (const marker of DIRECTIVE_MARKERS) {
    const index = lower.indexOf(marker);
    if (index >= 0 && (result < 0 || index < result)) result = index;
  }
  return result;
}

function appendTextPart(parts: PerformanceDirectivePart[], text: string): void {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.type === 'text') {
    parts[parts.length - 1] = { type: 'text', text: previous.text + text };
  } else {
    parts.push({ type: 'text', text });
  }
}

function retainedDirectivePrefixLength(value: string): number {
  const lower = value.toLowerCase();
  let retained = 0;
  for (const marker of DIRECTIVE_MARKERS) {
    const maximum = Math.min(marker.length, lower.length);
    for (let length = maximum; length > retained; length -= 1) {
      if (marker.startsWith(lower.slice(-length))) {
        retained = length;
        break;
      }
    }
  }
  return retained;
}

/**
 * Removes any number of hidden face directives without ever pronouncing them.
 * Structured intent and speech are returned as ordered parts so a directive
 * appearing between sentences can change only the sentence that follows it.
 */
export class PerformanceDirectiveStream {
  private pending = '';
  private resolvedIntent: PerformanceIntent | null = null;
  private resolvedAction: PerformanceAction | null = null;
  private trimDirectiveSeparator = false;

  get intent(): PerformanceIntent | null {
    return this.resolvedIntent;
  }

  get action(): PerformanceAction | null {
    return this.resolvedAction;
  }

  feed(chunk: string): string {
    return this.feedParts(chunk)
      .filter((part): part is Extract<PerformanceDirectivePart, { type: 'text' }> =>
        part.type === 'text')
      .map((part) => part.text)
      .join('');
  }

  flush(): string {
    return this.flushParts()
      .filter((part): part is Extract<PerformanceDirectivePart, { type: 'text' }> =>
        part.type === 'text')
      .map((part) => part.text)
      .join('');
  }

  feedParts(chunk: string): PerformanceDirectivePart[] {
    if (chunk) this.pending += chunk;
    return this.drain(false);
  }

  flushParts(): PerformanceDirectivePart[] {
    return this.drain(true);
  }

  private drain(flush: boolean): PerformanceDirectivePart[] {
    const parts: PerformanceDirectivePart[] = [];
    while (this.pending) {
      if (this.trimDirectiveSeparator) {
        const trimmed = this.pending.replace(/^\s+/u, '');
        this.pending = trimmed;
        // A directive may arrive in one model token and its separating space
        // in the next. Keep this latch armed until real prose arrives.
        if (!trimmed) break;
        this.trimDirectiveSeparator = false;
      }
      const marker = firstDirectiveMarker(this.pending);
      if (marker < 0) {
        if (flush) {
          appendTextPart(parts, this.pending);
          this.pending = '';
          break;
        }
        const retained = retainedDirectivePrefixLength(this.pending);
        const boundary = this.pending.length - retained;
        appendTextPart(parts, this.pending.slice(0, boundary));
        this.pending = this.pending.slice(boundary);
        break;
      }
      if (marker > 0) {
        appendTextPart(parts, this.pending.slice(0, marker));
        this.pending = this.pending.slice(marker);
        continue;
      }

      const close = this.pending.indexOf(']]');
      if (close >= 0) {
        const directive = this.pending.slice(0, close + 2);
        const parsedIntent = parsePerformanceDirective(directive.toLowerCase());
        const parsedAction = parsePerformanceActionDirective(directive);
        if (parsedIntent || parsedAction) {
          if (parsedIntent) {
            this.resolvedIntent = parsedIntent;
            parts.push({ type: 'intent', intent: parsedIntent });
          } else if (parsedAction) {
            this.resolvedAction = parsedAction;
            parts.push({ type: 'action', action: parsedAction });
          }
          this.pending = this.pending.slice(close + 2);
          this.trimDirectiveSeparator = true;
        } else {
          const trailing = this.pending.slice(close + 2).replace(/^\s+/u, '');
          const recovered = recoverSpeechFromMalformedDirective(directive);
          appendTextPart(parts, recovered);
          if (recovered && trailing && !/^[,.;:!?)}\]]/u.test(trailing)) {
            appendTextPart(parts, ' ');
          }
          this.pending = trailing;
        }
        continue;
      }

      const newline = this.pending.search(/[\r\n]/u);
      if (!flush && this.pending.length <= MAX_DIRECTIVE_CHARACTERS && newline < 0) break;
      const malformedEnd = newline >= 0 ? newline : this.pending.length;
      appendTextPart(
        parts,
        recoverSpeechFromMalformedDirective(this.pending.slice(0, malformedEnd)),
      );
      this.pending = newline >= 0
        ? this.pending.slice(newline + 1).replace(/^\s+/u, '')
        : '';
    }
    return parts;
  }
}
