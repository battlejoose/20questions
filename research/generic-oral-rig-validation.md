# GNM speech and expression rig geometry validation

**Result:** PASS (152/152 checks)

GNM-derived oral speech geometry plus region-isolated upper-face and joint-derived gaze regression; anatomically informed, not forensic, medical, patient-specific, or millimetrically validated.

## Method

The validator re-evaluates the pinned GNM v3 population-mean identity, applies the same deterministic correctives as the exporter, measures GNM's barycentric 68-point mouth landmarks and component geometry, checks rigid teeth, upper-face/oral separation, bilateral expression symmetry, and eye-joint gaze isolation, and byte-decodes every source GLB morph accessor to prove source/export parity. The compressed runtime manifest is checked here and decoded source/runtime parity is checked separately with `demo/scripts/compare-gnm-runtime.mjs`.

## Checks

| Status | Target | Check | Value | Expected |
|---|---|---|---:|---|
| PASS | all | finite geometry | True | true |
| PASS | all | bounded displacement | 19.7874 mm | <= 25 |
| PASS | oral targets | speech-target eyeball stability | 0 mm | <= 0.02 |
| PASS | oral targets | upper dental arch stability | 0 mm | <= 0.02 |
| PASS | oral targets | lower teeth rigid RMS | 0.000378467 mm | <= 0.02 |
| PASS | oral targets | oral delta symmetry RMS | 9.5251e-06 mm | <= 0.02 |
| PASS | artifact | GLB target names | True | true |
| PASS | artifact | GLB source-position parity | 0 m | <= 1e-7 |
| PASS | artifact | GLB morph-delta parity | 0 m | <= 1e-7 |
| PASS | artifact | source GLB size | 24298424 bytes | <= 24 MiB |
| PASS | artifact | runtime topology fingerprint | True | exact baseline SHA-256 |
| PASS | oral targets | oral runtime contract fingerprint | True | exact 46-target baseline SHA-256 |
| PASS | source | GNM model dimensions | True | 253 identity / 383 expression / 4 joints / 17,821 vertices / 35,324 triangles |
| PASS | artifact | metadata parity | True | all generated metadata contracts match |
| PASS | runtime artifact | compressed runtime manifest | True | 67 names / 8 primitives / 536 morph slots / <= 2 MiB |
| PASS | artifact | nontrivial compact targets | 67 count | == 67 |
| PASS | eyeOpen | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | eyeOpen | oral landmark stability | 0 mm | <= 0.001 |
| PASS | blinkLeft | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | blinkLeft | oral landmark stability | 0 mm | <= 0.001 |
| PASS | blinkRight | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | blinkRight | oral landmark stability | 0 mm | <= 0.001 |
| PASS | browConcern | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browConcern | oral landmark stability | 0 mm | <= 0.001 |
| PASS | browLift | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browLift | oral landmark stability | 0 mm | <= 0.001 |
| PASS | browLiftLeft | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browLiftLeft | oral landmark stability | 0 mm | <= 0.001 |
| PASS | browLiftRight | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browLiftRight | oral landmark stability | 0 mm | <= 0.001 |
| PASS | browFurrow | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browFurrow | oral landmark stability | 0 mm | <= 0.001 |
| PASS | eyeWiden | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | eyeWiden | oral landmark stability | 0 mm | <= 0.001 |
| PASS | eyeSquint | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | eyeSquint | oral landmark stability | 0 mm | <= 0.001 |
| PASS | cheekRaise | upper-face region isolation | True | skin moves; oral/ocular <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | cheekRaise | oral landmark stability | 0 mm | <= 0.001 |
| PASS | smileMouth | lower-face affect isolation | True | skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | surpriseMouth | lower-face affect isolation | True | skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | concernMouth | lower-face affect isolation | True | skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | curiosityMouth | lower-face affect isolation | True | skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | emphasisMouth | lower-face affect isolation | True | skin and oral envelope move; eyes/teeth/tongue <= 0.001 mm; bilateral symmetry <= 0.001 mm |
| PASS | browLift | named expression direction | 1.9328 mm | >= 0.30 |
| PASS | browFurrow | named expression direction | -0.64286 mm | <= -0.10 |
| PASS | eyeWiden | named expression direction | 3.26866 mm | >= 0.50 |
| PASS | eyeSquint | named expression direction | -3.26858 mm | <= -0.50 |
| PASS | cheekRaise | named expression direction | 0.470257 mm | >= 0.10 |
| PASS | warm | perceptible production affect | 9.41257 mm | >= 0.50 |
| PASS | warm | affect protected-component isolation | 0 mm | <= 0.001 |
| PASS | warm | whole-face affect signal | 8.93638 mm | >= 0.10 |
| PASS | surprise | perceptible production affect | 4.67504 mm | >= 0.50 |
| PASS | surprise | affect protected-component isolation | 0 mm | <= 0.001 |
| PASS | surprise | whole-face affect signal | 4.51309 mm | >= 0.10 |
| PASS | question | perceptible production affect | 2.49595 mm | >= 0.50 |
| PASS | question | affect protected-component isolation | 0 mm | <= 0.001 |
| PASS | question | whole-face affect signal | 1.18464 mm | >= 0.10 |
| PASS | concerned | perceptible production affect | 3.2754 mm | >= 0.50 |
| PASS | concerned | affect protected-component isolation | 0 mm | <= 0.001 |
| PASS | concerned | whole-face affect signal | 3.06954 mm | >= 0.10 |
| PASS | emphatic | perceptible production affect | 2.07682 mm | >= 0.50 |
| PASS | emphatic | affect protected-component isolation | 0 mm | <= 0.001 |
| PASS | emphatic | whole-face affect signal | 1.50638 mm | >= 0.10 |
| PASS | warm | signed production affect direction | 4.92644 mm | >= 1.0 |
| PASS | surprise | signed production affect direction | 3.31417 mm | >= 1.0 |
| PASS | surprise | signed production affect direction | 3.23728 mm | >= 1.0 |
| PASS | question | signed production affect direction | 1.74838 mm | >= 0.50 |
| PASS | question | signed production affect direction | 1.3376 mm | >= 0.50 |
| PASS | concerned | signed production affect direction | -1.40417 mm | <= -0.50 |
| PASS | concerned | signed production affect direction | -0.601906 mm | <= -0.20 |
| PASS | emphatic | signed production affect direction | -2.06868 mm | <= -0.25 |
| PASS | warmBilabial | affect-compatible bilabial distance | 0.404317 mm | 0.05–0.80 |
| PASS | warmBilabial | affect-compatible bilabial coverage | 0.933333 | >= 0.85 |
| PASS | warmBilabial | affect remains visible through contact | 1.07236 mm | >= 0.15 |
| PASS | warmLabiodental | affect-compatible labiodental distance | 0.346614 mm | 0.20–1.20 |
| PASS | warmLabiodental | affect-compatible labiodental coverage | 0.578947 | >= 0.50 |
| PASS | warmLabiodental | affect remains visible through contact | 1.07236 mm | >= 0.50 |
| PASS | surpriseBilabial | affect-compatible bilabial distance | 0.186965 mm | 0.05–0.80 |
| PASS | surpriseBilabial | affect-compatible bilabial coverage | 0.877059 | >= 0.85 |
| PASS | surpriseBilabial | affect remains visible through contact | 0.18052 mm | >= 0.15 |
| PASS | concernBilabial | affect-compatible bilabial distance | 0.516282 mm | 0.05–0.80 |
| PASS | concernBilabial | affect-compatible bilabial coverage | 0.933333 | >= 0.85 |
| PASS | concernBilabial | affect remains visible through contact | 1.90311 mm | >= 0.15 |
| PASS | questionBilabial | affect-compatible bilabial distance | 0.117503 mm | 0.05–0.80 |
| PASS | questionBilabial | affect-compatible bilabial coverage | 0.9 | >= 0.85 |
| PASS | questionBilabial | affect remains visible through contact | 0.28431 mm | >= 0.15 |
| PASS | emphaticBilabial | affect-compatible bilabial distance | 0.159257 mm | 0.05–0.80 |
| PASS | emphaticBilabial | affect-compatible bilabial coverage | 0.944444 | >= 0.85 |
| PASS | emphaticBilabial | affect remains visible through contact | 0.602548 mm | >= 0.15 |
| PASS | gazeLeft | joint-derived ocular gaze isolation and direction | True | intended iris axis >= 0.5 mm; outside ocular <= 0.001 mm |
| PASS | gazeRight | joint-derived ocular gaze isolation and direction | True | intended iris axis >= 0.5 mm; outside ocular <= 0.001 mm |
| PASS | gazeUp | joint-derived ocular gaze isolation and direction | True | intended iris axis >= 0.5 mm; outside ocular <= 0.001 mm |
| PASS | gazeDown | joint-derived ocular gaze isolation and direction | True | intended iris axis >= 0.5 mm; outside ocular <= 0.001 mm |
| PASS | artifact | duplicate compact targets | 0 count | == 0 |
| PASS | viseme_MBP | bilabial rim distance | 0.248245 mm | 0.10–0.80 |
| PASS | viseme_MBP | bilabial contact coverage | 0.929739 | >= 0.70 |
| PASS | viseme_MBP | bilabial aperture | 4.94982 mm | <= 5.5 |
| PASS | viseme_FV | labiodental contact | 0.418054 mm | 0.20–1.20 |
| PASS | viseme_FV | labiodental aperture | 6.62541 mm | 4.5–8.5 |
| PASS | viseme_L | alveolar tongue contact | 0.507443 mm | 0.10–1.50 |
| PASS | viseme_TDN | alveolar tongue contact | 0.390642 mm | 0.10–1.50 |
| PASS | tongueTipUp | alveolar tongue contact | 0.507443 mm | 0.10–1.50 |
| PASS | viseme_TH | dental tongue protrusion | 5.36782 mm | 3.0–8.0 |
| PASS | viseme_TH | tongue remains behind lip front | 4.1133 mm | >= 0.5 |
| PASS | viseme_SZ | sibilant aperture | 5.26884 mm | 4.0–7.0 |
| PASS | viseme_SZ | anterior tongue groove | 0.22538 mm | >= 0.20 |
| PASS | viseme_CHSH | sibilant aperture | 9.29224 mm | 6.0–11.0 |
| PASS | viseme_CHSH | anterior tongue groove | 0.343919 mm | >= 0.20 |
| PASS | viseme_KG | posterior tongue/velum approach | 1.27006 mm | 0.5–3.0 |
| PASS | viseme_WQ | rounded W/Q width | 0.927069 | <= 0.94 |
| PASS | viseme_WQ | rounded W/Q protrusion | 3.01872 mm | >= 3.0 |
| PASS | vowel_AA | vowel aperture | 13.0799 mm | 10.0–16.0 |
| PASS | vowel_AE | vowel aperture | 11.519 mm | 9.0–14.0 |
| PASS | vowel_AH | vowel aperture | 11.02 mm | 9.0–14.0 |
| PASS | vowel_EH | vowel aperture | 9.17192 mm | 7.0–11.0 |
| PASS | vowel_IH | vowel aperture | 7.67875 mm | 5.5–9.5 |
| PASS | vowel_EE | vowel aperture | 8.35341 mm | 6.0–10.0 |
| PASS | vowel_OH | vowel aperture | 10.9805 mm | 8.5–13.0 |
| PASS | vowel_OO | vowel aperture | 8.37131 mm | 6.0–10.0 |
| PASS | vowel_EE | spread /i/ width | 1.06375 | >= 1.06 |
| PASS | vowel_OH | rounded vowel width | 0.950961 | <= 0.96 |
| PASS | vowel_OO | rounded vowel width | 0.943504 | <= 0.96 |
| PASS | jawOpen | jaw-open aperture | 12.8719 mm | >= 10 |
| PASS | jawOpen | lower dental arch descends | -3.52483 mm | <= -3.0 |
| PASS | jawForward | mandible protrusion | 2.99994 mm | 2.5–3.5 |
| PASS | jawForward | jaw-forward aperture isolation | 0 mm | <= 0.25 |
| PASS | upperLipRaise | isolated upper-lip raise | 2.16708 mm | >= 1.2 |
| PASS | lowerLipDepress | isolated lower-lip depress | -1.9688 mm | <= -1.2 |
| PASS | lipCompress | lip compression aperture reduction | 1.38932 mm | >= 0.8 |
| PASS | lipRollIn | lip roll inward | -3.6521 mm | <= -1.5 |
| PASS | lipRollOut | lip roll outward | 2.37609 mm | >= 1.0 |
| PASS | mouthCornersUp | mouth-corner vertical control | 2.94889 mm | 1–inf |
| PASS | mouthCornersDown | mouth-corner vertical control | -2.10454 mm | -inf–-1 |
| PASS | mouthStretch | mouth stretch lateral control | 3.66859 mm | >= 2.0 |
| PASS | tongueTipLateral | lateral tongue channel | 1.12526 mm | >= 0.5 |
| PASS | tongueBladeUp | tongue blade raise | 1.3562 mm | >= 1.0 |
| PASS | tongueBladeGroove | tongue blade groove | 0.32635 mm | >= 0.25 |
| PASS | tongueBodyHigh | atomic tongue control | 2.03916 mm | >= 1.5 |
| PASS | tongueBodyBack | atomic tongue control | 2.18773 mm | >= 1.5 |
| PASS | tongueBodyLow | atomic tongue control | -1.69381 mm | <= -1.0 |
| PASS | tongueForward | atomic tongue control | 2.01469 mm | >= 1.5 |
| PASS | tongueRetract | atomic tongue control | -2.01469 mm | <= -1.5 |
| PASS | contactBilabial | layerable bilabial contact | 0.27791 mm | 0.10–0.80 |
| PASS | contactLabiodental | layerable labiodental contact | 0.349997 mm | 0.20–1.20 |
| PASS | contactDental | layerable dental protrusion | 5.5 mm | 3.0–8.0 |
| PASS | contactAlveolar | layerable alveolar contact | 0.476313 mm | 0.10–1.50 |
| PASS | contactLateral | layerable alveolar contact | 0.476313 mm | 0.10–1.50 |
| PASS | contactLateral | layerable lateral channel | 1.65522 mm | >= 0.8 |
| PASS | correctiveSibilantGroove | layerable sibilant groove | 0.546679 mm | >= 0.30 |
| PASS | contactVelar | layerable velar contact | 1.2859 mm | 0.5–3.0 |
| PASS | contact targets | upper-contact intersection proxy | 231 count | <= 300 edge hits (zero neutral baseline) |
| PASS | contact targets | baseline-relative intersection proxy | 4.57658 ratio | <= 5.0× neutral for nonzero baselines |

## Core target metrics

| Target | Aperture mm | Width / neutral | Protrusion mm | Lip rim min mm | Incisor contact mm | Alveolar contact mm | Groove mm | Velar clearance mm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| viseme_MBP | 4.95 | 0.969 | 2.04 | 0.25 | 4.67 | 12.04 | 0.14 | 13.67 |
| viseme_FV | 6.63 | 1.004 | -2.53 | 1.01 | 0.42 | 16.25 | 0.31 | 16.05 |
| viseme_L | 8.43 | 1.001 | 0.31 | 1.83 | 4.67 | 0.51 | -0.55 | 9.02 |
| viseme_TH | 12.22 | 1.004 | 0.76 | 4.16 | 6.83 | 9.66 | 0.12 | 14.73 |
| viseme_TDN | 7.40 | 1.001 | 0.23 | 1.30 | 4.32 | 0.39 | -0.63 | 9.09 |
| viseme_SZ | 5.27 | 0.968 | 0.30 | 0.43 | 3.39 | 4.62 | 0.23 | 12.19 |
| viseme_CHSH | 9.29 | 0.940 | 1.49 | 0.67 | 4.57 | 5.81 | 0.34 | 13.35 |
| viseme_KG | 6.34 | 0.995 | -0.19 | 0.70 | 3.02 | 12.86 | 0.71 | 1.27 |
| viseme_R | 6.56 | 0.988 | 0.42 | 0.52 | 3.57 | 5.54 | -1.06 | 13.29 |
| viseme_WQ | 9.26 | 0.927 | 3.02 | 0.76 | 6.30 | 12.00 | 0.24 | 12.57 |
| vowel_AA | 13.08 | 0.977 | -1.05 | 2.55 | 5.28 | 17.67 | 0.32 | 16.20 |
| vowel_AE | 11.52 | 1.012 | -1.89 | 4.13 | 4.42 | 17.35 | 0.29 | 16.44 |
| vowel_AH | 11.02 | 0.983 | -0.79 | 1.77 | 3.94 | 16.53 | 0.27 | 15.83 |
| vowel_EH | 9.17 | 1.019 | -1.40 | 2.63 | 2.88 | 15.48 | 0.23 | 15.62 |
| vowel_IH | 7.68 | 1.020 | -1.05 | 1.78 | 2.68 | 14.42 | 0.17 | 15.16 |
| vowel_EE | 8.35 | 1.064 | -1.87 | 2.55 | 2.51 | 13.43 | 0.13 | 14.52 |
| vowel_OH | 10.98 | 0.951 | 1.48 | 0.33 | 4.56 | 13.76 | 0.25 | 13.82 |
| vowel_OO | 8.37 | 0.944 | 2.31 | 0.59 | 5.53 | 12.30 | 0.19 | 13.04 |
| jawOpen | 12.87 | 0.975 | -0.90 | 2.19 | 5.16 | 17.39 | 0.33 | 16.04 |
| mouthFunnel | 12.59 | 0.935 | 2.15 | 0.21 | 5.29 | 13.59 | 0.27 | 13.37 |
| mouthPucker | 8.61 | 0.926 | 3.17 | 0.56 | 6.52 | 11.71 | 0.21 | 12.43 |
| tongueTipUp | 8.43 | 1.001 | 0.31 | 1.83 | 4.67 | 0.51 | -0.50 | 9.00 |
| jawForward | 4.60 | 1.000 | 1.74 | 0.54 | 4.64 | 12.17 | 0.07 | 14.56 |
| upperLipRaise | 7.81 | 0.998 | 0.24 | 0.39 | 2.96 | 12.96 | 0.07 | 14.81 |
| lowerLipDepress | 7.04 | 1.021 | -0.33 | 0.45 | 2.87 | 12.96 | 0.07 | 14.64 |
| lipCompress | 3.21 | 0.990 | 0.38 | 0.92 | 3.04 | 12.96 | 0.07 | 14.68 |
| lipRollIn | 5.07 | 1.005 | -3.65 | 0.52 | 1.40 | 12.96 | 0.07 | 14.47 |
| lipRollOut | 6.03 | 0.974 | 2.38 | 0.18 | 5.85 | 12.96 | 0.07 | 14.63 |
| mouthCornersUp | 6.99 | 1.052 | -1.42 | 1.36 | 2.54 | 12.96 | 0.07 | 14.81 |
| mouthCornersDown | 4.84 | 1.024 | -0.57 | 0.61 | 2.83 | 12.96 | 0.07 | 14.56 |
| mouthStretch | 8.20 | 1.169 | -1.63 | 2.45 | 2.55 | 12.96 | 0.07 | 14.79 |
| tongueTipLateral | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 3.65 | -1.13 | 11.52 |
| tongueBladeUp | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 11.98 | 0.56 | 13.15 |
| tongueBladeGroove | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 7.73 | 0.33 | 14.64 |
| tongueBodyHigh | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 12.96 | 0.11 | 10.10 |
| tongueBodyBack | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 12.62 | 0.23 | 8.48 |
| tongueBodyLow | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 12.96 | -0.16 | 18.11 |
| tongueForward | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 11.41 | 0.07 | 14.56 |
| tongueRetract | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 14.88 | 0.07 | 14.83 |
| contactBilabial | 4.60 | 1.000 | 0.00 | 0.28 | 3.20 | 12.96 | 0.07 | 14.64 |
| contactLabiodental | 4.60 | 1.000 | 0.00 | 0.73 | 0.35 | 12.96 | 0.07 | 14.64 |
| contactDental | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 8.82 | 0.07 | 14.64 |
| contactAlveolar | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 0.48 | -1.59 | 8.26 |
| contactLateral | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 0.48 | -1.66 | 8.26 |
| correctiveSibilantGroove | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 4.93 | 0.55 | 12.53 |
| contactVelar | 4.60 | 1.000 | 0.00 | 0.52 | 3.10 | 12.02 | 0.76 | 1.29 |

## Intersection regression proxy

GNM oral components are open/non-watertight and intersect in neutral. Counts are edge/triangle intersection regression proxies; intended contacts also increase them, so they are not signed penetration depths.

| Target | Upper teeth | Lower teeth | Mouth sock |
|---|---:|---:|---:|
| neutral | 0 | 111 | 126 |
| viseme_L | 204 | 67 | 169 |
| viseme_TH | 79 | 475 | 190 |
| viseme_TDN | 203 | 72 | 183 |
| viseme_SZ | 141 | 79 | 108 |
| viseme_CHSH | 129 | 78 | 108 |
| viseme_KG | 210 | 111 | 190 |
| viseme_R | 120 | 87 | 105 |
| tongueTipLateral | 127 | 86 | 105 |
| tongueBladeGroove | 0 | 166 | 105 |
| contactDental | 73 | 508 | 198 |
| contactAlveolar | 231 | 82 | 184 |
| contactLateral | 226 | 83 | 173 |
| correctiveSibilantGroove | 143 | 90 | 105 |
| contactVelar | 213 | 111 | 186 |

## Upper-face isolation

| Target | Skin max mm | Oral max mm | Ocular max mm | Oral landmark max mm | Symmetry max error mm |
|---|---:|---:|---:|---:|---:|
| eyeOpen | 0.9924 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| blinkLeft | 5.2314 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| blinkRight | 4.8361 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| browConcern | 1.8017 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| browLift | 2.7309 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| browLiftLeft | 3.3888 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| browLiftRight | 2.4755 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| browFurrow | 1.7836 | 0.000000 | 0.000000 | 0.000000 | 0.000032 |
| eyeWiden | 2.8582 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| eyeSquint | 2.8582 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| cheekRaise | 2.5666 | 0.000000 | 0.000000 | 0.000000 | 0.000031 |

## Lower-face affect isolation

| Target | Skin max mm | Oral max mm | Eyes max mm | Teeth max mm | Tongue max mm | Symmetry max error mm |
|---|---:|---:|---:|---:|---:|---:|
| smileMouth | 13.6177 | 13.6177 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| surpriseMouth | 7.5825 | 7.5825 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| concernMouth | 5.8825 | 5.8825 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| curiosityMouth | 3.3655 | 3.3655 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |
| emphasisMouth | 3.6559 | 3.6559 | 0.000000 | 0.000000 | 0.000000 | 0.000033 |

## Production affect profiles

The values below apply the same calibrated target weights used by the browser controller at 0.9 intent intensity. Every profile combines region-isolated GNM upper-face and lower-face signals while leaving the eyes, teeth, and tongue protected.

| Affect | Skin max mm | Protected component max mm | Oral landmark max mm | Brow Y mm | Eye aperture mm | Mouth-corner Y mm | Mouth width mm | Lip forward mm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| warm | 9.4126 | 0.000000 | 8.936380 | -1.3578 | -2.8963 | 4.9264 | 8.1625 | -4.1504 |
| surprise | 4.6750 | 0.000000 | 4.513088 | 3.3142 | 3.2373 | -1.4808 | -0.6113 | -0.4863 |
| question | 2.4959 | 0.000000 | 1.184635 | 1.7484 | 1.3376 | -0.2212 | -0.7878 | 0.6520 |
| concerned | 3.2754 | 0.000000 | 3.069539 | -1.4042 | -2.7293 | -0.9504 | 3.0582 | -1.2622 |
| emphatic | 2.0768 | 0.000000 | 1.506377 | -1.3530 | -2.0687 | 0.5041 | -1.8767 | 0.6491 |

## Speech and affect composition

These blends reproduce the runtime contact-priority policy. A strong GNM affect signal must remain visible without erasing bilabial or labiodental articulation.

| Blend | Contact | Affect | Affect weight | Lip rim min mm | Lip coverage | Incisor min mm | Incisor coverage | Affect signal mm | Corner Y mm |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| warmBilabial | contactBilabial | smileMouth | 0.0829 | 0.404 | 0.933 | 2.991 | 0.000 | 1.072 | 0.591 |
| warmLabiodental | contactLabiodental | smileMouth | 0.0829 | 0.608 | 0.209 | 0.347 | 0.579 | 1.072 | 0.591 |
| surpriseBilabial | contactBilabial | surpriseMouth | 0.0238 | 0.187 | 0.877 | 3.184 | 0.000 | 0.181 | -0.059 |
| concernBilabial | contactBilabial | concernMouth | 0.3452 | 0.516 | 0.933 | 2.961 | 0.000 | 1.903 | -0.589 |
| questionBilabial | contactBilabial | curiosityMouth | 0.0876 | 0.118 | 0.900 | 3.349 | 0.000 | 0.284 | -0.053 |
| emphaticBilabial | contactBilabial | emphasisMouth | 0.1766 | 0.159 | 0.944 | 3.366 | 0.000 | 0.603 | 0.202 |

## Joint-derived gaze isolation

| Target | Ocular max mm | Outside ocular max mm | Iris mean delta mm | Left/right RMS mismatch mm |
|---|---:|---:|---|---:|
| gazeLeft | 1.9455 | 0.000000 | [1.5648, 0.0000, -0.0930] | 0.000096 |
| gazeRight | 1.9455 | 0.000000 | [-1.5647, 0.0000, -0.0949] | 0.000098 |
| gazeUp | 1.6217 | 0.000000 | [0.0000, 1.3053, -0.0565] | 0.000071 |
| gazeDown | 1.6216 | 0.000000 | [0.0000, -1.3044, -0.0741] | 0.000087 |

## Artifact integrity

- GLB SHA-256: `dea5b6e929a37777d0c0f75447c7b94833ce4a53a1c48e5a24f951ae12cffeb5`
- GLB bytes: 24298424
- Runtime GLB SHA-256: `ef3aea507a8cc1eef24d9f9f4f5352a70a017faac5c6140f5ca8b72f94b37c81`
- Runtime GLB bytes: 1636180
- Maximum source-position accessor error: 0 m
- Maximum morph-delta accessor error: 0 m
- Nontrivial compact targets: 67
- Duplicate compact targets: 0
- Oral runtime contract SHA-256: `c68b0d2aed9e43891c0a8cc55e7d8ff789319beaa4e8eb491a137eb5eb2b8b88`
- Runtime topology SHA-256: `0edd9b3927c25224b5cbd63b9ec6b2940c12d1c0fe69ae65ef262fbfdfe34427`
- Expression/gaze isolation audit: PASS
- Target names: viseme_MBP, viseme_FV, viseme_L, viseme_TH, viseme_TDN, viseme_SZ, viseme_CHSH, viseme_KG, viseme_R, viseme_WQ, vowel_AA, vowel_AE, vowel_AH, vowel_EH, vowel_IH, vowel_EE, vowel_OH, vowel_OO, jawOpen, mouthFunnel, mouthPucker, tongueTipUp, jawForward, upperLipRaise, lowerLipDepress, lipCompress, lipRollIn, lipRollOut, mouthCornersUp, mouthCornersDown, mouthStretch, tongueTipLateral, tongueBladeUp, tongueBladeGroove, tongueBodyHigh, tongueBodyBack, tongueBodyLow, tongueForward, tongueRetract, contactBilabial, contactLabiodental, contactDental, contactAlveolar, contactLateral, correctiveSibilantGroove, contactVelar, eyeOpen, blinkLeft, blinkRight, smile, browConcern, browLift, browLiftLeft, browLiftRight, browFurrow, eyeWiden, eyeSquint, cheekRaise, smileMouth, surpriseMouth, concernMouth, curiosityMouth, emphasisMouth, gazeLeft, gazeRight, gazeUp, gazeDown

## Interpretation boundary

These tests establish deterministic contact intent, coherent component motion, bounded deformation, and exact GLB export parity. They do not establish collision-free volumetric anatomy because the supplied GNM mouth parts are open and overlap at neutral, and they are not a claim of millimetric biomechanical accuracy.
