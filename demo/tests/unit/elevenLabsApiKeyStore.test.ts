import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearStoredElevenLabsApiKey,
  ELEVENLABS_API_KEY_STORAGE_KEY,
  getStoredElevenLabsApiKey,
  maskElevenLabsApiKey,
  storeElevenLabsApiKey,
} from '../../src/speech/ElevenLabsApiKeyStore';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('stores, masks, reads, and clears the BYOK credential under one namespaced key', () => {
  const storage = new MemoryStorage();
  const key = storeElevenLabsApiKey('  example-api-key-1234  ', storage);
  assert.equal(key, 'example-api-key-1234');
  assert.equal(storage.getItem(ELEVENLABS_API_KEY_STORAGE_KEY), key);
  assert.equal(getStoredElevenLabsApiKey(storage), key);
  assert.equal(maskElevenLabsApiKey(key), 'stored locally');
  clearStoredElevenLabsApiKey(storage);
  assert.equal(getStoredElevenLabsApiKey(storage), null);
});

test('rejects blank or whitespace-containing keys', () => {
  const storage = new MemoryStorage();
  assert.throws(() => storeElevenLabsApiKey('   ', storage), /Enter an ElevenLabs/u);
  assert.throws(() => storeElevenLabsApiKey('bad key', storage), /unsupported/u);
});
