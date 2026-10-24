import crypto from "crypto";
import { ALL_STREAM_SERVERS } from "../../src/lib/streaming/streaming";
import { resolveCinejoyStream } from "../../src/lib/streaming/cinejoy";
import { resolveRivestreamStream, resolveRivestreamProvider } from "../../src/lib/streaming/rivestream";
import { resolveAnimeParadise, resolveVidZee } from "../../src/lib/streaming/kstream";
import { resolveKAAStream } from "../../src/lib/streaming/kaa";
import { resolveStellarStream } from "../../src/lib/streaming/stellar";
import { resolveMiruroStream } from "../../src/lib/streaming/miruro";
import { resolveMovieNightStream } from "../../src/lib/streaming/movienight";

async function resolveRealTmdbId(tmdbId: string, title: string, type: string): Promise<string> {
  if (tmdbId && /^\d+$/.test(tmdbId)) {
    return tmdbId;
  }

  const TMDB_KEY = "cd02d9e0ed072fcea61ee0d7199ea48e";

  if (title) {
    const cleanTitle = title.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim();
    try {
      const searchRes = await fetch(
        `https://api.tmdb.org/3/search/${type === "tv" ? "tv" : "movie"}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanTitle)}`,
        { signal: AbortSignal.timeout(1500) }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          return String(searchData.results[0].id);
        }
      }
    } catch {}
  }

  return tmdbId;
}

async function resolveAniListId(title: string, rawId: string): Promise<string> {
  const clean = (title || "")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/Season \d+/i, "")
    .trim();

  if (clean) {
    const query = `query ($search: String) { Media (search: $search, type: ANIME) { id } }`;
    try {
      const res = await fetch("https://graphql.anilist.co/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { search: clean } }),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = await res.json();
        const foundId = data?.data?.Media?.id;
        if (foundId) return String(foundId);
      }
    } catch {}
  }

  return rawId || "1735";
}

const SHIOPA_SECRET = "poprink_security_v2_2026";
const SHIOPA_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function shiopaHmac(key: string, msg: string): string {
  return crypto.createHmac("sha256", key).update(msg).digest("hex");
}

function makeShiopaSk(id: string) {
  const t = Date.now();
  const n = Math.random().toString(36).substring(2, 15);
  const h = shiopaHmac(SHIOPA_SECRET, `${t}:${n}:${id}:/api/streams`);
  return { token: Buffer.from(JSON.stringify({ t, n, h })).toString("base64"), t, n };
}

function shiopaRc4(base64Payload: string, key: string): string {
  const data = Buffer.from(base64Payload, "base64");
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  let i = 0;
  j = 0;
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    out[k] = data[k] ^ s[(s[i] + s[j]) % 256];
  }
  return new TextDecoder().decode(out);
}

function shiopaShift(text: string, key: string): string {
  let out = "";
  const keyLen = key.length;
  for (let idx = 0; idx < text.length; idx++) {
    const char = text[idx];
    const pos = SHIOPA_B64.indexOf(char);
    if (pos !== -1) {
      const shiftVal = key.charCodeAt(idx % keyLen) % 65;
      out += SHIOPA_B64[(pos - shiftVal + 65) % 65];
    } else {
      out += char;
    }
  }
  return out;
}

function shiopaXor(base64Text: string, key: string): string {
  const data = Buffer.from(base64Text, "base64");
  const out = new Uint8Array(data.length);
  const keyLen = key.length;
  for (let idx = 0; idx < data.length; idx++) {
    out[idx] = data[idx] ^ ((key.charCodeAt(idx % keyLen) + idx) % 256);
  }
  return new TextDecoder().decode(out);
}

async function resolveShiopaStream(tmdbId: string, type: string, season: string, episode: string) {
  try {
    const skInfo = makeShiopaSk(tmdbId);
    let query = `id=${tmdbId}&type=${type}`;
    if (type === "tv") query += `&season=${season}&episode=${episode}`;

    const res = await fetch(`https://shiopa.com/api/streams?${query}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: `https://shiopa.com/watch/${tmdbId}`,
        Accept: "application/json",
        "x-sk": skInfo.token,
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.v !== 1 || !json.p) return null;

    const keyA = shiopaHmac(SHIOPA_SECRET, `${skInfo.t}:${skInfo.n}:xor`);
    const keyB = shiopaHmac(SHIOPA_SECRET, `${skInfo.t}:${skInfo.n}:shift`);
    const keyC = shiopaHmac(SHIOPA_SECRET, `${skInfo.t}:${skInfo.n}:rc4`);

    const step1 = shiopaRc4(json.p, keyC);
    const step2 = shiopaShift(step1, keyB);
    const step3 = shiopaXor(step2, keyA);
    const decrypted = JSON.parse(step3);

    if (!decrypted?.results?.length) return null;

    for (const r of decrypted.results) {
      if (!r.streams?.length) continue;
      const sortedStreams = [...r.streams].sort((a: any, b: any) => {
        const getScore = (url: string = "") => {
          const u = url.toLowerCase();
          if (u.includes("1080p") || u.includes("1080")) return 100;
          if (u.includes("720p") || u.includes("720")) return 90;
          if (u.includes("480p") || u.includes("360p")) return 50;
          if (u.includes("2160p") || u.includes("4k")) return 10;
          return 70;
        };
        return getScore(b.url) - getScore(a.url);
      });

      for (const s of sortedStreams) {
        let streamUrl = s.url;
        let headers: Record<string, string> = s.headers || {};

        const tokMatch = s.url?.match(/tok=([^&]+)/);
        if (tokMatch) {
          try {
            const parsedTok = JSON.parse(Buffer.from(tokMatch[1], "base64").toString("utf8"));
            const decodedD = JSON.parse(Buffer.from(parsedTok.d, "base64").toString("utf8"));
            if (decodedD.url) {
              streamUrl = decodedD.url;
              if (decodedD.headers) headers = { ...headers, ...decodedD.headers };
            }
          } catch {}
        }

        if (streamUrl && streamUrl.startsWith("http")) {
          return {
            server: r.serverName || r.server,
            streamUrl,
            headers,
          };
        }
      }
    }
  } catch {}
  return null;
}

async function fetchPublicSubtitles(
  imdbId: string,
  type: "movie" | "tv",
  season?: number | string,
  episode?: number | string
): Promise<Array<{ label: string; lang: string; url: string; default?: boolean }>> {
  if (!imdbId || !imdbId.startsWith("tt")) return [];
  try {
    const epPath =
      type === "tv"
        ? `series/${imdbId}%3A${season || 1}%3A${episode || 1}.json`
        : `movie/${imdbId}.json`;
    const res = await fetch(`https://opensubtitles-v3.strem.io/subtitles/${epPath}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(1800),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const subs = data?.subtitles || [];
    const results: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
    const seenLangs = new Set<string>();

    const labelMap: Record<string, string> = {
      eng: "English",
      en: "English",
      spa: "Spanish",
      es: "Spanish",
      fra: "French",
      fr: "French",
      deu: "German",
      de: "German",
      ita: "Italian",
      it: "Italian",
      por: "Portuguese",
      pob: "Portuguese (BR)",
      pt: "Portuguese",
      hin: "Hindi",
      hi: "Hindi",
      ara: "Arabic",
      ar: "Arabic",
      rus: "Russian",
      ru: "Russian",
    };

    for (const s of subs) {
      if (!s.url || !s.lang) continue;
      const langCode = s.lang.toLowerCase();
      if (seenLangs.has(langCode)) continue;
      seenLangs.add(langCode);

      const langName = labelMap[langCode] || langCode.toUpperCase();
      const proxiedSubUrl = `/api/stream/proxy?url=${encodeURIComponent(s.url)}`;
      results.push({
        label: langName,
        lang: langCode.slice(0, 2),
        url: proxiedSubUrl,
        default: langCode.startsWith("en") && !results.some((r) => r.default),
      });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function handleResolve(searchParams: URLSearchParams) {
  const serverId = searchParams.get("server") || searchParams.get("serverId") || "poseidon";
  const rawTmdbId = searchParams.get("tmdbId") || "";
  const title = searchParams.get("title") || "";
  const rawType = (searchParams.get("type") || "").toLowerCase();
  const type = rawType === "tv" || rawType === "series" ? "tv" : "movie";
  const season = searchParams.get("season") || "1";
  const episode = searchParams.get("episode") || "1";
  const audio = searchParams.get("audio") || "dub";
  const checkDubOnly = searchParams.get("checkDub") === "true";
  const imdbId = searchParams.get("imdbId") || "";
  const year = searchParams.get("year") || "";

  const tmdbId = await resolveRealTmdbId(rawTmdbId, title, type);

  if (checkDubOnly) {
    if (title) {
      try {
        const miruroTest = await resolveMiruroStream(title, episode, "dub");
        if (miruroTest && typeof miruroTest.hasDub === "boolean") {
          return { status: 200, data: { hasDub: miruroTest.hasDub } };
        }
      } catch {}
    }

    try {
      const checkRes = await fetch(
        `https://kazora.cc/api/watch?id=${tmdbId}&ep=${episode}&server=kaa&type=dub`,
        {
          headers: {
            Referer: "https://kazora.cc/",
            Origin: "https://kazora.cc",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (checkRes.ok) {
        return { status: 200, data: { hasDub: true } };
      }
      return { status: 200, data: { hasDub: false } };
    } catch {
      return { status: 200, data: { hasDub: null } };
    }
  }

  const serverConfig = ALL_STREAM_SERVERS.find((s) => s.id === serverId);

  try {
    // 0. Miruro Anime Ultra-Fast Native HLS Resolver
    if (serverId === "miruro_anime") {
      const audioMode = audio === "dub" ? "dub" : "sub";
      let miruroResult = await resolveMiruroStream(title, episode, audioMode);

      if (!miruroResult?.streamUrl) {
        const kaa = await resolveKAAStream(title, episode, audioMode);
        if (kaa?.streamUrl) {
          miruroResult = {
            streamUrl: kaa.streamUrl,
            server: serverConfig?.name || "Shisui",
            provider: "kaa",
            subtitles: [],
            quality: kaa.quality || "1080p Master HLS",
            hasDub: true,
          };
        }
      }

      if (!miruroResult?.streamUrl) {
        const ap = await resolveAnimeParadise(title, parseInt(episode, 10));
        if (ap?.success && ap.streamUrl) {
          miruroResult = {
            streamUrl: ap.streamUrl,
            server: serverConfig?.name || "Shisui",
            provider: "animeparadise",
            subtitles: ap.subtitles || [],
            quality: ap.quality || "1080p FHD",
            hasDub: false,
          };
        }
      }

      if (miruroResult?.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            serverName: serverConfig?.name || "Shisui",
            mode: "hls",
            streamUrl: miruroResult.streamUrl,
            subtitles: miruroResult.subtitles || [],
            quality: miruroResult.quality || "1080p",
            hasDub: miruroResult.hasDub ?? true,
            supportsDualAudio: true,
            audioType: audioMode,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found on Shisui anime cluster",
        },
      };
    }

    // 0.65 MovieNight Native HLS Resolver
    if (serverId === "salem_hls" || serverId === "vixsrc_hls" || serverId === "movienight_auto" || serverId === "movienight") {
      const preferred =
        serverId === "salem_hls"
          ? "salem"
          : serverId === "vixsrc_hls"
          ? "vixsrc-1"
          : undefined;

      const mnResult = await resolveMovieNightStream(
        tmdbId,
        type as "movie" | "tv",
        season,
        episode,
        title,
        preferred,
        imdbId,
        year
      );

      if (mnResult.success && mnResult.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            serverName: `MovieNight (${mnResult.server})`,
            mode: "hls",
            streamUrl: mnResult.streamUrl,
            subtitles: mnResult.subtitles || [],
            quality: mnResult.quality || "auto",
          },
        };
      }

      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: mnResult.error || "No stream found in MovieNight cluster",
        },
      };
    }

    // 0.7 Stellar Native HLS Resolver
    if (serverId === "stellar_hls" || serverId === "stellar_miami" || serverId === "stellar_boise") {
      const targetSubServer = serverId === "stellar_boise" ? "boise" : serverId === "stellar_miami" ? "miami" : "auto";
      const stellarResult = await resolveStellarStream(
        targetSubServer,
        tmdbId,
        type as "movie" | "tv",
        season,
        episode
      );

      if (stellarResult?.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            serverName: stellarResult.server,
            streamUrl: stellarResult.streamUrl,
            subtitles: stellarResult.subtitles || [],
            quality: stellarResult.quality,
            is4k: stellarResult.is4k,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in Stellar cluster",
        },
      };
    }

    // 0.8 Cinejoy Native HLS Resolver
    if (serverId === "cinejoy_hls" || serverId === "cinejoy_lisbon" || serverId === "cinejoy_nebula") {
      const targetSubServer = serverId === "cinejoy_lisbon" ? "lisbon" : serverId === "cinejoy_nebula" ? "nebula" : "auto";
      const cinejoyResult = await resolveCinejoyStream(
        targetSubServer,
        tmdbId,
        type,
        season,
        episode,
        title
      );

      if (cinejoyResult?.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            serverName: cinejoyResult.server,
            streamUrl: cinejoyResult.streamUrl,
            subtitles: cinejoyResult.subtitles || [],
            quality: cinejoyResult.quality,
            is4k: cinejoyResult.is4k,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in Cinejoy cluster",
        },
      };
    }

    // 1. Poseidon HLS Resolver (vaplayer.ru)
    if (serverId === "poseidon" || serverId === "poseidon_anime") {
      let apiUrl = `https://streamdata.vaplayer.ru/api.php?tmdb=${tmdbId}&type=${type}`;
      if (type === "tv") {
        apiUrl += `&season=${season}&episode=${episode}`;
      }

      const res = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://nextgencloudfabric.com/",
          Origin: "https://nextgencloudfabric.com",
        },
        signal: AbortSignal.timeout(7000),
      });

      if (res.ok) {
        const data = await res.json();
        const rawUrls = data?.data?.stream_urls || data?.stream_urls || [];
        if (rawUrls.length > 0) {
          const rawUrl = rawUrls[0];
          const returnedImdb = data?.data?.imdb_id || imdbId;

          let resolvedSubs: any[] = [];
          if (returnedImdb) {
            try {
              resolvedSubs = await Promise.race([
                fetchPublicSubtitles(returnedImdb, type as any, season, episode),
                new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 1200)),
              ]);
            } catch {}
          }

          const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(
            rawUrl
          )}&referer=${encodeURIComponent("https://nextgencloudfabric.com/")}&origin=${encodeURIComponent(
            "https://nextgencloudfabric.com"
          )}`;

          return {
            status: 200,
            data: {
              success: true,
              server: serverId,
              serverName: serverConfig?.name || "Itachi",
              mode: "hls",
              streamUrl: proxiedUrl,
              rawUrl,
              subtitles:
                resolvedSubs.length > 0
                  ? resolvedSubs
                  : data?.subtitles || data?.data?.default_subs || [],
            },
          };
        }
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: `No stream found in ${serverConfig?.name || "Itachi"} cluster`,
        },
      };
    }

    // 1.5 Shiopa HLS Resolver
    if (serverId === "shiopa_hls") {
      const shiopaResult = await resolveShiopaStream(tmdbId, type, season, episode);
      if (shiopaResult?.streamUrl) {
        const proxiedStreamUrl = `/api/stream/proxy?url=${encodeURIComponent(shiopaResult.streamUrl)}${
          shiopaResult.headers?.Referer ? `&referer=${encodeURIComponent(shiopaResult.headers.Referer)}` : ""
        }`;

        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            serverName: `Shiopa (${shiopaResult.server})`,
            streamUrl: proxiedStreamUrl,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in Shiopa cluster",
        },
      };
    }

    // 2. Orion HLS Resolver
    if (serverId === "orion") {
      const isTv = type === "tv";
      const numTmdb = Number(tmdbId);
      const pageReferer = isTv
        ? `https://7movies.ac/tv/${numTmdb}/watch?season=${season}&episode=${episode}`
        : `https://7movies.ac/movie/${numTmdb}/watch`;

      const tokenRes = await fetch("https://7movies.ac/api/playback-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: pageReferer,
          Origin: "https://7movies.ac",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        body: JSON.stringify(
          isTv
            ? { tmdbId: numTmdb, type, season: Number(season), episode: Number(episode) }
            : { tmdbId: numTmdb, type }
        ),
        signal: AbortSignal.timeout(3500),
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const token = tokenData?.token || tokenData?.data?.token;
        if (token) {
          const path = isTv ? `tv/${numTmdb}/${season}/${episode}` : `movie/${numTmdb}`;
          const sourceRes = await fetch(
            `https://embed.vidrift.net/api/source/${path}?token=${token}&provider=moviebox`,
            {
              headers: {
                Referer: "https://embed.vidrift.net/",
                Origin: "https://embed.vidrift.net",
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              },
              signal: AbortSignal.timeout(3500),
            }
          );
          if (sourceRes.ok) {
            const sourceData = await sourceRes.json();
            const rawStream = sourceData?.data?.source || sourceData?.source;
            if (rawStream) {
              const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(
                rawStream
              )}&referer=${encodeURIComponent("https://embed.vidrift.net/")}&origin=${encodeURIComponent(
                "https://embed.vidrift.net"
              )}`;

              return {
                status: 200,
                data: {
                  success: true,
                  server: serverId,
                  mode: "hls",
                  streamUrl: proxiedUrl,
                  subtitles: sourceData?.subtitles || [],
                },
              };
            }
          }
        }
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in Orion cluster",
        },
      };
    }

    // 3. PurStream HLS Resolver
    if (serverId === "purstream") {
      const cleanTitle = (title || "").replace(/[^a-zA-Z0-9\s]/g, "").trim();
      if (!cleanTitle) {
        return { status: 200, data: { success: false, server: serverId, message: "Missing title" } };
      }

      const searchRes = await fetch(
        `https://api.purstream.ad/api/v1/search-bar/search/${encodeURIComponent(cleanTitle)}`,
        {
          headers: {
            Referer: "https://purstream.ad/",
            Origin: "https://purstream.ad",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(3500),
        }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const results = searchData?.data || searchData?.results || [];
        if (results.length > 0) {
          const item = results[0];
          const streamEndpoint =
            type === "tv"
              ? `https://api.purstream.ad/api/v1/stream/${item.id}/episode?season=${season}&episode=${episode}`
              : `https://api.purstream.ad/api/v1/stream/${item.id}`;

          const streamRes = await fetch(streamEndpoint, {
            headers: { Referer: "https://purstream.ad/" },
            signal: AbortSignal.timeout(3500),
          });

          if (streamRes.ok) {
            const streamData = await streamRes.json();
            const rawUrl = streamData?.data?.stream || streamData?.stream;
            if (rawUrl) {
              const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(
                rawUrl
              )}&referer=${encodeURIComponent("https://purstream.ad/")}`;

              return {
                status: 200,
                data: {
                  success: true,
                  server: serverId,
                  mode: "hls",
                  streamUrl: proxiedUrl,
                  subtitles: streamData?.subtitles || [],
                },
              };
            }
          }
        }
      }

      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in PurStream cluster",
        },
      };
    }

    // 4. Atlantia / Rivestream Native HLS Resolver
    if (serverId === "atlantia" || serverId.startsWith("rive_")) {
      const preferredProvider =
        serverId === "rive_vanguard"
          ? "vanguard"
          : serverId === "rive_citadel"
          ? "citadel"
          : serverId === "rive_mirage"
          ? "mirage"
          : undefined;

      const mediaType = type === "tv" ? "tv" : "movie";
      const riveResult = preferredProvider
        ? await resolveRivestreamProvider(preferredProvider, tmdbId, mediaType, season, episode)
        : await resolveRivestreamStream(tmdbId, mediaType, season, episode);

      if (riveResult.success && riveResult.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            streamUrl: riveResult.streamUrl,
            subtitles: riveResult.subtitles || [],
            quality: riveResult.quality,
            activeProvider: riveResult.provider,
          },
        };
      }

      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: riveResult.error || "No active stream found in Rivestream cluster",
        },
      };
    }

    // 4.5 Anime Paradise Native HLS Resolver
    if (serverId === "animeparadise") {
      const animeResult = await resolveAnimeParadise(title, parseInt(episode, 10));
      if (animeResult.success && animeResult.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            streamUrl: animeResult.streamUrl,
            subtitles: animeResult.subtitles || [],
            quality: animeResult.quality,
            skipData: animeResult.skipData,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: animeResult.error || "No stream found in Anime Paradise cluster",
        },
      };
    }

    // 4.6 VidZee Native HLS Resolver
    if (serverId === "vidzee") {
      const vidzeeResult = await resolveVidZee(
        tmdbId,
        type === "tv" ? "tv" : "movie",
        parseInt(season, 10),
        parseInt(episode, 10)
      );
      if (vidzeeResult.success && vidzeeResult.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            mode: "hls",
            streamUrl: vidzeeResult.streamUrl,
            subtitles: vidzeeResult.subtitles || [],
            quality: vidzeeResult.quality,
          },
        };
      }
      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: vidzeeResult.error || "No stream found in VidZee cluster",
        },
      };
    }

    // 4.7 KickAssAnime (KAA) Native Dual-Audio Master HLS Resolver
    if (serverId === "kaa_anime") {
      const kaaResult = await resolveKAAStream(title, episode, audio);
      if (kaaResult?.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            serverName: kaaResult.serverName,
            mode: "hls",
            streamUrl: kaaResult.streamUrl,
            subtitles: [],
            quality: kaaResult.quality || "1080p Master HLS",
            hasDub: true,
            supportsDualAudio: true,
            audioType: audio,
          },
        };
      }

      const ap = await resolveAnimeParadise(title, parseInt(episode, 10));
      if (ap?.success && ap.streamUrl) {
        return {
          status: 200,
          data: {
            success: true,
            server: serverId,
            serverName: serverConfig?.name || "Yuji",
            mode: "hls",
            streamUrl: ap.streamUrl,
            subtitles: ap.subtitles || [],
            quality: ap.quality || "1080p FHD",
            hasDub: false,
            supportsDualAudio: false,
            audioType: audio,
          },
        };
      }

      return {
        status: 200,
        data: {
          success: false,
          server: serverId,
          message: "No stream found in KickAssAnime cluster",
        },
      };
    }

    return {
      status: 200,
      data: {
        success: false,
        server: serverId,
        message: "Server returned no playable source",
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        server: serverId,
        message: error instanceof Error ? error.message : "Resolution timeout or network error",
      },
    };
  }
}

export default async function handler(request: any, response?: any) {
  try {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      if (response && typeof response.setHeader === "function") {
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "*");
        response.statusCode = 204;
        return response.end();
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // Node.js req/res (Vercel Serverless Function or Vite dev middleware)
    if (response && (typeof response.status === "function" || typeof response.setHeader === "function")) {
      const host = request.headers?.host || "localhost:5173";
      const fullUrl = new URL(request.url || "/", `http://${host}`);
      const searchParams = fullUrl.searchParams;

      if (request.query && typeof request.query === "object") {
        for (const [k, v] of Object.entries(request.query)) {
          if (typeof v === "string" && !searchParams.has(k)) {
            searchParams.set(k, v);
          }
        }
      }

      const result = await handleResolve(searchParams);
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

      if (typeof response.status === "function" && typeof response.json === "function") {
        return response.status(result.status).json(result.data);
      } else {
        response.statusCode = result.status;
        return response.end(JSON.stringify(result.data));
      }
    }

    // Edge / Standard Fetch Request
    const fullUrl = new URL(request.url, "http://localhost");
    const result = await handleResolve(fullUrl.searchParams);
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  } catch (err: any) {
    console.error("FATAL_RESOLVE_ERROR:", err);
    const errPayload = {
      success: false,
      error: err?.message || String(err),
      stack: err?.stack,
    };
    if (response) {
      if (typeof response.setHeader === "function") {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Access-Control-Allow-Origin", "*");
      }
      if (typeof response.status === "function" && typeof response.json === "function") {
        return response.status(200).json(errPayload);
      }
      response.statusCode = 200;
      return response.end(JSON.stringify(errPayload));
    }
    return new Response(JSON.stringify(errPayload), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}


