import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncTtlLruCache } from '../../src/speech/AsyncTtlLruCache';

test('cache de-duplicates in-flight work and does not retain failures', async () => {
  const cache = new AsyncTtlLruCache<number>();
  let createCalls = 0;
  let completeFirst: ((value: number) => void) | undefined;

  const first = cache.getOrCreate('same', async () => {
    createCalls += 1;
    return new Promise<number>((resolve) => {
      completeFirst = resolve;
    });
  });
  const duplicate = cache.getOrCreate('same', async () => {
    createCalls += 1;
    return 99;
  });

  assert.equal(createCalls, 1);
  assert.ok(completeFirst);
  completeFirst(7);
  assert.deepEqual(await Promise.all([first, duplicate]), [7, 7]);

  let failureCalls = 0;
  await assert.rejects(
    cache.getOrCreate('failure', async () => {
      failureCalls += 1;
      throw new Error('temporary');
    }),
    /temporary/u,
  );
  const recovered = await cache.getOrCreate('failure', async () => {
    failureCalls += 1;
    return 8;
  });
  assert.equal(recovered, 8);
  assert.equal(failureCalls, 2);
});

test('clear isolates a replacement from work that was already in flight', async () => {
  const cache = new AsyncTtlLruCache<number>();
  let completeOld: ((value: number) => void) | undefined;
  const old = cache.getOrCreate('key', () => new Promise<number>((resolve) => {
    completeOld = resolve;
  }));

  cache.clear();
  const replacement = cache.getOrCreate('key', async () => 2);
  completeOld?.(1);
  assert.deepEqual(await Promise.all([old, replacement]), [1, 2]);
  assert.equal(await cache.getOrCreate('key', async () => 3), 2);
});
