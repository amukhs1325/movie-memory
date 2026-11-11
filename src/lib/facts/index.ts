import "server-only";
import { prisma } from "@/lib/db";
import { generateMovieFact } from "./openai";
import { createPrismaFactStore } from "./prisma-store";
import { getFact, type FactResult } from "./service";

const store = createPrismaFactStore(prisma);

/** Production wiring: Postgres store + OpenAI generator. */
export function getFactForUser(
  userId: string,
  movie: string,
): Promise<FactResult> {
  return getFact({ store, generate: generateMovieFact }, userId, movie);
}
