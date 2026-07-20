import type { SpeechRigWeights } from './types';

/** Morph names baked by tools/export_gnm_asset.py for speech articulation. */
export const GNM_SPEECH_MORPH_TARGETS = [
  'viseme_MBP',
  'viseme_FV',
  'viseme_L',
  'viseme_TH',
  'viseme_TDN',
  'viseme_SZ',
  'viseme_CHSH',
  'viseme_KG',
  'viseme_R',
  'viseme_WQ',
  'vowel_AA',
  'vowel_AE',
  'vowel_AH',
  'vowel_EH',
  'vowel_IH',
  'vowel_EE',
  'vowel_OH',
  'vowel_OO',
  'jawOpen',
  'mouthFunnel',
  'mouthPucker',
  'tongueTipUp',
  'jawForward',
  'upperLipRaise',
  'lowerLipDepress',
  'lipCompress',
  'lipRollIn',
  'lipRollOut',
  'mouthCornersUp',
  'mouthCornersDown',
  'mouthStretch',
  'tongueTipLateral',
  'tongueBladeUp',
  'tongueBladeGroove',
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
] as const;

export type GnmSpeechMorphTarget = (typeof GNM_SPEECH_MORPH_TARGETS)[number];
export type GnmSpeechMorphWeights = Record<GnmSpeechMorphTarget, number>;

export interface MorphTargetMeshLike {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function blankMorphWeights(): GnmSpeechMorphWeights {
  return Object.fromEntries(
    GNM_SPEECH_MORPH_TARGETS.map((target) => [target, 0]),
  ) as GnmSpeechMorphWeights;
}

/**
 * Converts the provider-independent articulator rig into the expanded native
 * GNM speech basis. Legacy visemes contribute broad learned-manifold motion;
 * atomic contact morphs supply the remainder of each seal/constriction so the
 * same anatomical correction is not applied twice.
 */
export function toGnmSpeechMorphWeights(
  rig: Readonly<SpeechRigWeights>,
): GnmSpeechMorphWeights {
  const morphs = blankMorphWeights();
  const bilabial = Math.max(rig.lipsTogether, rig.contactBilabial);
  const labiodental = Math.max(rig.lowerLipToTeeth, rig.contactLabiodental);
  const dental = Math.max(rig.tongueBetweenTeeth, rig.contactDental);
  const alveolar = Math.max(rig.tongueTipUp, rig.contactAlveolar);
  const lateral = Math.max(rig.tongueTipLateral, rig.contactLateral);
  const velar = Math.max(rig.tongueDorsumUp, rig.contactVelar);
  morphs.viseme_MBP = clamp01(bilabial * 0.35);
  morphs.contactBilabial = clamp01(bilabial * 0.65);
  morphs.viseme_FV = clamp01(labiodental * 0.38);
  morphs.contactLabiodental = clamp01(labiodental * 0.62);
  morphs.viseme_L = clamp01(lateral * 0.35);
  morphs.tongueTipLateral = clamp01(rig.tongueTipLateral * 0.72);
  morphs.contactLateral = clamp01(rig.contactLateral * 0.65);
  morphs.viseme_TH = clamp01(dental * 0.32);
  morphs.contactDental = clamp01(dental * 0.68);
  // These three exported targets each include an alveolar-contact component;
  // their maximum combined unit pose is intentionally bounded to one.
  morphs.viseme_TDN = clamp01(alveolar * 0.18);
  morphs.tongueTipUp = clamp01(rig.tongueTipUp * 0.42);
  morphs.contactAlveolar = clamp01(rig.contactAlveolar * 0.4);
  morphs.viseme_SZ = clamp01(rig.mouthSZ * 0.45);
  morphs.correctiveSibilantGroove = clamp01(
    rig.correctiveSibilantGroove * 0.55,
  );
  morphs.viseme_CHSH = clamp01(rig.mouthSHCH);
  morphs.viseme_KG = clamp01(velar * 0.34);
  morphs.contactVelar = clamp01(rig.contactVelar * 0.66);
  morphs.viseme_R = clamp01(rig.mouthR);
  morphs.viseme_WQ = clamp01(Math.max(rig.mouthU, rig.lipPucker) * 0.72);

  morphs.vowel_AA = clamp01(rig.mouthAA);
  morphs.vowel_AH = clamp01(rig.mouthAH);
  morphs.vowel_AE = clamp01(Math.max(rig.mouthE * 0.55, rig.lipStretch * 0.5));
  morphs.vowel_EH = clamp01(rig.mouthE);
  morphs.vowel_IH = clamp01(rig.mouthIH);
  morphs.vowel_EE = clamp01(Math.max(rig.mouthI, rig.lipStretch * 0.78));
  morphs.vowel_OH = clamp01(rig.mouthO);
  morphs.vowel_OO = clamp01(rig.mouthU);

  morphs.jawOpen = clamp01(rig.jawOpen * 0.92);
  morphs.jawForward = clamp01(rig.jawForward);
  morphs.mouthFunnel = clamp01(rig.lipFunnel);
  morphs.mouthPucker = clamp01(rig.lipPucker);
  morphs.upperLipRaise = clamp01(rig.upperLipRaise);
  morphs.lowerLipDepress = clamp01(rig.lowerLipDepress);
  morphs.lipCompress = clamp01(rig.lipCompress);
  morphs.lipRollIn = clamp01(rig.lipRollIn);
  morphs.lipRollOut = clamp01(rig.lipRollOut);
  morphs.mouthCornersUp = clamp01(rig.mouthCornersUp);
  morphs.mouthCornersDown = clamp01(rig.mouthCornersDown);
  morphs.mouthStretch = clamp01(rig.mouthStretch);
  morphs.tongueBladeUp = clamp01(rig.tongueBladeUp);
  morphs.tongueBladeGroove = clamp01(rig.tongueBladeGroove * 0.72);
  morphs.tongueBodyHigh = clamp01(rig.tongueBodyHigh);
  morphs.tongueBodyBack = clamp01(rig.tongueBodyBack);
  morphs.tongueBodyLow = clamp01(rig.tongueBodyLow);
  morphs.tongueForward = clamp01(rig.tongueForward);
  morphs.tongueRetract = clamp01(rig.tongueRetract);
  return morphs;
}

/** Applies only speech targets; blink/expression targets remain untouched. */
export function applyGnmSpeechMorphWeights(
  mesh: MorphTargetMeshLike,
  weights: Readonly<GnmSpeechMorphWeights>,
): void {
  const dictionary = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dictionary || !influences) return;

  for (const target of GNM_SPEECH_MORPH_TARGETS) {
    const index = dictionary[target];
    if (index !== undefined && index >= 0 && index < influences.length) {
      influences[index] = weights[target];
    }
  }
}
