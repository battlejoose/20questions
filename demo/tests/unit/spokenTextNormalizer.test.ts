import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integerToSpokenWords,
  normalizeSpokenText,
} from '../../src/local-agent/SpokenTextNormalizer';

test('integerToSpokenWords handles common conversational magnitudes', () => {
  assert.equal(integerToSpokenWords(0), 'zero');
  assert.equal(integerToSpokenWords(42), 'forty two');
  assert.equal(integerToSpokenWords(2026), 'two thousand twenty six');
  assert.equal(integerToSpokenWords(-12), 'minus twelve');
});

test('normalizeSpokenText expands ambiguous written forms deterministically', () => {
  assert.equal(
    normalizeSpokenText('GPU use hit 42% at 3:05 PM and cost $12.50'),
    'G P U use hit forty two percent at three oh five p m and cost twelve dollars and fifty cents.',
  );
});

test('normalizeSpokenText strips visual markup while retaining speech content', () => {
  assert.equal(
    normalizeSpokenText('See [the docs](https://example.com), e.g., before launch 🚀'),
    'See the docs, for example, before launch.',
  );
});

test('normalizeSpokenText never pronounces leaked model control tags', () => {
  assert.equal(
    normalizeSpokenText('<CODE>Keep this answer.</CODE><|assistant|>'),
    'Keep this answer.',
  );
});

test('normalizeSpokenText speaks dates, units, email, and urls', () => {
  assert.equal(
    normalizeSpokenText('On 2026-07-18 email me@test.com about 12 km at https://gnm.dev/a'),
    'On july eighteenth, two thousand twenty six email me at test dot com about twelve kilometers at gnm dot dev slash a.',
  );
});
