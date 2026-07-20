# Third-party notices

This file records the principal third-party software, model, asset, and service terms used by the GNM + Three.js Talking Avatar. It is an engineering provenance record, not legal advice.

## Project code

Original project source code and documentation are licensed under the [Apache License 2.0](LICENSE). That grant does not relicense third-party software, model weights, the GNM-derived GLB, or synthetic audio.

## Google GNM Head

- Project: [google/GNM](https://github.com/google/GNM)
- Pinned commit: [`e26528fbf34d3fefd1a8f160d1b68641df78a586`](https://github.com/google/GNM/tree/e26528fbf34d3fefd1a8f160d1b68641df78a586)
- License: [Apache License 2.0](https://github.com/google/GNM/blob/e26528fbf34d3fefd1a8f160d1b68641df78a586/LICENSE)
- Runtime asset: `demo/public/assets/models/gnm-neutral.runtime.glb`
- Runtime SHA-256: `01b3b21382d5b4e8d2fed15e31fda78728f608186543262925ed949545f523e4`

The runtime GLB evaluates the GNM v3 population-mean identity offline and adds a compact set of named facial and speech targets while preserving GNM topology. Distributions must retain the Apache-2.0 license and identify modifications. The asset is a generic synthetic head, not a scan or identity-specific likeness.

## Static runtime and browser credentials

The deployable demo is a static client application. Speech recognition, local language-model generation, local synthesis, phone timing, and facial animation run in browser workers with WebGPU and/or WebAssembly. Model downloads contact the artifact hosts listed below and disclose ordinary request metadata such as IP address and user agent.

Large ONNX Runtime and LiteRT-LM WebAssembly binaries are loaded from version-pinned jsDelivr URLs. Model weights are downloaded on demand from their named repositories and stored in browser-managed caches when available.

The optional direct-phrase path calls ElevenLabs from the browser. A visitor-supplied key is stored, unencrypted, in origin-scoped `localStorage` under `gnm-avatar.elevenlabs-api-key.v1` and sent directly to ElevenLabs in the `xi-api-key` header. It is never bundled with the application or relayed through project infrastructure. A static site cannot keep this key secret from same-origin JavaScript, an XSS flaw, sufficiently privileged extensions, developer tools, or another user of the same unlocked browser profile. Public deployments should require each visitor to supply a restricted, low-quota key and should never embed a shared key.

## Speech recognition and voice activity detection

- [Moonshine Tiny ONNX](https://huggingface.co/onnx-community/moonshine-tiny-ONNX): MIT
- [Whisper Tiny English ONNX](https://huggingface.co/onnx-community/whisper-tiny.en): Apache-2.0 model repository metadata
- [Transformers.js](https://github.com/huggingface/transformers.js): Apache-2.0
- [ricky0123/vad](https://github.com/ricky0123/vad): ISC
- [Silero VAD](https://github.com/snakers4/silero-vad): MIT
- Local VAD notices: [LICENSES/VAD-ISC-and-Silero-MIT.txt](LICENSES/VAD-ISC-and-Silero-MIT.txt)

Microphone audio and transcripts remain in the local inference path. Downloading model artifacts still contacts their hosts.

## Local speech synthesis

### Kokoro

- [Kokoro 82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX): Apache-2.0
- [Timestamped Kokoro 82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped): Apache-2.0
- [kokoro-js](https://github.com/hexgrad/kokoro): Apache-2.0

### KittenTTS Nano

- [KittenTTS Nano 0.8 fp32](https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32): Apache-2.0
- Pinned revision: `7a1db645b1f3ab9420761d87428e042b9cec3f26`

### Supertonic 2

- [Supertone 2 model](https://huggingface.co/Supertone/supertonic-2): BigScience OpenRAIL-M
- Pinned revision: `75e6727618a02f323c720cba9478152d4bc16ca4`
- [Browser reference implementation](https://github.com/supertone-inc/supertonic/tree/main/web): MIT
- Local code notice: [LICENSES/Supertone-MIT.txt](LICENSES/Supertone-MIT.txt)

The Supertonic model license includes use restrictions and downstream notice obligations. Apache-2.0 does not replace those terms. The demo links the applicable model terms in its model selector; downstream deployments are responsible for presenting and honoring them appropriately.

All supplied voices are generic synthetic voices. They are not historical recordings or identity-specific voice clones.

## Local language models

- [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM): Apache-2.0
- [Gemma 4 E2B LiteRT-LM](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm): Apache-2.0, revision `9262660a1676eed6d0c477ab1a86344430854664`
- [Gemma 4 E4B LiteRT-LM](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm): Apache-2.0, revision `f7ad3343bd6ebc9607f4dc3bc4f2398bd5749bc5`
- [Gemma 3 1B ONNX](https://huggingface.co/onnx-community/gemma-3-1b-it-ONNX): [Gemma Terms of Use](https://ai.google.dev/gemma/terms); adapter currently disabled
- [WebLLM](https://github.com/mlc-ai/web-llm): Apache-2.0
- Qwen 2.5 and Qwen 3.5 upstream models: Apache-2.0

The Gemma and Qwen browser artifacts remain under their model-specific upstream terms. Some optional Qwen, Kokoro, and speech-recognition artifact URLs currently resolve mutable upstream revisions; pin exact revisions before requiring a fully reproducible supply chain.

## ElevenLabs direct phrase

- Service: ElevenLabs timestamped text-to-speech API
- Runtime voice: premade `George`, voice ID `JBFqnCBsd6RMkjVDRZzb`
- Runtime model: `eleven_multilingual_v2`

No ElevenLabs-generated audio is distributed with this repository. Live output remains subject to the visitor's own ElevenLabs account, plan, and applicable terms.

## Direct JavaScript dependencies

The exact resolved graph is in `demo/package-lock.json`. A production build generates `THIRD_PARTY_SOFTWARE_LICENSES.txt` from installed production dependency license files and curated notices.

| Package | Version | License |
| --- | ---: | --- |
| [three](https://threejs.org/) | 0.184.0 | MIT |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | 4.1.0 | Apache-2.0 |
| [@litert-lm/core](https://github.com/google-ai-edge/LiteRT-LM) | 0.14.0 | Apache-2.0 |
| [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) | 0.2.84 | Apache-2.0 |
| [@ricky0123/vad-web](https://github.com/ricky0123/vad) | 0.0.30 | ISC |
| [kokoro-js](https://github.com/hexgrad/kokoro) | 1.2.1 | Apache-2.0 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | 1.25.0 development snapshot `1a71a5f46e` | MIT |
| [phonemizer](https://github.com/xenova/phonemizer.js) | 1.2.1 | Apache-2.0 |

Build and test dependencies remain under their package licenses. These include Vite, TypeScript, Playwright, pngjs, glTF Transform, SciPy, NumPy, h5py, trimesh, and pygltflib.

## Synthetic-media disclosure

The avatar and voices are synthetic. The project must not imply endorsement by Google, GNM contributors, model publishers, or ElevenLabs. Users are responsible for following applicable synthetic-media, privacy, consent, and disclosure rules in their deployment territory.
