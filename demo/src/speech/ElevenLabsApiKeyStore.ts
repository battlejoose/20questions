export const ELEVENLABS_API_KEY_STORAGE_KEY =
  'gnm-avatar.elevenlabs-api-key.v1';

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): KeyStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeElevenLabsApiKey(value: string): string {
  const key = value.trim();
  if (!key) {
    throw new TypeError('Enter an ElevenLabs API key.');
  }
  if (key.length > 512 || /\s|[\u0000-\u001F\u007F]/u.test(key)) {
    throw new TypeError('The API key contains unsupported characters.');
  }
  return key;
}

/** Reads the BYOK credential for this origin without ever placing it in app state. */
export function getStoredElevenLabsApiKey(
  storage: KeyStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(ELEVENLABS_API_KEY_STORAGE_KEY);
    if (!value) return null;
    return normalizeElevenLabsApiKey(value);
  } catch {
    return null;
  }
}

export function storeElevenLabsApiKey(
  value: string,
  storage: KeyStorage | null = browserStorage(),
): string {
  const key = normalizeElevenLabsApiKey(value);
  if (!storage) {
    throw new Error('Local browser storage is unavailable.');
  }
  try {
    storage.setItem(ELEVENLABS_API_KEY_STORAGE_KEY, key);
  } catch {
    throw new Error('The API key could not be saved in this browser.');
  }
  return key;
}

export function clearStoredElevenLabsApiKey(
  storage: KeyStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(ELEVENLABS_API_KEY_STORAGE_KEY);
  } catch {
    // Clearing a missing or inaccessible browser store is already effectively done.
  }
}

export function maskElevenLabsApiKey(value: string): string {
  const key = value.trim();
  if (!key) return 'No key saved';
  return 'stored locally';
}
