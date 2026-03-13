/*
CREATE TABLE spotify_listening_history (
  id                    BIGSERIAL PRIMARY KEY,
  ts                    TIMESTAMPTZ NOT NULL,
  platform              TEXT,
  ms_played             INTEGER NOT NULL,
  conn_country          TEXT,
  track_name            TEXT,
  artist_name           TEXT,
  album_name            TEXT,
  spotify_track_uri     TEXT,
  episode_name          TEXT,
  episode_show_name     TEXT,
  reason_start          TEXT,
  reason_end            TEXT,
  shuffle               BOOLEAN,
  skipped               BOOLEAN,
  offline               BOOLEAN,
  incognito_mode        BOOLEAN,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slh_ts ON spotify_listening_history(ts);
CREATE INDEX idx_slh_artist ON spotify_listening_history(artist_name);
CREATE INDEX idx_slh_uri ON spotify_listening_history(spotify_track_uri);

CREATE TABLE spotify_track_metadata (
  spotify_track_uri     TEXT PRIMARY KEY,
  track_name            TEXT,
  artist_name           TEXT,
  artist_id             TEXT,
  album_name            TEXT,
  album_id              TEXT,
  album_type            TEXT,
  release_date          TEXT,
  duration_ms           INTEGER,
  explicit              BOOLEAN,
  popularity            INTEGER,
  preview_url           TEXT,
  track_number          INTEGER,
  album_image_url       TEXT,
  tempo                 FLOAT,
  key                   INTEGER,
  mode                  INTEGER,
  danceability          FLOAT,
  energy                FLOAT,
  valence               FLOAT,
  acousticness          FLOAT,
  instrumentalness      FLOAT,
  liveness              FLOAT,
  speechiness           FLOAT,
  loudness              FLOAT,
  time_signature        INTEGER,
  genres                TEXT[],
  artist_popularity     INTEGER,
  artist_followers      INTEGER,
  metadata_fetched_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stm_genres ON spotify_track_metadata USING GIN(genres);
CREATE INDEX idx_stm_artist_id ON spotify_track_metadata(artist_id);

CREATE TABLE spotify_recent_plays (
  id                    BIGSERIAL PRIMARY KEY,
  played_at             TIMESTAMPTZ NOT NULL UNIQUE,
  track_name            TEXT,
  artist_name           TEXT,
  album_name            TEXT,
  spotify_track_uri     TEXT,
  duration_ms           INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE spotify_playlists (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id   TEXT,
  title                 TEXT NOT NULL,
  description           TEXT,
  cover_image_url       TEXT,
  track_uris            TEXT[],
  created_by_ai         BOOLEAN DEFAULT FALSE,
  ai_prompt             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
*/

export interface ListeningHistory {
  id: number;
  ts: string;
  platform: string | null;
  ms_played: number;
  conn_country: string | null;
  track_name: string | null;
  artist_name: string | null;
  album_name: string | null;
  spotify_track_uri: string | null;
  episode_name: string | null;
  episode_show_name: string | null;
  reason_start: string | null;
  reason_end: string | null;
  shuffle: boolean | null;
  skipped: boolean | null;
  offline: boolean | null;
  incognito_mode: boolean | null;
  created_at: string | null;
}

export interface TrackMetadata {
  spotify_track_uri: string;
  track_name: string | null;
  artist_name: string | null;
  artist_id: string | null;
  album_name: string | null;
  album_id: string | null;
  album_type: string | null;
  release_date: string | null;
  duration_ms: number | null;
  explicit: boolean | null;
  popularity: number | null;
  preview_url: string | null;
  track_number: number | null;
  album_image_url: string | null;
  tempo: number | null;
  key: number | null;
  mode: number | null;
  danceability: number | null;
  energy: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  speechiness: number | null;
  loudness: number | null;
  time_signature: number | null;
  genres: string[] | null;
  artist_popularity: number | null;
  artist_followers: number | null;
  metadata_fetched_at: string | null;
}

export interface RecentPlay {
  id: number;
  played_at: string;
  track_name: string | null;
  artist_name: string | null;
  album_name: string | null;
  spotify_track_uri: string | null;
  duration_ms: number | null;
  created_at: string | null;
}

export interface Playlist {
  id: string;
  spotify_playlist_id: string | null;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  track_uris: string[] | null;
  created_by_ai: boolean | null;
  ai_prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SpotifyStreamingEntry {
  ts: string;
  platform?: string | null;
  ms_played: number;
  conn_country?: string | null;
  track_name?: string | null;
  artist_name?: string | null;
  album_name?: string | null;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  episode_name?: string | null;
  episode_show_name?: string | null;
  reason_start?: string | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  skipped?: boolean | null;
  offline?: boolean | null;
  incognito_mode?: boolean | null;
}
