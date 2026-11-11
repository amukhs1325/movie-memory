import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";

// "/" is both the landing page and the login page.
// Signed-in users are routed by onboarding state:
//   no favorite movie yet -> /onboarding (first-time users)
//   favorite movie saved  -> /dashboard  (returning users)
export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.favoriteMovie ? "/dashboard" : "/onboarding");
  }

  async function signInWithGoogle() {
    "use server";
    // Come back to "/" so the routing above decides where the user goes.
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Movie Memory</h1>
        <p className="mt-3 text-stone-600">
          Tell us your favorite movie and get a fun fact about it.
        </p>
        <form action={signInWithGoogle} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white transition hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
