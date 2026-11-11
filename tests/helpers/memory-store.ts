import type { FactStore, StoredFact, WindowState } from "@/lib/facts/service";

type Row = {
  id: string;
  userId: string;
  movie: string;
  cacheWindow: number;
  createdAt: Date;
  status: "PENDING" | "READY";
  content: string | null;
};

/**
 * In-memory FactStore for unit tests. It enforces the same unique key as
 * the database, @@unique([userId, movie, cacheWindow]), so the race logic in
 * the service is exercised the same way it is against Postgres.
 */
export class MemoryFactStore implements FactStore {
  rows: Row[] = [];
  private nextId = 1;

  /** Test helper: insert a READY fact directly. */
  seed(userId: string, movie: string, content: string, createdAt: Date): void {
    this.rows.push({
      id: `seed-${this.nextId++}`,
      userId,
      movie,
      cacheWindow: Math.floor(createdAt.getTime() / 60_000),
      createdAt,
      status: "READY",
      content,
    });
  }

  async findLatestReady(userId: string, movie: string): Promise<StoredFact | null> {
    const ready = this.rows
      .filter((r) => r.userId === userId && r.movie === movie && r.status === "READY")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return ready[0] ? toFact(ready[0]) : null;
  }

  async claimWindow(
    userId: string,
    movie: string,
    cacheWindow: number,
    createdAt: Date,
  ): Promise<string | null> {
    const taken = this.rows.some(
      (r) => r.userId === userId && r.movie === movie && r.cacheWindow === cacheWindow,
    );
    if (taken) return null; // unique constraint violation
    const id = `fact-${this.nextId++}`;
    this.rows.push({ id, userId, movie, cacheWindow, createdAt, status: "PENDING", content: null });
    return id;
  }

  async complete(claimId: string, content: string): Promise<StoredFact> {
    const row = this.rows.find((r) => r.id === claimId);
    if (!row) throw new Error("claim not found");
    row.status = "READY";
    row.content = content;
    return toFact(row);
  }

  async release(claimId: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.id === claimId && r.status === "PENDING"));
  }

  async getWindowState(
    userId: string,
    movie: string,
    cacheWindow: number,
  ): Promise<WindowState> {
    const row = this.rows.find(
      (r) => r.userId === userId && r.movie === movie && r.cacheWindow === cacheWindow,
    );
    if (!row) return { status: "missing" };
    if (row.status === "PENDING") return { status: "pending" };
    return { status: "ready", fact: toFact(row) };
  }
}

function toFact(row: Row): StoredFact {
  return { id: row.id, content: row.content as string, createdAt: row.createdAt };
}
