import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getFactForUser } from "@/lib/facts";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/fact
 *
 * Returns a fun fact about the signed-in user's favorite movie.
 * The endpoint takes no user id or movie parameter: both come from the
 * session and the database, so there is nothing a caller can change to read
 * someone else's facts.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401, headers: NO_STORE },
    );
  }

  if (!user.favoriteMovie) {
    return NextResponse.json(
      { error: "Pick your favorite movie first." },
      { status: 409, headers: NO_STORE },
    );
  }

  const result = await getFactForUser(user.id, user.favoriteMovie);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 503, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      fact: result.fact.content,
      createdAt: result.fact.createdAt.toISOString(),
      source: result.source,
    },
    { headers: NO_STORE },
  );
}
