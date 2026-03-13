const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

type SpotifyApiObject = Record<string, unknown>;

export interface SpotifyClient {
  getRecentlyPlayed(limit?: number): Promise<SpotifyApiObject>;
  getTrack(trackId: string): Promise<SpotifyApiObject>;
  getAudioFeatures(trackId: string): Promise<SpotifyApiObject>;
  getArtist(artistId: string): Promise<SpotifyApiObject>;
  searchTracks(query: string, limit?: number): Promise<SpotifyApiObject>;
  createPlaylist(
    userId: string,
    name: string,
    description: string,
  ): Promise<SpotifyApiObject>;
  addTracksToPlaylist(
    playlistId: string,
    uris: string[],
  ): Promise<SpotifyApiObject>;
  uploadPlaylistCover(playlistId: string, base64Image: string): Promise<void>;
}

async function spotifyFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | SpotifyApiObject
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? JSON.stringify(payload.error)
        : response.statusText;

    throw new Error(`Spotify API request failed: ${response.status} ${message}`);
  }

  return (payload ?? {}) as T;
}

export function getSpotifyClient(accessToken: string): SpotifyClient {
  return {
    getRecentlyPlayed(limit = 20) {
      const searchParams = new URLSearchParams({
        limit: String(limit),
      });

      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/me/player/recently-played?${searchParams.toString()}`,
      );
    },
    getTrack(trackId) {
      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/tracks/${encodeURIComponent(trackId)}`,
      );
    },
    getAudioFeatures(trackId) {
      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/audio-features/${encodeURIComponent(trackId)}`,
      );
    },
    getArtist(artistId) {
      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/artists/${encodeURIComponent(artistId)}`,
      );
    },
    searchTracks(query, limit = 20) {
      const searchParams = new URLSearchParams({
        q: query,
        type: "track",
        limit: String(limit),
      });

      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/search?${searchParams.toString()}`,
      );
    },
    createPlaylist(userId, name, description) {
      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/users/${encodeURIComponent(userId)}/playlists`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
          }),
        },
      );
    },
    addTracksToPlaylist(playlistId, uris) {
      return spotifyFetch<SpotifyApiObject>(
        accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/tracks`,
        {
          method: "POST",
          body: JSON.stringify({ uris }),
        },
      );
    },
    uploadPlaylistCover(playlistId, base64Image) {
      return spotifyFetch<void>(
        accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/images`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "image/jpeg",
          },
          body: base64Image,
        },
      );
    },
  };
}
