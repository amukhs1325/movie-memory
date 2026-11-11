import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  FRIENDLY_ERROR,
  getFact,
  type FactServiceDeps,
} from "@/lib/facts/service";
import { MemoryFactStore } from "./helpers/memory-store";

const ALICE = "user-alice";
const BOB = "user-bob";
const MOVIE = "Spirited Away";
const T0 = Date.UTC(2026, 0, 1, 12, 0, 30); // 30s into a minute

let store: MemoryFactStore;
let clock: number;
let generate: ReturnType<typeof vi.fn<(movie: string) => Promise<string>>>;
let deps: FactServiceDeps;

beforeEach(() => {
  store = new MemoryFactStore();
  clock = T0;
  let count = 0;
  generate = vi.fn(async (movie: string) => `fact #${++count} about ${movie}`);
  deps = {
    store,
    generate,
    now: () => clock,
    // Advance the fake clock instead of really waiting.
    sleep: async (ms) => {
      clock += ms;
    },
    onError: () => {}, // keep test output quiet
  };
});

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ userId: ALICE, status: "READY" });
  });

  it("returns the cached fact while it is less than 60 seconds old", async () => {
    const first = await getFact(deps, ALICE, MOVIE);

    clock = T0 + CACHE_TTL_MS - 1; // 59.999s later
    const second = await getFact(deps, ALICE, MOVIE);

    expect(second).toMatchObject({ ok: true, source: "cache" });
    expect(second.ok && second.fact.content).toBe(first.ok && first.fact.content);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("generates a new fact once the cached one is 60 seconds old", async () => {
    await getFact(deps, ALICE, MOVIE);

    clock = T0 + CACHE_TTL_MS; // exactly 60s later: no longer "less than 60s"
    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(result.ok && result.fact.content).toBe(`fact #2 about ${MOVIE}`);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.rows).toHaveLength(2); // history is kept
  });

  it("serves the most recent fact when several exist", async () => {
    store.seed(ALICE, MOVIE, "old fact", new Date(T0 - 5 * 60_000));
    store.seed(ALICE, MOVIE, "recent fact", new Date(T0 - 10_000));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "cache" });
    expect(result.ok && result.fact.content).toBe("recent fact");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("burst / idempotency protection", () => {
  it("calls OpenAI once when many requests arrive at the same time", async () => {
    // Hold the first generation open so the other requests overlap with it.
    let finish!: (fact: string) => void;
    generate.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    deps.sleep = () => new Promise((resolve) => setTimeout(resolve, 1));

    const requests = Array.from({ length: 5 }, () => getFact(deps, ALICE, MOVIE));
    await new Promise((resolve) => setTimeout(resolve, 10));
    finish("the one shared fact");
    const results = await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toMatchObject({ ok: true });
      expect(result.ok && result.fact.content).toBe("the one shared fact");
    }
    expect(store.rows).toHaveLength(1);
  });
});

describe("failure handling", () => {
  it("returns the most recent cached fact if OpenAI fails", async () => {
    store.seed(ALICE, MOVIE, "older fact", new Date(T0 - 5 * 60_000));
    generate.mockRejectedValueOnce(new Error("timeout"));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "fallback" });
    expect(result.ok && result.fact.content).toBe("older fact");
  });

  it("returns a user-friendly error if OpenAI fails and nothing is cached", async () => {
    generate.mockRejectedValueOnce(new Error("500 from OpenAI"));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toEqual({ ok: false, error: FRIENDLY_ERROR });
  });

  it("releases the claim after a failure so the next request can retry", async () => {
    generate.mockRejectedValueOnce(new Error("timeout"));
    await getFact(deps, ALICE, MOVIE);
    expect(store.rows).toHaveLength(0); // no stuck PENDING row

    clock += 1_000; // same 60s window
    const retry = await getFact(deps, ALICE, MOVIE);

    expect(retry).toMatchObject({ ok: true, source: "generated" });
  });

  it("stops waiting on a stuck generation and falls back", async () => {
    store.seed(ALICE, MOVIE, "older fact", new Date(T0 - 5 * 60_000));
    // Simulate another request that claimed the window and never finished.
    await store.claimWindow(ALICE, MOVIE, Math.floor(T0 / 60_000), new Date(T0));

    const result = await getFact({ ...deps, maxWaitMs: 2_000 }, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "fallback" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("authorization: facts are scoped to their owner", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    store.seed(BOB, MOVIE, "Bob's private fact", new Date(T0 - 1_000));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result.ok && result.fact.content).not.toBe("Bob's private fact");
    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(store.rows.find((r) => r.userId === ALICE)).toBeDefined();
  });

  it("does not fall back to another user's fact when OpenAI fails", async () => {
    store.seed(BOB, MOVIE, "Bob's private fact", new Date(T0 - 5 * 60_000));
    generate.mockRejectedValueOnce(new Error("timeout"));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toEqual({ ok: false, error: FRIENDLY_ERROR });
  });

  it("one user's claim does not block another user's generation", async () => {
    await store.claimWindow(BOB, MOVIE, Math.floor(T0 / 60_000), new Date(T0));

    const result = await getFact(deps, ALICE, MOVIE);

    expect(result).toMatchObject({ ok: true, source: "generated" });
  });
});
