# GNM + Three.js Talking Avatar

A browser-native talking avatar built from [Google GNM Head](https://github.com/google/GNM), Three.js, Web Audio, WebGPU, and WebAssembly. Type a phrase or talk naturally, then watch one continuous GNM facial surface articulate the response with jaw, lip, tongue, eye, and expression morphs.

[Open the source repository](https://github.com/majidmanzarpour/threejs-talking-avatar)

Original project source code and documentation are licensed under the [Apache License 2.0](LICENSE). Third-party software, model weights, the GNM-derived GLB, and synthetic audio retain the separate terms recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The deployable demo is a static Vite application. It has no application server, database, serverless function, or secret-bearing backend. Local conversation models run in browser workers. The optional ElevenLabs direct-phrase path calls ElevenLabs from the browser with a key supplied by the visitor.

## What the demo includes

- A compact, rigged GNM v3 head rendered with Three.js.
- Local microphone recognition with Moonshine or Whisper.
- Local response generation with Gemma or Qwen through LiteRT-LM/WebLLM.
- Local synthesis with timestamped or standard Kokoro, Supertonic, and KittenTTS.
- Switchable native, waveform-refined, and heuristic phone timing for comparison.
- Coarticulated jaw, lip, and tongue motion driven from the Web Audio clock.
- A deterministic performance layer for prosodic brows, gaze, head beats, affect, and nonperiodic blinks, with no facial ML runtime or second inference pass.
- An optional direct phrase mode using ElevenLabs timestamped speech.
- A model manager that can warm, reload, unload, and compare runtime combinations.

The avatar is a reusable technical demo, not a scan, medical model, motion-capture performance, or claim of perfect human biomechanics.

## Run locally

Requirements:

- Node.js 20 or newer.
- A current Chromium-family browser with WebGL 2, Web Audio, WebAssembly, and WebGPU.
- Several gigabytes of free browser storage for the larger local-model combinations.

```bash
git clone https://github.com/majidmanzarpour/threejs-talking-avatar.git
cd threejs-talking-avatar/demo
npm install
npm run dev
```

Open <http://127.0.0.1:5188>. Localhost is treated as a secure browser context, so microphone permission can be requested during development.

No credential is required to render the avatar or use the fully local conversation stack.

## Try it

### Talk with the local avatar

1. Open the local model manager.
2. Choose a speech recognizer, brain, voice, and lip-timing mode.
3. Select **Warm** to download and compile without opening the microphone, or start the conversation directly.
4. Allow microphone access when the browser asks.
5. Speak, pause, and let the local pipeline transcribe, answer, synthesize, and animate.

The default quality path uses Gemma 4 E2B and timestamped Kokoro fp32. The first run is intentionally large: Gemma 4 E2B is about 2.01 GB and the fp32 timestamped Kokoro package is about 326 MB. Available alternatives range from a roughly 290 MB Qwen brain to multi-gigabyte Gemma/Qwen options, and from roughly 60 MB KittenTTS to 263 MB Supertonic. The model manager shows the expected footprint before download.

Model weights are requested from their upstream artifact hosts after the visitor starts or warms a selected runtime. Cache Storage, the normal HTTP cache, and runtime-specific browser storage are used where available. Browser quota, eviction policy, private-browsing mode, and model updates can cause a later download to repeat.

Transcripts, prompts, generated responses, and locally synthesized audio remain inside the browser-local inference path. Downloading weights still contacts the model hosts listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Speak a direct phrase with ElevenLabs

The direct-phrase feature is optional. Open the API-key control, enter an ElevenLabs key, and save it for this site. The key is stored under `gnm-avatar.elevenlabs-api-key.v1` in the browser's `localStorage` for the current origin. The page then sends the phrase and key directly to ElevenLabs' timestamped text-to-speech endpoint using the `xi-api-key` header; there is no repository-owned relay or proxy. The current demo uses premade voice `JBFqnCBsd6RMkjVDRZzb` with `eleven_multilingual_v2` and `mp3_44100_128` output.

Clear the saved key from the same control when finished. Without a key, the custom ElevenLabs action stays gated.

#### Browser-key security tradeoff

A static site cannot keep a service credential secret. A key in `localStorage` is not included in the deployment or sent to this project's server—there is no project server—but it is readable by JavaScript running on that origin, browser extensions with sufficient access, developer tools, and anyone using the same unlocked browser profile. A cross-site-scripting flaw would also put it at risk.

For a public demo:

- Ask each visitor to provide their own low-quota or restricted key.
- Never prefill, commit, log, place in a URL, or bake a shared key into the Vite bundle.
- Use a disposable key and provider-side usage limits where available.
- Clear the key after testing, especially on a shared device.
- Use a trusted backend proxy instead if the application must use an owner-funded secret. That would be a different, non-static deployment architecture.

The key and phrase necessarily go to ElevenLabs when that optional path is used and are governed by the visitor's ElevenLabs account and terms.

## Lip timing modes

Lip timing can be compared independently of the selected voice:

| Mode | Behavior |
| --- | --- |
| **Auto** | Uses synthesis-native durations where available and deterministic acoustic refinement otherwise. |
| **Native** | Preserves duration boundaries supplied by the synthesis model. Timestamped Kokoro is the primary reference. |
| **Waveform** | Refines IPA estimates using waveform energy, voicing, and transient features. |
| **Heuristic** | Exposes the unrefined G2P/duration baseline for A/B testing. |

All modes animate the same GNM morph rig. They are deterministic animation strategies, not learned audio-to-face motion capture or acoustic forced alignment.

## Expressive performance

The shared Gemma/Qwen prompt makes the LLM a semantic performance director. Each response starts with a typed physical plan such as `[[perform:gesture=smile,intensity=0.85,onset=immediate,hold=1.6,release=0.7,valence=0.8,arousal=0.3,dominance=0.1]]`, followed by a compact hidden directive before every spoken sentence, such as `[[face:warm:0.8:appreciation]]`. The LLM interprets arbitrary requests and selects the gesture, timing, and continuous valence, arousal, and dominance rather than relying on a hard-coded user-phrase matcher. Turn-level actions can begin while the reply is still being composed; sentence directives then let the delivery react, settle, and change expression as its meaning changes.

A stream-safe parser accepts arbitrary token splits and removes all performance metadata before clause segmentation, speech synthesis, visible replies, and conversation history. The runtime accepts only a bounded semantic gesture vocabulary and converts it to calibrated GNM motion, so the model never controls raw morph weights. If a sentence directive is omitted or malformed, a deterministic affect fallback combines the current user transcript, clean reply, punctuation, requested emotion, discourse cues, and decoded PCM prominence.

Intent and prosody drive calibrated GNM-native brow, lid, cheek, lower-face, gaze, blink, and head motion on the same Web Audio clock as lip movement. Strong affect is performed as an onset, apex, decay, and restrained residue rather than a frozen sentence-long pose. Brows, lids, cheeks, and mouth corners move on slightly different response curves; sparse emphasis beats, subtle seeded asymmetry, natural blinks, and repeat-emotion attenuation keep successive clauses from looking mechanical. Upper-face controls are oral-locked, while five dedicated lower-face affect targets leave the eyes, teeth, and tongue protected. A contact-priority compositor briefly attenuates only conflicting lower-face motion during bilabial and labiodental closures so Kokoro timing remains authoritative without making the rest of the expression disappear.

## Static architecture

```text
Local conversation
microphone -> browser VAD + STT worker -> browser LLM worker
           -> stripped sentence performance intents + browser TTS worker
           -> phone timing + coarticulation
           -> PCM prosody + response text + agent state -> expressive performance
           -> bounded GNM morph compositor -> Three.js
                    \-> Web Audio playback clock

Optional direct phrase
text + visitor-owned browser key -> ElevenLabs timestamped TTS API
                                 -> audio + character alignment
                                 -> phone timing + coarticulation
                                 -> PCM prosody + response text -> expressive performance
                                 -> bounded GNM morph compositor -> Three.js
```

The production output is only static HTML, JavaScript, CSS, a small VAD model, and the runtime GNM asset. Vite's development and preview processes serve those files locally; they do not provide an application API. Version-pinned ONNX Runtime and LiteRT-LM WebAssembly binaries load from jsDelivr, while model weights load from the upstream repositories after an explicit visitor action.

Important paths:

| Path | Responsibility |
| --- | --- |
| `demo/src/portrait/` | Three.js scene, GNM loading, materials, camera, smoke, and animation. |
| `demo/src/speech/` | Direct speech client, Web Audio scheduling, timing, coarticulation, expressive performance planning, and rig mapping. |
| `demo/src/local-agent/` | Browser model registry, selection, caching, streaming turn orchestration, and workers. |
| `demo/src/local-agent/runtime/RuntimeAssetUrls.ts` | Pinned CDN locations for the large ONNX Runtime and LiteRT-LM WASM binaries. |
| `demo/public/local-models/vad/` | Small same-origin Silero VAD model and worklet copied during install. |
| `demo/public/assets/` | Generic GNM source and runtime models. |
| `demo/tests/` | Unit and browser regression checks. |
| `tools/` | Generic offline GNM export and oral-rig validation utilities. |
| `research/generic-*` | Reproducible validation output for the generic GNM asset. |

## Static deployment

Build the deployable site locally:

```bash
cd demo
npm ci
npm run build
```

Upload the contents of `demo/dist/` to Netlify or another static host. The app needs no function, database, application server, or build-time ElevenLabs key. Use HTTPS in production so browsers can grant microphone access.

The build prunes research-only assets, source GLBs, and duplicate fallback WASM binaries. At this checkpoint the uncompressed output is about 26 MB and its largest file is about 6 MB. Large ONNX Runtime and LiteRT-LM binaries are version-pinned in `RuntimeAssetUrls.ts` and served by jsDelivr; model weights load from their named upstream repositories after visitor action.

For threaded WASM paths, configure `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The runtimes fall back to compatible single-threaded paths when cross-origin isolation is unavailable.

## Adapt it for your own agent

The pieces are intentionally separable:

- Add or remove downloadable models in `demo/src/local-agent/modelRegistry.ts` and implement the corresponding worker runtime.
- Replace `demo/public/assets/models/gnm-neutral.runtime.glb` with a compatible GNM-derived asset while preserving the morph contract used by `GnmHead`.
- Change the local system prompt and turn policy in `demo/src/local-agent/runtime/BrainContracts.ts`.
- Tune phone-to-articulator behavior under `demo/src/speech/` without changing the LLM or voice.
- Remove the ElevenLabs direct-phrase client entirely if the deployment should accept no cloud credential.

Model licenses and distribution terms vary. Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before publishing a fork. The project's Apache-2.0 grant does not relicense third-party materials.

## Build and verify

```bash
cd demo
npm run test:unit
npm run verify:model-runtime
npm run build
```

Optional visual/browser checks are available through the Playwright scripts in `demo/package.json`. Do not infer that a historical test report covers later source edits; run the relevant checks for the revision being distributed.

## GNM provenance

The upstream GNM checkout is pinned at [`e26528fbf34d3fefd1a8f160d1b68641df78a586`](https://github.com/google/GNM/tree/e26528fbf34d3fefd1a8f160d1b68641df78a586). GNM Head v3 supplies a canonical topology, identity/expression basis, sparse landmarks, skin and oral/eye components, and four joints. It does not provide named speech visemes, audio alignment, a JavaScript runtime, a jaw joint, or an identity-specific appearance model.

This project evaluates GNM offline, bakes a neutral identity and a compact set of named facial targets into `gnm-neutral.runtime.glb`, then applies speech coarticulation in the browser. Validation details and limitations are recorded in:

- [`research/generic-gnm-runtime-validation.md`](research/generic-gnm-runtime-validation.md)
- [`research/generic-oral-rig-validation.md`](research/generic-oral-rig-validation.md)

## Rights and disclosure

Google GNM is Apache-2.0. Local model licenses, open-source packages, the GNM-derived GLB, and synthetic speech provenance are itemized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Except where otherwise noted, the original project source code and documentation are available under [Apache License 2.0](LICENSE). Third-party materials remain under the terms identified in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
