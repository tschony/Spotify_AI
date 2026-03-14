import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase";
import type { TrackMetadata } from "@/types/spotify";

export const dynamic = "force-dynamic";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const HISTORY_SCAN_PAGE_SIZE = 5000;
const METADATA_LOOKUP_BATCH_SIZE = 400;
const SPOTIFY_BATCH_SIZE = 50;
const ENRICHMENT_LIMIT = 200;

type SessionWithSpotify = Session & {
  accessToken?: string;
};

type EnrichCountsResponse = {
  historyTracks: number;
  metadataTracks: number;
  remainingTracks: number;
  batchSize: number;
};

type EnrichResponse = {
  processed: number;
  errors: number;
};

type MetadataUpsert = Omit<TrackMetadata, "metadata_fetched_at"> & {
  metadata_fetched_at: string;
};

type UriRow = {
  spotify_track_uri: string | null;
};

type HistoryPage = {
  rowCount: number;
  uniqueUris: string[];
  nextCursor: string | null;
};

type TrackBatchItem = {
  spotifyTrackUri: string;
  trackId: string;
};

type SpotifyImage = {
  url: string;
};

type SpotifyAlbum = {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  images: SpotifyImage[];
};

type SpotifyTrackArtist = {
  id: string;
  name: string;
};

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  explicit: boolean;
  popularity: number;
  preview_url: string | null;
  track_number: number;
  duration_ms: number;
  album: SpotifyAlbum;
  artists: SpotifyTrackArtist[];
};

type SpotifyAudioFeatures = {
  id: string;
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  key: number;
  liveness: number;
  loudness: number;
  mode: number;
  speechiness: number;
  tempo: number;
  time_signature: number;
  valence: number;
};

type SpotifyArtist = {
  id: string;
  genres: string[];
  popularity: number;
  followers?: {
    total?: number;
  };
};

type SpotifyTracksResponse = {
  tracks: Array<SpotifyTrack | null>;
};

type SpotifyAudioFeaturesResponse = {
  audio_features: Array<SpotifyAudioFeatures | null>;
};

type SpotifyArtistsResponse = {
  artists: Array<SpotifyArtist | null>;
};

function createResponse<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getTrackIdFromUri(spotifyTrackUri: string) {
  const parts = spotifyTrackUri.split(":");

  if (parts.length !== 3) {
    return null;
  }

  const [platform, type, trackId] = parts;

  if (platform !== "spotify" || type !== "track" || !trackId) {
    return null;
  }

  return trackId;
}

function createPlaceholderMetadataRow(
  spotifyTrackUri: string,
  fetchedAt: string,
): MetadataUpsert {
  return {
    spotify_track_uri: spotifyTrackUri,
    track_name: null,
    artist_name: null,
    artist_id: null,
    album_name: null,
    album_id: null,
    album_type: null,
    release_date: null,
    duration_ms: null,
    explicit: null,
    popularity: null,
    preview_url: null,
    track_number: null,
    album_image_url: null,
    tempo: null,
    key: null,
    mode: null,
    danceability: null,
    energy: null,
    valence: null,
    acousticness: null,
    instrumentalness: null,
    liveness: null,
    speechiness: null,
    loudness: null,
    time_signature: null,
    genres: null,
    artist_popularity: null,
    artist_followers: null,
    metadata_fetched_at: fetchedAt,
  };
}

function buildMetadataRow(
  spotifyTrackUri: string,
  track: SpotifyTrack,
  audioFeatures: SpotifyAudioFeatures | null,
  artist: SpotifyArtist | null,
  fetchedAt: string,
): MetadataUpsert {
  const primaryArtist = track.artists[0] ?? null;

  return {
    spotify_track_uri: spotifyTrackUri,
    track_name: track.name ?? null,
    artist_name: primaryArtist?.name ?? null,
    artist_id: primaryArtist?.id ?? null,
    album_name: track.album?.name ?? null,
    album_id: track.album?.id ?? null,
    album_type: track.album?.album_type ?? null,
    release_date: track.album?.release_date ?? null,
    duration_ms: track.duration_ms ?? null,
    explicit: track.explicit ?? null,
    popularity: track.popularity ?? null,
    preview_url: track.preview_url ?? null,
    track_number: track.track_number ?? null,
    album_image_url: track.album?.images?.[0]?.url ?? null,
    tempo: audioFeatures?.tempo ?? null,
    key: audioFeatures?.key ?? null,
    mode: audioFeatures?.mode ?? null,
    danceability: audioFeatures?.danceability ?? null,
    energy: audioFeatures?.energy ?? null,
    valence: audioFeatures?.valence ?? null,
    acousticness: audioFeatures?.acousticness ?? null,
    instrumentalness: audioFeatures?.instrumentalness ?? null,
    liveness: audioFeatures?.liveness ?? null,
    speechiness: audioFeatures?.speechiness ?? null,
    loudness: audioFeatures?.loudness ?? null,
    time_signature: audioFeatures?.time_signature ?? null,
    genres: artist?.genres ?? null,
    artist_popularity: artist?.popularity ?? null,
    artist_followers: artist?.followers?.total ?? null,
    metadata_fetched_at: fetchedAt,
  };
}

async function spotifyFetch<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? JSON.stringify(payload.error)
        : response.statusText;

    throw new Error(`Spotify API request failed: ${response.status} ${message}`);
  }

  return payload as T;
}

async function getMetadataTrackCount(supabase: SupabaseClient) {
  const { count, error } = await supabase
    .from("spotify_track_metadata")
    .select("spotify_track_uri", {
      count: "exact",
      head: true,
    });

  if (error) {
    throw new Error(`Failed to count track metadata rows: ${error.message}`);
  }

  return count ?? 0;
}

async function getExistingMetadataUris(
  supabase: SupabaseClient,
  spotifyTrackUris: string[],
) {
  const existingUris = new Set<string>();

  for (const uriBatch of chunkArray(spotifyTrackUris, METADATA_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("spotify_track_metadata")
      .select("spotify_track_uri")
      .in("spotify_track_uri", uriBatch);

    if (error) {
      throw new Error(`Failed to inspect track metadata rows: ${error.message}`);
    }

    for (const row of (data ?? []) as UriRow[]) {
      if (row.spotify_track_uri) {
        existingUris.add(row.spotify_track_uri);
      }
    }
  }

  return existingUris;
}

async function getDistinctHistoryPage(
  supabase: SupabaseClient,
  cursor: string | null,
): Promise<HistoryPage> {
  let query = supabase
    .from("spotify_listening_history")
    .select("spotify_track_uri")
    .not("spotify_track_uri", "is", null)
    .order("spotify_track_uri", { ascending: true })
    .limit(HISTORY_SCAN_PAGE_SIZE);

  if (cursor) {
    query = query.gt("spotify_track_uri", cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to scan listening history: ${error.message}`);
  }

  const rows = (data ?? []) as UriRow[];

  if (rows.length === 0) {
    return {
      rowCount: 0,
      uniqueUris: [],
      nextCursor: null,
    };
  }

  const uniqueUris: string[] = [];
  let nextCursor = cursor;

  for (const row of rows) {
    const spotifyTrackUri = row.spotify_track_uri?.trim() ?? null;

    if (!spotifyTrackUri || spotifyTrackUri === nextCursor) {
      continue;
    }

    uniqueUris.push(spotifyTrackUri);
    nextCursor = spotifyTrackUri;
  }

  return {
    rowCount: rows.length,
    uniqueUris,
    nextCursor,
  };
}

async function countDistinctHistoryTracksAndRemaining(
  supabase: SupabaseClient,
) {
  let cursor: string | null = null;
  let historyTracks = 0;
  let remainingTracks = 0;

  while (true) {
    const page = await getDistinctHistoryPage(supabase, cursor);

    if (page.rowCount === 0) {
      break;
    }

    if (page.uniqueUris.length > 0) {
      const existingUris = await getExistingMetadataUris(
        supabase,
        page.uniqueUris,
      );

      historyTracks += page.uniqueUris.length;

      for (const spotifyTrackUri of page.uniqueUris) {
        if (!existingUris.has(spotifyTrackUri)) {
          remainingTracks += 1;
        }
      }
    }

    if (page.rowCount < HISTORY_SCAN_PAGE_SIZE || !page.nextCursor) {
      break;
    }

    cursor = page.nextCursor;
  }

  return {
    historyTracks,
    remainingTracks,
  };
}

async function collectMissingTrackUris(
  supabase: SupabaseClient,
  limit: number,
) {
  const missingTrackUris: string[] = [];
  let cursor: string | null = null;

  while (missingTrackUris.length < limit) {
    const page = await getDistinctHistoryPage(supabase, cursor);

    if (page.rowCount === 0) {
      break;
    }

    if (page.uniqueUris.length > 0) {
      const existingUris = await getExistingMetadataUris(
        supabase,
        page.uniqueUris,
      );

      for (const spotifyTrackUri of page.uniqueUris) {
        if (!existingUris.has(spotifyTrackUri)) {
          missingTrackUris.push(spotifyTrackUri);
        }

        if (missingTrackUris.length >= limit) {
          break;
        }
      }
    }

    if (
      missingTrackUris.length >= limit ||
      page.rowCount < HISTORY_SCAN_PAGE_SIZE ||
      !page.nextCursor
    ) {
      break;
    }

    cursor = page.nextCursor;
  }

  return missingTrackUris;
}

async function fetchArtistMap(
  accessToken: string,
  tracks: Array<SpotifyTrack | null>,
) {
  const artistIds = Array.from(
    new Set(
      tracks.flatMap((track) =>
        (track?.artists ?? [])
          .map((artist) => artist.id)
          .filter((artistId): artistId is string => Boolean(artistId)),
      ),
    ),
  );
  const artistMap = new Map<string, SpotifyArtist>();

  for (const artistIdBatch of chunkArray(artistIds, SPOTIFY_BATCH_SIZE)) {
    try {
      const response = await spotifyFetch<SpotifyArtistsResponse>(
        accessToken,
        `/artists?ids=${artistIdBatch.join(",")}`,
      );

      for (const artist of response.artists ?? []) {
        if (artist?.id) {
          artistMap.set(artist.id, artist);
        }
      }
    } catch (error) {
      console.error("Failed to fetch Spotify artists batch", error);
    }
  }

  return artistMap;
}

async function buildMetadataRows(
  accessToken: string,
  missingTrackUris: string[],
) {
  const fetchedAt = new Date().toISOString();
  const rowsToUpsert: MetadataUpsert[] = [];
  const validTrackBatchItems: TrackBatchItem[] = [];
  let errors = 0;

  for (const spotifyTrackUri of missingTrackUris) {
    const trackId = getTrackIdFromUri(spotifyTrackUri);

    if (!trackId) {
      rowsToUpsert.push(
        createPlaceholderMetadataRow(spotifyTrackUri, fetchedAt),
      );
      continue;
    }

    validTrackBatchItems.push({
      spotifyTrackUri,
      trackId,
    });
  }

  for (const trackBatch of chunkArray(validTrackBatchItems, SPOTIFY_BATCH_SIZE)) {
    const trackIds = trackBatch.map((item) => item.trackId);
    const [tracksResult, audioFeaturesResult] = await Promise.allSettled([
      spotifyFetch<SpotifyTracksResponse>(
        accessToken,
        `/tracks?ids=${trackIds.join(",")}`,
      ),
      spotifyFetch<SpotifyAudioFeaturesResponse>(
        accessToken,
        `/audio-features?ids=${trackIds.join(",")}`,
      ),
    ]);

    if (tracksResult.status === "rejected") {
      console.error("Failed to fetch Spotify tracks batch", tracksResult.reason);
      errors += trackBatch.length;
      continue;
    }

    if (audioFeaturesResult.status === "rejected") {
      console.error(
        "Failed to fetch Spotify audio features batch",
        audioFeaturesResult.reason,
      );
    }

    const tracks = tracksResult.value.tracks ?? [];
    const audioFeatures =
      audioFeaturesResult.status === "fulfilled"
        ? (audioFeaturesResult.value.audio_features ?? [])
        : [];
    const artistMap = await fetchArtistMap(accessToken, tracks);

    for (const [index, item] of trackBatch.entries()) {
      const track = tracks[index] ?? null;

      if (!track) {
        rowsToUpsert.push(
          createPlaceholderMetadataRow(item.spotifyTrackUri, fetchedAt),
        );
        continue;
      }

      rowsToUpsert.push(
        buildMetadataRow(
          item.spotifyTrackUri,
          track,
          audioFeatures[index] ?? null,
          (track.artists[0] && artistMap.get(track.artists[0].id)) ?? null,
          fetchedAt,
        ),
      );
    }
  }

  return {
    rowsToUpsert,
    errors,
  };
}

export const GET = auth(async (request) => {
  if (!request.auth) {
    return createResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabaseServiceRoleClient();

  try {
    const metadataTracks = await getMetadataTrackCount(supabase);
    const { historyTracks, remainingTracks } =
      await countDistinctHistoryTracksAndRemaining(supabase);

    return createResponse<EnrichCountsResponse>({
      historyTracks,
      metadataTracks,
      remainingTracks,
      batchSize: ENRICHMENT_LIMIT,
    });
  } catch (error) {
    console.error("Failed to load enrichment counts", error);

    return createResponse({ error: "Failed to load enrichment counts." }, 500);
  }
});

export const POST = auth(async (request) => {
  if (!request.auth) {
    return createResponse<EnrichResponse>(
      {
        processed: 0,
        errors: 1,
      },
      401,
    );
  }

  const session = request.auth as SessionWithSpotify;

  if (!session.accessToken) {
    return createResponse<EnrichResponse>(
      {
        processed: 0,
        errors: 1,
      },
      400,
    );
  }

  const supabase = getSupabaseServiceRoleClient();

  try {
    const missingTrackUris = await collectMissingTrackUris(
      supabase,
      ENRICHMENT_LIMIT,
    );

    if (missingTrackUris.length === 0) {
      return createResponse<EnrichResponse>({
        processed: 0,
        errors: 0,
      });
    }

    const { rowsToUpsert, errors: fetchErrors } = await buildMetadataRows(
      session.accessToken,
      missingTrackUris,
    );
    let processed = 0;
    let errors = fetchErrors;

    for (const metadataBatch of chunkArray(rowsToUpsert, ENRICHMENT_LIMIT)) {
      const { error } = await supabase
        .from("spotify_track_metadata")
        .upsert(metadataBatch, {
          onConflict: "spotify_track_uri",
        });

      if (error) {
        console.error("Failed to upsert Spotify track metadata batch", error);
        errors += metadataBatch.length;
        continue;
      }

      processed += metadataBatch.length;
    }

    return createResponse<EnrichResponse>({
      processed,
      errors,
    });
  } catch (error) {
    console.error("Spotify enrichment failed", error);

    return createResponse<EnrichResponse>(
      {
        processed: 0,
        errors: ENRICHMENT_LIMIT,
      },
      500,
    );
  }
});
