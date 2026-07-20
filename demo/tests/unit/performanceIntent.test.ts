import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAIN_SYSTEM_PROMPT } from '../../src/local-agent/runtime/BrainContracts';
import {
  PerformanceDirectiveStream,
  inferPerformanceIntent,
  parsePerformanceActionDirective,
  parsePerformanceDirective,
} from '../../src/speech/PerformanceIntent';

const DIRECTED_REPLY =
  '[[face:warm:0.82:appreciation]] Beaches and sunsets are truly wonderful sights.';

test('the shared brain contract requires exact requested physical gestures', () => {
  assert.match(BRAIN_SYSTEM_PROMPT, /exact requested gesture/iu);
  assert.match(BRAIN_SYSTEM_PROMPT, /gesture=nod/iu);
  assert.match(BRAIN_SYSTEM_PROMPT, /gesture=shake/iu);
  assert.match(BRAIN_SYSTEM_PROMPT, /intensity at least 0\.8/iu);
});

function consume(tokens: readonly string[]): {
  readonly text: string;
  readonly intent: ReturnType<typeof parsePerformanceDirective>;
} {
  const stream = new PerformanceDirectiveStream();
  let text = '';
  for (const token of tokens) text += stream.feed(token);
  text += stream.flush();
  return { text, intent: stream.intent };
}

test('the collected beaches reply resolves to a strong warm performance', () => {
  const intent = inferPerformanceIntent({
    userText: 'What is your opinion about beaches and sunsets?',
    assistantText:
      'Beaches and sunsets are truly wonderful sights. They offer great opportunities for relaxation and beauty.',
  });
  assert.equal(intent.affect, 'warm');
  assert.equal(intent.discourseAct, 'appreciation');
  assert.ok(intent.intensity >= 0.7);
  assert.equal(intent.source, 'contextual-fallback');
});

test('a requested emotion overrides literal neutral model prose', () => {
  const intent = inferPerformanceIntent({
    userText: 'Can you act surprised?',
    assistantText:
      'I am not capable of feeling emotions. I can process information and respond to your requests.',
  });
  assert.equal(intent.affect, 'surprise');
  assert.equal(intent.source, 'requested-emotion');
  assert.equal(intent.confidence, 0.96);
  assert.ok(intent.intensity >= 0.9);
});

test('valid performance directives parse into a typed intent', () => {
  assert.deepEqual(parsePerformanceDirective('[[face:question:0.73:question]]'), {
    affect: 'question',
    intensity: 0.73,
    discourseAct: 'question',
    confidence: 0.9,
    source: 'llm-directive',
  });
  assert.equal(parsePerformanceDirective('[[face:joyful:1:statement]]'), null);
  assert.equal(parsePerformanceDirective('[[face:warm:1.4:statement]]'), null);
});

test('the LLM physical plan parses into bounded semantic action data', () => {
  assert.deepEqual(parsePerformanceActionDirective(
    '[[perform:gesture=smile,intensity=0.82,onset=immediate,hold=1.4,release=0.7,valence=0.8,arousal=0.35,dominance=0.1]]',
  ), {
    gesture: 'smile',
    intensity: 0.82,
    onset: 'immediate',
    holdSeconds: 1.4,
    releaseSeconds: 0.7,
    valence: 0.8,
    arousal: 0.35,
    dominance: 0.1,
    source: 'llm-directive',
  });
  assert.equal(parsePerformanceActionDirective(
    '[[perform:gesture=dance,intensity=1,onset=immediate]]',
  ), null);
  assert.equal(parsePerformanceActionDirective(
    '[[perform:gesture=smile,intensity=1.4,onset=immediate]]',
  ), null);
});

test('physical and sentence directives remain stream-safe and never enter speech', () => {
  const reply =
    '[[perform:gesture=smile,intensity=0.82,onset=immediate,hold=1.4,release=0.7,valence=0.8,arousal=0.35,dominance=0.1]] [[face:warm:0.6:affirmation]] Of course. How is this?';
  for (let boundary = 0; boundary <= reply.length; boundary += 1) {
    const stream = new PerformanceDirectiveStream();
    const spoken = stream.feed(reply.slice(0, boundary)) +
      stream.feed(reply.slice(boundary)) + stream.flush();
    assert.equal(spoken, 'Of course. How is this?', `split boundary ${boundary}`);
    assert.equal(stream.action?.gesture, 'smile', `split boundary ${boundary}`);
    assert.equal(stream.intent?.affect, 'warm', `split boundary ${boundary}`);
  }
});

test('the directive is stripped correctly at every possible token boundary', () => {
  const expected = 'Beaches and sunsets are truly wonderful sights.';
  for (let boundary = 0; boundary <= DIRECTED_REPLY.length; boundary += 1) {
    const result = consume([
      DIRECTED_REPLY.slice(0, boundary),
      DIRECTED_REPLY.slice(boundary),
    ]);
    assert.equal(result.text, expected, `split boundary ${boundary}`);
    assert.equal(result.intent?.affect, 'warm', `split boundary ${boundary}`);
    assert.equal(result.intent?.intensity, 0.82, `split boundary ${boundary}`);
  }
});

test('one-character model tokens cannot leak the directive into speech', () => {
  const result = consume([...DIRECTED_REPLY]);
  assert.equal(result.text, 'Beaches and sunsets are truly wonderful sights.');
  assert.equal(result.intent?.discourseAct, 'appreciation');
  assert.doesNotMatch(result.text, /face|\[\[/iu);
});

test('missing directives preserve prose while malformed face tags fail closed', () => {
  assert.deepEqual(consume(['A plain response.']), {
    text: 'A plain response.',
    intent: null,
  });
  assert.deepEqual(
    consume(['[[face-surprise:LOUD:statement]] ', 'Only this is spoken.']),
    { text: 'Only this is spoken.', intent: null },
  );
  assert.deepEqual(consume(['[[face:sur', 'prise:0.8']), {
    text: '',
    intent: null,
  });
});

test('a malformed directive cannot swallow prose embedded after its fields', () => {
  const reply =
    '[[face:warm:0.74:question Why did the scarecrow win an award]]? Because he was outstanding in his field.';
  const expected =
    'Why did the scarecrow win an award? Because he was outstanding in his field.';
  for (let boundary = 0; boundary <= reply.length; boundary += 1) {
    const result = consume([reply.slice(0, boundary), reply.slice(boundary)]);
    assert.equal(result.text, expected, `split boundary ${boundary}`);
    assert.equal(result.intent, null, `split boundary ${boundary}`);
    assert.doesNotMatch(result.text, /\[\[|face:/iu);
  }
});

test('multiple directives remain ordered with the sentences they control', () => {
  const stream = new PerformanceDirectiveStream();
  const parts = [
    ...stream.feedParts('[[face:surprise:0.9:statement]] Wow, I did not expect that. [[fa'),
    ...stream.feedParts('ce:warm:0.42:appreciation]] That is wonderful news.'),
    ...stream.flushParts(),
  ];
  assert.deepEqual(parts, [
    {
      type: 'intent',
      intent: {
        affect: 'surprise',
        intensity: 0.9,
        discourseAct: 'statement',
        confidence: 0.9,
        source: 'llm-directive',
      },
    },
    { type: 'text', text: 'Wow, I did not expect that. ' },
    {
      type: 'intent',
      intent: {
        affect: 'warm',
        intensity: 0.42,
        discourseAct: 'appreciation',
        confidence: 0.9,
        source: 'llm-directive',
      },
    },
    { type: 'text', text: 'That is wonderful news.' },
  ]);
});
