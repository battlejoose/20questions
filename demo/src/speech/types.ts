/** The raw snake_case shape returned by ElevenLabs' REST API. */
export interface ElevenLabsCharacterAlignmentJson {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Raw response from POST /v1/text-to-speech/:voice_id/with-timestamps. */
export interface ElevenLabsTimestampedResponseJson {
  audio_base64: string;
  alignment?: ElevenLabsCharacterAlignmentJson | null;
  normalized_alignment?: ElevenLabsCharacterAlignmentJson | null;
}

/** SDK-neutral character timing used by the rest of the application. */
export interface CharacterAlignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

export interface WordTiming {
  text: string;
  wordIndex: number;
  startTime: number;
  endTime: number;
  characterStart: number;
  characterEnd: number;
}

export type PhonemeTimingSource =
  | 'estimated-from-character-alignment'
  | 'estimated-from-kokoro-phonemes'
  | 'estimated-from-local-phonemes'
  | 'waveform-refined'
  | 'silence-gap';

export type PhonemeTimingOrigin =
  | 'provider-aligned'
  | 'synthesis-native'
  | 'forced-aligned'
  | 'g2p-estimated';

/** User-selectable policy for turning local TTS timing into GNM motion. */
export type LocalLipSyncMode = 'auto' | 'native' | 'waveform' | 'heuristic';

/**
 * Phone timing estimated inside each ElevenLabs word interval.
 * It is deterministic, but it is not an acoustic forced-alignment confidence.
 */
export interface PhonemeInterval {
  phone: string;
  normalizedPhone: string;
  startTime: number;
  endTime: number;
  word: string | null;
  wordIndex: number | null;
  source: PhonemeTimingSource;
  /** Where the boundary clock originated, independent of later DSP refinement. */
  timingOrigin?: PhonemeTimingOrigin;
  /** Optional deterministic prominence metadata supplied by a timing source. */
  stress?: 0 | 1 | 2;
  /** Normalized emphasis amount. One is neutral; values are clamped by the rig. */
  emphasis?: number;
  /** Speaking-rate ratio where one is the timing source's neutral rate. */
  speakingRate?: number;
}

/** Stable morph/bone names expected from the compact speech rig. */
export const SPEECH_RIG_TARGETS = [
  'jawOpen',
  'jawForward',
  'upperLipRaise',
  'lowerLipDepress',
  'lipsTogether',
  'lipCompress',
  'lipRollIn',
  'lipRollOut',
  'lipPucker',
  'lipFunnel',
  'lipStretch',
  'mouthStretch',
  'mouthCornersUp',
  'mouthCornersDown',
  'lowerLipToTeeth',
  'tongueTipUp',
  'tongueTipLateral',
  'tongueBladeUp',
  'tongueBladeGroove',
  'tongueBetweenTeeth',
  'tongueDorsumUp',
  'tongueBodyHigh',
  'tongueBodyBack',
  'tongueBodyLow',
  'tongueForward',
  'tongueRetract',
  'contactBilabial',
  'contactLabiodental',
  'contactDental',
  'contactAlveolar',
  'contactLateral',
  'correctiveSibilantGroove',
  'contactVelar',
  'mouthAA',
  'mouthAH',
  'mouthE',
  'mouthIH',
  'mouthI',
  'mouthO',
  'mouthU',
  'mouthR',
  'mouthSHCH',
  'mouthSZ',
] as const;

export type SpeechRigTarget = (typeof SPEECH_RIG_TARGETS)[number];
export type SpeechRigPose = Partial<Record<SpeechRigTarget, number>>;
export type SpeechRigWeights = Record<SpeechRigTarget, number>;

export type SpeechGestureKind =
  | 'silence'
  | 'vowel'
  | 'diphthong'
  | 'stop'
  | 'nasal-closure'
  | 'fricative'
  | 'approximant';

export interface VisemeInterval {
  phone: string;
  startTime: number;
  endTime: number;
  anticipationStartTime: number;
  releaseEndTime: number;
  pose: SpeechRigPose;
  /** Extra phase data is optional so existing timeline consumers remain valid. */
  normalizedPhone?: string;
  gestureKind?: SpeechGestureKind;
  peakStartTime?: number;
  releaseStartTime?: number;
  startPose?: SpeechRigPose;
  endPose?: SpeechRigPose;
  dominance?: number;
  strength?: number;
}

export interface SyntheticVoiceDisclosure {
  voiceId: string;
  displayName: string;
  premade: true;
  historicalVoiceClone: false;
  synthetic: true;
}

/** JSON-safe payload returned by the demo's server endpoint. */
export interface SpeechSynthesisPayload {
  audioBase64: string;
  audioMimeType: 'audio/mpeg';
  durationSeconds: number;
  alignment: CharacterAlignment;
  words: WordTiming[];
  phonemes: PhonemeInterval[];
  voice: SyntheticVoiceDisclosure;
}
