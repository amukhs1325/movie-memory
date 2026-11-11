"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { movieTitleSchema } from "@/lib/validation";

export type OnboardingState = { error?: string; value?: string };

export async function saveFavoriteMovie(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Server actions are public HTTP endpoints, so re-check the session here
  // instead of trusting that the form was only shown to signed-in users.
  const user = await requireUser();

  const raw = formData.get("movie");
  const parsed = movieTitleSchema.safeParse(typeof raw === "string" ? raw : "");

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid movie title.",
      // Echo back (capped) so the user doesn't lose what they typed.
      value: typeof raw === "string" ? raw.slice(0, 200) : "",
    };
  }

  // Only write if the movie is still empty. Onboarding is first-time only,
  // and this also makes a double-submit harmless.
  await prisma.user.updateMany({
    where: { id: user.id, favoriteMovie: null },
    data: { favoriteMovie: parsed.data },
  });

  redirect("/dashboard");
}
