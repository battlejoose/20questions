import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELEVENLABS_MODEL_ID,
  ElevenLabsBrowserTtsClient,
  ElevenLabsBrowserTtsError,
  PREMADE_VOICE_ID,
} from '../../src/speech/ElevenLabsBrowserTts';

function restAlignment(text: string) {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.08),
    character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.08),
  };
}

test('requires a browser-supplied key before making a network request', async () => {
  let fetchCalls = 0;
  const client = new ElevenLabsBrowserTtsClient({
    getApiKey: () => null,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Fetch should not run.');
    },
  });

  await assert.rejects(client.synthesize('Hello'), (error: unknown) => {
    assert.ok(error instanceof ElevenLabsBrowserTtsError);
    assert.equal(error.code, 'MISSING_API_KEY');
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('calls timestamped TTS directly with the fixed premade voice and safe fetch policy', async () => {
  let upstreamCalls = 0;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const client = new ElevenLabsBrowserTtsClient({
    getApiKey: () => 'browser-test-key',
    phonemizeWord: async (word) =>
      word.toLowerCase() === 'hi' ? ['h', 'aɪ'] : ['ð', 'ɛ', 'r'],
    fetchImpl: async (input, init) => {
      upstreamCalls += 1;
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        audio_base64: 'ZmFrZS1tcDM=',
        normalized_alignment: restAlignment('Hi there'),
      });
    },
  });

  const first = await client.synthesize('  Hi\nthere  ');
  const second = await client.synthesize('Hi there');
  assert.equal(first, second);
  assert.equal(upstreamCalls, 1);
  assert.match(capturedUrl, new RegExp(`/text-to-speech/${PREMADE_VOICE_ID}/with-timestamps`, 'u'));
  assert.match(capturedUrl, /output_format=mp3_44100_128/u);
  assert.match(capturedUrl, /enable_logging=false/u);
  assert.equal(capturedInit?.credentials, 'omit');
  assert.equal(capturedInit?.referrerPolicy, 'no-referrer');
  assert.equal(new Headers(capturedInit?.headers).get('xi-api-key'), 'browser-test-key');
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(body.text, 'Hi there');
  assert.equal(body.model_id, ELEVENLABS_MODEL_ID);
  assert.equal(first.voice.voiceId, PREMADE_VOICE_ID);
  assert.ok(first.phonemes.length > 0);
});

test('changing keys creates a new cache namespace without exposing either key in the URL', async () => {
  let apiKey = 'first-browser-key';
  const seenHeaders: string[] = [];
  const seenUrls: string[] = [];
  const client = new ElevenLabsBrowserTtsClient({
    getApiKey: () => apiKey,
    phonemizeWord: async () => ['h', 'i'],
    fetchImpl: async (input, init) => {
      seenUrls.push(String(input));
      seenHeaders.push(new Headers(init?.headers).get('xi-api-key') ?? '');
      return Response.json({
        audio_base64: 'ZmFrZQ==',
        alignment: restAlignment('Hi'),
      });
    },
  });

  await client.synthesize('Hi');
  apiKey = 'second-browser-key';
  await client.synthesize('Hi');
  assert.deepEqual(seenHeaders, ['first-browser-key', 'second-browser-key']);
  assert.equal(seenUrls.length, 2);
  assert.ok(seenUrls.every((url) => !url.includes('browser-key')));
});

test('rejects oversized text before calling ElevenLabs', async () => {
  let called = false;
  const client = new ElevenLabsBrowserTtsClient({
    getApiKey: () => 'browser-test-key',
    maxTextCharacters: 5,
    fetchImpl: async () => {
      called = true;
      throw new Error('Should not run.');
    },
  });

  await assert.rejects(client.synthesize('123456'), (error: unknown) => {
    assert.ok(error instanceof ElevenLabsBrowserTtsError);
    assert.equal(error.code, 'INVALID_TEXT');
    return true;
  });
  assert.equal(called, false);
});

test('maps authentication and rate-limit failures without reflecting response bodies', async () => {
  for (const [status, code] of [[401, 'AUTHENTICATION'], [429, 'RATE_LIMITED']] as const) {
    const client = new ElevenLabsBrowserTtsClient({
      getApiKey: () => 'browser-test-key',
      fetchImpl: async () => Response.json(
        { detail: 'provider-secret-details' },
        { status },
      ),
    });
    await assert.rejects(client.synthesize(`Status ${status}`), (error: unknown) => {
      assert.ok(error instanceof ElevenLabsBrowserTtsError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /provider-secret-details/u);
      return true;
    });
  }
});

test('times out a stalled browser request with a sanitized error', async () => {
  const client = new ElevenLabsBrowserTtsClient({
    getApiKey: () => 'browser-test-key',
    requestTimeoutMilliseconds: 1,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException(
        'provider-secret-details',
        'AbortError',
      )));
    }),
  });

  await assert.rejects(client.synthesize('Hello'), (error: unknown) => {
    assert.ok(error instanceof ElevenLabsBrowserTtsError);
    assert.equal(error.code, 'REQUEST_FAILED');
    assert.match(error.message, /timed out/u);
    assert.doesNotMatch(error.message, /provider-secret-details/u);
    return true;
  });
});
