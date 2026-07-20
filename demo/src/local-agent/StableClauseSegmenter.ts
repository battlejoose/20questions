export interface StableClauseSegmenterOptions {
  /** Forces a boundary at the next whitespace after this size. */
  readonly maxClauseCharacters?: number;
  /** A shorter first phrase reduces time-to-first-audio for local TTS. */
  readonly firstClauseCharacters?: number;
}

const DEFAULT_MAX_CLAUSE_CHARACTERS = 180;
const CLOSING_PUNCTUATION = new Set(['"', "'", '”', '’', ')', ']', '}']);
const COMMON_ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
]);

const normalizeClause = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim();

const hasSpeakableContent = (value: string): boolean =>
  /[\p{L}\p{N}]/u.test(value);

/**
 * Incrementally finds immutable speech clauses. Punctuation at the current end
 * of a token stream is deliberately held until a later whitespace arrives (or
 * flush is called), so an emitted clause never needs to be retracted.
 */
export class StableClauseSegmenter {
  private buffer = '';
  private readonly maxClauseCharacters: number;
  private readonly firstClauseCharacters: number;
  private emittedClauses = 0;

  constructor(options: StableClauseSegmenterOptions = {}) {
    const max = options.maxClauseCharacters ?? DEFAULT_MAX_CLAUSE_CHARACTERS;
    if (!Number.isInteger(max) || max < 16) {
      throw new RangeError('maxClauseCharacters must be an integer of at least 16.');
    }
    this.maxClauseCharacters = max;
    const first = options.firstClauseCharacters ?? max;
    if (!Number.isInteger(first) || first < 16) {
      throw new RangeError('firstClauseCharacters must be an integer of at least 16.');
    }
    this.firstClauseCharacters = Math.min(first, max);
  }

  feed(chunk: string): readonly string[] {
    if (!chunk) return [];
    this.buffer += chunk;
    return this.extractStableClauses(false);
  }

  flush(): readonly string[] {
    return this.extractStableClauses(true);
  }

  /**
   * Commits a safe word-boundary prefix after an idle gap in a token stream.
   * This keeps speech responsive when a model pauses without punctuation while
   * avoiding a split inside the word currently being decoded.
   */
  flushPendingPrefix(minimumCharacters = 24): readonly string[] {
    if (!Number.isInteger(minimumCharacters) || minimumCharacters < 1) {
      throw new RangeError('minimumCharacters must be a positive integer.');
    }
    if (this.buffer.trim().length < minimumCharacters) return [];

    let boundary = this.buffer.length;
    if (!/\s$/u.test(this.buffer)) {
      const lastWhitespace = this.buffer.search(/\s+\S*$/u);
      if (lastWhitespace < minimumCharacters) return [];
      boundary = lastWhitespace + 1;
    }

    const clauses: string[] = [];
    this.emitThrough(boundary, clauses);
    return clauses;
  }

  /**
   * Releases only a complete comma/dash-delimited phrase after a model pause.
   * Unlike flushPendingPrefix this never invents a prosodic boundary at an
   * arbitrary word, so TTS does not add false utterance-final lengthening.
   */
  flushPendingProsodicPrefix(minimumCharacters = 32): readonly string[] {
    if (!Number.isInteger(minimumCharacters) || minimumCharacters < 1) {
      throw new RangeError('minimumCharacters must be a positive integer.');
    }
    if (this.buffer.trim().length < minimumCharacters) return [];

    let boundary = -1;
    for (let index = minimumCharacters - 1; index < this.buffer.length; index += 1) {
      if (!',—–'.includes(this.buffer[index])) continue;
      let cursor = index + 1;
      while (cursor < this.buffer.length && CLOSING_PUNCTUATION.has(this.buffer[cursor])) {
        cursor += 1;
      }
      if (cursor < this.buffer.length && /\s/u.test(this.buffer[cursor])) {
        boundary = cursor + 1;
      }
    }
    if (boundary < 0) return [];
    const clauses: string[] = [];
    this.emitThrough(boundary, clauses);
    return clauses;
  }

  pendingText(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = '';
    this.emittedClauses = 0;
  }

  private extractStableClauses(flush: boolean): string[] {
    const clauses: string[] = [];

    while (this.buffer) {
      const boundary = this.findStableBoundary();
      if (boundary < 0) break;
      this.emitThrough(boundary, clauses);
    }

    if (flush && this.buffer.trim()) {
      const clause = normalizeClause(this.buffer);
      this.buffer = '';
      if (clause && hasSpeakableContent(clause)) clauses.push(clause);
    } else if (flush) {
      this.buffer = '';
    }

    return clauses;
  }

  private findStableBoundary(): number {
    const characterLimit = this.emittedClauses === 0
      ? this.firstClauseCharacters
      : this.maxClauseCharacters;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];

      if (character === '\n') return index + 1;

      if ('.?!;:'.includes(character) && !this.isFalseBoundary(index)) {
        let cursor = index + 1;
        while (
          cursor < this.buffer.length &&
          CLOSING_PUNCTUATION.has(this.buffer[cursor])
        ) {
          cursor += 1;
        }
        if (cursor < this.buffer.length && /\s/u.test(this.buffer[cursor])) {
          return cursor + 1;
        }
      }

      if (
        index + 1 >= characterLimit &&
        /\s/u.test(character)
      ) {
        return index + 1;
      }
    }

    return -1;
  }

  private isFalseBoundary(index: number): boolean {
    const character = this.buffer[index];
    if (character !== '.') return false;

    const previous = this.buffer[index - 1];
    const next = this.buffer[index + 1];
    if (previous && next && /\d/u.test(previous) && /\d/u.test(next)) {
      return true;
    }

    const prefix = this.buffer.slice(0, index);
    const word = prefix.match(/(?:^|\s)([A-Za-z]+(?:\.[A-Za-z]+)*)$/u)?.[1];
    return word ? COMMON_ABBREVIATIONS.has(word.toLowerCase()) : false;
  }

  private emitThrough(boundary: number, clauses: string[]): void {
    const clause = normalizeClause(this.buffer.slice(0, boundary));
    this.buffer = this.buffer.slice(boundary).replace(/^\s+/u, '');
    if (clause && hasSpeakableContent(clause)) {
      clauses.push(clause);
      this.emittedClauses += 1;
    }
  }
}
