# Generic GNM runtime asset validation

**Result:** PASS

The population-mean GNM source asset was compressed with meshopt and verified
against the uncompressed exporter output with `demo/scripts/compare-gnm-runtime.mjs`.

## Artifact diagnostics

| Metric | Result | Limit |
|---|---:|---:|
| Named morph targets | 60 | exact name/order parity |
| Primitive morph slots | 480 | 60 targets x 8 primitives |
| Runtime vertices | 17,368 | unchanged |
| Position maximum error | 0.000003246 m | <= 0.00001 m |
| Morph-delta maximum error | 0.000003243 m | <= 0.00001 m |
| Oral semantic channels | PASS | exact channel/histogram parity |
| Source GLB bytes | 21,859,884 | <= 24 MiB |
| Runtime GLB bytes | 1,469,268 | <= 2 MiB |

## Integrity

- Source SHA-256: `4b9c7b0cf4b8ac64a787c78cec7520e85c1241bcc099a66c635fbd64598a9945`
- Runtime SHA-256: `0ae904cf1ed4b012276f94d662bf7ceb72066f287e2933a3400cd16870ba205d`
- Target names are retained in identical order.
- All 60 controls are nontrivial on their intended runtime component.
- No two controls have duplicate runtime-visible morph deltas.
- The original 46 oral controls retain the exact baseline runtime-delta contract
  SHA-256 `c68b0d2aed9e43891c0a8cc55e7d8ff789319beaa4e8eb491a137eb5eb2b8b88`.
- Runtime topology retains baseline SHA-256
  `0edd9b3927c25224b5cbd63b9ec6b2940c12d1c0fe69ae65ef262fbfdfe34427`.
- The added upper-face targets have zero oral/ocular component drift; gaze has
  zero outside-ocular drift and is baked from GNM's paired eye joints.

This verifies transmission fidelity and target contracts. It is not a visual or
perceptual speech-accuracy claim; those require synchronized human-reference
evaluation in the mouth-motion harness.
