/**
 * Fact generation with a 60-second cache, burst protection and failure
 * fallback (Variant A).
 *
 * This module holds only the decision logic. Storage and OpenAI are passed
 * in as dependencies so the logic can be unit tested without a database or
 * network, and so the rules live in one readable place.
 *
 * How a request is handled:
 *
 *   1. Load the latest READY fact for (user, movie).
 *      If it is less than 60s old, return it (cache hit).
 *
 *   2. Otherwise try to CLAIM the current 60s window by inserting a PENDING
 *      row. A unique constraint on (userId, movie, cacheWindow) means only
 *      one request can win the claim, no matter how many tabs, refreshes or
 *      server instances race for it.
 *
 *   3. Winner: call OpenAI, fill in the row (READY), return it.
 *      If OpenAI fails, delete the claim (so a retry is possible) and fall
 *      back to the previous fact, or a friendly error if there is none.
 *
 *   4. Losers: do NOT call OpenAI. Poll the claimed row until the winner
 *      finishes, then return the same fact. If the winner fails or takes too
 *      long, use the same fallback as above.
 *
 * Why the window never blocks a legitimate regeneration: a fact created at
 * time t sits in window floor(t / 60s). It only becomes stale at t + 60s,
 * which is always in a later window, so the next claim never collides with
 * the fact it is replacing.
 */

export const CACHE_TTL_MS = 60_000;

/** Upper bound for how long a request waits on another request's generation. */
export const DEFAULT_MAX_WAIT_MS = 11_000;
export const DEFAULT_POLL_INTERVAL_MS = 250;

export const FRIENDLY_ERROR =
  "We couldn't come up with a fun fact right now. Please try again in a moment.";

export interface StoredFact {
  id: string;
  content: string;
  createdAt: Date;
}

export type WindowState =
  | { status: "ready"; fact: StoredFact }
  | { status: "pending" }
  | { status: "missing" };

/** Persistence operations the service needs. Every call is scoped by userId. */
export interface FactStore {
  findLatestReady(userId: string, movie: string): Promise<StoredFact | null>;
  /** Insert a PENDING row. Returns its id, or null if the window is taken. */
  claimWindow(
    userId: string,
    movie: string,
    cacheWindow: number,
    createdAt: Date,
  ): Promise<string | null>;
  complete(claimId: string, content: string): Promise<StoredFact>;
  /** Remove a PENDING claim after a failed generation. */
  release(claimId: string): Promise<void>;
  getWindowState(
    userId: string,
    movie: string,
    cacheWindow: number,
  ): Promise<WindowState>;
}

export interface FactServiceDeps {
  store: FactStore;
  generate: (movie: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
}

export type FactSource = "cache" | "generated" | "fallback";

export type FactResult =
  | {
      ok: true;
      source: FactSource;
      fact: { content: string; createdAt: Date };
    }
  | { ok: false; error: string };

export function cacheWindowFor(timestampMs: number): number {
  return Math.floor(timestampMs / CACHE_TTL_MS);
}

export function isFresh(fact: StoredFact, nowMs: number): boolean {
  return nowMs - fact.createdAt.getTime() < CACHE_TTL_MS;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function success(source: FactSource, fact: StoredFact): FactResult {
  return {
    ok: true,
    source,
    fact: { content: fact.content, createdAt: fact.createdAt },
  };
}

function fallback(previous: StoredFact | null): FactResult {
  return previous
    ? success("fallback", previous)
    : { ok: false, error: FRIENDLY_ERROR };
}

export async function getFact(
  deps: FactServiceDeps,
  userId: string,
  movie: string,
): Promise<FactResult> {
  const {
    store,
    generate,
    now = Date.now,
    sleep = defaultSleep,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onError = (error) => console.error("[facts] generation failed:", error),
  } = deps;

  const nowMs = now();

  // 1. Cache hit
  const latest = await store.findLatestReady(userId, movie);
  if (latest && isFresh(latest, nowMs)) {
    return success("cache", latest);
  }

  // 2. Try to become the one request that generates for this window
  const cacheWindow = cacheWindowFor(nowMs);
  const claimId = await store.claimWindow(
    userId,
    movie,
    cacheWindow,
    new Date(nowMs),
  );

  // 4. Someone else holds the claim: wait for their result
  if (claimId === null) {
    const waitStart = now();
    while (true) {
      const state = await store.getWindowState(userId, movie, cacheWindow);
      if (state.status === "ready") return success("cache", state.fact);
      if (state.status === "missing") return fallback(latest); // winner failed
      if (now() - waitStart >= maxWaitMs) return fallback(latest);
      await sleep(pollIntervalMs);
    }
  }

  // 3. We hold the claim: generate, store, return
  try {
    const content = await generate(movie);
    const fact = await store.complete(claimId, content);
    return success("generated", fact);
  } catch (error) {
    onError(error);
    // Free the window so the next request can retry immediately.
    await store.release(claimId).catch(onError);
    return fallback(latest);
  }
}
