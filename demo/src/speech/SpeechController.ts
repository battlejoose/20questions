import { CoarticulationEngine } from './CoarticulationEngine';
import {
  ExpressivePerformanceController,
  type ConversationalPerformanceState,
  type ExpressivePerformanceFrame,
} from './ExpressivePerformanceController';
import {
  analyzeSpeechAudio,
  refinePhonemeTimelineWithAudio,
  type SpeechAcousticFrame,
} from './AudioAnalysis';
import {
  SPEECH_RIG_TARGETS,
  type PhonemeInterval,
  type LocalLipSyncMode,
  type SpeechRigWeights,
  type SpeechSynthesisPayload,
  type SyntheticVoiceDisclosure,
} from './types';
import {
  resolveKokoroPhonemeIntervals,
  type KokoroPhonemeInput,
} from './KokoroPhonemeTiming';
import {
  ElevenLabsBrowserTtsClient,
  ElevenLabsBrowserTtsError,
  type TimestampedSpeechClient,
} from './ElevenLabsBrowserTts';
import type {
  PerformanceAction,
  PerformanceIntent,
} from './PerformanceIntent';

export const LOCAL_KOKORO_VOICE: SyntheticVoiceDisclosure = Object.freeze({
  voiceId: 'kokoro-local',
  displayName: 'Local Kokoro synthetic voice',
  premade: true,
  historicalVoiceClone: false,
  synthetic: true,
});

export const LOCAL_SUPERTONIC_VOICE: SyntheticVoiceDisclosure = Object.freeze({
  voiceId: 'supertonic-2-m1-local',
  displayName: 'Local Supertonic 2 M1 synthetic voice',
  premade: true,
  historicalVoiceClone: false,
  synthetic: true,
});

export const LOCAL_KITTEN_VOICE: SyntheticVoiceDisclosure = Object.freeze({
  voiceId: 'kitten-tts-nano-jasper-local',
  displayName: 'Local KittenTTS Nano Jasper synthetic voice',
  premade: true,
  historicalVoiceClone: false,
  synthetic: true,
});

export const SPEECH_DISCLOSURE = Object.freeze({
  voice:
    'The performance uses synthetic voices selected by the visitor. It is not a voice clone or an imitation of a real person.',
  timing:
    'Speech audio includes provider character timestamps. IPA boundaries are deterministically refined from decoded waveform energy, voicing, and transients; this is not acoustic forced-alignment or a learned animation model.',
  animation:
    'Lip, jaw, and tongue motion uses an anatomically informed compact viseme rig with coarticulation and contact constraints; it is a reusable animation model, not motion captured from a person.',
});

export type SpeechControllerState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'ended'
  | 'error';

export type SpeechAssetSource =
  | 'live-synthesis'
  | 'local-pcm';

export interface PreparedSpeech {
  requestedText: string;
  spokenText: string;
  source: SpeechAssetSource;
  durationSeconds: number;
  phonemes: readonly PhonemeInterval[];
  voice: SyntheticVoiceDisclosure;
}

export interface SpeechControllerSnapshot {
  state: SpeechControllerState;
  prepared: PreparedSpeech | null;
  error: SpeechControllerError | null;
}

export interface SpeechPlaybackClockSnapshot {
  state: SpeechControllerState;
  positionSeconds: number;
  durationSeconds: number;
  fraction: number;
}

export interface SpeechControllerOptions {
  synthesisClient?: TimestampedSpeechClient;
  audioContext?: AudioContext;
  fetchImpl?: typeof fetch;
}

export type SpeechControllerListener = (
  snapshot: Readonly<SpeechControllerSnapshot>,
) => void;

export class SpeechControllerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_TEXT'
      | 'INVALID_PCM'
      | 'MISSING_API_KEY'
      | 'AUTHENTICATION'
      | 'RATE_LIMITED'
      | 'REQUEST_FAILED'
      | 'INVALID_RESPONSE'
      | 'AUDIO_DECODE_FAILED'
      | 'NO_PREPARED_SPEECH',
  ) {
    super(message);
    this.name = 'SpeechControllerError';
  }
}

interface DecodedSpeech {
  prepared: PreparedSpeech;
  buffer: AudioBuffer;
  acousticFrames: readonly SpeechAcousticFrame[];
  performanceIntent?: PerformanceIntent;
  performanceUserText?: string;
}

export interface LocalPcmPlaybackOptions {
  /** Auto prefers synthesis-native intervals and acoustically micro-refines them. */
  timingMode?: LocalLipSyncMode;
  /** Semantic performance accompanies speech but never enters the TTS text. */
  performanceIntent?: PerformanceIntent;
  performanceUserText?: string;
}

function analyzeDecodedSpeech(
  buffer: AudioBuffer,
  phonemes: readonly PhonemeInterval[],
): {
  acousticFrames: readonly SpeechAcousticFrame[];
  phonemes: PhonemeInterval[];
} {
  // Tests and unusual Web Audio shims may provide only a duration. Real
  // AudioBuffers expose these PCM methods and take the deterministic path.
  if (
    typeof buffer.getChannelData !== 'function' ||
    !Number.isFinite(buffer.sampleRate) ||
    !Number.isFinite(buffer.length) ||
    !Number.isFinite(buffer.numberOfChannels)
  ) {
    return { acousticFrames: [], phonemes: Array.from(phonemes) };
  }
  try {
    const acousticFrames = analyzeSpeechAudio(buffer);
    return {
      acousticFrames,
      phonemes: refinePhonemeTimelineWithAudio(phonemes, acousticFrames),
    };
  } catch {
    // Timing from the provider remains a safe deterministic fallback; an
    // analysis failure must never prevent the requested audio from playing.
    return { acousticFrames: [], phonemes: Array.from(phonemes) };
  }
}

function analyzeDecodedSpeechWithoutRetiming(
  buffer: AudioBuffer,
  phonemes: readonly PhonemeInterval[],
): {
  acousticFrames: readonly SpeechAcousticFrame[];
  phonemes: PhonemeInterval[];
} {
  if (
    typeof buffer.getChannelData !== 'function' ||
    !Number.isFinite(buffer.sampleRate) ||
    !Number.isFinite(buffer.length) ||
    !Number.isFinite(buffer.numberOfChannels)
  ) {
    return { acousticFrames: [], phonemes: Array.from(phonemes) };
  }
  try {
    return {
      acousticFrames: analyzeSpeechAudio(buffer),
      phonemes: Array.from(phonemes),
    };
  } catch {
    return { acousticFrames: [], phonemes: Array.from(phonemes) };
  }
}

function silentWeights(): SpeechRigWeights {
  return Object.fromEntries(
    SPEECH_RIG_TARGETS.map((target) => [target, 0]),
  ) as SpeechRigWeights;
}

function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function decodeBase64(base64: string): ArrayBuffer {
  const compact = base64.replace(/\s+/gu, '');
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function isSyntheticVoice(value: unknown): value is SyntheticVoiceDisclosure {
  if (!value || typeof value !== 'object') return false;
  return (
    typeof Reflect.get(value, 'voiceId') === 'string' &&
    typeof Reflect.get(value, 'displayName') === 'string' &&
    Reflect.get(value, 'premade') === true &&
    Reflect.get(value, 'historicalVoiceClone') === false &&
    Reflect.get(value, 'synthetic') === true
  );
}

function validPhonemes(value: unknown): value is PhonemeInterval[] {
  return (
    Array.isArray(value) &&
    value.every(
      (phone) =>
        phone &&
        typeof phone === 'object' &&
        typeof Reflect.get(phone, 'phone') === 'string' &&
        typeof Reflect.get(phone, 'normalizedPhone') === 'string' &&
        Number.isFinite(Reflect.get(phone, 'startTime')) &&
        Number.isFinite(Reflect.get(phone, 'endTime')) &&
        Reflect.get(phone, 'startTime') >= 0 &&
        Reflect.get(phone, 'endTime') >= Reflect.get(phone, 'startTime'),
    )
  );
}

function isSpeechPayload(value: unknown): value is SpeechSynthesisPayload {
  if (!value || typeof value !== 'object') return false;
  const duration = Reflect.get(value, 'durationSeconds');
  const audio = Reflect.get(value, 'audioBase64');
  return (
    typeof audio === 'string' &&
    audio.length > 0 &&
    audio.length <= 32_000_000 &&
    Reflect.get(value, 'audioMimeType') === 'audio/mpeg' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0 &&
    validPhonemes(Reflect.get(value, 'phonemes')) &&
    isSyntheticVoice(Reflect.get(value, 'voice'))
  );
}

export class SpeechController {
  readonly disclosure = SPEECH_DISCLOSURE;

  private readonly synthesisClient: TimestampedSpeechClient;
  private readonly context: AudioContext;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners = new Set<SpeechControllerListener>();
  private readonly zeroWeights = silentWeights();
  private readonly performance: ExpressivePerformanceController;

  private state: SpeechControllerState = 'idle';
  private error: SpeechControllerError | null = null;
  private decoded: DecodedSpeech | null = null;
  private engine: CoarticulationEngine | null = null;
  private source: AudioBufferSourceNode | null = null;
  private sourceStartAt = 0;
  private sourceStartPerformanceAt = 0;
  private stoppedAtSeconds = 0;
  private requestAbort: AbortController | null = null;
  private operation = 0;

  constructor(options: SpeechControllerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.synthesisClient = options.synthesisClient ?? new ElevenLabsBrowserTtsClient({
      fetchImpl: this.fetchImpl,
    });

    const AudioContextConstructor =
      globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!options.audioContext && !AudioContextConstructor) {
      throw new SpeechControllerError(
        'This browser does not support Web Audio.',
        'AUDIO_DECODE_FAILED',
      );
    }
    this.context = options.audioContext ?? new AudioContextConstructor!();
    this.performance = new ExpressivePerformanceController(this.context);
  }

  subscribe(listener: SpeechControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): Readonly<SpeechControllerSnapshot> {
    return {
      state: this.state,
      prepared: this.decoded?.prepared ?? null,
      error: this.error,
    };
  }

  /** Current named rig weights. Call once per render frame. */
  update(): Readonly<SpeechRigWeights> {
    return this.engine?.update() ?? this.zeroWeights;
  }

  /** Upper-face, gaze, blink, and head performance sampled on the audio clock. */
  updatePerformance(): Readonly<ExpressivePerformanceFrame> {
    return this.performance.update();
  }

  setConversationState(state: ConversationalPerformanceState): void {
    this.performance.setConversationState(state);
  }

  /** Executes a semantic physical action selected by the local LLM. */
  performAction(action: PerformanceAction): void {
    this.performance.performAction(action);
  }

  setReducedMotion(enabled: boolean): void {
    this.performance.setReducedMotion(enabled);
  }

  /** Audio-free deterministic affect pose for hidden in-app visual review. */
  setDeterministicPerformancePreview(intent: PerformanceIntent): void {
    this.cancel();
    this.performance.setDeterministicPreview(intent);
  }

  /** Audio-clock position used by conversational playback progress and echo gating. */
  playbackClock(): Readonly<SpeechPlaybackClockSnapshot> {
    const durationSeconds = this.decoded?.buffer.duration ?? 0;
    const livePosition = this.source
      ? Math.max(0, this.context.currentTime - this.sourceStartAt)
      : this.stoppedAtSeconds;
    const positionSeconds = Math.min(durationSeconds, livePosition);
    return {
      state: this.state,
      positionSeconds,
      durationSeconds,
      fraction: durationSeconds > 0 ? positionSeconds / durationSeconds : 0,
    };
  }

  /** Monotonic wall-clock time at which the currently scheduled audio begins. */
  scheduledPlaybackStartAt(): number | null {
    return this.source ? this.sourceStartPerformanceAt : null;
  }

  /** Approximate current output energy for microphone echo/self-trigger rejection. */
  playbackOutputRms(windowSeconds = 0.025): number {
    const decoded = this.decoded;
    const clock = this.playbackClock();
    if (!decoded || !this.source || clock.positionSeconds <= 0) return 0;
    const channel = decoded.buffer.getChannelData(0);
    const center = Math.floor(clock.positionSeconds * decoded.buffer.sampleRate);
    const radius = Math.max(1, Math.floor(windowSeconds * decoded.buffer.sampleRate * 0.5));
    const start = Math.max(0, center - radius);
    const end = Math.min(channel.length, center + radius);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      energy += channel[index] * channel[index];
    }
    return end > start ? Math.sqrt(energy / (end - start)) : 0;
  }

  async speak(text: string): Promise<PreparedSpeech> {
    const requestedText = normalizeText(text);
    if (!requestedText) {
      throw new SpeechControllerError('Enter a phrase to speak.', 'INVALID_TEXT');
    }

    // Invoke resume while the caller's click/keypress still owns user
    // activation. Waiting until after network synthesis can lose autoplay
    // permission in Safari and embedded browsers.
    this.requestAudioUnlock();
    const operation = this.beginOperation('loading');
    try {
      const decoded = await this.fetchSynthesis(requestedText, operation);

      this.assertCurrent(operation);
      this.decoded = decoded;
      this.engine = new CoarticulationEngine(
        this.context,
        decoded.prepared.phonemes,
        { acousticFrames: decoded.acousticFrames },
      );
      this.setState('ready');
      await this.startDecoded(operation);
      return decoded.prepared;
    } catch (error) {
      if (operation !== this.operation) throw error;
      const controllerError =
        error instanceof SpeechControllerError
          ? error
          : new SpeechControllerError('Speech playback failed.', 'REQUEST_FAILED');
      this.error = controllerError;
      this.setState('error');
      throw controllerError;
    }
  }

  /**
   * Plays mono PCM produced by a local speech runtime. The same AudioContext
   * start time drives the buffer source and GNM coarticulation clock.
   */
  async playLocalPcm(
    pcm: Float32Array,
    sampleRate: number,
    text: string,
    localPhonemes: KokoroPhonemeInput,
    voice: SyntheticVoiceDisclosure = LOCAL_KOKORO_VOICE,
    options: LocalPcmPlaybackOptions = {},
  ): Promise<PreparedSpeech> {
    const requestedText = normalizeText(text);
    if (!requestedText) {
      throw new SpeechControllerError('Enter a phrase to speak.', 'INVALID_TEXT');
    }
    if (
      !(pcm instanceof Float32Array) ||
      pcm.length === 0 ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      throw new SpeechControllerError(
        'Local speech must provide non-empty mono Float32 PCM and a valid sample rate.',
        'INVALID_PCM',
      );
    }
    for (const sample of pcm) {
      if (!Number.isFinite(sample)) {
        throw new SpeechControllerError(
          'Local speech PCM contains a non-finite sample.',
          'INVALID_PCM',
        );
      }
    }
    // Own an ArrayBuffer-backed copy so SharedArrayBuffer views cannot be
    // mutated during playback and Web Audio's stricter DOM type is satisfied.
    const pcmCopy = new Float32Array(pcm);
    if (!isSyntheticVoice(voice)) {
      throw new SpeechControllerError(
        'Local speech must identify a disclosed synthetic voice.',
        'INVALID_PCM',
      );
    }

    this.requestAudioUnlock();
    const operation = this.beginOperation('loading');
    try {
      let buffer: AudioBuffer;
      try {
        buffer = this.context.createBuffer(1, pcmCopy.length, sampleRate);
        if (typeof buffer.copyToChannel === 'function') {
          buffer.copyToChannel(pcmCopy, 0);
        } else {
          buffer.getChannelData(0).set(pcmCopy);
        }
      } catch {
        throw new SpeechControllerError(
          'The local speech PCM could not be prepared for playback.',
          'INVALID_PCM',
        );
      }

      const durationSeconds = pcmCopy.length / sampleRate;
      let phonemes: PhonemeInterval[];
      try {
        const timingInput = options.timingMode === 'heuristic' && Array.isArray(localPhonemes)
          ? localPhonemes.map((interval) => interval.phone).join(' ')
          : localPhonemes;
        phonemes = resolveKokoroPhonemeIntervals(
          timingInput,
          durationSeconds,
          requestedText,
          voice.voiceId === LOCAL_KOKORO_VOICE.voiceId
            ? 'estimated-from-kokoro-phonemes'
            : 'estimated-from-local-phonemes',
        );
      } catch (error) {
        throw new SpeechControllerError(
          error instanceof Error
            ? `Invalid local phonemes: ${error.message}`
            : 'Invalid local phonemes.',
          'INVALID_PCM',
        );
      }

      this.assertCurrent(operation);
      const timingMode = options.timingMode ?? 'auto';
      const analysis = timingMode === 'native' || timingMode === 'heuristic'
        ? analyzeDecodedSpeechWithoutRetiming(buffer, phonemes)
        : analyzeDecodedSpeech(buffer, phonemes);
      const decoded: DecodedSpeech = {
        prepared: {
          requestedText,
          spokenText: requestedText,
          source: 'local-pcm',
          durationSeconds,
          phonemes: analysis.phonemes,
          voice,
        },
        buffer,
        acousticFrames: analysis.acousticFrames,
        performanceIntent: options.performanceIntent,
        performanceUserText: options.performanceUserText,
      };
      this.decoded = decoded;
      this.engine = new CoarticulationEngine(
        this.context,
        decoded.prepared.phonemes,
        { acousticFrames: decoded.acousticFrames },
      );
      this.setState('ready');
      await this.startDecoded(operation);
      return decoded.prepared;
    } catch (error) {
      if (operation !== this.operation) throw error;
      const controllerError = error instanceof SpeechControllerError
        ? error
        : new SpeechControllerError(
          'Local speech playback failed.',
          'INVALID_PCM',
        );
      this.error = controllerError;
      this.setState('error');
      throw controllerError;
    }
  }

  async replay(): Promise<PreparedSpeech> {
    if (!this.decoded) {
      throw new SpeechControllerError(
        'Generate speech before replaying.',
        'NO_PREPARED_SPEECH',
      );
    }
    this.requestAudioUnlock();
    const operation = this.beginOperation('ready', false);
    await this.startDecoded(operation);
    return this.decoded.prepared;
  }

  cancel(): void {
    this.operation += 1;
    this.requestAbort?.abort();
    this.requestAbort = null;
    this.stopSource();
    this.engine?.reset();
    this.performance.cancelAll(true);
    this.error = null;
    this.setState(this.decoded ? 'ready' : 'idle');
  }

  async close(): Promise<void> {
    this.cancel();
    this.listeners.clear();
    if (this.context.state !== 'closed') await this.context.close();
  }

  private beginOperation(
    state: SpeechControllerState,
    clearDecoded = true,
  ): number {
    this.operation += 1;
    this.requestAbort?.abort();
    this.requestAbort = null;
    this.stopSource();
    this.engine?.reset();
    this.performance.cancelSpeech(false);
    if (clearDecoded) {
      this.decoded = null;
      this.engine = null;
    }
    this.error = null;
    this.setState(state);
    return this.operation;
  }

  private async fetchSynthesis(text: string, operation: number): Promise<DecodedSpeech> {
    const abort = new AbortController();
    this.requestAbort = abort;
    let body: SpeechSynthesisPayload;
    try {
      body = await this.synthesisClient.synthesize(text, abort.signal);
    } catch (error) {
      this.assertCurrent(operation);
      if (error instanceof ElevenLabsBrowserTtsError) {
        const controllerCode = error.code === 'CANCELLED'
          ? 'REQUEST_FAILED'
          : error.code;
        throw new SpeechControllerError(
          error.message,
          controllerCode,
        );
      }
      throw new SpeechControllerError(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Speech generation was cancelled.'
          : 'Direct speech generation is unavailable.',
        'REQUEST_FAILED',
      );
    } finally {
      if (this.requestAbort === abort) this.requestAbort = null;
    }

    this.assertCurrent(operation);
    if (!isSpeechPayload(body)) {
      throw new SpeechControllerError(
        'Direct speech returned invalid timing data.',
        'INVALID_RESPONSE',
      );
    }

    const audioBytes = decodeBase64(body.audioBase64);
    const buffer = await this.decodeAudio(audioBytes, operation);
    const analysis = analyzeDecodedSpeech(buffer, body.phonemes);
    return {
      prepared: {
        requestedText: text,
        spokenText: text,
        source: 'live-synthesis',
        durationSeconds: body.durationSeconds,
        phonemes: analysis.phonemes,
        voice: body.voice,
      },
      buffer,
      acousticFrames: analysis.acousticFrames,
    };
  }

  private async decodeAudio(bytes: ArrayBuffer, operation: number): Promise<AudioBuffer> {
    try {
      const buffer = await this.context.decodeAudioData(bytes.slice(0));
      this.assertCurrent(operation);
      return buffer;
    } catch {
      this.assertCurrent(operation);
      throw new SpeechControllerError(
        'The generated audio could not be decoded.',
        'AUDIO_DECODE_FAILED',
      );
    }
  }

  private async startDecoded(operation: number): Promise<void> {
    const decoded = this.decoded;
    const engine = this.engine;
    if (!decoded || !engine) {
      throw new SpeechControllerError('No speech is ready.', 'NO_PREPARED_SPEECH');
    }

    if (this.context.state === 'suspended') {
      await Promise.race([
        this.context.resume(),
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1800)),
      ]);
      if (this.context.state === 'suspended') {
        throw new SpeechControllerError(
          'Audio playback is blocked by the browser. Press Replay to allow sound.',
          'AUDIO_DECODE_FAILED',
        );
      }
    }
    this.assertCurrent(operation);

    const source = this.context.createBufferSource();
    source.buffer = decoded.buffer;
    source.connect(this.context.destination);
    const startAt = this.context.currentTime + 0.045;
    source.onended = () => {
      if (this.source !== source || operation !== this.operation) return;
      this.stoppedAtSeconds = decoded.buffer.duration;
      this.source = null;
      this.setState('ended');
    };

    this.source = source;
    this.sourceStartAt = startAt;
    const monotonicNow = globalThis.performance?.now?.() ?? Date.now();
    this.sourceStartPerformanceAt = monotonicNow +
      Math.max(0, (startAt - this.context.currentTime) * 1000);
    this.stoppedAtSeconds = 0;
    this.preparePerformance(decoded);
    engine.startAt(startAt);
    this.performance.startAt(startAt);
    source.start(startAt);
    this.setState('playing');
  }

  private requestAudioUnlock(): void {
    if (this.context.state !== 'suspended') return;
    // The call itself must happen inside user activation. Its promise may stay
    // pending in embedded/headless browsers, so synthesis must not await it.
    void this.context.resume().catch(() => undefined);
  }

  private preparePerformance(decoded: DecodedSpeech): void {
    this.performance.prepare({
      text: decoded.prepared.spokenText,
      phonemes: decoded.prepared.phonemes,
      acousticFrames: decoded.acousticFrames,
      durationSeconds: decoded.buffer.duration,
      performanceIntent: decoded.performanceIntent,
      userText: decoded.performanceUserText,
    });
  }

  private stopSource(): void {
    if (!this.source) return;
    this.stoppedAtSeconds = Math.min(
      this.decoded?.buffer.duration ?? 0,
      Math.max(0, this.context.currentTime - this.sourceStartAt),
    );
    this.source.onended = null;
    try {
      this.source.stop();
    } catch {
      // A source that has already ended cannot always be stopped again.
    }
    this.source.disconnect();
    this.source = null;
  }

  private assertCurrent(operation: number): void {
    if (operation !== this.operation) {
      throw new SpeechControllerError('Speech generation was cancelled.', 'REQUEST_FAILED');
    }
  }

  private setState(state: SpeechControllerState): void {
    this.state = state;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
