/**
 * Small in-memory cache for data that many requests read and that changes
 * rarely (exchange rate, property types). Each server instance keeps its own
 * copy for a short time, so a busy page reads the database once instead of on
 * every request. Concurrent callers for the same key share one load.
 *
 * Only for data that is the same for every viewer; never cache per-user data.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = load()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) {
        // Drop the oldest entry (Map keeps insertion order).
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** Forget cached values whose key starts with `prefix` (call after a change). */
export function invalidateCached(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test helper. */
export function clearMemoryCache(): void {
  store.clear();
  inFlight.clear();
}
