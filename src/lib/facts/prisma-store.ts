import { Prisma, type PrismaClient } from "@prisma/client";
import type { FactStore, StoredFact, WindowState } from "./service";

const factSelect = { id: true, content: true, createdAt: true } as const;

function toStoredFact(row: {
  id: string;
  content: string | null;
  createdAt: Date;
}): StoredFact {
  // READY rows always have content; guard anyway so a bad row can't leak null.
  if (row.content === null) throw new Error(`Fact ${row.id} has no content`);
  return { id: row.id, content: row.content, createdAt: row.createdAt };
}

/** Postgres implementation of FactStore. Every query filters by userId. */
export function createPrismaFactStore(db: PrismaClient): FactStore {
  return {
    async findLatestReady(userId, movie) {
      const row = await db.movieFact.findFirst({
        where: { userId, movie, status: "READY" },
        orderBy: { createdAt: "desc" },
        select: factSelect,
      });
      return row ? toStoredFact(row) : null;
    },

    async claimWindow(userId, movie, cacheWindow, createdAt) {
      try {
        const row = await db.movieFact.create({
          data: { userId, movie, cacheWindow, createdAt, status: "PENDING" },
          select: { id: true },
        });
        return row.id;
      } catch (error) {
        // P2002 = unique constraint violation: another request already
        // claimed this (user, movie, window). That is the expected race,
        // not an error.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return null;
        }
        throw error;
      }
    },

    async complete(claimId, content) {
      const row = await db.movieFact.update({
        where: { id: claimId },
        data: { content, status: "READY" },
        select: factSelect,
      });
      return toStoredFact(row);
    },

    async release(claimId) {
      // Only ever delete our own unfinished claim.
      await db.movieFact.deleteMany({
        where: { id: claimId, status: "PENDING" },
      });
    },

    async getWindowState(userId, movie, cacheWindow): Promise<WindowState> {
      const row = await db.movieFact.findUnique({
        where: { userId_movie_cacheWindow: { userId, movie, cacheWindow } },
        select: { ...factSelect, status: true },
      });
      if (!row) return { status: "missing" };
      if (row.status === "PENDING") return { status: "pending" };
      return { status: "ready", fact: toStoredFact(row) };
    },
  };
}
