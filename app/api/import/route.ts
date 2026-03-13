import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase";
import type { ListeningHistory, SpotifyStreamingEntry } from "@/types/spotify";

const BATCH_SIZE = 500;

type ImportRequestBody = {
  data: SpotifyStreamingEntry[];
};

type ImportResponse = {
  inserted: number;
  skipped: number;
  errors: string[];
};

type ListeningHistoryInsert = Omit<
  ListeningHistory,
  "id" | "created_at" | "spotify_track_uri"
> & {
  spotify_track_uri: string;
};

type NormalizedEntryResult =
  | { kind: "record"; record: ListeningHistoryInsert }
  | { kind: "skip" }
  | { kind: "invalid" };

function createResponse(
  body: ImportResponse,
  status = 200,
) {
  return NextResponse.json(body, { status });
}

function buildEntryKey(ts: string, spotifyTrackUri: string) {
  return `${ts}::${spotifyTrackUri}`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeTimestamp(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeEntry(entry: SpotifyStreamingEntry): NormalizedEntryResult {
  const spotifyTrackUri = entry.spotify_track_uri?.trim();

  if (!spotifyTrackUri) {
    return { kind: "skip" };
  }

  const ts = normalizeTimestamp(entry.ts);
  const msPlayed = Number(entry.ms_played);

  if (!ts || !Number.isFinite(msPlayed)) {
    return { kind: "invalid" };
  }

  return {
    kind: "record",
    record: {
      ts,
      platform: entry.platform ?? null,
      ms_played: msPlayed,
      conn_country: entry.conn_country ?? null,
      track_name: entry.track_name ?? entry.master_metadata_track_name ?? null,
      artist_name:
        entry.artist_name ?? entry.master_metadata_album_artist_name ?? null,
      album_name:
        entry.album_name ?? entry.master_metadata_album_album_name ?? null,
      spotify_track_uri: spotifyTrackUri,
      episode_name: entry.episode_name ?? null,
      episode_show_name: entry.episode_show_name ?? null,
      reason_start: entry.reason_start ?? null,
      reason_end: entry.reason_end ?? null,
      shuffle: entry.shuffle ?? null,
      skipped: entry.skipped ?? null,
      offline: entry.offline ?? null,
      incognito_mode: entry.incognito_mode ?? null,
    },
  };
}

export const POST = auth(async (request) => {
  if (!request.auth) {
    return createResponse(
      {
        inserted: 0,
        skipped: 0,
        errors: ["Unauthorized"],
      },
      401,
    );
  }

  let body: Partial<ImportRequestBody>;

  try {
    body = (await request.json()) as Partial<ImportRequestBody>;
  } catch {
    return createResponse(
      {
        inserted: 0,
        skipped: 0,
        errors: ["Request body must be valid JSON."],
      },
      400,
    );
  }

  if (!Array.isArray(body.data)) {
    return createResponse(
      {
        inserted: 0,
        skipped: 0,
        errors: ["Request body must match { data: SpotifyStreamingEntry[] }."],
      },
      400,
    );
  }

  const errors: string[] = [];
  let skipped = 0;
  let inserted = 0;
  let invalidCount = 0;
  const dedupedEntries = new Map<string, ListeningHistoryInsert>();

  for (const entry of body.data) {
    const normalized = normalizeEntry(entry);

    if (normalized.kind === "skip") {
      skipped += 1;
      continue;
    }

    if (normalized.kind === "invalid") {
      skipped += 1;
      invalidCount += 1;
      continue;
    }

    const key = buildEntryKey(
      normalized.record.ts,
      normalized.record.spotify_track_uri,
    );

    if (dedupedEntries.has(key)) {
      skipped += 1;
      continue;
    }

    dedupedEntries.set(key, normalized.record);
  }

  if (invalidCount > 0) {
    errors.push(
      `${invalidCount} entries were skipped because they were missing a valid timestamp or ms_played value.`,
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const batches = chunkArray(Array.from(dedupedEntries.values()), BATCH_SIZE);

  for (const [batchIndex, batch] of batches.entries()) {
    const trackUris = Array.from(
      new Set(batch.map((entry) => entry.spotify_track_uri)),
    );

    const timestamps = batch.map((entry) => entry.ts);
    const minTs = timestamps.reduce((min, current) =>
      current < min ? current : min,
    );
    const maxTs = timestamps.reduce((max, current) =>
      current > max ? current : max,
    );

    const { data: existingRows, error: existingRowsError } = await supabase
      .from("spotify_listening_history")
      .select("ts, spotify_track_uri")
      .in("spotify_track_uri", trackUris)
      .gte("ts", minTs)
      .lte("ts", maxTs);

    if (existingRowsError) {
      errors.push(
        `Batch ${batchIndex + 1}: failed to inspect existing rows (${existingRowsError.message}).`,
      );
      continue;
    }

    const existingKeys = new Set(
      (existingRows ?? []).map((row) => buildEntryKey(row.ts, row.spotify_track_uri)),
    );

    const rowsToInsert = batch.filter(
      (entry) =>
        !existingKeys.has(buildEntryKey(entry.ts, entry.spotify_track_uri)),
    );

    skipped += batch.length - rowsToInsert.length;

    if (rowsToInsert.length === 0) {
      continue;
    }

    const { error: upsertError } = await supabase
      .from("spotify_listening_history")
      .upsert(rowsToInsert, {
        onConflict: "ts,spotify_track_uri",
        ignoreDuplicates: true,
      });

    if (upsertError) {
      errors.push(
        `Batch ${batchIndex + 1}: ${upsertError.message}. Ensure a unique constraint exists on (ts, spotify_track_uri).`,
      );
      continue;
    }

    inserted += rowsToInsert.length;
  }

  return createResponse({
    inserted,
    skipped,
    errors,
  });
});
