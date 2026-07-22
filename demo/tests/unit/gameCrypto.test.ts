import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createQuestionHash,
  createSecretCommitment,
  normalizeGuess,
} from '../../server/gameCrypto.js';

test('normalizes equivalent exact guesses without accepting partial guesses', () => {
  assert.equal(normalizeGuess('  An OCTOPUS!  '), 'octopus');
  assert.equal(normalizeGuess('the blue-whale'), 'blue whale');
  assert.notEqual(normalizeGuess('octopus-like creature'), normalizeGuess('octopus'));
});

test('secret commitments are deterministic and salt-sensitive', () => {
  const first = createSecretCommitment('round-1', 'An Octopus', 'salt-a');
  assert.equal(first, createSecretCommitment('round-1', 'octopus', 'salt-a'));
  assert.notEqual(first, createSecretCommitment('round-1', 'octopus', 'salt-b'));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('question hashes bind round, wallet, and text', () => {
  const first = createQuestionHash('round-1', 'wallet-a', 'Is it alive?');
  assert.notEqual(first, createQuestionHash('round-2', 'wallet-a', 'Is it alive?'));
  assert.notEqual(first, createQuestionHash('round-1', 'wallet-b', 'Is it alive?'));
  assert.notEqual(first, createQuestionHash('round-1', 'wallet-a', 'Can it move?'));
});
