// Streamly Ultra-Fast Client Stream Cache & Background Pre-fetcher
export interface ResolvedStreamData {
  success: boolean;
  server: string;
  serverName?: string;
  mode: "hls" | "embed";
  streamUrl?: string;
  embedUrl?: string;
  subtitles?: Array<{ label: string; lang: string; url: string; default?: boolean }>;
  quality?: string;
  hasDub?: boolean;
  audioType?: "sub" | "dub";
  message?: string;
  code?: string;
}

interface CacheEntry {
  data: ResolvedStreamData;
  timestamp: number;
}

export interface StreamParams {
  server: string;
  tmdbId: string | number;
  title?: string;
  type?: "movie" | "tv";
  season?: string | number;
  episode?: string | number;
  audio?: "sub" | "dub";
}

const CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes
const streamCache = new Map<string, CacheEntry>();
const inFlightPromises = new Map<string, Promise<ResolvedStreamData | null>>();

export function getStreamCacheKey(p: StreamParams): string {
  const srv = p.server || "poseidon";
  const id = String(p.tmdbId || "");
  const title = (p.title || "").trim().toLowerCase();
  const type = p.type || "movie";
  const s = String(p.season || "1");
  const e = String(p.episode || "1");
  const a = p.audio || "dub";
  return `${srv}|${id}|${title}|${type}|${s}|${e}|${a}`;
}

export function getCachedStream(p: StreamParams): ResolvedStreamData | null {
  const key = getStreamCacheKey(p);
  const entry = streamCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  if (entry) {
    streamCache.delete(key);
  }
  return null;
}

export function setCachedStream(p: StreamParams, data: ResolvedStreamData): void {
  const key = getStreamCacheKey(p);
  streamCache.set(key, { data, timestamp: Date.now() });
}

// Warm up the browser cache with master .m3u8 playlist so playback starts instantly
async function preWarmPlaylist(streamUrl: string) {
  if (!streamUrl || typeof window === "undefined") return;
  try {
    // Fetch master manifest to warm proxy and browser HTTP cache
    fetch(streamUrl, {
      method: "GET",
      headers: { Accept: "*/*" },
      priority: "low",
    } as any).catch(() => {});
  } catch {
    // Ignore pre-warm network exceptions
  }
}

export async function prefetchStream(p: StreamParams): Promise<ResolvedStreamData | null> {
  const key = getStreamCacheKey(p);

  // 1. Check existing fresh cache
  const cached = getCachedStream(p);
  if (cached) return cached;

  // 2. Check if already being fetched in flight
  if (inFlightPromises.has(key)) {
    return inFlightPromises.get(key)!;
  }

  // 3. Initiate background resolution
  const fetchPromise = (async () => {
    try {
      const q = new URLSearchParams({
        server: p.server,
        tmdbId: String(p.tmdbId || ""),
        title: p.title || "",
        type: p.type || "movie",
        season: String(p.season || "1"),
        episode: String(p.episode || "1"),
        audio: p.audio || "dub",
      });

      const res = await fetch(`/api/stream/resolve?${q.toString()}`, {
        priority: "low",
      } as any);

      if (!res.ok) return null;
      const data: ResolvedStreamData = await res.json();

      if (data && data.success) {
        setCachedStream(p, data);

        // Pre-warm HLS master playlist if available
        if (data.mode === "hls" && data.streamUrl) {
          preWarmPlaylist(data.streamUrl);
        }
        return data;
      }
      return data;
    } catch {
      return null;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, fetchPromise);
  return fetchPromise;
}
