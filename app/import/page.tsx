"use client";

import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { FileJson, ShieldCheck, Upload } from "lucide-react";
import { getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { SpotifyStreamingEntry } from "@/types/spotify";

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: string[];
};

type AuthState = "checking" | "ready" | "redirecting";
type UploadState = "idle" | "uploading" | "done" | "error";

function uploadImportData(
  data: SpotifyStreamingEntry[],
  onProgress: (progress: number) => void,
) {
  return new Promise<ImportResult>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/api/import");
    request.responseType = "json";
    request.setRequestHeader("Content-Type", "application/json");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    request.onerror = () => {
      reject(new Error("Upload failed."));
    };

    request.onload = () => {
      const response = request.response as ImportResult | null;

      if (request.status >= 200 && request.status < 300 && response) {
        resolve(response);
        return;
      }

      const message =
        response?.errors?.[0] ??
        `Import failed with status ${request.status}.`;

      reject(new Error(message));
    };

    request.send(JSON.stringify({ data }));
  });
}

export default function ImportPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Select Spotify export files.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const session = await getSession();

      if (cancelled) {
        return;
      }

      if (!session) {
        setAuthState("redirecting");
        window.location.replace(
          "/api/auth/signin?callbackUrl=%2Fimport",
        );
        return;
      }

      setAuthState("ready");
    }

    checkSession().catch(() => {
      if (cancelled) {
        return;
      }

      setAuthState("redirecting");
      router.replace("/api/auth/signin?callbackUrl=%2Fimport");
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setErrorMessage(null);
    setResult(null);
    setProgress(0);
    setStatusText("Files selected and ready to import.");
  }

  async function handleImport() {
    if (files.length === 0 || uploadState === "uploading") {
      return;
    }

    setUploadState("uploading");
    setErrorMessage(null);
    setResult(null);
    setProgress(0);

    try {
      const mergedEntries: SpotifyStreamingEntry[] = [];

      for (const [index, file] of files.entries()) {
        setStatusText(`Parsing ${file.name}`);

        const content = await file.text();
        const parsed = JSON.parse(content) as unknown;

        if (!Array.isArray(parsed)) {
          throw new Error(`${file.name} does not contain a JSON array.`);
        }

        mergedEntries.push(...(parsed as SpotifyStreamingEntry[]));
        setProgress(Math.round(((index + 1) / files.length) * 30));
      }

      setStatusText(
        `Uploading ${mergedEntries.length.toLocaleString()} entries to Supabase`,
      );

      const importResult = await uploadImportData(mergedEntries, (fraction) => {
        setProgress(30 + Math.round(fraction * 70));
      });

      setProgress(100);
      setStatusText("Import completed.");
      setResult(importResult);
      setUploadState("done");
    } catch (error) {
      setUploadState("error");
      setStatusText("Import failed.");
      setErrorMessage(
        error instanceof Error ? error.message : "Import failed.",
      );
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
              <Upload className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                Spotify Import
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                Import listening history
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Upload one or more Spotify streaming history JSON files. The app
                merges all arrays, skips non-track entries, and imports records
                in safe batches.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/70 p-6">
            <label
              htmlFor="spotify-import-files"
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-10 text-center transition hover:border-emerald-500/50 hover:bg-zinc-900/70"
            >
              <FileJson className="h-10 w-10 text-zinc-500" />
              <span className="mt-4 text-lg font-medium">
                Choose Spotify JSON exports
              </span>
              <span className="mt-2 text-sm text-zinc-400">
                Multiple files are supported.
              </span>
            </label>
            <input
              id="spotify-import-files"
              type="file"
              accept=".json,application/json"
              multiple
              className="sr-only"
              onChange={handleFileSelection}
            />

            <div className="mt-5 flex flex-wrap gap-2">
              {files.length === 0 ? (
                <span className="rounded-full border border-zinc-800 px-3 py-1 text-sm text-zinc-500">
                  No files selected
                </span>
              ) : (
                files.map((file) => (
                  <span
                    key={`${file.name}-${file.size}`}
                    className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-300"
                  >
                    {file.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="mt-8">
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
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleImport}
              disabled={files.length === 0 || uploadState === "uploading"}
              className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              {uploadState === "uploading" ? "Importing..." : "Start import"}
            </button>
            <span className="text-sm text-zinc-500">
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </span>
          </div>

          {errorMessage ? (
            <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          {result ? (
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                  Inserted
                </p>
                <p className="mt-3 text-4xl font-semibold text-emerald-400">
                  {result.inserted.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                  Skipped
                </p>
                <p className="mt-3 text-4xl font-semibold text-zinc-100">
                  {result.skipped.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 md:col-span-2">
                <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                  Errors
                </p>
                {result.errors.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-400">No import errors.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-amber-200">
                    {result.errors.map((error) => (
                      <li key={error} className="rounded-xl bg-amber-500/10 p-3">
                        {error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
