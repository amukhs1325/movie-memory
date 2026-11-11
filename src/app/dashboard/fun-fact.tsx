"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FactState =
  | { status: "loading" }
  | { status: "ready"; fact: string }
  | { status: "error"; message: string };

const GENERIC_ERROR = "Something went wrong loading your fun fact.";

/**
 * Loads the fun fact from GET /api/fact after the page renders, so the
 * dashboard appears right away even when OpenAI is slow. All caching and
 * deduplication happen on the server; this component only displays results.
 */
export function FunFact() {
  const [state, setState] = useState<FactState>({ status: "loading" });
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort(); // drop any in-flight request
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/fact", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || typeof body?.fact !== "string") {
        setState({ status: "error", message: body?.error ?? GENERIC_ERROR });
        return;
      }
      setState({ status: "ready", fact: body.fact });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setState({ status: "error", message: GENERIC_ERROR });
    }
  }, []);

  useEffect(() => {
    // Run the first load outside the effect body (avoids a synchronous
    // setState inside the effect).
    queueMicrotask(load);
    return () => controllerRef.current?.abort();
  }, [load]);

  return (
    <div className="mt-6 border-t border-stone-200 pt-6">
      <p className="text-sm font-medium uppercase tracking-wide text-stone-500">
        Fun fact
      </p>
      <div className="mt-2 min-h-12" aria-live="polite">
        {state.status === "loading" && (
          <p className="animate-pulse text-stone-400">Finding a fun fact...</p>
        )}
        {state.status === "ready" && <p className="leading-relaxed">{state.fact}</p>}
        {state.status === "error" && (
          <p role="alert" className="text-red-600">
            {state.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={load}
        disabled={state.status === "loading"}
        className="mt-4 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-100 disabled:opacity-50"
      >
        Refresh fact
      </button>
      <p className="mt-2 text-xs text-stone-500">
        A new fact is generated at most once per minute.
      </p>
    </div>
  );
}
