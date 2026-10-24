/**
 * MovieNight Native Scraper & Stream Resolver
 * Reverse-engineered from https://movienig.ht/
 *
 * Supported Native Server Clusters:
 * - Salem (Cinejoy / Wing 1080p/4K Direct Master HLS)
 * - VixSrc (Newport Beach - Multi-language audio HLS)
 * - Zurich / Austin / Vienna (Failover high-speed HLS clusters)
 */

export interface MovieNightSource {
  url: string;
  quality?: string;
  type?: string;
}

export interface MovieNightSubtitle {
  label: string;
  lang: string;
  url: string;
  default?: boolean;
}

export interface MovieNightResolution {
  success: boolean;
  server: string;
  streamUrl?: string;
  rawUrl?: string;
  quality?: string;
  subtitles?: MovieNightSubtitle[];
  error?: string;
}

const MOVIENIGHT_BASE = "https://movienig.ht";
const TMDB_API_KEY = "cd02d9e0ed072fcea61ee0d7199ea48e";

const MOVIENIGHT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://movienig.ht/",
  Origin: "https://movienig.ht",
  Accept: "application/json, text/plain, */*",
};

// Cache for TMDB ID -> IMDB ID mapping
const imdbCache = new Map<string, string>();

/**
 * Resolves external IMDB ID for a TMDB ID
 */
export async function getImdbId(tmdbId: string | number, type: "movie" | "tv" = "movie", explicitImdbId?: string): Promise<string | null> {
  if (explicitImdbId && explicitImdbId.startsWith("tt")) {
    return explicitImdbId;
  }

  const cacheKey = `${type}:${tmdbId}`;
  if (imdbCache.has(cacheKey)) {
    return imdbCache.get(cacheKey)!;
  }

  // If already an IMDB ID
  if (String(tmdbId).startsWith("tt")) {
    return String(tmdbId);
  }

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.imdb_id) {
        imdbCache.set(cacheKey, data.imdb_id);
        return data.imdb_id;
      }
    }
  } catch (err) {
    console.error(`[MovieNight] Failed to fetch IMDB ID for ${type} ${tmdbId}:`, err);
  }

  return null;
}

/**
 * Resolves title / year from TMDB if not provided
 */
async function getMediaMeta(tmdbId: string | number, type: "movie" | "tv"): Promise<{ title: string; year?: string }> {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = await res.json();
      const title = data?.title || data?.name || "";
      const releaseDate = data?.release_date || data?.first_air_date || "";
      const year = releaseDate ? releaseDate.split("-")[0] : undefined;
      return { title, year };
    }
  } catch {}
  return { title: "" };
}

/**
 * Resolves direct HLS stream from MovieNight backend
 */
export async function resolveMovieNightStream(
  tmdbId: string | number,
  type: "movie" | "tv" = "movie",
  season: string | number = 1,
  episode: string | number = 1,
  title?: string,
  preferredServer?: string,
  explicitImdbId?: string,
  year?: string
): Promise<MovieNightResolution> {
  try {
    // 1. Get IMDB ID
    const imdbId = await getImdbId(tmdbId, type, explicitImdbId);
    if (!imdbId) {
      return { success: false, server: preferredServer || "movienight", error: "Could not find IMDB ID" };
    }

    // 2. Ensure title and year exist
    let mediaTitle = title;
    let mediaYear = year;
    if (!mediaTitle || !mediaYear) {
      const meta = await getMediaMeta(tmdbId, type);
      if (!mediaTitle) mediaTitle = meta.title;
      if (!mediaYear) mediaYear = meta.year;
    }

    // 3. Build endpoint
    let endpoint =
      type === "tv"
        ? `${MOVIENIGHT_BASE}/api/stream/v1/tv/${imdbId}/${season}/${episode}?tmdbId=${tmdbId}&title=${encodeURIComponent(
            mediaTitle || ""
          )}`
        : `${MOVIENIGHT_BASE}/api/stream/v1/movie/${imdbId}?tmdbId=${tmdbId}&title=${encodeURIComponent(
            mediaTitle || ""
          )}`;

    if (mediaYear) {
      endpoint += `&year=${mediaYear}`;
    }

    if (preferredServer) {
      endpoint += `&server=${encodeURIComponent(preferredServer)}`;
    }

    const headers = {
      ...MOVIENIGHT_HEADERS,
      Referer: `${MOVIENIGHT_BASE}/watch/${type === "tv" ? "tv" : "movie"}/${imdbId}`,
    };

    const res = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return {
        success: false,
        server: preferredServer || "movienight",
        error: `MovieNight returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const sources: MovieNightSource[] = data?.sources || [];
    if (!sources || sources.length === 0 || !sources[0]?.url) {
      return {
        success: false,
        server: preferredServer || "movienight",
        error: data?.error || "No playable stream sources returned",
      };
    }

    const bestSource = sources[0];
    const rawStreamUrl = bestSource.url;

    // Subtitles normalization
    const subtitles: MovieNightSubtitle[] = (data?.subtitles || [])
      .filter((s: any) => s?.url || s?.file)
      .map((s: any) => ({
        label: s.label || s.language || "English",
        lang: (s.lang || s.language || "en").toLowerCase().slice(0, 2),
        url: s.url || s.file,
        default: Boolean(s.default),
      }));

    // Wrap in our internal CORS proxy with proper referer
    const proxiedStreamUrl = `/api/stream/proxy?url=${encodeURIComponent(
      rawStreamUrl
    )}&referer=${encodeURIComponent("https://movienig.ht/")}&origin=${encodeURIComponent(
      "https://movienig.ht"
    )}`;

    return {
      success: true,
      server: data.server || preferredServer || "salem",
      streamUrl: proxiedStreamUrl,
      rawUrl: rawStreamUrl,
      quality: bestSource.quality || "auto",
      subtitles,
    };
  } catch (err: any) {
    return {
      success: false,
      server: preferredServer || "movienight",
      error: err?.message || "Failed to resolve stream from MovieNight cluster",
    };
  }
}
