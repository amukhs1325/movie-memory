import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session lookup and the fact service so we can test the route's
// authorization rules on their own.
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/facts", () => ({ getFactForUser: vi.fn() }));

import { GET } from "@/app/api/fact/route";
import { getCurrentUser } from "@/lib/current-user";
import { getFactForUser } from "@/lib/facts";

const mockedUser = vi.mocked(getCurrentUser);
const mockedFacts = vi.mocked(getFactForUser);

const alice = {
  id: "user-alice",
  name: "Alice",
  email: "alice@example.com",
  image: null,
  favoriteMovie: "Spirited Away",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/fact authorization", () => {
  it("returns 401 and generates nothing when signed out", async () => {
    mockedUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockedFacts).not.toHaveBeenCalled();
  });

  it("only ever looks up facts for the signed-in user's id and movie", async () => {
    mockedUser.mockResolvedValue(alice);
    mockedFacts.mockResolvedValue({
      ok: true,
      source: "cache",
      fact: { content: "A fun fact", createdAt: new Date() },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockedFacts).toHaveBeenCalledExactlyOnceWith("user-alice", "Spirited Away");
    expect(await response.json()).toMatchObject({ fact: "A fun fact" });
  });

  it("returns 409 when the user has not finished onboarding", async () => {
    mockedUser.mockResolvedValue({ ...alice, favoriteMovie: null });

    const response = await GET();

    expect(response.status).toBe(409);
    expect(mockedFacts).not.toHaveBeenCalled();
  });

  it("returns 503 with a friendly message when no fact is available", async () => {
    mockedUser.mockResolvedValue(alice);
    mockedFacts.mockResolvedValue({ ok: false, error: "Please try again." });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Please try again." });
  });

  it("is never cached by browsers or proxies", async () => {
    mockedUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
