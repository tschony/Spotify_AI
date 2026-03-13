import type { Session } from "next-auth";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Spotify from "next-auth/providers/spotify";

const spotifyScopes = [
  "user-read-recently-played",
  "user-read-playback-state",
  "user-top-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "ugc-image-upload",
];

type SpotifyToken = JWT & {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  error?: "RefreshTokenError";
};

type SessionWithSpotify = Session & {
  accessToken?: string;
  error?: "RefreshTokenError";
};

type SpotifyRefreshResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

async function refreshSpotifyAccessToken(
  token: SpotifyToken,
): Promise<SpotifyToken> {
  try {
    if (!token.refreshToken) {
      throw new TypeError("Missing Spotify refresh token");
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new TypeError("Missing Spotify client credentials");
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const tokensOrError = (await response.json()) as
      | SpotifyRefreshResponse
      | Record<string, unknown>;

    if (!response.ok) {
      throw tokensOrError;
    }

    const refreshedTokens = tokensOrError as SpotifyRefreshResponse;

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Math.floor(Date.now() / 1000 + refreshedTokens.expires_in),
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (error) {
    console.error("Error refreshing Spotify access token", error);

    return {
      ...token,
      error: "RefreshTokenError",
    };
  }
}

const authConfig = {
  session: {
    strategy: "jwt",
  },
  providers:
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
      ? [
          Spotify({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            authorization: {
              url: "https://accounts.spotify.com/authorize",
              params: {
                scope: spotifyScopes.join(" "),
              },
            },
          }),
        ]
      : [],
  callbacks: {
    async jwt({ token, account }) {
      const spotifyToken = token as SpotifyToken;

      if (account?.provider === "spotify") {
        return {
          ...spotifyToken,
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? spotifyToken.refreshToken,
          expiresAt:
            account.expires_at ??
            Math.floor(Date.now() / 1000 + (account.expires_in ?? 0)),
          error: undefined,
        };
      }

      if (!spotifyToken.expiresAt || Date.now() < spotifyToken.expiresAt * 1000) {
        return spotifyToken;
      }

      return refreshSpotifyAccessToken(spotifyToken);
    },
    async session({ session, token }) {
      const spotifySession = session as SessionWithSpotify;
      const spotifyToken = token as SpotifyToken;

      spotifySession.accessToken = spotifyToken.accessToken;
      spotifySession.error = spotifyToken.error;

      return spotifySession;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
} satisfies NextAuthConfig;

const { handlers } = NextAuth(authConfig);

export const { GET, POST } = handlers;
