import vm from "vm";

interface CinejoyCaption {
  type: string;
  id: string;
  url: string;
  language: string;
}

interface CinejoyStreamSource {
  type: string;
  id: string;
  playlist: string;
  captions?: CinejoyCaption[];
}

interface CinejoyResponse {
  stream?: CinejoyStreamSource[];
}

interface CinejoyApi {
  GW: () => Promise<Array<{ name: string; status: string; "4k": boolean }>>;
  pW: (server: string, tmdbId: number | string, imdbId?: string, year?: number, title?: string) => Promise<CinejoyResponse>;
  qW: (server: string, tmdbId: number | string, season?: number | string, episode?: number | string, imdbId?: string, title?: string, year?: number) => Promise<CinejoyResponse>;
}

let cachedApiPromise: Promise<CinejoyApi | null> | null = null;

async function initCinejoyApi(): Promise<CinejoyApi | null> {
  try {
    const res = await fetch("https://cinejoy.pk/_app/immutable/chunks/DHJgaGwg.js", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://cinejoy.pk/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const code = await res.text();

    const icIdx = code.indexOf("function ic(");
    if (icIdx === -1) return null;
    const nextFnAfterIc = code.indexOf("function ", icIdx + 500);
    const mIdx = code.indexOf("function M(){");
    if (mIdx === -1) return null;

    const sliceCode = code.slice(mIdx, nextFnAfterIc !== -1 ? nextFnAfterIc : icIdx + 5000);

    const sandbox: Record<string, unknown> = {
      console,
      fetch: (url: string, opts: RequestInit = {}) => {
        const headers: Record<string, string> = {
          Referer: "https://cinejoy.pk/",
          Origin: "https://cinejoy.pk",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          ...((opts.headers as Record<string, string>) || {}),
        };
        return fetch(url, { ...opts, headers });
      },
      Headers,
      Request,
      Response,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      WebAssembly,
      crypto: globalThis.crypto,
      Intl,
      setTimeout,
      clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const fullCode = "const B = { subtitles: [], languages: [] };" + sliceCode + "globalThis.__API__ = { GW, pW, qW };";
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fullCode, ctx);

    return (sandbox.__API__ as CinejoyApi) || null;
  } catch (err) {
    console.error("[Cinejoy] Failed to initialize scraper engine:", err);
    return null;
  }
}

export async function getCinejoyApi(): Promise<CinejoyApi | null> {
  if (!cachedApiPromise) {
    cachedApiPromise = initCinejoyApi()
      .then((api) => {
        if (!api) cachedApiPromise = null;
        return api;
      })
      .catch((_err) => {
        cachedApiPromise = null;
        return null;
      });
  }
  return cachedApiPromise;
}

export interface CinejoyResolveResult {
  server: string;
  streamUrl: string;
  subtitles?: Array<{ label?: string; file?: string; lang?: string; kind?: string }>;
  quality?: string;
  is4k?: boolean;
}

export async function resolveCinejoyStream(
  requestedServer: "auto" | "lisbon" | "nebula" | "solara",
  tmdbId: string | number,
  type: string = "movie",
  season: string | number = 1,
  episode: string | number = 1,
  title?: string,
  year?: number
): Promise<CinejoyResolveResult | null> {
  try {
    const api = await getCinejoyApi();
    if (!api) return null;

    // Server priority ordering: Nebula (stable 1080p + edge cached) -> Lisbon (4K when available)
    const serversToTry = requestedServer === "auto" ? ["nebula", "lisbon"] : [requestedServer];

    for (const serverName of serversToTry) {
      try {
        let res: CinejoyResponse | null = null;
        if (type === "tv") {
          res = await api.qW(serverName, tmdbId, season, episode, undefined, title, year);
        } else {
          res = await api.pW(serverName, tmdbId, undefined, year, title);
        }

        const streamItem = res?.stream?.[0];
        if (streamItem?.playlist) {
          const subtitles = (streamItem.captions || []).map((c) => {
            const proxiedVtt = `/api/stream/proxy?url=${encodeURIComponent(
              c.url
            )}&referer=${encodeURIComponent("https://cinejoy.pk/")}&origin=${encodeURIComponent(
              "https://cinejoy.pk"
            )}`;
            return {
              label: c.language.toUpperCase(),
              lang: c.language,
              url: proxiedVtt,
              file: proxiedVtt,
              kind: "captions",
              default: c.language === "en",
            };
          });

          const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(
            streamItem.playlist
          )}&referer=${encodeURIComponent("https://cinejoy.pk/")}&origin=${encodeURIComponent("https://cinejoy.pk")}`;

          return {
            server: `Cinejoy ${serverName === "lisbon" ? "Lisbon (4K)" : serverName === "nebula" ? "Nebula (1080p)" : serverName.toUpperCase()}`,
            streamUrl: proxiedUrl,
            subtitles,
            quality: serverName === "lisbon" ? "4K" : "1080p",
            is4k: serverName === "lisbon",
          };
        }
      } catch {
        // Try next server in cluster
        continue;
      }
    }
  } catch (err) {
    console.error("[Cinejoy] Stream resolution error:", err);
  }

  return null;
}
