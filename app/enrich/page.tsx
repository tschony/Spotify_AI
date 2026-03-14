"use client";

import { useEffect, useState } from "react";
import { DatabaseZap, RefreshCw, ShieldCheck } from "lucide-react";
import { getSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type EnrichStats = {
  historyTracks: number;
  metadataTracks: number;
  remainingTracks: number;
  batchSize: number;
};

type EnrichResult = {
  processed: number;
  errors: number;
};

type AuthState = "checking" | "ready" | "redirecting";
type RunState = "idle" | "loading" | "running" | "done" | "error";

type RunTotals = {
  processed: number;
  errors: number;
  batches: number;
  startedRemaining: number;
};

function calculateProgress(startedRemaining: number, remainingTracks: number) {
  if (startedRemaining === 0) {
    return 100;
  }

  const completed = Math.max(startedRemaining - remainingTracks, 0);

  return Math.min(100, Math.round((completed / startedRemaining) * 100));
}

async function fetchEnrichmentStats() {
  const response = await fetch("/api/enrich", {
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | EnrichStats
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "Failed to load enrichment stats.",
    );
  }

  return payload as EnrichStats;
}

async function runEnrichmentBatch() {
  const response = await fetch("/api/enrich", {
    method: "POST",
  });

  const payload = (await response.json().catch(() => null)) as
    | EnrichResult
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "Failed to run enrichment batch.",
    );
  }

  return payload as EnrichResult;
}

export default function EnrichPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [runState, setRunState] = useState<RunState>("loading");
  const [stats, setStats] = useState<EnrichStats | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Loading enrichment status.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [totals, setTotals] = useState<RunTotals>({
    processed: 0,
    errors: 0,
    batches: 0,
    startedRemaining: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const session = await getSession();

      if (cancelled) {
        return;
      }

      if (!session) {
        setAuthState("redirecting");
        window.location.replace("/api/auth/signin?callbackUrl=%2Fenrich");
        return;
      }

      setAuthState("ready");
      setRunState("loading");

      try {
        const nextStats = await fetchEnrichmentStats();

        if (cancelled) {
          return;
        }

        setStats(nextStats);
        setTotals((currentTotals) => ({
          ...currentTotals,
          startedRemaining: nextStats.remainingTracks,
        }));
        setProgress(nextStats.remainingTracks === 0 ? 100 : 0);
        setStatusText(
          nextStats.remainingTracks === 0
            ? "All track metadata is already enriched."
            : `Ready to process up to ${nextStats.batchSize.toLocaleString()} tracks per request.`,
        );
        setRunState("idle");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRunState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load enrichment stats.",
        );
        setStatusText("Could not load enrichment status.");
      }
    }

    initialize().catch(() => {
      if (cancelled) {
        return;
      }

      setAuthState("redirecting");
      router.replace("/api/auth/signin?callbackUrl=%2Fenrich");
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function refreshStats() {
    setRunState("loading");
    setErrorMessage(null);

    try {
      const nextStats = await fetchEnrichmentStats();

      setStats(nextStats);
      setProgress(
        totals.startedRemaining === 0
          ? nextStats.remainingTracks === 0
            ? 100
            : 0
          : calculateProgress(totals.startedRemaining, nextStats.remainingTracks),
      );
      setStatusText(
        nextStats.remainingTracks === 0
          ? "All track metadata is already enriched."
          : `Ready to process up to ${nextStats.batchSize.toLocaleString()} tracks per request.`,
      );
      setRunState("idle");
    } catch (error) {
      setRunState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to refresh enrichment stats.",
      );
      setStatusText("Could not refresh enrichment status.");
    }
  }

  async function handleEnrichment() {
    if (!stats || runState === "running") {
      return;
    }

    if (stats.remainingTracks === 0) {
      setProgress(100);
      setStatusText("All track metadata is already enriched.");
      setRunState("done");
      return;
    }

    const startedRemaining = stats.remainingTracks;
    let processedTotal = 0;
    let errorTotal = 0;
    let batchCount = 0;
    let latestStats = stats;

    setRunState("running");
    setErrorMessage(null);
    setTotals({
      processed: 0,
      errors: 0,
      batches: 0,
      startedRemaining,
    });
    setProgress(0);
    setStatusText(
      `Starting enrichment for ${startedRemaining.toLocaleString()} remaining tracks.`,
    );

    try {
      while (latestStats.remainingTracks > 0) {
        batchCount += 1;
        setStatusText(
          `Processing batch ${batchCount} of ${Math.max(
            1,
            Math.ceil(startedRemaining / latestStats.batchSize),
          )}.`,
        );

        const batchResult = await runEnrichmentBatch();

        processedTotal += batchResult.processed;
        errorTotal += batchResult.errors;

        setTotals({
          processed: processedTotal,
          errors: errorTotal,
          batches: batchCount,
          startedRemaining,
        });

        latestStats = await fetchEnrichmentStats();
        setStats(latestStats);
        setProgress(
          calculateProgress(startedRemaining, latestStats.remainingTracks),
        );

        if (latestStats.remainingTracks === 0) {
          setStatusText("Enrichment completed.");
          setRunState("done");
          setProgress(100);
          return;
        }

        if (batchResult.processed === 0) {
          setRunState("error");
          setErrorMessage(
            errorTotal > 0
              ? "Enrichment stopped because the next batch could not be processed."
              : "No additional tracks were processed. Check the server logs for details.",
          );
          setStatusText(
            `${latestStats.remainingTracks.toLocaleString()} tracks are still missing metadata.`,
          );
          return;
        }

        setStatusText(
          `Processed ${processedTotal.toLocaleString()} tracks so far. ${latestStats.remainingTracks.toLocaleString()} remaining.`,
        );
      }

      setRunState("done");
      setProgress(100);
      setStatusText("Enrichment completed.");
    } catch (error) {
      setRunState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Enrichment failed.",
      );
      setStatusText("Enrichment failed.");
    }
  }

  if (authState !== "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
        <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 text-center shadow-2xl shadow-black/30">
          <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
          <h1 className="text-2xl font-semibold">Checking session</h1>
          <p className="mt-3 text-sm text-zinc-400">
            You will be redirected to Spotify sign-in if needed.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900/85 p-8 shadow-2xl shadow-black/30">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
              <DatabaseZap className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                Spotify Enrichment
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                Enrich track metadata
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Pull album, artist, genre, popularity, and audio feature data
                from Spotify in safe 200-track batches until the metadata table
                is complete.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                History tracks
              </p>
              <p className="mt-3 text-4xl font-semibold text-zinc-100">
                {stats?.historyTracks.toLocaleString() ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                Metadata rows
              </p>
              <p className="mt-3 text-4xl font-semibold text-emerald-400">
                {stats?.metadataTracks.toLocaleString() ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                Remaining
              </p>
              <p className="mt-3 text-4xl font-semibold text-amber-200">
                {stats?.remainingTracks.toLocaleString() ?? "—"}
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-6">
            <div className="mb-3 flex items-center justify-between text-sm text-zinc-400">
              <span>{statusText}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-lime-400 to-teal-300 transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Processed this run
                </p>
                <p className="mt-2 text-3xl font-semibold text-zinc-100">
                  {totals.processed.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Batch calls
                </p>
                <p className="mt-2 text-3xl font-semibold text-zinc-100">
                  {totals.batches.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Errors
                </p>
                <p className="mt-2 text-3xl font-semibold text-rose-200">
                  {totals.errors.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleEnrichment}
              disabled={
                !stats ||
                runState === "loading" ||
                runState === "running" ||
                stats.remainingTracks === 0
              }
              className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              {runState === "running" ? "Enriching..." : "Start Enrichment"}
            </button>
            <button
              type="button"
              onClick={refreshStats}
              disabled={runState === "loading" || runState === "running"}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh counts
            </button>
            {stats ? (
              <span className="text-sm text-zinc-500">
                Max {stats.batchSize.toLocaleString()} tracks per request
              </span>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
