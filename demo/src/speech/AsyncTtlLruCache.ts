export interface AsyncTtlLruCacheOptions {
  maxEntries?: number;
  ttlMilliseconds?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

/** Small in-memory cache with in-flight de-duplication to avoid duplicate TTS cost. */
export class AsyncTtlLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly maxEntries: number;
  private readonly ttlMilliseconds: number;
  private readonly now: () => number;
  private generation = 0;

  constructor(options: AsyncTtlLruCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 32);
    this.ttlMilliseconds = Math.max(1, options.ttlMilliseconds ?? 60 * 60_000);
    this.now = options.now ?? Date.now;
  }

  async getOrCreate(key: string, create: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.expiresAt > this.now()) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        return cached.value;
      }
      this.entries.delete(key);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const generation = this.generation;
    const creation = create()
      .then((value) => {
        if (generation !== this.generation) return value;
        while (this.entries.size >= this.maxEntries) {
          const oldestKey = this.entries.keys().next().value as string | undefined;
          if (oldestKey === undefined) {
            break;
          }
          this.entries.delete(oldestKey);
        }

        this.entries.set(key, {
          expiresAt: this.now() + this.ttlMilliseconds,
          value,
        });
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === creation) this.pending.delete(key);
      });

    this.pending.set(key, creation);
    return creation;
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
  }
}
