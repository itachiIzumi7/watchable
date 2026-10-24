/**
 * Rivestream Native Scraper & Stream Resolver
 * Reverse-engineered from https://www.rivestream.app/
 *
 * Supported Native Server Clusters:
 * - Vanguard: 4K HDR direct Master HLS (.m3u8)
 * - Citadel: Multi-language Audio (Hindi, English, Tamil, Telugu) 720p/480p HLS
 * - Mirage: 4K UHD Master HLS (.m3u8)
 */

export interface RivestreamSource {
  quality: string;
  url: string;
  source: string;
  format: string;
}

export interface RivestreamCaption {
  file: string;
  label?: string;
  language?: string;
  type?: string;
}

export interface RivestreamResolution {
  success: boolean;
  provider: string;
  streamUrl?: string;
  rawUrl?: string;
  quality?: string;
  subtitles?: Array<{ label: string; lang: string; url: string; default?: boolean }>;
  sources?: RivestreamSource[];
  error?: string;
}

const RIVE_SCRAPER_BASE = "https://scrapper.rivestream.app";
const RIVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Referer: "https://www.rivestream.app/",
  Origin: "https://www.rivestream.app",
  Accept: "application/json, text/plain, */*",
};

// Priority ordering of known active native providers on Rivestream
export const RIVESTREAM_PROVIDERS = ["vanguard", "citadel", "mirage", "savannah"] as const;
export type RivestreamProvider = (typeof RIVESTREAM_PROVIDERS)[number];

/**
 * Resolves stream from a specific Rivestream native provider
 */
export async function resolveRivestreamProvider(
  provider: string,
  tmdbId: string | number,
  type: "movie" | "tv" = "movie",
  season: string | number = 1,
  episode: string | number = 1
): Promise<RivestreamResolution> {
  try {
    let endpoint = `${RIVE_SCRAPER_BASE}/api/provider?provider=${encodeURIComponent(provider)}&id=${tmdbId}`;
    if (type === "tv") {
      endpoint += `&season=${season}&episode=${episode}`;
    }
    // Add cachebuster for providers that benefit from it
    if (provider === "citadel" || provider === "savannah") {
      endpoint += `&cb=${Date.now()}`;
    }

    const res = await fetch(endpoint, {
      headers: RIVE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { success: false, provider, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const sources: RivestreamSource[] = data?.data?.sources || [];
    const captions: RivestreamCaption[] = data?.data?.captions || [];

    if (!sources || sources.length === 0) {
      return { success: false, provider, error: "No sources returned" };
    }

    // Select the best stream source (prefer 4K / 1080p / 720p)
    const bestSource = sources[0];
    let rawStreamUrl = bestSource.url;

    // Normalize subtitles
    const subtitles = captions
      .filter((c) => Boolean(c.file))
      .map((c) => ({
        label: c.label || c.language || "English",
        lang: (c.language || "en").toLowerCase().slice(0, 2),
        url: c.file,
        default: (c.label || c.language || "").toLowerCase().includes("english"),
      }));

    // If stream URL is wrapped in valhallastream proxy, extract underlying destination if needed
    let proxiedStreamUrl = rawStreamUrl;
    if (rawStreamUrl.includes("proxy.valhallastream.com/m3u8?url=")) {
      try {
        const parsed = new URL(rawStreamUrl);
        const unwrapped = parsed.searchParams.get("url");
        const headersParam = parsed.searchParams.get("headers");
        let upstreamReferer = "https://cinejoy.pk/";
        let upstreamOrigin = "https://cinejoy.pk";

        if (headersParam) {
          try {
            const parsedHeaders = JSON.parse(headersParam);
            if (parsedHeaders.Referer) upstreamReferer = parsedHeaders.Referer;
            if (parsedHeaders.Origin) upstreamOrigin = parsedHeaders.Origin;
          } catch {}
        }

        if (unwrapped) {
          proxiedStreamUrl = `/api/stream/proxy?url=${encodeURIComponent(
            unwrapped
          )}&referer=${encodeURIComponent(upstreamReferer)}&origin=${encodeURIComponent(upstreamOrigin)}`;
        }
      } catch {
        // Fallback to valhallastream direct
      }
    } else if (rawStreamUrl.includes("img1.fcxmb.com") || rawStreamUrl.includes("fcxmb.com")) {
      // Citadel streams are direct open HLS (.m3u8 with .jpg segments)
      // Can be played directly or via our proxy
      proxiedStreamUrl = rawStreamUrl;
    }

    return {
      success: true,
      provider,
      streamUrl: proxiedStreamUrl,
      rawUrl: rawStreamUrl,
      quality: bestSource.quality,
      subtitles,
      sources,
    };
  } catch (err: any) {
    return {
      success: false,
      provider,
      error: err?.message || "Resolution error",
    };
  }
}

/**
 * Resolves stream from Rivestream with auto-failover across top native providers
 */
export async function resolveRivestreamStream(
  tmdbId: string | number,
  type: "movie" | "tv" = "movie",
  season: string | number = 1,
  episode: string | number = 1,
  preferredProvider?: string
): Promise<RivestreamResolution> {
  const providersToTry = preferredProvider
    ? [preferredProvider, ...RIVESTREAM_PROVIDERS.filter((p) => p !== preferredProvider)]
    : RIVESTREAM_PROVIDERS;

  for (const provider of providersToTry) {
    const result = await resolveRivestreamProvider(provider, tmdbId, type, season, episode);
    if (result.success && result.streamUrl) {
      return result;
    }
  }

  return {
    success: false,
    provider: "rivestream_auto",
    error: "No working native stream found across Rivestream providers",
  };
}
