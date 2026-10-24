/**
 * K-Stream / Kdesa Scraper & Stream Resolver
 * Reverse-engineered from https://kdesa.stream/
 *
 * Supported Native High-Performance Servers:
 * 1. Anime Paradise (animeparadise / kstream_anime):
 *    - Direct Crunchyroll Master HLS (1080p Full HD)
 *    - Multi-language WebVTT subtitles (English, Spanish, Italian, Portuguese)
 *    - Accurate Intro / Outro skip timestamps
 *
 * 2. VidZee (vidzee / kstream_vidzee):
 *    - Direct FastCloud 1080p / 720p Master HLS (.m3u8)
 *    - Available for Movies & TV series
 */

export interface KStreamResolution {
  success: boolean;
  server: string;
  streamUrl?: string;
  rawUrl?: string;
  quality?: string;
  subtitles?: Array<{ label: string; lang: string; url: string; default?: boolean }>;
  skipData?: { intro?: { start: number; end: number }; outro?: { start: number; end: number } };
  error?: string;
}

const ANIME_PARADISE_API = "https://api.animeparadise.moe";
const ANIME_PARADISE_STREAM = "https://stream.animeparadise.moe";
const VIDZEE_API = "https://core.vidzee.wtf/streams";

const ANIME_PARADISE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Referer: "https://animeparadise.moe/",
  Origin: "https://animeparadise.moe",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const VIDZEE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Referer: "https://player.vidzee.wtf/",
  Origin: "https://player.vidzee.wtf",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

/**
 * Resolves an anime title from AnimeParadise (extracted from kdesa.stream)
 */
export async function resolveAnimeParadise(
  title: string,
  episode: number = 1
): Promise<KStreamResolution> {
  try {
    const cleanTitle = (title || "")
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/Season \d+/i, "")
      .trim();

    if (!cleanTitle) {
      return { success: false, server: "animeparadise", error: "Missing title" };
    }

    // 1. Search Anime
    const searchRes = await fetch(
      `${ANIME_PARADISE_API}/search?q=${encodeURIComponent(cleanTitle)}&limit=15`,
      {
        headers: ANIME_PARADISE_HEADERS,
        signal: AbortSignal.timeout(4000),
      }
    );

    if (!searchRes.ok) {
      return { success: false, server: "animeparadise", error: `Search HTTP ${searchRes.status}` };
    }

    const searchData = await searchRes.json();
    const items = searchData.data || [];
    if (!items || items.length === 0) {
      return { success: false, server: "animeparadise", error: "Title not found on AnimeParadise" };
    }

    // Pick best match: prefer item with episode count > 1 if episode > 1, or exact title
    const lowerClean = cleanTitle.toLowerCase();
    const matched =
      items.find((i: any) => {
        const t = (i.title || "").toLowerCase();
        const eng = (i.alternativeTitle?.english || "").toLowerCase();
        return t === lowerClean || eng === lowerClean;
      }) ||
      (episode > 1
        ? items.sort((a: any, b: any) => (b.episodes || 0) - (a.episodes || 0))[0]
        : items[0]);

    if (!matched?._id) {
      return { success: false, server: "animeparadise", error: "No matching anime ID" };
    }

    // 2. Fetch Episodes List
    const epRes = await fetch(`${ANIME_PARADISE_API}/anime/${matched._id}/episode`, {
      headers: ANIME_PARADISE_HEADERS,
      signal: AbortSignal.timeout(4000),
    });

    if (!epRes.ok) {
      return { success: false, server: "animeparadise", error: "Failed to fetch episodes" };
    }

    const epJson = await epRes.json();
    const episodes = epJson.data || [];
    const targetEp =
      episodes.find((e: any) => Number(e.number) === Number(episode)) || episodes[0];

    if (!targetEp?.uid) {
      return { success: false, server: "animeparadise", error: `Episode ${episode} not found` };
    }

    // 3. Fetch Stream Link & Subtitles
    const streamRes = await fetch(
      `${ANIME_PARADISE_API}/ep/${targetEp.uid}?origin=${matched._id}`,
      {
        headers: ANIME_PARADISE_HEADERS,
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!streamRes.ok) {
      return { success: false, server: "animeparadise", error: "Failed to resolve stream link" };
    }

    const streamJson = await streamRes.json();
    const epData = streamJson.data?.episode;
    const rawToken = epData?.streamLink;

    if (!rawToken) {
      return { success: false, server: "animeparadise", error: "Empty stream token from upstream" };
    }

    // Master HLS URL
    const upstreamM3u8 = `${ANIME_PARADISE_STREAM}/m3u8?url=${encodeURIComponent(rawToken)}`;
    const proxiedM3u8 = `/api/stream/proxy?url=${encodeURIComponent(
      upstreamM3u8
    )}&referer=${encodeURIComponent("https://animeparadise.moe/")}`;

    // Normalize Subtitles: only keep valid HTTP(S) endpoints and deduplicate by lang
    const seenLangs = new Set<string>();
    const subtitles = (epData.subData || [])
      .filter(
        (s: any) =>
          Boolean(s?.src) &&
          typeof s.src === "string" &&
          (s.src.startsWith("http://") || s.src.startsWith("https://"))
      )
      .map((s: any) => {
        const lang = (s.label || "English").toLowerCase().slice(0, 2);
        return {
          label: s.label || "English",
          lang,
          url: s.src,
          default: (s.label || "").toLowerCase().includes("english"),
        };
      })
      .filter((s: any) => {
        if (seenLangs.has(s.lang)) return false;
        seenLangs.add(s.lang);
        return true;
      });

    return {
      success: true,
      server: "animeparadise",
      streamUrl: proxiedM3u8,
      rawUrl: upstreamM3u8,
      quality: "1080p FHD",
      subtitles,
      skipData: epData.skipData,
    };
  } catch (err: any) {
    return {
      success: false,
      server: "animeparadise",
      error: err?.message || "AnimeParadise resolution error",
    };
  }
}

/**
 * Resolves stream from VidZee (extracted from kdesa.stream)
 */
export async function resolveVidZee(
  tmdbId: string | number,
  type: "movie" | "tv" = "movie",
  season: number = 1,
  episode: number = 1
): Promise<KStreamResolution> {
  const subServers = ["dcloud", "ipcloud", "tik"];
  const path = type === "movie" ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;

  for (const s of subServers) {
    try {
      const endpoint = `${VIDZEE_API}/${path}?s=${s}&e=0`;
      const res = await fetch(endpoint, {
        headers: VIDZEE_HEADERS,
        signal: AbortSignal.timeout(3500),
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      if (data?.url && typeof data.url === "string" && data.url.startsWith("http")) {
        const proxied = `/api/stream/proxy?url=${encodeURIComponent(
          data.url
        )}&referer=${encodeURIComponent("https://player.vidzee.wtf/")}`;

        return {
          success: true,
          server: "vidzee",
          streamUrl: proxied,
          rawUrl: data.url,
          quality: "1080p HLS",
          subtitles: [],
        };
      }
    } catch {
      // Continue to next sub-server
    }
  }

  return {
    success: false,
    server: "vidzee",
    error: "No active stream found in VidZee cluster",
  };
}
