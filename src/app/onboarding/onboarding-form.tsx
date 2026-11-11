"use client";

import { useActionState } from "react";
import { MOVIE_MAX_LENGTH } from "@/lib/movie-limits";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = {};

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    saveFavoriteMovie,
    initialState,
  );

  return (
    <form action={formAction} className="mt-6 space-y-3" noValidate>
      <label htmlFor="movie" className="sr-only">
        Favorite movie
      </label>
      {/* Browser limits are only a convenience. The server re-validates. */}
      <input
        id="movie"
        name="movie"
        type="text"
        required
        maxLength={MOVIE_MAX_LENGTH}
        defaultValue={state.value}
        placeholder="e.g. Spirited Away"
        autoComplete="off"
        autoFocus
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white transition hover:bg-stone-700 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save and continue"}
      </button>
    </form>
  );
}
