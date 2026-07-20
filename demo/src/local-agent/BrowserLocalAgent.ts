import {
  LOCAL_KITTEN_VOICE,
  LOCAL_SUPERTONIC_VOICE,
  type LocalLipSyncMode,
  type PreparedSpeech,
  type SpeechController,
  type SpeechControllerSnapshot,
} from '../speech';
import { LocalVoiceAgent } from './LocalVoiceAgent';
import {
  detectBrowserCapabilities,
  type BrowserCapabilitySnapshot,
} from './capabilities';
import {
  SAFE_DEFAULT_MODEL_SELECTION,
  selectLocalAgentModels,
  type LocalAgentModelRequest,
  type LocalAgentModelSelection,
} from './selectionPolicy';
import type {
  AgentEvent,
  AgentMetric,
  BrainRequest,
  LocalAgentPorts,
  PlaybackRequest,
  PlaybackResult,
  VadStartContext,
} from './types';
import {
  BrowserBrainRuntime,
  LocalTtsRuntime,
  SttRuntime,
  VadRuntime,
  type BrainLoadProgress,
  type LocalTtsSynthesisResult,
  type VadRuntimeCallbacks,
  type WorkerProgress,
} from './runtime';
import type { LocalModelId } from './modelRegistry';

export interface LocalModelProgressEvent {
  modelId: LocalModelId;
  fraction: number | null;
  loadedBytes: number;
  totalBytes: number | null;
  message: string;
}

export interface BrowserLocalAgentCallbacks {
  onAgentEvent?(event: AgentEvent): void;
  onMetric?(metric: AgentMetric): void;
  onCapabilities?(capabilities: BrowserCapabilitySnapshot): void;
  onModelProgress?(progress: LocalModelProgressEvent): void;
  onMicLevel?(rms: number, speechProbability: number): void;
  onEchoSuppressed?(): void;
}

function abortError(): DOMException {
  return new DOMException('Local voice operation cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function waitForSpeechPlayback(
  speech: SpeechController,
  request: PlaybackRequest<LocalTtsSynthesisResult>,
  elapsedBefore: number,
  totalDuration: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    const finish = (completed: boolean, error?: Error): void => {
      if (settled) return;
      settled = true;
      globalThis.clearInterval(timer);
      request.signal.removeEventListener('abort', onAbort);
      unsubscribe();
      if (error) reject(error);
      else resolve(completed);
    };
    const reportProgress = (): void => {
      const clock = speech.playbackClock();
      const elapsed = Math.min(totalDuration, elapsedBefore + clock.positionSeconds);
      request.onProgress({
        spokenCharacters: Math.floor(
          request.text.length * (elapsed / Math.max(0.001, totalDuration)),
        ),
      });
    };
    const onAbort = (): void => {
      reportProgress();
      speech.cancel();
      finish(false);
    };
    const onSnapshot = (snapshot: Readonly<SpeechControllerSnapshot>): void => {
      reportProgress();
      if (snapshot.state === 'ended') finish(true);
      else if (snapshot.state === 'error') {
        finish(false, snapshot.error ?? new Error('Local speech playback failed.'));
      }
    };
    const timer = globalThis.setInterval(reportProgress, 32);
    unsubscribe = speech.subscribe(onSnapshot);
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();
  });
}

export class BrowserLocalAgent {
  readonly agent: LocalVoiceAgent<Float32Array, LocalTtsSynthesisResult>;

  private readonly stt = new SttRuntime();
  private readonly brain = new BrowserBrainRuntime();
  private readonly tts = new LocalTtsRuntime();
  private vad: VadRuntime | null = null;
  private capabilitiesPromise: Promise<BrowserCapabilitySnapshot> | null = null;
  private selectionPromise: Promise<LocalAgentModelSelection> | null = null;
  private lastMicRms = 0;
  private lastSpeechProbability = 0;
  private suppressCurrentSegment = false;
  private unsubscribeAgent: (() => void) | null = null;

  constructor(
    private readonly speech: SpeechController,
    private readonly callbacks: BrowserLocalAgentCallbacks = {},
    private readonly modelRequest: LocalAgentModelRequest = {},
  ) {
    const ports: LocalAgentPorts<Float32Array, LocalTtsSynthesisResult> = {
      vad: {
        isSupported: () =>
          globalThis.isSecureContext === true &&
          typeof navigator.mediaDevices?.getUserMedia === 'function',
        start: (context) => this.startVad(context),
        stop: () => this.vad?.pause(),
      },
      stt: {
        isSupported: async () => (await this.capabilities()).wasm.available,
        install: async (context) => {
          const modelId = (await this.selection()).stt;
          if (!modelId) throw new Error('No compatible local speech recognizer was found.');
          throwIfAborted(context.signal);
          await this.stt.load(modelId, (progress) =>
            this.reportWorkerProgress(modelId, progress),
          );
          this.reportReady(modelId);
          throwIfAborted(context.signal);
        },
        transcribe: async (utterance, context) => {
          throwIfAborted(context.signal);
          const result = await this.stt.transcribe(utterance, 16_000);
          throwIfAborted(context.signal);
          return result.text;
        },
      },
      brain: {
        isSupported: async () => (await this.selection()).llm !== null,
        install: async (context) => {
          const modelId = (await this.selection()).llm;
          if (!modelId) throw new Error('WebGPU with shader-f16 is required for the local brain.');
          throwIfAborted(context.signal);
          await this.brain.load(
            modelId,
            (progress) => this.reportBrainProgress(modelId, progress),
            context.signal,
          );
          this.reportReady(modelId);
          throwIfAborted(context.signal);
        },
        stream: (request) => this.streamBrain(request),
      },
      tts: {
        isSupported: async () => (await this.capabilities()).wasm.available,
        install: async (context) => {
          const modelId = (await this.selection()).tts;
          if (!modelId) throw new Error('No compatible local speech runtime was found.');
          throwIfAborted(context.signal);
          await this.tts.load(modelId, (progress) =>
            this.reportWorkerProgress(modelId, progress),
          );
          this.reportReady(modelId);
          throwIfAborted(context.signal);
        },
        synthesize: async (request) => {
          const cancel = (): void => this.tts.cancelInFlight();
          request.signal.addEventListener('abort', cancel, { once: true });
          try {
            const result = await this.tts.synthesize(request.text);
            throwIfAborted(request.signal);
            return result;
          } finally {
            request.signal.removeEventListener('abort', cancel);
          }
        },
      },
      playback: {
        isSupported: () =>
          typeof globalThis.AudioContext === 'function' ||
          typeof (globalThis as typeof globalThis & { webkitAudioContext?: unknown })
            .webkitAudioContext === 'function',
        play: (request) => this.playSynthesis(request),
      },
    };

    this.agent = new LocalVoiceAgent({
      ports,
      maxHistoryMessages: 10,
      maxHistoryCharacters: 4_500,
      maxBufferedClauses: 2,
      firstClauseCharacters: 96,
      maxClauseCharacters: 180,
      onMetric: (metric) => this.callbacks.onMetric?.(metric),
    });
    this.unsubscribeAgent = this.agent.subscribe((event) => {
      this.callbacks.onAgentEvent?.(event);
    });
  }

  async capabilities(): Promise<BrowserCapabilitySnapshot> {
    if (!this.capabilitiesPromise) {
      this.capabilitiesPromise = detectBrowserCapabilities().then((capabilities) => {
        this.callbacks.onCapabilities?.(capabilities);
        return capabilities;
      });
    }
    return this.capabilitiesPromise;
  }

  async selection(): Promise<LocalAgentModelSelection> {
    if (!this.selectionPromise) {
      this.selectionPromise = this.capabilities().then((capabilities) =>
        selectLocalAgentModels(
          capabilities,
          Object.keys(this.modelRequest).length > 0
            ? this.modelRequest
            : SAFE_DEFAULT_MODEL_SELECTION,
        ).selection,
      );
    }
    return this.selectionPromise;
  }

  submitTranscript(transcript: string): Promise<void> {
    return this.agent.submitTranscript(transcript);
  }

  /** Updates only the articulation timing policy; loaded model workers stay resident. */
  setLipSyncMode(mode: LocalLipSyncMode): void {
    this.modelRequest.lipSyncMode = mode;
  }

  async dispose(): Promise<void> {
    await this.agent.stopListening().catch(() => undefined);
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    await Promise.all([
      this.vad?.dispose(),
      this.stt.dispose(),
      this.brain.dispose(),
      this.tts.dispose(),
    ]);
    this.vad = null;
  }

  private async startVad(context: VadStartContext<Float32Array>): Promise<void> {
    const callbacks: VadRuntimeCallbacks = {
      onSpeechStart: () => {
        this.suppressCurrentSegment = false;
      },
      onSpeechConfirmed: () => {
        const outputRms = this.speech.playbackOutputRms();
        const outputActive = this.speech.snapshot().state === 'playing';
        const echoThreshold = Math.max(0.012, outputRms * 0.2);
        this.suppressCurrentSegment =
          outputActive &&
          this.lastMicRms < echoThreshold &&
          this.lastSpeechProbability < 0.94;
        if (this.suppressCurrentSegment) this.callbacks.onEchoSuppressed?.();
        else context.onSpeechStart();
      },
      onSpeechEnd: (audio) => {
        if (!this.suppressCurrentSegment) context.onUtterance(audio);
        this.suppressCurrentSegment = false;
      },
      onMisfire: () => {
        this.suppressCurrentSegment = false;
      },
      onLevel: (rms, probability) => {
        this.lastMicRms = rms;
        this.lastSpeechProbability = probability;
        this.callbacks.onMicLevel?.(rms, probability);
      },
    };
    if (this.vad) this.vad.setCallbacks(callbacks);
    else this.vad = new VadRuntime(callbacks);
    context.signal.addEventListener('abort', () => void this.vad?.pause(), { once: true });
    await this.vad.start().catch((error: unknown) => {
      context.onError(error);
      throw error;
    });
  }

  private async *streamBrain(request: BrainRequest): AsyncGenerator<string, void, void> {
    const history = request.history.map(({ role, content }) => ({ role, content }));
    for await (const token of this.brain.stream(history, request.signal)) yield token;
  }

  private async playSynthesis(
    request: PlaybackRequest<LocalTtsSynthesisResult>,
  ): Promise<PlaybackResult> {
    throwIfAborted(request.signal);
    const totalDuration = request.synthesis.chunks.reduce(
      (total, chunk) => total + chunk.audio.length / chunk.sampleRate,
      0,
    );
    let elapsed = 0;
    let prepared: PreparedSpeech | null = null;
    let reportedAudioStart = false;
    for (const chunk of request.synthesis.chunks) {
      throwIfAborted(request.signal);
      prepared = await this.speech.playLocalPcm(
        chunk.audio,
        chunk.sampleRate,
        chunk.text,
        chunk.phonemes,
        request.synthesis.engine === 'supertonic-2'
          ? LOCAL_SUPERTONIC_VOICE
          : request.synthesis.engine === 'kitten-tts-nano'
            ? LOCAL_KITTEN_VOICE
            : undefined,
        {
          timingMode: this.modelRequest.lipSyncMode ?? 'auto',
          performanceIntent: request.performanceIntent,
          performanceUserText: request.performanceUserText,
        },
      );
      if (!reportedAudioStart) {
        reportedAudioStart = true;
        this.callbacks.onMetric?.({
          type: 'milestone',
          stage: 'audio-start',
          at: this.speech.scheduledPlaybackStartAt() ??
            (globalThis.performance?.now?.() ?? Date.now()),
          turnId: request.turnId,
        });
      }
      const completed = await waitForSpeechPlayback(
        this.speech,
        request,
        elapsed,
        totalDuration,
      );
      if (!completed) {
        return {
          completed: false,
          spokenCharacters: Math.floor(
            request.text.length *
              ((elapsed + this.speech.playbackClock().positionSeconds) /
                Math.max(0.001, totalDuration)),
          ),
        };
      }
      elapsed += prepared.durationSeconds;
    }
    request.onProgress({ spokenCharacters: request.text.length });
    return { completed: true, spokenCharacters: request.text.length };
  }

  private reportWorkerProgress(modelId: LocalModelId, progress: WorkerProgress): void {
    this.callbacks.onModelProgress?.({ modelId, ...progress });
  }

  private reportBrainProgress(modelId: LocalModelId, progress: BrainLoadProgress): void {
    this.callbacks.onModelProgress?.({
      modelId,
      fraction: Math.max(0, Math.min(1, progress.progress)),
      loadedBytes: 0,
      totalBytes: null,
      message: progress.text,
    });
  }

  private reportReady(modelId: LocalModelId): void {
    this.callbacks.onModelProgress?.({
      modelId,
      fraction: 1,
      loadedBytes: 0,
      totalBytes: null,
      message: 'ready · cached locally',
    });
  }
}
