export { CoarticulationEngine, normalizePhoneForRig, poseForPhone } from './CoarticulationEngine';
export {
  analyzeSpeechAudio,
  refinePhonemeTimelineWithAudio,
  sampleSpeechAcoustics,
} from './AudioAnalysis';
export type {
  AcousticAnalysisOptions,
  PcmAudioLike,
  SpeechAcousticFrame,
} from './AudioAnalysis';
export { AsyncTtlLruCache } from './AsyncTtlLruCache';
export type { AsyncTtlLruCacheOptions } from './AsyncTtlLruCache';
export {
  clearStoredElevenLabsApiKey,
  ELEVENLABS_API_KEY_STORAGE_KEY,
  getStoredElevenLabsApiKey,
  maskElevenLabsApiKey,
  normalizeElevenLabsApiKey,
  storeElevenLabsApiKey,
} from './ElevenLabsApiKeyStore';
export {
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_TIMESTAMPED_TTS_URL,
  ElevenLabsBrowserTtsClient,
  ElevenLabsBrowserTtsError,
  MAX_SPEECH_TEXT_CHARACTERS,
  PREMADE_VOICE_ID,
  PREMADE_VOICE_NAME,
  sanitizeSpeechText,
} from './ElevenLabsBrowserTts';
export type {
  ElevenLabsBrowserTtsErrorCode,
  ElevenLabsBrowserTtsOptions,
  TimestampedSpeechClient,
} from './ElevenLabsBrowserTts';
export type {
  AudioClock,
  CoarticulationEngineOptions,
} from './CoarticulationEngine';
export {
  EXPRESSIVE_MORPH_TARGETS,
  ExpressivePerformanceController,
  calibrateExpressionIntensity,
  inferTextAffect,
  normalizePitchHz,
  planExpressivePerformance,
  protectSmileForOralContact,
  robustPitchStatistics,
  sampleSemanticAffectEnvelope,
  speechCompatibleExpressionWeight,
  suppressCompetingExpression,
} from './ExpressivePerformanceController';
export {
  PERFORMANCE_AFFECTS,
  PERFORMANCE_ACTION_DIRECTIVE_PREFIX,
  PERFORMANCE_DIRECTIVE_PREFIX,
  PERFORMANCE_DISCOURSE_ACTS,
  PERFORMANCE_GESTURES,
  PerformanceDirectiveStream,
  inferPerformanceIntent,
  parsePerformanceActionDirective,
  parsePerformanceDirective,
} from './PerformanceIntent';
export type {
  PerformanceAction,
  PerformanceActionOnset,
  PerformanceAffect,
  PerformanceDiscourseAct,
  PerformanceDirectivePart,
  PerformanceGesture,
  PerformanceIntent,
  PerformanceIntentInferenceInput,
  PerformanceIntentSource,
} from './PerformanceIntent';
export type {
  BlinkCue,
  ConversationalPerformanceState,
  ExpressiveAffect,
  ExpressiveAffectTargets,
  ExpressiveMorphTarget,
  ExpressiveMorphWeights,
  ExpressivePerformanceDiagnostics,
  ExpressivePerformanceFrame,
  ExpressivePerformanceInput,
  ExpressivePerformancePlan,
  PitchStatistics,
  ProsodicCue,
  SemanticAffectEnvelope,
} from './ExpressivePerformanceController';
export {
  LOCAL_KITTEN_VOICE,
  LOCAL_KOKORO_VOICE,
  LOCAL_SUPERTONIC_VOICE,
  SPEECH_DISCLOSURE,
  SpeechController,
  SpeechControllerError,
} from './SpeechController';
export {
  kokoroPhonemesToIntervals,
  resolveKokoroPhonemeIntervals,
  tokenizeKokoroIpa,
} from './KokoroPhonemeTiming';
export {
  buildPhonemeTimeline,
  espeakWordPhonemizer,
  extractWordTimings,
  tokenizeIpa,
  validateCharacterAlignment,
} from './PhonemeTiming';
export type { PhonemeTimelineOptions, WordPhonemizer } from './PhonemeTiming';
export type {
  KokoroPhonemeInput,
  KokoroPhonemeToken,
} from './KokoroPhonemeTiming';
export {
  applyGnmSpeechMorphWeights,
  GNM_SPEECH_MORPH_TARGETS,
  toGnmSpeechMorphWeights,
} from './GnmSpeechMorphAdapter';
export type {
  GnmSpeechMorphTarget,
  GnmSpeechMorphWeights,
  MorphTargetMeshLike,
} from './GnmSpeechMorphAdapter';
export type {
  PreparedSpeech,
  LocalPcmPlaybackOptions,
  SpeechAssetSource,
  SpeechControllerListener,
  SpeechControllerOptions,
  SpeechPlaybackClockSnapshot,
  SpeechControllerSnapshot,
  SpeechControllerState,
} from './SpeechController';
export * from './types';
