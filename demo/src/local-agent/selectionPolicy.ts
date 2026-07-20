import {
  LANGUAGE_MODELS,
  SPEECH_TO_TEXT_MODELS,
  TEXT_TO_SPEECH_MODELS,
  getLocalModel,
  type LanguageModelId,
  type LocalModelDescriptor,
  type LocalModelId,
  type SpeechToTextModelId,
  type TextToSpeechModelId,
} from './modelRegistry';
import {
  evaluateModelCompatibility,
  type BrowserCapabilitySnapshot,
  type ModelCompatibilitySnapshot,
} from './capabilities';
import type { LocalLipSyncMode } from '../speech';

export interface LocalAgentModelSelection {
  stt: SpeechToTextModelId | null;
  llm: LanguageModelId | null;
  tts: TextToSpeechModelId | null;
}

export interface LocalAgentModelRequest {
  stt?: SpeechToTextModelId;
  llm?: LanguageModelId;
  tts?: TextToSpeechModelId;
  lipSyncMode?: LocalLipSyncMode;
  /** Consent is scoped to one model and is not persisted by this policy module. */
  consentedModelIds?: readonly LocalModelId[];
}

export interface SelectionDecision {
  kind: LocalModelDescriptor['kind'];
  requestedModelId: LocalModelId;
  selectedModelId: LocalModelId | null;
  compatibility: ModelCompatibilitySnapshot;
  automatic: boolean;
  reason: string;
}

export interface LocalAgentSelectionResult {
  selection: LocalAgentModelSelection;
  decisions: readonly SelectionDecision[];
  readyToResolveArtifacts: boolean;
}

export const SAFE_DEFAULT_MODEL_SELECTION = Object.freeze({
  stt: 'moonshine-tiny-q8',
  llm: 'qwen2.5-0.5b-instruct-q4f16',
  tts: 'kokoro-82m-q8-wasm',
} as const satisfies LocalAgentModelSelection);

function decide(
  model: LocalModelDescriptor,
  capabilities: BrowserCapabilitySnapshot,
  explicitRequest: boolean,
  consentedModelIds: ReadonlySet<LocalModelId>,
): SelectionDecision {
  const compatibility = evaluateModelCompatibility(model, capabilities);
  if (!compatibility.supported) {
    return {
      kind: model.kind,
      requestedModelId: model.id,
      selectedModelId: null,
      compatibility,
      automatic: !explicitRequest,
      reason: compatibility.blockers.join('; '),
    };
  }

  if (model.policy.requiresExplicitConsent && !consentedModelIds.has(model.id)) {
    return {
      kind: model.kind,
      requestedModelId: model.id,
      selectedModelId: null,
      compatibility,
      automatic: !explicitRequest,
      reason: 'Explicit consent is required for this model.',
    };
  }

  if (!explicitRequest && model.policy.releaseChannel !== 'safe-default') {
    return {
      kind: model.kind,
      requestedModelId: model.id,
      selectedModelId: null,
      compatibility,
      automatic: true,
      reason: 'Optional and experimental models are never selected automatically.',
    };
  }

  return {
    kind: model.kind,
    requestedModelId: model.id,
    selectedModelId: model.id,
    compatibility,
    automatic: !explicitRequest,
    reason: explicitRequest ? 'Supported explicit model selection.' : 'Supported safe default.',
  };
}

export function selectLocalAgentModels(
  capabilities: BrowserCapabilitySnapshot,
  request: LocalAgentModelRequest = {},
): LocalAgentSelectionResult {
  const consented = new Set(request.consentedModelIds ?? []);
  const stt = request.stt ?? SAFE_DEFAULT_MODEL_SELECTION.stt;
  const llm = request.llm ?? SAFE_DEFAULT_MODEL_SELECTION.llm;
  const tts = request.tts ?? SAFE_DEFAULT_MODEL_SELECTION.tts;
  const decisions = [
    decide(SPEECH_TO_TEXT_MODELS[stt], capabilities, request.stt !== undefined, consented),
    decide(LANGUAGE_MODELS[llm], capabilities, request.llm !== undefined, consented),
    decide(TEXT_TO_SPEECH_MODELS[tts], capabilities, request.tts !== undefined, consented),
  ];
  const selection: LocalAgentModelSelection = {
    stt: decisions[0].selectedModelId as SpeechToTextModelId | null,
    llm: decisions[1].selectedModelId as LanguageModelId | null,
    tts: decisions[2].selectedModelId as TextToSpeechModelId | null,
  };

  return {
    selection,
    decisions,
    readyToResolveArtifacts:
      selection.stt !== null && selection.llm !== null && selection.tts !== null,
  };
}

export function mayAutomaticallyDownload(modelId: LocalModelId): boolean {
  const model = getLocalModel(modelId);
  return (
    model.policy.releaseChannel === 'safe-default' &&
    model.policy.allowAutomaticDownload &&
    !model.policy.requiresExplicitConsent
  );
}
