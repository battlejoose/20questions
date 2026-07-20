import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGnmSpeechMorphWeights,
  GNM_SPEECH_MORPH_TARGETS,
  toGnmSpeechMorphWeights,
} from '../../src/speech/GnmSpeechMorphAdapter';
import { SPEECH_RIG_TARGETS, type SpeechRigWeights } from '../../src/speech/types';

function rigWeights(): SpeechRigWeights {
  return Object.fromEntries(
    SPEECH_RIG_TARGETS.map((target) => [target, 0]),
  ) as SpeechRigWeights;
}

function assertClose(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${actual} to be approximately ${expected}`,
  );
}

test('GNM adapter maps the expanded physical controls without double-applying contacts', () => {
  const rig = rigWeights();
  rig.lipsTogether = 1;
  rig.lowerLipToTeeth = 0.7;
  rig.tongueBetweenTeeth = 0.8;
  rig.tongueTipUp = 0.6;
  rig.contactAlveolar = 0.6;
  rig.tongueTipLateral = 0.5;
  rig.contactLateral = 0.5;
  rig.mouthU = 0.4;
  rig.lipPucker = 0.8;
  rig.mouthE = 0.9;
  rig.lipStretch = 0.7;
  rig.mouthI = 0.3;
  rig.mouthAA = 0.9;
  rig.mouthAH = 0.62;
  rig.mouthIH = 0.74;
  rig.jawOpen = 0.6;
  rig.jawForward = 0.3;
  const result = toGnmSpeechMorphWeights(rig);

  assertClose(result.viseme_MBP + result.contactBilabial, 1);
  assertClose(result.viseme_FV + result.contactLabiodental, 0.7);
  assertClose(result.viseme_TH + result.contactDental, 0.8);
  assertClose(result.viseme_L, 0.175);
  assertClose(result.viseme_TDN, 0.108);
  assertClose(result.tongueTipUp, 0.252);
  assertClose(result.tongueTipLateral, 0.36);
  assertClose(result.viseme_WQ, 0.576);
  assert.equal(result.vowel_AA, 0.9);
  assert.equal(result.vowel_AH, 0.62);
  assert.equal(result.vowel_IH, 0.74);
  assertClose(result.vowel_AE, 0.495);
  assert.equal(result.vowel_EH, 0.9);
  assertClose(result.vowel_EE, 0.546);
  assertClose(result.jawOpen, 0.552);
  assert.equal(result.jawForward, 0.3);
});

test('L and T/D/N stay on distinct GNM tongue targets', () => {
  const lateral = rigWeights();
  lateral.tongueTipLateral = 1;
  lateral.contactLateral = 1;
  const lateralMorphs = toGnmSpeechMorphWeights(lateral);
  assert.ok(lateralMorphs.viseme_L > 0);
  assert.ok(lateralMorphs.tongueTipLateral > 0);
  assert.equal(lateralMorphs.viseme_TDN, 0);
  assert.equal(lateralMorphs.contactAlveolar, 0);

  const alveolar = rigWeights();
  alveolar.tongueTipUp = 1;
  alveolar.contactAlveolar = 1;
  const alveolarMorphs = toGnmSpeechMorphWeights(alveolar);
  assert.ok(alveolarMorphs.viseme_TDN > 0);
  assert.ok(alveolarMorphs.tongueTipUp > 0);
  assertClose(
    alveolarMorphs.viseme_TDN +
      alveolarMorphs.tongueTipUp +
      alveolarMorphs.contactAlveolar,
    1,
  );
  assert.equal(alveolarMorphs.viseme_L, 0);
  assert.equal(alveolarMorphs.contactLateral, 0);
});

test('GNM adapter updates speech targets without disturbing blink targets', () => {
  const dictionary = Object.fromEntries(
    [...GNM_SPEECH_MORPH_TARGETS, 'blinkLeft'].map((name, index) => [name, index]),
  );
  const influences = Array.from(
    { length: GNM_SPEECH_MORPH_TARGETS.length + 1 },
    () => 0,
  );
  influences[dictionary.blinkLeft] = 0.75;
  const rig = rigWeights();
  rig.mouthO = 0.8;

  applyGnmSpeechMorphWeights(
    { morphTargetDictionary: dictionary, morphTargetInfluences: influences },
    toGnmSpeechMorphWeights(rig),
  );

  assert.equal(influences[dictionary.vowel_OH], 0.8);
  assert.equal(influences[dictionary.blinkLeft], 0.75);
});
