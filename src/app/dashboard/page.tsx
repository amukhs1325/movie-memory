import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/current-user";
import { FunFact } from "./fun-fact";

export default async function DashboardPage() {
  // Signed-out visitors are redirected to "/" (the login page).
  const user = await requireUser();
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google may not return a name or photo, so every field has a fallback.
  const displayName = user.name?.trim() || "Movie fan";
  const initial = (user.name?.trim() || user.email || "?")
    .charAt(0)
    .toUpperCase();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <header className="flex items-center gap-4">
        {user.image ? (
          // Plain <img>: Google avatar URLs are already sized, and
          // no-referrer avoids Google rejecting hotlinked avatars.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            width={56}
            height={56}
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-200 text-xl font-semibold text-stone-600"
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{displayName}</h1>
          {user.email && (
            <p className="truncate text-sm text-stone-600">{user.email}</p>
          )}
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-100"
          >
            Log out
          </button>
        </form>
      </header>

      <section className="mt-10 rounded-xl border border-stone-200 bg-white p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Favorite movie
        </p>
        {/* React escapes this text, so a title can't inject HTML. */}
        <p className="mt-1 text-2xl font-semibold">{user.favoriteMovie}</p>
        <FunFact />
      </section>
    </main>
  );
}
