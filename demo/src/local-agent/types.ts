import type {
  PerformanceAction,
  PerformanceIntent,
} from '../speech/PerformanceIntent';

export type LocalAgentState =
  | 'unsupported'
  | 'installing'
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type ConversationRole = 'user' | 'assistant';

export interface ConversationMessage {
  readonly role: ConversationRole;
  readonly content: string;
  readonly turnId: number;
}

export type RequestPhase =
  | 'support'
  | 'install'
  | 'vad'
  | 'stt'
  | 'brain'
  | 'tts'
  | 'playback';

export interface RequestContext {
  readonly turnId: number;
  readonly requestId: number;
  readonly signal: AbortSignal;
}

export interface InstallablePort {
  isSupported?(context: RequestContext): boolean | Promise<boolean>;
  install?(context: RequestContext): void | Promise<void>;
}

export interface VadStartContext<TUtterance> extends RequestContext {
  readonly onSpeechStart: () => void;
  readonly onUtterance: (utterance: TUtterance) => void;
  readonly onError: (error: unknown) => void;
}

export interface VadPort<TUtterance> extends InstallablePort {
  start(context: VadStartContext<TUtterance>): void | Promise<void>;
  stop?(): void | Promise<void>;
}

export interface SttPort<TUtterance> extends InstallablePort {
  transcribe(utterance: TUtterance, context: RequestContext): Promise<string>;
}

export interface BrainRequest extends RequestContext {
  readonly transcript: string;
  readonly history: readonly ConversationMessage[];
}

export interface BrainPort extends InstallablePort {
  stream(request: BrainRequest):
    | AsyncIterable<string>
    | Promise<AsyncIterable<string>>;
}

export interface TtsRequest extends RequestContext {
  readonly text: string;
  readonly performanceIntent?: PerformanceIntent;
  readonly performanceUserText?: string;
}

export interface TtsPort<TSynthesis> extends InstallablePort {
  synthesize(request: TtsRequest): Promise<TSynthesis>;
}

export interface PlaybackProgress {
  /** Number of UTF-16 code units whose audio has actually completed. */
  readonly spokenCharacters: number;
}

export interface PlaybackResult extends PlaybackProgress {
  /** True only when the entire supplied audio completed normally. */
  readonly completed: boolean;
}

export interface PlaybackRequest<TSynthesis> extends RequestContext {
  readonly text: string;
  readonly synthesis: TSynthesis;
  readonly performanceIntent?: PerformanceIntent;
  readonly performanceUserText?: string;
  readonly onProgress: (progress: PlaybackProgress) => void;
}

export interface PlaybackPort<TSynthesis> extends InstallablePort {
  play(request: PlaybackRequest<TSynthesis>): Promise<PlaybackResult | void>;
}

export interface LocalAgentPorts<TUtterance, TSynthesis> {
  readonly vad: VadPort<TUtterance>;
  readonly stt: SttPort<TUtterance>;
  readonly brain: BrainPort;
  readonly tts: TtsPort<TSynthesis>;
  readonly playback: PlaybackPort<TSynthesis>;
}

export type InterruptReason =
  | 'barge-in'
  | 'superseded'
  | 'cancelled'
  | 'stopped';

export interface LocalAgentSnapshot {
  readonly state: LocalAgentState;
  readonly turnId: number;
  readonly requestId: number;
  readonly history: readonly ConversationMessage[];
  readonly error?: Error;
}

export type AgentEvent =
  | {
      readonly type: 'state';
      readonly from: LocalAgentState;
      readonly to: LocalAgentState;
      readonly snapshot: LocalAgentSnapshot;
    }
  | { readonly type: 'turn-started'; readonly turnId: number }
  | { readonly type: 'turn-completed'; readonly turnId: number }
  | { readonly type: 'speech-start'; readonly turnId: number }
  | { readonly type: 'transcript'; readonly turnId: number; readonly text: string }
  | { readonly type: 'reasoning'; readonly turnId: number; readonly text: string }
  | {
      readonly type: 'performance-intent';
      readonly turnId: number;
      readonly intent: PerformanceIntent;
    }
  | {
      readonly type: 'performance-action';
      readonly turnId: number;
      readonly action: PerformanceAction;
    }
  | { readonly type: 'clause'; readonly turnId: number; readonly text: string }
  | {
      readonly type: 'assistant-spoken';
      readonly turnId: number;
      readonly text: string;
    }
  | {
      readonly type: 'barge-in';
      readonly turnId: number;
    }
  | {
      readonly type: 'interrupted';
      readonly turnId: number;
      readonly reason: InterruptReason;
    }
  | {
      readonly type: 'stale-result';
      readonly turnId: number;
      readonly requestId: number;
      readonly phase: RequestPhase;
    }
  | { readonly type: 'error'; readonly error: Error; readonly turnId: number };

export type AgentMetric =
  | {
      readonly type: 'state-transition';
      readonly at: number;
      readonly from: LocalAgentState;
      readonly to: LocalAgentState;
      readonly turnId: number;
    }
  | {
      readonly type: 'request';
      readonly at: number;
      readonly phase: RequestPhase;
      readonly status: 'started' | 'completed' | 'stale' | 'failed';
      readonly turnId: number;
      readonly requestId: number;
      readonly durationMs?: number;
    }
  | {
      readonly type: 'queue-depth';
      readonly at: number;
      readonly turnId: number;
      readonly depth: number;
    }
  | {
      readonly type: 'turn';
      readonly at: number;
      readonly status: 'started' | 'completed' | 'interrupted';
      readonly turnId: number;
      readonly durationMs?: number;
    }
  | {
      readonly type: 'clause';
      readonly at: number;
      readonly turnId: number;
      readonly characters: number;
    }
  | {
      readonly type: 'milestone';
      readonly at: number;
      readonly stage: 'llm-first-token' | 'audio-start';
      readonly turnId: number;
      /** Stage-local duration when the producer can measure it directly. */
      readonly durationMs?: number;
    };

export interface LocalAgentOptions<TUtterance, TSynthesis> {
  readonly ports: LocalAgentPorts<TUtterance, TSynthesis>;
  readonly maxHistoryMessages?: number;
  readonly maxHistoryCharacters?: number;
  readonly maxBufferedClauses?: number;
  readonly maxClauseCharacters?: number;
  readonly firstClauseCharacters?: number;
  readonly now?: () => number;
  readonly onMetric?: (metric: AgentMetric) => void;
}
