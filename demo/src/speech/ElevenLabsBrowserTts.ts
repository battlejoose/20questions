import { AsyncTtlLruCache } from './AsyncTtlLruCache';
import { getStoredElevenLabsApiKey } from './ElevenLabsApiKeyStore';
import {
  buildPhonemeTimeline,
  extractWordTimings,
  type WordPhonemizer,
} from './PhonemeTiming';
import type {
  CharacterAlignment,
  SpeechSynthesisPayload,
} from './types';

export const ELEVENLABS_TIMESTAMPED_TTS_URL =
  'https://api.elevenlabs.io/v1/text-to-speech';
export const PREMADE_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
export const PREMADE_VOICE_NAME = 'George (ElevenLabs premade)';
export const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
export const MAX_SPEECH_TEXT_CHARACTERS = 1_000;

interface RestCharacterAlignment {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
  characterStartTimesSeconds?: unknown;
  characterEndTimesSeconds?: unknown;
}

interface RestTimestampedResponse {
  audio_base64?: unknown;
  audioBase64?: unknown;
  alignment?: unknown;
  normalized_alignment?: unknown;
  normalizedAlignment?: unknown;
}

export type ElevenLabsBrowserTtsErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_TEXT'
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'
  | 'CANCELLED';

export class ElevenLabsBrowserTtsError extends Error {
  constructor(
    readonly code: ElevenLabsBrowserTtsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ElevenLabsBrowserTtsError';
  }
}

export interface TimestampedSpeechClient {
  synthesize(text: string, signal?: AbortSignal): Promise<SpeechSynthesisPayload>;
}

export interface ElevenLabsBrowserTtsOptions {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string | null;
  phonemizeWord?: WordPhonemizer;
  cache?: AsyncTtlLruCache<SpeechSynthesisPayload>;
  voiceId?: string;
  voiceName?: string;
  modelId?: string;
  maxTextCharacters?: number;
  requestTimeoutMilliseconds?: number;
}

export function sanitizeSpeechText(
  input: string,
  maxCharacters = MAX_SPEECH_TEXT_CHARACTERS,
): string {
  if (typeof input !== 'string') {
    throw new ElevenLabsBrowserTtsError(
      'INVALID_TEXT',
      'The phrase must be text.',
    );
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(input)) {
    throw new ElevenLabsBrowserTtsError(
      'INVALID_TEXT',
      'The phrase contains unsupported control characters.',
    );
  }

  const text = input.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!text) {
    throw new ElevenLabsBrowserTtsError('INVALID_TEXT', 'Enter a phrase to speak.');
  }
  if (Array.from(text).length > maxCharacters) {
    throw new ElevenLabsBrowserTtsError(
      'INVALID_TEXT',
      `The phrase cannot exceed ${maxCharacters} characters.`,
    );
  }
  return text;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'number' && Number.isFinite(item) && item >= 0,
  );
}

function normalizeAlignment(value: unknown): CharacterAlignment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as RestCharacterAlignment;
  const characters = raw.characters;
  const starts = raw.character_start_times_seconds ?? raw.characterStartTimesSeconds;
  const ends = raw.character_end_times_seconds ?? raw.characterEndTimesSeconds;
  if (
    !Array.isArray(characters) ||
    !characters.every((item) => typeof item === 'string') ||
    !isNumberArray(starts) ||
    !isNumberArray(ends) ||
    characters.length === 0 ||
    characters.length !== starts.length ||
    characters.length !== ends.length
  ) {
    return null;
  }
  return {
    characters: Array.from(characters),
    characterStartTimesSeconds: Array.from(starts),
    characterEndTimesSeconds: Array.from(ends),
  };
}

function responseError(status: number): ElevenLabsBrowserTtsError {
  if (status === 401 || status === 403) {
    return new ElevenLabsBrowserTtsError(
      'AUTHENTICATION',
      'ElevenLabs rejected this API key. Check its permissions and quota.',
    );
  }
  if (status === 429) {
    return new ElevenLabsBrowserTtsError(
      'RATE_LIMITED',
      'ElevenLabs is rate limiting this key. Wait a moment and retry.',
    );
  }
  return new ElevenLabsBrowserTtsError(
    'REQUEST_FAILED',
    `ElevenLabs could not generate speech (${status}).`,
  );
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class ElevenLabsBrowserTtsClient implements TimestampedSpeechClient {
  private readonly fetchImpl: typeof fetch;
  private readonly getApiKey: () => string | null;
  private readonly phonemizeWord: WordPhonemizer | undefined;
  private readonly cache: AsyncTtlLruCache<SpeechSynthesisPayload>;
  private readonly voiceId: string;
  private readonly voiceName: string;
  private readonly modelId: string;
  private readonly maxTextCharacters: number;
  private readonly requestTimeoutMilliseconds: number;

  constructor(options: ElevenLabsBrowserTtsOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getApiKey = options.getApiKey ?? getStoredElevenLabsApiKey;
    this.phonemizeWord = options.phonemizeWord;
    this.cache = options.cache ?? new AsyncTtlLruCache({
      maxEntries: 4,
      ttlMilliseconds: 10 * 60_000,
    });
    this.voiceId = options.voiceId ?? PREMADE_VOICE_ID;
    this.voiceName = options.voiceName ?? PREMADE_VOICE_NAME;
    this.modelId = options.modelId ?? ELEVENLABS_MODEL_ID;
    this.maxTextCharacters = Math.max(
      1,
      options.maxTextCharacters ?? MAX_SPEECH_TEXT_CHARACTERS,
    );
    this.requestTimeoutMilliseconds = Math.max(
      1,
      options.requestTimeoutMilliseconds ?? 30_000,
    );
  }

  async synthesize(
    input: string,
    signal?: AbortSignal,
  ): Promise<SpeechSynthesisPayload> {
    const text = sanitizeSpeechText(input, this.maxTextCharacters);
    const apiKey = this.getApiKey()?.trim() ?? '';
    if (!apiKey) {
      throw new ElevenLabsBrowserTtsError(
        'MISSING_API_KEY',
        'Add your ElevenLabs API key to enable direct phrase speech.',
      );
    }
    if (/\s|[\u0000-\u001F\u007F]/u.test(apiKey)) {
      throw new ElevenLabsBrowserTtsError(
        'AUTHENTICATION',
        'The saved ElevenLabs API key is not valid.',
      );
    }
    const cacheKey =
      `${await this.credentialNamespace(apiKey)}\0${this.voiceId}\0${this.modelId}\0${text}`;
    return this.cache.getOrCreate(cacheKey, () =>
      this.requestSynthesis(text, apiKey, signal),
    );
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async credentialNamespace(apiKey: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(apiKey),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }

  private async requestSynthesis(
    text: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<SpeechSynthesisPayload> {
    if (signal?.aborted) {
      throw new ElevenLabsBrowserTtsError('CANCELLED', 'Speech generation was cancelled.');
    }
    const endpoint =
      `${ELEVENLABS_TIMESTAMPED_TTS_URL}/${encodeURIComponent(this.voiceId)}` +
      '/with-timestamps?output_format=mp3_44100_128&enable_logging=false';
    let response: Response;
    const requestAbort = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => requestAbort.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      requestAbort.abort();
    }, this.requestTimeoutMilliseconds);
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          apply_text_normalization: 'auto',
        }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: requestAbort.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ElevenLabsBrowserTtsError(
          'REQUEST_FAILED',
          'ElevenLabs speech generation timed out. Retry in a moment.',
        );
      }
      if (abortError(error)) {
        throw new ElevenLabsBrowserTtsError('CANCELLED', 'Speech generation was cancelled.');
      }
      throw new ElevenLabsBrowserTtsError(
        'REQUEST_FAILED',
        'This browser could not reach ElevenLabs directly.',
      );
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }

    if (!response.ok) throw responseError(response.status);

    let body: RestTimestampedResponse;
    try {
      body = await response.json() as RestTimestampedResponse;
    } catch {
      throw new ElevenLabsBrowserTtsError(
        'INVALID_RESPONSE',
        'ElevenLabs returned unreadable timing data.',
      );
    }

    const audioBase64 = body.audio_base64 ?? body.audioBase64;
    const alignment = normalizeAlignment(
      body.normalized_alignment ?? body.normalizedAlignment ?? body.alignment,
    );
    if (
      typeof audioBase64 !== 'string' ||
      !audioBase64 ||
      audioBase64.length > 32_000_000 ||
      !alignment
    ) {
      throw new ElevenLabsBrowserTtsError(
        'INVALID_RESPONSE',
        'ElevenLabs returned incomplete speech timing data.',
      );
    }

    try {
      const phonemes = await buildPhonemeTimeline(alignment, {
        language: 'en-us',
        phonemizeWord: this.phonemizeWord,
      });
      const durationSeconds = Math.max(...alignment.characterEndTimesSeconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || phonemes.length === 0) {
        throw new TypeError('Empty alignment.');
      }
      return {
        audioBase64,
        audioMimeType: 'audio/mpeg',
        durationSeconds,
        alignment,
        words: extractWordTimings(alignment),
        phonemes,
        voice: {
          voiceId: this.voiceId,
          displayName: this.voiceName,
          premade: true,
          historicalVoiceClone: false,
          synthetic: true,
        },
      };
    } catch (error) {
      if (error instanceof ElevenLabsBrowserTtsError) throw error;
      throw new ElevenLabsBrowserTtsError(
        'INVALID_RESPONSE',
        'Speech timing could not be converted into mouth movement.',
      );
    }
  }
}
