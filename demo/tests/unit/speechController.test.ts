import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPEECH_DISCLOSURE,
  SpeechController,
} from '../../src/speech/SpeechController';
import type { SpeechSynthesisPayload } from '../../src/speech/types';

class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  onended: ((this: AudioScheduledSourceNode, event: Event) => unknown) | null = null;
  startedAt: number | null = null;
  connected = false;
  stopCalls = 0;

  connect(): AudioNode {
    this.connected = true;
    return {} as AudioNode;
  }

  disconnect(): void {
    this.connected = false;
  }

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeAudioBuffer {
  readonly numberOfChannels = 1;
  readonly duration: number;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.samples = new Float32Array(length);
    this.duration = length / sampleRate;
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    assert.equal(channel, 0);
    return this.samples;
  }

  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void {
    assert.equal(channel, 0);
    this.samples.set(source);
  }
}

class FakeAudioContext {
  currentTime = 12;
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  sources: FakeBufferSource[] = [];
  buffers: FakeAudioBuffer[] = [];

  async decodeAudioData(): Promise<AudioBuffer> {
    return { duration: 0.3 } as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBuffer {
    assert.equal(numberOfChannels, 1);
    const buffer = new FakeAudioBuffer(length, sampleRate);
    this.buffers.push(buffer);
    return buffer as unknown as AudioBuffer;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

const livePayload: SpeechSynthesisPayload = {
  audioBase64: 'AA==',
  audioMimeType: 'audio/mpeg',
  durationSeconds: 0.3,
  alignment: {
    characters: ['m'],
    characterStartTimesSeconds: [0],
    characterEndTimesSeconds: [0.3],
  },
  words: [
    {
      text: 'm',
      wordIndex: 0,
      startTime: 0,
      endTime: 0.3,
      characterStart: 0,
      characterEnd: 1,
    },
  ],
  phonemes: [
    {
      phone: 'm',
      normalizedPhone: 'm',
      startTime: 0,
      endTime: 0.3,
      word: 'm',
      wordIndex: 0,
      source: 'estimated-from-character-alignment',
    },
  ],
  voice: {
    voiceId: 'premade',
    displayName: 'Premade synthetic voice',
    premade: true,
    historicalVoiceClone: false,
    synthetic: true,
  },
};

test('controller schedules audio and articulation from the same Web Audio time', async () => {
  const audioContext = new FakeAudioContext();
  const states: string[] = [];
  const controller = new SpeechController({
    audioContext: audioContext as unknown as AudioContext,
    synthesisClient: {
      async synthesize() {
        return livePayload;
      },
    },
  });
  controller.subscribe(({ state }) => states.push(state));

  const prepared = await controller.speak('m');
  const source = audioContext.sources[0];
  assert.equal(prepared.source, 'live-synthesis');
  assert.equal(source.startedAt, 12.045);
  assert.equal(typeof controller.scheduledPlaybackStartAt(), 'number');
  assert.deepEqual(states, ['idle', 'loading', 'ready', 'playing']);

  audioContext.currentTime = 12.12;
  assert.ok(controller.update().lipsTogether > 0);
  assert.ok(Math.abs(controller.updatePerformance().diagnostics.speechTime - 0.075) < 1e-6);

  source.onended?.call(
    source as unknown as AudioScheduledSourceNode,
    new Event('ended'),
  );
  assert.equal(controller.snapshot().state, 'ended');

  audioContext.currentTime = 13;
  await controller.replay();
  assert.equal(audioContext.sources[1].startedAt, 13.045);
  controller.cancel();
  assert.equal(controller.snapshot().state, 'ready');
});

test('local PCM uses Kokoro IPA, waveform timing, one AV clock, and cancellation', async () => {
  const audioContext = new FakeAudioContext();
  const controller = new SpeechController({
    audioContext: audioContext as unknown as AudioContext,
    fetchImpl: async () => {
      throw new Error('Local PCM playback must not fetch.');
    },
  });
  const sampleRate = 8_000;
  const pcm = new Float32Array(sampleRate);
  for (let index = Math.round(sampleRate * 0.35); index < pcm.length; index += 1) {
    const time = index / sampleRate;
    pcm[index] = Math.sin(time * Math.PI * 2 * 160) * 0.45;
  }

  const prepared = await controller.playLocalPcm(
    pcm,
    sampleRate,
    'pa',
    'pɑ',
  );
  const source = audioContext.sources[0];
  const copiedPcm = audioContext.buffers[0].getChannelData(0);

  assert.equal(prepared.source, 'local-pcm');
  assert.equal(prepared.durationSeconds, 1);
  assert.equal(source.startedAt, 12.045);
  assert.equal(source.buffer, audioContext.buffers[0] as unknown as AudioBuffer);
  assert.notEqual(copiedPcm, pcm);
  assert.deepEqual(copiedPcm, pcm);
  assert.equal(prepared.phonemes[0].endTime, prepared.phonemes[1].startTime);
  assert.equal(prepared.phonemes[0].source, 'waveform-refined');
  assert.ok(prepared.phonemes[0].endTime > 0.33);

  audioContext.currentTime = source.startedAt! + 0.62;
  assert.ok(controller.update().jawOpen > 0.35);
  const performanceFrame = controller.updatePerformance();
  assert.ok(Math.abs(performanceFrame.diagnostics.speechTime - 0.62) < 1e-6);
  assert.ok(performanceFrame.diagnostics.plannerMs >= 0);

  controller.cancel();
  assert.equal(source.stopCalls, 1);
  assert.equal(source.connected, false);
  assert.equal(controller.scheduledPlaybackStartAt(), null);
  assert.equal(controller.snapshot().state, 'ready');
  assert.equal(controller.updatePerformance().diagnostics.cueCount, 0);
});

test('local PCM timing policy can preserve native boundaries or acoustically refine them', async () => {
  const audioContext = new FakeAudioContext();
  const controller = new SpeechController({
    audioContext: audioContext as unknown as AudioContext,
    fetchImpl: async () => {
      throw new Error('Local PCM playback must not fetch.');
    },
  });
  const sampleRate = 8_000;
  const pcm = new Float32Array(sampleRate);
  for (let index = Math.round(sampleRate * 0.35); index < pcm.length; index += 1) {
    pcm[index] = Math.sin((index / sampleRate) * Math.PI * 2 * 160) * 0.45;
  }
  const nativeTrack = [
    {
      phone: 'p', normalizedPhone: 'p', startTime: 0, endTime: 0.32,
      word: 'pa', wordIndex: 0, source: 'estimated-from-kokoro-phonemes' as const,
      timingOrigin: 'synthesis-native' as const,
    },
    {
      phone: 'ɑ', normalizedPhone: 'ɑ', startTime: 0.32, endTime: 1,
      word: 'pa', wordIndex: 0, source: 'estimated-from-kokoro-phonemes' as const,
      timingOrigin: 'synthesis-native' as const,
    },
  ];

  const native = await controller.playLocalPcm(
    pcm, sampleRate, 'pa', nativeTrack, undefined, { timingMode: 'native' },
  );
  assert.equal(native.phonemes[0].endTime, 0.32);
  assert.equal(native.phonemes[0].timingOrigin, 'synthesis-native');
  assert.equal(native.phonemes[0].source, 'estimated-from-kokoro-phonemes');

  const refined = await controller.playLocalPcm(
    pcm, sampleRate, 'pa', nativeTrack, undefined, { timingMode: 'waveform' },
  );
  assert.equal(refined.phonemes[0].source, 'waveform-refined');
  assert.ok(refined.phonemes[0].endTime > native.phonemes[0].endTime);
});

test('timestamped Kokoro timing keeps its audio clock while the beaches reply performs warmly', async () => {
  const audioContext = new FakeAudioContext();
  const controller = new SpeechController({
    audioContext: audioContext as unknown as AudioContext,
    fetchImpl: async () => {
      throw new Error('Local PCM playback must not fetch.');
    },
  });
  const sampleRate = 8_000;
  const pcm = new Float32Array(sampleRate);
  for (let index = 0; index < pcm.length; index += 1) {
    pcm[index] = Math.sin((index / sampleRate) * Math.PI * 2 * 175) * 0.32;
  }
  const nativeTrack = [
    {
      phone: 'b', normalizedPhone: 'b', startTime: 0, endTime: 0.18,
      word: 'beaches', wordIndex: 0, source: 'estimated-from-kokoro-phonemes' as const,
      timingOrigin: 'synthesis-native' as const,
    },
    {
      phone: 'i', normalizedPhone: 'i', startTime: 0.18, endTime: 1,
      word: 'beaches', wordIndex: 0, source: 'estimated-from-kokoro-phonemes' as const,
      timingOrigin: 'synthesis-native' as const,
    },
  ];

  const prepared = await controller.playLocalPcm(
    pcm,
    sampleRate,
    'Beaches and sunsets are truly wonderful sights.',
    nativeTrack,
    undefined,
    {
      timingMode: 'native',
      performanceUserText: 'What is your opinion about beaches and sunsets?',
      performanceIntent: {
        affect: 'warm',
        intensity: 0.82,
        discourseAct: 'appreciation',
        confidence: 0.9,
        source: 'llm-directive',
      },
    },
  );
  const source = audioContext.sources[0];
  assert.equal(source.startedAt, 12.045);
  assert.equal(prepared.phonemes[0].endTime, 0.18);
  assert.equal(prepared.phonemes[0].timingOrigin, 'synthesis-native');

  // Advance as the render loop would so the bounded expression dynamics see
  // real frame intervals instead of one artificial 450 ms jump.
  for (let elapsed = 0.05; elapsed <= 0.45; elapsed += 0.05) {
    audioContext.currentTime = source.startedAt! + elapsed;
    controller.updatePerformance();
  }
  assert.ok(controller.update().jawOpen > 0);
  const expression = controller.updatePerformance();
  assert.equal(expression.diagnostics.affect, 'warm');
  assert.equal(expression.diagnostics.intentSource, 'llm-directive');
  assert.ok(expression.diagnostics.maximumMorphWeight > 0.25);
  assert.ok(Math.abs(expression.diagnostics.speechTime - 0.45) < 1e-6);
});

test('public disclosure explicitly distinguishes synthesis and timing estimates', () => {
  assert.match(SPEECH_DISCLOSURE.voice, /synthetic voices/i);
  assert.match(SPEECH_DISCLOSURE.voice, /not a voice clone/i);
  assert.match(SPEECH_DISCLOSURE.voice, /not.*real person/i);
  assert.match(SPEECH_DISCLOSURE.timing, /not acoustic forced-alignment/i);
});
