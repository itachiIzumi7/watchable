import fs from "fs";
import path from "path";

export interface StellarSubtitle {
  label: string;
  lang: string;
  url: string;
  source?: string;
  default?: boolean;
}

export interface StellarResolveResult {
  streamUrl: string;
  server: string;
  quality?: string;
  qualities?: string[];
  subtitles?: StellarSubtitle[];
  is4k?: boolean;
}

interface WasmEngine {
  initSync: (options: { module: Buffer | Uint8Array }) => void;
  init_session?: () => void;
  encrypt_request_payload: (payload: string) => Uint8Array;
  decrypt_response_payload_bytes: (bytes: Uint8Array) => string;
}

let cachedEngine: WasmEngine | null = null;
let engineInitPromise: Promise<WasmEngine | null> | null = null;

async function getWasmEngine(): Promise<WasmEngine | null> {
  if (cachedEngine) return cachedEngine;
  if (engineInitPromise) return engineInitPromise;

  engineInitPromise = (async () => {
    try {
      let jsPath = path.join(process.cwd(), "src/lib/streaming/stellar-engine/engine.js");
      let wasmPath = path.join(process.cwd(), "src/lib/streaming/stellar-engine/engine.wasm");

      if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
        jsPath = path.join(process.cwd(), "src/lib/stellar-engine/engine.js");
        wasmPath = path.join(process.cwd(), "src/lib/stellar-engine/engine.wasm");
      }

      if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
        console.error("[Stellar] Engine files not found at:", jsPath, wasmPath);
        return null;
      }

      const engineCode = fs.readFileSync(jsPath, "utf8");
      const wasmBuffer = fs.readFileSync(wasmPath);

      const fn = new Function(engineCode + "; return wasm_bindgen;");
      const wasm = fn() as WasmEngine;
      wasm.initSync({ module: wasmBuffer });
      if (wasm.init_session) wasm.init_session();

      cachedEngine = wasm;
      return wasm;
    } catch (err) {
      console.error("[Stellar] Failed to initialize Wasm engine:", err);
      return null;
    }
  })();

  return engineInitPromise;
}

async function callStellarProtected(
  engine: WasmEngine,
  endpoint: string,
  payload: Record<string, unknown>
): Promise<any> {
  const encrypted = engine.encrypt_request_payload(JSON.stringify(payload));
  const res = await fetch(`https://api.stellar.gdn${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://stellar.gdn/",
      Origin: "https://stellar.gdn",
      Accept: "*/*",
    },
    body: Buffer.from(encrypted),
    signal: AbortSignal.timeout(2800),
  });

  if (!res.ok) {
    throw new Error(`Stellar API ${endpoint} failed with HTTP ${res.status}`);
  }

  const arrayBuf = await res.arrayBuffer();
  if (!arrayBuf || arrayBuf.byteLength === 0) {
    throw new Error(`Empty response from Stellar API ${endpoint}`);
  }

  const decryptedStr = engine.decrypt_response_payload_bytes(new Uint8Array(arrayBuf));
  return JSON.parse(decryptedStr);
}

export async function resolveStellarStream(
  targetServer: string = "auto",
  tmdbId: number | string,
  type: "movie" | "tv",
  season: number | string = 1,
  episode: number | string = 1
): Promise<StellarResolveResult | null> {
  try {
    const engine = await getWasmEngine();
    if (!engine) return null;

    const numericTmdbId = typeof tmdbId === "string" ? parseInt(tmdbId, 10) : tmdbId;
    if (!numericTmdbId || isNaN(numericTmdbId)) return null;

    // Define priority server candidates
    let serverCandidates: string[] = [];
    if (targetServer === "miami" || targetServer === "stellar_miami") {
      serverCandidates = ["Miami", "Boise", "Atlanta"];
    } else if (targetServer === "boise" || targetServer === "stellar_boise") {
      serverCandidates = ["Boise", "Miami", "Atlanta"];
    } else if (targetServer === "atlanta") {
      serverCandidates = ["Atlanta", "Miami", "Boise"];
    } else {
      // auto / default: Miami -> Boise -> Atlanta -> Orlando
      serverCandidates = ["Miami", "Boise", "Atlanta", "Orlando"];
    }

    const sNum = typeof season === "string" ? parseInt(season, 10) : season;
    const eNum = typeof episode === "string" ? parseInt(episode, 10) : episode;

    let streamData: any = null;
    let chosenServer = "";

    for (const s of serverCandidates) {
      try {
        const payload: Record<string, unknown> = {
          mediaType: type === "tv" ? "tv" : "movie",
          id: String(numericTmdbId),
          source: s,
        };
        if (type === "tv") {
          payload.season = sNum || 1;
          payload.episode = eNum || 1;
        }

        const res = await callStellarProtected(engine, "/api/r", payload);
        if (res && res.url) {
          streamData = res;
          chosenServer = s;
          break;
        }
      } catch {
        // Try next candidate
        continue;
      }
    }

    if (!streamData?.url) return null;

    // Fetch subtitles asynchronously in parallel or right away
    let subtitles: StellarSubtitle[] = [];
    try {
      const subPayload: Record<string, unknown> = {
        mediaType: type === "tv" ? "tv" : "movie",
        id: numericTmdbId,
      };
      if (type === "tv") {
        subPayload.season = sNum || 1;
        subPayload.episode = eNum || 1;
      }

      const subRes = await callStellarProtected(engine, "/api/subtitles", subPayload);
      if (Array.isArray(subRes?.subtitles)) {
        subtitles = subRes.subtitles.map((sub: any) => ({
          label: sub.label || sub.language || "Subtitle",
          lang: sub.language || "en",
          url: `/api/stream/proxy?url=${encodeURIComponent(sub.url)}&referer=${encodeURIComponent("https://stellar.gdn/")}&origin=${encodeURIComponent("https://stellar.gdn")}`,
          source: sub.source || "Stellar",
          default: sub.language === "en",
        }));
      }
    } catch {
      // Subtitle failure is non-fatal
    }

    const rawUrl = streamData.url;
    const is4k =
      streamData.quality?.toLowerCase()?.includes("4k") ||
      streamData.qualities?.some((q: any) => (q.quality || q).toString().toLowerCase().includes("4k")) ||
      false;

    // Proxy stream through Streamly's local proxy
    const proxiedStreamUrl = `/api/stream/proxy?url=${encodeURIComponent(
      rawUrl
    )}&referer=${encodeURIComponent("https://stellar.gdn/")}&origin=${encodeURIComponent("https://stellar.gdn")}`;

    const qualitiesList = Array.isArray(streamData.qualities)
      ? streamData.qualities.map((q: any) => q.quality || q)
      : streamData.quality
      ? [streamData.quality]
      : [];

    return {
      streamUrl: proxiedStreamUrl,
      server: `Stellar ${chosenServer} (${is4k ? "4K" : streamData.quality || "1080p"})`,
      quality: streamData.quality || (is4k ? "4K" : "1080p"),
      qualities: qualitiesList,
      subtitles,
      is4k,
    };
  } catch (err) {
    console.error("[Stellar] Stream resolution error:", err);
    return null;
  }
}
