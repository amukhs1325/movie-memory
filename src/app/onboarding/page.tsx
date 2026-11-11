import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  // First-time only: users who already picked a movie go to the dashboard.
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.split(" ")[0];

  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}!` : "Welcome!"}
        </h1>
        <p className="mt-2 text-stone-600">What is your favorite movie?</p>
        <OnboardingForm />
      </div>
    </main>
  );
}
