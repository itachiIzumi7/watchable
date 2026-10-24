import { execFile } from "child_process";
import fs from "fs";
import { resolveKAAStream } from "./kaa";

export interface MiruroSubtitle {
  label: string;
  lang: string;
  url: string;
  source?: string;
  default?: boolean;
}

export interface MiruroResolveResult {
  streamUrl: string;
  server: string;
  provider: string;
  subtitles?: MiruroSubtitle[];
  quality?: string;
  hasDub?: boolean;
}

// In-memory cache for Anime title -> Miruro internal media ID
const animeIdCache = new Map<string, string>([
  ["jujutsu kaisen", "l9aQcH0K4elYGR6uiKnFUiymK44zIuzo"],
  ["jujutsu kaisen season 2", "l9aQcH0K4elYGR6uiKnFUiymK44zIuzo"],
]);

// In-memory cache for MediaID:Episode -> Sources response (contains both dub & sub)
interface CachedSources {
  data: any;
  timestamp: number;
}
const sourcesCache = new Map<string, CachedSources>();
import path from "path";

const SOURCES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCurlBin(): string {
  if (process.platform === "win32") {
    try {
      const gitA = ["C:", "Program Files", "Git", "mingw64", "bin", "curl.exe"].join(path.sep);
      const gitB = ["C:", "Program Files", "Git", "usr", "bin", "curl.exe"].join(path.sep);
      if (fs.existsSync(gitA)) return gitA;
      if (fs.existsSync(gitB)) return gitB;
    } catch {}
  }
  return "curl";
}

function fetchTextWithCurl(url: string, headers: Record<string, string> = {}): Promise<string> {
  const curlBin = getCurlBin();
  return new Promise((resolve, reject) => {
    const args = ["-s", "-4", "--connect-timeout", "4", "--max-time", "8", "--http1.1", "--compressed"];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push(url);

    // @ts-ignore turbopack hint
    execFile(/*turbopackIgnore: true*/ curlBin, args, { maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      if (!stdout || stdout.length === 0) return reject(new Error("Empty response from curl"));
      resolve(stdout);
    });
  });
}

async function requestMiruro(url: string, retries = 2): Promise<string> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Referer: "https://barelystarted.miruro.tv/",
    Accept: "text/html,application/json,*/*",
  };

  // 1. Try fast native fetch first
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      return await res.text();
    }
  } catch (err) {
    console.error("[Miruro native fetch error]:", err);
    // Continue to curl fallback
  }

  // 2. Fallback to OpenSSL curl
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchTextWithCurl(url, headers);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[Miruro] fetch error for ${url}:`, err);
        return "";
      }
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  return "";
}

export async function findMiruroMediaId(title: string): Promise<string | null> {
  if (!title) return null;
  const cleanTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ū/gi, "u")
    .replace(/ō/gi, "o")
    .replace(/Shippūden/gi, "Shippuden")
    .replace(/Shippuuden/gi, "Shippuden")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/Season \d+/i, "")
    .replace(/Part \d+/i, "")
    .trim();

  const cacheKey = cleanTitle.toLowerCase();
  if (animeIdCache.has(cacheKey)) {
    return animeIdCache.get(cacheKey)!;
  }

  try {
    const searchUrl = `https://barelystarted.miruro.tv/search?q=${encodeURIComponent(cleanTitle)}`;
    const html = await requestMiruro(searchUrl);
    if (!html) return null;

    // 1. Modern Miruro Card matching: href="/info/{mediaId}/{slug}"
    const anchorRegex = /href="\/info\/([a-zA-Z0-9_\-]+)\/([^"#\?]+)"/g;
    let m;
    const candidates: Array<{ id: string; slug: string }> = [];
    while ((m = anchorRegex.exec(html)) !== null) {
      candidates.push({ id: m[1], slug: m[2].toLowerCase() });
    }

    if (candidates.length > 0) {
      const targetSlug = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Match closest slug
      const exact = candidates.find((c) => c.slug === targetSlug);
      if (exact) {
        animeIdCache.set(cacheKey, exact.id);
        return exact.id;
      }

      // Check if candidate starts with targetSlug (e.g. naruto -> naruto-shippuden or vice versa)
      const prefixMatch = candidates.find(
        (c) => c.slug.startsWith(targetSlug + "-") || targetSlug.startsWith(c.slug + "-")
      );
      if (prefixMatch) {
        animeIdCache.set(cacheKey, prefixMatch.id);
        return prefixMatch.id;
      }

      // Check word token overlap (require at least 60% of significant words to match)
      const targetWords = targetSlug.split("-").filter((w) => w.length > 2);
      if (targetWords.length > 0) {
        const bestCandidate = candidates.find((c) => {
          const candWords = c.slug.split("-").filter((w) => w.length > 2);
          const matchCount = targetWords.filter((tw) => candWords.includes(tw)).length;
          return matchCount / targetWords.length >= 0.6;
        });
        if (bestCandidate) {
          animeIdCache.set(cacheKey, bestCandidate.id);
          return bestCandidate.id;
        }
      }
    }

    // 2. Fallback to SvelteKit JSON hydration matching if present
    const jsonRegex = /\{id:"([^"]+)",external_ids:\{[^}]*\},title:\{romaji:"([^"]+)"(?:,english:([^\,\}]+))?/g;
    let jm;
    const lowerClean = cleanTitle.toLowerCase();
    while ((jm = jsonRegex.exec(html)) !== null) {
      const id = jm[1];
      const romaji = (jm[2] || "").toLowerCase();
      const eng = (jm[3] || "").replace(/"/g, "").toLowerCase();
      if (
        (romaji && (romaji === lowerClean || romaji.startsWith(lowerClean) || lowerClean.startsWith(romaji))) ||
        (eng && (eng === lowerClean || eng.startsWith(lowerClean) || lowerClean.startsWith(eng)))
      ) {
        animeIdCache.set(cacheKey, id);
        return id;
      }
    }
  } catch (err) {
    console.error("[Miruro] Error searching anime:", err);
  }

  return null;
}

export async function prefetchMiruroSources(title: string, episode: number | string = 1): Promise<void> {
  try {
    const mediaId = await findMiruroMediaId(title);
    if (!mediaId) return;

    const epNum = typeof episode === "string" ? parseInt(episode, 10) : episode;
    const cacheKey = `${mediaId}:${epNum || 1}`;
    const cached = sourcesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SOURCES_CACHE_TTL) {
      return;
    }

    const sourcesUrl = `https://barelystarted.miruro.tv/api/sources?id=${encodeURIComponent(mediaId)}&n=${epNum || 1}`;
    const jsonStr = await requestMiruro(sourcesUrl);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      if (data && data.tracks) {
        sourcesCache.set(cacheKey, { data, timestamp: Date.now() });
      }
    }
  } catch (err) {
    // Ignore prefetch errors
  }
}

export async function resolveMiruroStream(
  title: string,
  episode: number | string = 1,
  audioMode: "dub" | "sub" = "dub"
): Promise<MiruroResolveResult | null> {
  try {
    const mediaId = await findMiruroMediaId(title);
    if (!mediaId) return null;

    const epNum = typeof episode === "string" ? parseInt(episode, 10) : episode;
    const cacheKey = `${mediaId}:${epNum || 1}`;

    let data: any = null;
    const cached = sourcesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SOURCES_CACHE_TTL) {
      data = cached.data;
    } else {
      const sourcesUrl = `https://barelystarted.miruro.tv/api/sources?id=${encodeURIComponent(
        mediaId
      )}&n=${epNum || 1}`;

      const jsonStr = await requestMiruro(sourcesUrl);
      if (!jsonStr) return null;

      data = JSON.parse(jsonStr);
      if (data && data.tracks) {
        sourcesCache.set(cacheKey, { data, timestamp: Date.now() });
      }
    }

    if (!data || !data.tracks || !Array.isArray(data.tracks)) return null;

    // Check available tracks
    const dubTrack = data.tracks.find((t: any) => t.track === "dub");
    const subTrack =
      data.tracks.find((t: any) => t.track === "ssub") ||
      data.tracks.find((t: any) => t.track === "sub");

    const targetTrack = audioMode === "dub" ? dubTrack || subTrack : subTrack || dubTrack;
    if (!targetTrack || !targetTrack.providers) return null;

    // Subtitle extraction
    let subtitles: MiruroSubtitle[] = [];
    const sourceSubs =
      targetTrack.providers?.find((p: any) => p.subtitles?.length > 0)?.subtitles ||
      subTrack?.providers?.find((p: any) => p.subtitles?.length > 0)?.subtitles ||
      targetTrack.subtitles ||
      subTrack?.subtitles ||
      [];
    if (Array.isArray(sourceSubs) && sourceSubs.length > 0) {
      subtitles = sourceSubs
        .filter((s: any) => {
          if (!s.file || typeof s.file !== "string") return false;
          const lower = s.file.toLowerCase();
          // Exclude thumbnail storyboard sprite sheets and images mislabeled as subtitles
          if (lower.endsWith(".jpeg") || lower.endsWith(".jpg") || lower.endsWith(".png") || lower.includes(".top/a/")) {
            return false;
          }
          return true;
        })
        .map((s: any) => ({
          label: s.label || s.language || "Subtitle",
          lang: s.language || "en",
          url: `/api/stream/proxy?url=${encodeURIComponent(s.file)}&referer=${encodeURIComponent(
            "https://barelystarted.miruro.tv/"
          )}&origin=${encodeURIComponent("https://barelystarted.miruro.tv")}`,
          source: "Miruro",
          default: Boolean(s.default) || s.language === "en" || s.language === "eng",
        }));
    }

    // Provider priority: bee (NexaBloom / MegaCloud) -> sun (Keeply / UltraCloud) -> hop (Krussdomi)
    const priorityProviders = ["bee", "sun", "hop", "knob"];
    const allProviders = targetTrack.providers;

    let chosenStreamUrl = "";
    let chosenHeaders: Record<string, string> = {};
    let chosenServerName = "";
    let chosenProviderName = "";

    for (const provCode of priorityProviders) {
      const prov = allProviders.find((p: any) => p.provider === provCode);
      if (!prov || !prov.servers) continue;

      for (const s of prov.servers) {
        if (s.streams && s.streams.length > 0 && s.streams[0].url) {
          chosenStreamUrl = s.streams[0].url;
          chosenHeaders = s.headers || {};
          chosenServerName = s.server || provCode;
          chosenProviderName = provCode;
          break;
        }
      }
      if (chosenStreamUrl) break;
    }

    // If priority providers didn't match, pick any stream from any provider
    if (!chosenStreamUrl) {
      for (const prov of allProviders) {
        for (const s of prov.servers || []) {
          if (s.streams && s.streams.length > 0 && s.streams[0].url) {
            chosenStreamUrl = s.streams[0].url;
            chosenHeaders = s.headers || {};
            chosenServerName = s.server || prov.provider;
            chosenProviderName = prov.provider;
            break;
          }
        }
        if (chosenStreamUrl) break;
      }
    }

    if (!chosenStreamUrl) {
      // Fallback directly to KAA Dual-Audio Master HLS
      const kaa = await resolveKAAStream(title, episode, audioMode);
      if (kaa?.streamUrl) {
        return {
          streamUrl: kaa.streamUrl,
          server: "Shisui (Master HLS)",
          provider: "kaa",
          subtitles: [],
          quality: kaa.quality || "1080p Master HLS",
          hasDub: true,
        };
      }
      return null;
    }

    const referer =
      chosenHeaders["Referer"] ||
      (chosenProviderName === "bee"
        ? "https://megaplay.buzz/"
        : chosenProviderName === "sun"
        ? "https://ultracloud.cc/"
        : chosenProviderName === "hop"
        ? "https://krussdomi.com/"
        : "https://barelystarted.miruro.tv/");

    const origin =
      chosenHeaders["Origin"] ||
      (chosenProviderName === "sun" ? "https://ultracloud.cc" : undefined);

    let proxyUrl = `/api/stream/proxy?url=${encodeURIComponent(chosenStreamUrl)}&referer=${encodeURIComponent(
      referer
    )}`;
    if (origin) {
      proxyUrl += `&origin=${encodeURIComponent(origin)}`;
    }

    return {
      streamUrl: proxyUrl,
      server: `Miruro ${chosenServerName} (${audioMode.toUpperCase()})`,
      provider: chosenProviderName,
      subtitles,
      quality: "1080p",
      hasDub: Boolean(dubTrack && dubTrack.providers?.length > 0),
    };
  } catch (err) {
    console.error("[Miruro] Stream resolution error:", err);
  }

  // Fallback directly to KAA Dual-Audio Master HLS if Miruro domain fails/blocks
  try {
    const kaa = await resolveKAAStream(title, episode, audioMode);
    if (kaa?.streamUrl) {
      return {
        streamUrl: kaa.streamUrl,
        server: "Shisui (Master HLS)",
        provider: "kaa",
        subtitles: [],
        quality: kaa.quality || "1080p Master HLS",
        hasDub: true,
      };
    }
  } catch (e) {
    console.error("[Shisui KAA fallback error]:", e);
  }

  return null;
}
