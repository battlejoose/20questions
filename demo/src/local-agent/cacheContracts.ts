import type {
  LocalExecutionBackend,
  LocalModelId,
  LocalModelRuntime,
} from './modelRegistry';
import type { ModelCompatibilitySnapshot } from './capabilities';
import type { LocalAgentModelSelection } from './selectionPolicy';

export type ModelCacheState =
  | 'missing'
  | 'partial'
  | 'ready'
  | 'stale'
  | 'error';

export interface ModelCacheEntrySnapshot {
  modelId: LocalModelId;
  state: ModelCacheState;
  cacheKey: string;
  revision: string | null;
  expectedBytes: number;
  cachedBytes: number;
  updatedAtEpochMs: number | null;
  verifiedAtEpochMs: number | null;
  error?: string;
}

export interface LocalModelCacheSnapshot {
  schemaVersion: 1;
  capturedAtEpochMs: number;
  persistent: boolean;
  quotaBytes: number | null;
  usageBytes: number | null;
  entries: Readonly<Partial<Record<LocalModelId, ModelCacheEntrySnapshot>>>;
}

export type ModelTransferPhase =
  | 'idle'
  | 'checking-cache'
  | 'awaiting-consent'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'cancelled'
  | 'error';

export interface ModelProgressSnapshot {
  modelId: LocalModelId;
  phase: ModelTransferPhase;
  loadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
  filesCompleted: number;
  filesTotal: number | null;
  bytesPerSecond: number | null;
  updatedAtEpochMs: number;
  message?: string;
}

export type ModelReadinessState =
  | 'unsupported'
  | 'consent-required'
  | 'not-cached'
  | 'loading'
  | 'ready'
  | 'error';

export interface ModelReadinessSnapshot {
  modelId: LocalModelId;
  state: ModelReadinessState;
  compatibility: ModelCompatibilitySnapshot;
  cache: ModelCacheEntrySnapshot;
  progress: ModelProgressSnapshot;
  selectedRuntime: LocalModelRuntime | null;
  selectedBackend: LocalExecutionBackend | null;
  mayDownload: boolean;
  mayInitialize: boolean;
  message: string;
}

export interface LocalAgentReadinessSnapshot {
  capturedAtEpochMs: number;
  selection: LocalAgentModelSelection;
  state: 'unavailable' | 'needs-download' | 'loading' | 'ready' | 'error';
  models: readonly ModelReadinessSnapshot[];
}

export interface ProgressSnapshotInput {
  modelId: LocalModelId;
  phase: ModelTransferPhase;
  loadedBytes?: number;
  totalBytes?: number | null;
  filesCompleted?: number;
  filesTotal?: number | null;
  bytesPerSecond?: number | null;
  updatedAtEpochMs: number;
  message?: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createProgressSnapshot(
  input: ProgressSnapshotInput,
): ModelProgressSnapshot {
  const totalBytes =
    input.totalBytes == null ? null : nonNegative(input.totalBytes);
  const loadedBytes =
    totalBytes === null
      ? nonNegative(input.loadedBytes ?? 0)
      : Math.min(nonNegative(input.loadedBytes ?? 0), totalBytes);
  const fraction =
    totalBytes === null
      ? null
      : totalBytes === 0
        ? input.phase === 'ready'
          ? 1
          : 0
        : loadedBytes / totalBytes;

  return {
    modelId: input.modelId,
    phase: input.phase,
    loadedBytes,
    totalBytes,
    fraction,
    filesCompleted: nonNegative(input.filesCompleted ?? 0),
    filesTotal:
      input.filesTotal == null ? null : nonNegative(input.filesTotal),
    bytesPerSecond:
      input.bytesPerSecond == null ? null : nonNegative(input.bytesPerSecond),
    updatedAtEpochMs: input.updatedAtEpochMs,
    ...(input.message === undefined ? {} : { message: input.message }),
  };
}

export interface ReadinessSnapshotInput {
  compatibility: ModelCompatibilitySnapshot;
  cache: ModelCacheEntrySnapshot;
  progress: ModelProgressSnapshot;
  consentGranted: boolean;
  requiresExplicitConsent: boolean;
  allowDownload: boolean;
}

export function deriveModelReadiness(
  input: ReadinessSnapshotInput,
): ModelReadinessSnapshot {
  const { compatibility, cache, progress } = input;
  const selectedProfile = compatibility.backends.find((backend) => backend.supported)
    ?.backend;
  let state: ModelReadinessState;
  let message: string;

  if (!compatibility.supported) {
    state = 'unsupported';
    message = compatibility.blockers.join('; ');
  } else if (input.requiresExplicitConsent && !input.consentGranted) {
    state = 'consent-required';
    message = 'Explicit model consent is required before any artifact may be resolved.';
  } else if (cache.state === 'error' || progress.phase === 'error') {
    state = 'error';
    message = cache.error ?? progress.message ?? 'The model artifact could not be prepared.';
  } else if (cache.state === 'ready' && progress.phase !== 'verifying') {
    state = 'ready';
    message = 'Model artifacts are cached and ready to initialize.';
  } else if (
    progress.phase === 'checking-cache' ||
    progress.phase === 'downloading' ||
    progress.phase === 'verifying'
  ) {
    state = 'loading';
    message = progress.message ?? 'Model artifacts are being prepared.';
  } else {
    state = 'not-cached';
    message = input.allowDownload
      ? 'Model artifacts are not cached.'
      : 'Model artifacts are not cached and downloads are disabled.';
  }

  return {
    modelId: compatibility.modelId,
    state,
    compatibility,
    cache,
    progress,
    selectedRuntime: selectedProfile?.runtime ?? null,
    selectedBackend: selectedProfile?.execution ?? null,
    mayDownload:
      compatibility.supported &&
      (!input.requiresExplicitConsent || input.consentGranted) &&
      input.allowDownload &&
      state !== 'ready',
    mayInitialize: state === 'ready',
    message,
  };
}

export function deriveAgentReadiness(
  selection: LocalAgentModelSelection,
  models: readonly ModelReadinessSnapshot[],
  capturedAtEpochMs: number,
): LocalAgentReadinessSnapshot {
  const selectedCount = [selection.stt, selection.llm, selection.tts].filter(
    (modelId) => modelId !== null,
  ).length;
  let state: LocalAgentReadinessSnapshot['state'];

  if (selectedCount < 3 || models.some((model) => model.state === 'unsupported')) {
    state = 'unavailable';
  } else if (models.some((model) => model.state === 'error')) {
    state = 'error';
  } else if (models.every((model) => model.state === 'ready')) {
    state = 'ready';
  } else if (models.some((model) => model.state === 'loading')) {
    state = 'loading';
  } else {
    state = 'needs-download';
  }

  return {
    capturedAtEpochMs,
    selection,
    state,
    models,
  };
}
