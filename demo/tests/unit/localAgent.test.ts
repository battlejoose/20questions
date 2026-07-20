import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationHistory } from '../../src/local-agent/ConversationHistory';
import { LocalVoiceAgent } from '../../src/local-agent/LocalVoiceAgent';
import { ReasoningStreamFilter } from '../../src/local-agent/ReasoningStreamFilter';
import { SequentialTtsQueue } from '../../src/local-agent/SequentialTtsQueue';
import { StableClauseSegmenter } from '../../src/local-agent/StableClauseSegmenter';
import type {
  AgentEvent,
  AgentMetric,
  BrainRequest,
  LocalAgentPorts,
  PlaybackRequest,
  RequestContext,
  TtsRequest,
  VadStartContext,
} from '../../src/local-agent/types';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const tokenStream = (...tokens: string[]): AsyncIterable<string> => ({
  async *[Symbol.asyncIterator]() {
    for (const token of tokens) yield token;
  },
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('Condition was not reached within 50 event-loop turns.');
};

interface PortOverrides {
  readonly supported?: boolean;
  readonly onVadStart?: (context: VadStartContext<string>) => void;
  readonly transcribe?: (
    utterance: string,
    context: RequestContext,
  ) => Promise<string>;
  readonly stream?: (request: BrainRequest) => AsyncIterable<string>;
  readonly synthesize?: (request: TtsRequest) => Promise<string>;
  readonly play?: (
    request: PlaybackRequest<string>,
  ) => Promise<{ completed: boolean; spokenCharacters: number } | void>;
}

const createPorts = (
  overrides: PortOverrides = {},
): LocalAgentPorts<string, string> => ({
  vad: {
    isSupported:
      overrides.supported === undefined
        ? undefined
        : async () => overrides.supported ?? true,
    start: async (context) => overrides.onVadStart?.(context),
  },
  stt: {
    transcribe:
      overrides.transcribe ?? (async (utterance: string) => utterance),
  },
  brain: {
    stream:
      overrides.stream ??
      (() => tokenStream('Understood. ')),
  },
  tts: {
    synthesize:
      overrides.synthesize ?? (async (request: TtsRequest) => request.text),
  },
  playback: {
    play:
      overrides.play ??
      (async (request: PlaybackRequest<string>) => {
        request.onProgress({ spokenCharacters: request.text.length });
        return { completed: true, spokenCharacters: request.text.length };
      }),
  },
});

test('stable clause segmentation waits for evidence and never retracts output', () => {
  const segmenter = new StableClauseSegmenter();

  assert.deepEqual(segmenter.feed('Dr. Ada measured 3.'), []);
  assert.deepEqual(segmenter.feed('14 volts. '), [
    'Dr. Ada measured 3.14 volts.',
  ]);
  assert.deepEqual(segmenter.feed('Is that stable?'), []);
  assert.deepEqual(segmenter.feed(' Yes; it is'), [
    'Is that stable?',
    'Yes;',
  ]);
  assert.deepEqual(segmenter.flush(), ['it is']);
  assert.equal(segmenter.pendingText(), '');
});

test('stable clause segmentation can release a short first TTS phrase', () => {
  const segmenter = new StableClauseSegmenter({
    firstClauseCharacters: 24,
    maxClauseCharacters: 48,
  });

  assert.deepEqual(
    segmenter.feed('A deliberately short opening phrase continues here '),
    ['A deliberately short opening'],
  );
  assert.deepEqual(segmenter.flush(), ['phrase continues here']);
});

test('stable clause segmentation can commit a word-safe prefix after a token pause', () => {
  const segmenter = new StableClauseSegmenter({
    firstClauseCharacters: 60,
    maxClauseCharacters: 92,
  });

  assert.deepEqual(
    segmenter.feed('This answer has enough words to begin speaking while another'),
    [],
  );
  assert.deepEqual(segmenter.flushPendingPrefix(24), [
    'This answer has enough words to begin speaking while',
  ]);
  assert.equal(segmenter.pendingText(), 'another');
  assert.deepEqual(segmenter.flush(), ['another']);
});

test('prosodic idle flush waits for a spoken phrase boundary', () => {
  const segmenter = new StableClauseSegmenter({
    firstClauseCharacters: 120,
    maxClauseCharacters: 180,
  });

  segmenter.feed('This answer has enough words but no natural break yet');
  assert.deepEqual(segmenter.flushPendingProsodicPrefix(32), []);
  segmenter.feed(', while this second thought is still being generated');
  assert.deepEqual(segmenter.flushPendingProsodicPrefix(32), [
    'This answer has enough words but no natural break yet,',
  ]);
  assert.equal(segmenter.pendingText(), 'while this second thought is still being generated');
});

test('stable clause segmentation drops punctuation-only model fragments', () => {
  const segmenter = new StableClauseSegmenter();
  assert.deepEqual(segmenter.feed('? Because he was outstanding in his field.'), []);
  assert.equal(segmenter.pendingText(), 'Because he was outstanding in his field.');
  assert.deepEqual(segmenter.flush(), ['Because he was outstanding in his field.']);
});

test('reasoning filter survives split tags and never exposes control markup', () => {
  const filter = new ReasoningStreamFilter();
  const parts = [
    ...filter.feed('<thi'),
    ...filter.feed('nk>Check the premise.'),
    ...filter.feed('</TH'),
    ...filter.feed('INK>Final answer.'),
    ...filter.flush(),
  ];

  assert.deepEqual(parts, [
    { channel: 'reasoning', text: 'Check the premise.' },
    { channel: 'answer', text: 'Final answer.' },
  ]);
});

test('reasoning filter removes WebLLM empty wrappers and fails closed on unfinished thought', () => {
  const emptyWrapper = new ReasoningStreamFilter();
  const emptyParts = emptyWrapper.feed('<think>\n\n</think>\n\nAnswer.');
  assert.equal(
    emptyParts.some(
      (part) => part.channel === 'reasoning' && Boolean(part.text.trim()),
    ),
    false,
  );
  assert.equal(
    emptyParts
      .filter((part) => part.channel === 'answer')
      .map((part) => part.text)
      .join(''),
    '\n\nAnswer.',
  );

  const unfinished = new ReasoningStreamFilter();
  assert.deepEqual(unfinished.feed('<think>Never speak this.'), [
    { channel: 'reasoning', text: 'Never speak this.' },
  ]);
  assert.deepEqual(unfinished.flush(), []);
});

test('reasoning filter removes split Qwen wrappers without hiding their answer', () => {
  const filter = new ReasoningStreamFilter();
  const parts = [
    ...filter.feed('<CO'),
    ...filter.feed('DE>Use the native rig.</CO'),
    ...filter.feed('DE><|assistant|> Keep it local.'),
    ...filter.flush(),
  ];

  assert.equal(
    parts.filter((part) => part.channel === 'answer').map((part) => part.text).join(''),
    'Use the native rig. Keep it local.',
  );
  assert.equal(parts.some((part) => /[<>]|CODE|assistant/u.test(part.text)), false);
});

test('reasoning filter preserves literal comparison operators', () => {
  const filter = new ReasoningStreamFilter();
  const parts = [...filter.feed('Use x < y and z > 0.'), ...filter.flush()];
  assert.equal(parts.map((part) => part.text).join(''), 'Use x < y and z > 0.');
});

test('reasoning is visible as an event but never synthesized or saved as speech', async () => {
  const events: AgentEvent[] = [];
  const synthesized: string[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '<thi',
        'nk>First inspect it. ',
        'Then decide.</thi',
        'nk>Only say this aloud.',
      ),
      synthesize: async (request) => {
        synthesized.push(request.text);
        return request.text;
      },
    }),
  });
  agent.subscribe((event) => events.push(event));

  await agent.initialize();
  await agent.submitUtterance('question');

  assert.deepEqual(synthesized, ['Only say this aloud.']);
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'question', turnId: 1 },
    { role: 'assistant', content: 'Only say this aloud.', turnId: 1 },
  ]);
  assert.equal(
    events.filter((event) => event.type === 'reasoning').at(-1)?.text,
    'First inspect it. Then decide.',
  );
  assert.ok(
    events.every(
      (event) => event.type !== 'clause' || !event.text.includes('think'),
    ),
  );
});

test('performance directives are stripped before TTS, UI history, and playback metadata', async () => {
  const synthesized: TtsRequest[] = [];
  const played: PlaybackRequest<string>[] = [];
  const events: AgentEvent[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '[[fa',
        'ce:warm:0.',
        '82:appreciation]] Beaches and sunsets are truly wonderful sights.',
      ),
      synthesize: async (request) => {
        synthesized.push(request);
        return request.text;
      },
      play: async (request) => {
        played.push(request);
        request.onProgress({ spokenCharacters: request.text.length });
        return { completed: true, spokenCharacters: request.text.length };
      },
    }),
  });
  agent.subscribe((event) => events.push(event));

  await agent.initialize();
  await agent.submitUtterance('What is your opinion about beaches and sunsets?');

  assert.deepEqual(synthesized.map((request) => request.text), [
    'Beaches and sunsets are truly wonderful sights.',
  ]);
  assert.equal(synthesized[0].performanceIntent?.affect, 'warm');
  assert.equal(synthesized[0].performanceIntent?.intensity, 0.82);
  assert.equal(played[0].performanceIntent, synthesized[0].performanceIntent);
  assert.equal(played[0].performanceUserText, 'What is your opinion about beaches and sunsets?');
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'What is your opinion about beaches and sunsets?', turnId: 1 },
    { role: 'assistant', content: 'Beaches and sunsets are truly wonderful sights.', turnId: 1 },
  ]);
  assert.ok(events.some(
    (event) => event.type === 'performance-intent' && event.intent.source === 'llm-directive',
  ));
  assert.ok(events.every((event) => (
    event.type !== 'clause' || !event.text.includes('[[face')
  )));
});

test('explicit requested emotion wins over a contradictory small-model directive', async () => {
  let spokenRequest: TtsRequest | undefined;
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '[[face:neutral:0.3:statement]] ',
        'I am not capable of feeling emotions like surprise.',
      ),
      synthesize: async (request) => {
        spokenRequest = request;
        return request.text;
      },
    }),
  });

  await agent.initialize();
  await agent.submitUtterance('Can you act surprised?');

  assert.equal(spokenRequest?.performanceIntent?.affect, 'surprise');
  assert.equal(spokenRequest?.performanceIntent?.source, 'requested-emotion');
  assert.ok((spokenRequest?.performanceIntent?.intensity ?? 0) >= 0.9);
});

test('malformed face metadata preserves a joke setup and never queues bare punctuation', async () => {
  const synthesized: string[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '[[face:warm:0.74:question Why did the scarecrow ',
        'win an award]]? Because he was outstanding in his field.',
      ),
      synthesize: async (request) => {
        synthesized.push(request.text);
        return request.text;
      },
    }),
  });

  await agent.initialize();
  await agent.submitUtterance('Tell me a joke.');

  assert.deepEqual(synthesized, [
    'Why did the scarecrow win an award?',
    'Because he was outstanding in his field.',
  ]);
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'Tell me a joke.', turnId: 1 },
    {
      role: 'assistant',
      content: 'Why did the scarecrow win an award? Because he was outstanding in his field.',
      turnId: 1,
    },
  ]);
});

test('sentence-level face directives become distinct clause performance beats', async () => {
  const synthesized: TtsRequest[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '[[face:surprise:0.9:statement]] Wow, I did not expect that. ',
        '[[face:warm:0.42:appreciation]] That is wonderful news.',
      ),
      synthesize: async (request) => {
        synthesized.push(request);
        return request.text;
      },
    }),
  });

  await agent.initialize();
  await agent.submitUtterance('Tell me what happened.');

  assert.deepEqual(synthesized.map(({ text }) => text), [
    'Wow, I did not expect that.',
    'That is wonderful news.',
  ]);
  assert.equal(synthesized[0].performanceIntent?.affect, 'surprise');
  assert.equal(synthesized[0].performanceIntent?.intensity, 0.9);
  assert.equal(synthesized[1].performanceIntent?.affect, 'warm');
  assert.equal(synthesized[1].performanceIntent?.intensity, 0.42);
});

test('an LLM physical plan is emitted before speech and stripped from every spoken surface', async () => {
  const events: AgentEvent[] = [];
  const synthesized: string[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream(
        '[[perfor',
        'm:gesture=smile,intensity=0.86,onset=immediate,hold=1.6,release=0.7,',
        'valence=0.8,arousal=0.3,dominance=0.1]] ',
        '[[face:warm:0.55:affirmation]] Of course. How is this?',
      ),
      synthesize: async (request) => {
        synthesized.push(request.text);
        return request.text;
      },
    }),
  });
  agent.subscribe((event) => events.push(event));

  await agent.initialize();
  await agent.submitUtterance('Can you smile?');

  const actionIndex = events.findIndex((event) => event.type === 'performance-action');
  const clauseIndex = events.findIndex((event) => event.type === 'clause');
  assert.ok(actionIndex >= 0 && actionIndex < clauseIndex);
  const actionEvent = events[actionIndex];
  assert.equal(actionEvent.type, 'performance-action');
  if (actionEvent.type === 'performance-action') {
    assert.equal(actionEvent.action.gesture, 'smile');
    assert.equal(actionEvent.action.onset, 'immediate');
    assert.equal(actionEvent.action.intensity, 0.86);
  }
  assert.deepEqual(synthesized, ['Of course.', 'How is this?']);
  assert.ok(synthesized.every((text) => !text.includes('[[')));
  assert.equal(agent.snapshot().history.at(-1)?.content, 'Of course. How is this?');
});

test('conversation history is bounded and assistant text is upserted by turn', () => {
  const history = new ConversationHistory({
    maxMessages: 2,
    maxCharacters: 40,
  });
  history.appendUser(1, 'old question');
  history.upsertAssistant(1, 'partial');
  history.upsertAssistant(1, 'complete old response');
  history.appendUser(2, 'new question');
  history.upsertAssistant(2, 'new answer');

  assert.deepEqual(history.snapshot(), [
    { role: 'user', content: 'new question', turnId: 2 },
    { role: 'assistant', content: 'new answer', turnId: 2 },
  ]);
});

test('sequential TTS queue applies bounded admission backpressure', async () => {
  const playbacks = new Map<string, Deferred<void>>();
  const synthesized: string[] = [];
  const played: string[] = [];
  const depths: number[] = [];
  const queue = new SequentialTtsQueue<string>({
    maxBufferedClauses: 2,
    synthesize: async (text) => {
      synthesized.push(text);
      return text;
    },
    play: async (_synthesis, text) => {
      played.push(text);
      const gate = deferred<void>();
      playbacks.set(text, gate);
      await gate.promise;
    },
    onDepthChange: (depth) => depths.push(depth),
  });

  await queue.enqueue('one');
  await queue.enqueue('two');
  let thirdAdmitted = false;
  const third = queue.enqueue('three').then(() => {
    thirdAdmitted = true;
  });
  await waitFor(() => played.length === 1);

  assert.deepEqual(synthesized, ['one', 'two']);
  assert.deepEqual(played, ['one']);
  assert.equal(queue.bufferedCount, 2);
  assert.equal(thirdAdmitted, false);

  playbacks.get('one')?.resolve();
  await third;
  await waitFor(() => played.includes('two'));
  assert.equal(thirdAdmitted, true);
  assert.equal(queue.bufferedCount, 2);
  assert.deepEqual(played, ['one', 'two']);
  assert.deepEqual(synthesized, ['one', 'two', 'three']);

  playbacks.get('two')?.resolve();
  await waitFor(() => played.includes('three'));
  playbacks.get('three')?.resolve();
  await queue.waitForIdle();

  assert.deepEqual(synthesized, ['one', 'two', 'three']);
  assert.deepEqual(played, ['one', 'two', 'three']);
  assert.ok(Math.max(...depths) <= 2);
});

test('agent traverses listening turn states with monotonic request IDs', async () => {
  const events: AgentEvent[] = [];
  const metrics: AgentMetric[] = [];
  const requestIds: number[] = [];
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      onVadStart: (context) => requestIds.push(context.requestId),
      transcribe: async (_utterance, context) => {
        requestIds.push(context.requestId);
        return 'Tell me something';
      },
      stream: (request) => {
        requestIds.push(request.requestId);
        return tokenStream('Hello.', ' Again!');
      },
      synthesize: async (request) => {
        requestIds.push(request.requestId);
        return request.text;
      },
      play: async (request) => {
        requestIds.push(request.requestId);
        request.onProgress({ spokenCharacters: request.text.length });
        return { completed: true, spokenCharacters: request.text.length };
      },
    }),
    onMetric: (metric) => metrics.push(metric),
  });
  agent.subscribe((event) => events.push(event));

  assert.equal(agent.snapshot().state, 'installing');
  await agent.startListening();
  await agent.submitUtterance('audio');

  const states = events
    .filter((event): event is Extract<AgentEvent, { type: 'state' }> =>
      event.type === 'state',
    )
    .map((event) => event.to);
  assert.deepEqual(states, [
    'idle',
    'listening',
    'transcribing',
    'thinking',
    'speaking',
    'listening',
  ]);
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'Tell me something', turnId: 1 },
    { role: 'assistant', content: 'Hello. Again!', turnId: 1 },
  ]);
  assert.deepEqual(requestIds, [...requestIds].sort((left, right) => left - right));
  assert.equal(new Set(requestIds).size, requestIds.length);
  assert.equal(agent.snapshot().requestId, requestIds.at(-1));
  assert.ok(metrics.some((metric) => metric.type === 'queue-depth'));
  assert.ok(
    events.some(
      (event) => event.type === 'turn-completed' && event.turnId === 1,
    ),
  );
});

test('an existing transcript bypasses STT but keeps the complete response pipeline', async () => {
  const events: AgentEvent[] = [];
  let transcribeCalls = 0;
  let brainTranscript = '';
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      transcribe: async () => {
        transcribeCalls += 1;
        return 'unexpected';
      },
      stream: (request) => {
        brainTranscript = request.transcript;
        return tokenStream('Typed path works.');
      },
    }),
  });
  agent.subscribe((event) => events.push(event));

  await agent.submitTranscript('  Please smile and answer.  ');

  assert.equal(transcribeCalls, 0);
  assert.equal(brainTranscript, 'Please smile and answer.');
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'Please smile and answer.', turnId: 1 },
    { role: 'assistant', content: 'Typed path works.', turnId: 1 },
  ]);
  assert.equal(
    events.some(
      (event) => event.type === 'state' && event.to === 'transcribing',
    ),
    false,
  );
  assert.ok(
    events.some(
      (event) => event.type === 'turn-completed' && event.turnId === 1,
    ),
  );
});

test('a superseded STT result is rejected as stale', async () => {
  const firstTranscript = deferred<string>();
  const events: AgentEvent[] = [];
  let sttCalls = 0;
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      transcribe: async (utterance) => {
        sttCalls += 1;
        if (utterance === 'first') return firstTranscript.promise;
        return 'fresh transcript';
      },
      stream: () => tokenStream('Fresh answer. '),
    }),
  });
  agent.subscribe((event) => events.push(event));
  await agent.initialize();

  const first = agent.submitUtterance('first');
  await waitFor(() => sttCalls === 1);
  const second = agent.submitUtterance('second');
  await second;
  firstTranscript.resolve('stale transcript');
  await first;

  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'fresh transcript', turnId: 2 },
    { role: 'assistant', content: 'Fresh answer.', turnId: 2 },
  ]);
  assert.ok(
    events.some(
      (event) =>
        event.type === 'stale-result' &&
        event.turnId === 1 &&
        event.phase === 'stt',
    ),
  );
  assert.equal(agent.snapshot().turnId, 2);
  assert.equal(agent.snapshot().state, 'idle');
});

test('barge-in cancels queued speech and retains only confirmed playback', async () => {
  const playbackGate = deferred<void>();
  const events: AgentEvent[] = [];
  let playbackRequest: PlaybackRequest<string> | undefined;
  const agent = new LocalVoiceAgent({
    ports: createPorts({
      stream: () => tokenStream('Hello brave world. ', 'This stays unsaid. '),
      play: async (request) => {
        playbackRequest = request;
        request.onProgress({ spokenCharacters: 5 });
        await playbackGate.promise;
        return { completed: true, spokenCharacters: request.text.length };
      },
    }),
    maxBufferedClauses: 2,
  });
  agent.subscribe((event) => events.push(event));
  await agent.initialize();

  const turn = agent.submitUtterance('question');
  await waitFor(() => playbackRequest !== undefined);
  assert.equal(agent.snapshot().state, 'speaking');
  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'question', turnId: 1 },
    { role: 'assistant', content: 'Hello', turnId: 1 },
  ]);

  assert.equal(agent.bargeIn(), true);
  assert.equal(agent.snapshot().state, 'interrupted');
  playbackGate.resolve();
  await turn;

  assert.deepEqual(agent.snapshot().history, [
    { role: 'user', content: 'question', turnId: 1 },
    { role: 'assistant', content: 'Hello', turnId: 1 },
  ]);
  assert.equal(
    events.filter((event) => event.type === 'barge-in').length,
    1,
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === 'interrupted' && event.reason === 'barge-in',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === 'stale-result' && event.phase === 'playback',
    ),
  );
});

test('unsupported ports stop initialization explicitly', async () => {
  const agent = new LocalVoiceAgent({
    ports: createPorts({ supported: false }),
  });

  await agent.initialize();
  assert.equal(agent.snapshot().state, 'unsupported');
  await assert.rejects(agent.startListening(), /unsupported/u);
});
