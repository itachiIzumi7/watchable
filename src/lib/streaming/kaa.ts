// KickAssAnime (KAA) Native Master HLS Stream Resolver
// High-speed, dual-audio (Japanese & English Dub), 1080p Master HLS streams from hls.krussdomi.com

interface KAAResult {
  success: boolean;
  server: string;
  serverName: string;
  streamUrl?: string;
  type?: string;
  format?: string;
  quality?: string;
  hasDub?: boolean;
  supportsDualAudio?: boolean;
  error?: string;
}

const KAA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export async function resolveKAAStream(
  title: string,
  episode: number | string = 1,
  _preferredAudio: string = "dub"
): Promise<KAAResult | null> {
  try {
    let cleanTitle = (title || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ū/gi, "u")
      .replace(/ō/gi, "o")
      .replace(/Shippūden/gi, "Shippuden")
      .replace(/Shippuuden/gi, "Shippuden")
      .replace(/\s*S\d+\s*E\d+.*$/i, "")
      .replace(/\s*Season\s*\d+.*$/i, "")
      .replace(/\s*Episode\s*\d+.*$/i, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/[:\-]\s*ep(isode)?\s*\d+.*$/i, "")
      .replace(/[:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanTitle) return null;

    // 1. Search show on KAA
    const searchRes = await fetch("https://kaa.lt/api/fsearch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://kaa.lt/",
        "User-Agent": KAA_USER_AGENT,
      },
      body: JSON.stringify({ query: cleanTitle }),
      signal: AbortSignal.timeout(4500),
    });

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    let shows = searchData?.result || [];

    if (!shows.length && cleanTitle.includes(" ")) {
      const shorter = cleanTitle.split(" ").slice(0, 2).join(" ");
      const retryRes = await fetch("https://kaa.lt/api/fsearch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: "https://kaa.lt/",
          "User-Agent": KAA_USER_AGENT,
        },
        body: JSON.stringify({ query: shorter }),
        signal: AbortSignal.timeout(4500),
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        shows = retryData?.result || [];
      }
    }

    if (!shows.length) return null;

    const targetSlug = cleanTitle
      .toLowerCase()
      .replace(/shippuuden/gi, "shippuden")
      .replace(/[^a-z0-9]/g, "");

    const show =
      shows.find((s: any) => {
        const slug = (s.slug || "").toLowerCase();
        const t = (s.title || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/ū/gi, "u")
          .replace(/ō/gi, "o")
          .replace(/shippuuden/gi, "shippuden")
          .toLowerCase();
        const normClean = cleanTitle.toLowerCase();
        const isNotExtra =
          !slug.includes("pv") &&
          !slug.includes("trailer") &&
          !slug.includes("music") &&
          !slug.includes("movie") &&
          !t.includes("movie") &&
          !t.includes("official pv") &&
          !t.includes("trailer") &&
          s.type !== "special";

        const normShowSlug = slug.replace(/[^a-z0-9]/g, "");
        const slugMatch =
          normShowSlug.startsWith(targetSlug) ||
          normShowSlug.includes(targetSlug) ||
          targetSlug.includes(normShowSlug);
        const titleMatch =
          t === normClean ||
          t.includes(normClean) ||
          normClean.includes(t) ||
          t.startsWith(normClean + " ") ||
          normClean.startsWith(t + " ");

        return isNotExtra && (slugMatch || titleMatch);
      }) || shows[0];

    if (!show?.slug) return null;

    // 2. Fetch episode list for show (100 eps per page)
    const page = Math.ceil(Number(episode) / 100) || 1;
    let epRes = await fetch(`https://kaa.lt/api/show/${show.slug}/episodes?lang=ja-JP&page=${page}`, {
      headers: {
        Referer: "https://kaa.lt/",
        "User-Agent": KAA_USER_AGENT,
      },
      signal: AbortSignal.timeout(4500),
    });

    let epData = epRes.ok ? await epRes.json() : null;
    let episodes = epData?.result || [];

    if (!episodes.length) {
      epRes = await fetch(`https://kaa.lt/api/show/${show.slug}/episodes?lang=en-US&page=${page}`, {
        headers: {
          Referer: "https://kaa.lt/",
          "User-Agent": KAA_USER_AGENT,
        },
        signal: AbortSignal.timeout(4500),
      });
      epData = epRes.ok ? await epRes.json() : null;
      episodes = epData?.result || [];
    }

    const targetEp = episodes.find(
      (e: any) =>
        e.episode_number === Number(episode) ||
        e.episode_string === String(episode)
    );

    if (!targetEp?.slug) return null;

    // 3. Fetch episode page to extract master stream ID
    const epPageUrl = `https://kaa.lt/${show.slug}/ep-${targetEp.episode_number}-${targetEp.slug}`;
    const pageRes = await fetch(epPageUrl, {
      headers: {
        Referer: "https://kaa.lt/",
        "User-Agent": KAA_USER_AGENT,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const idMatch = html.match(/id=([a-f0-9]{24})/);
    if (!idMatch?.[1]) return null;

    const id = idMatch[1];
    const rawStreamUrl = `https://hls.krussdomi.com/manifest/${id}/master.m3u8`;
    const proxiedUrl = `/api/stream/proxy?url=${encodeURIComponent(
      rawStreamUrl
    )}&referer=${encodeURIComponent("https://krussdomi.com/")}&origin=${encodeURIComponent(
      "https://krussdomi.com"
    )}`;

    return {
      success: true,
      server: "kaa_anime",
      serverName: "Yuji (KickAssAnime Dual-Audio HLS)",
      streamUrl: proxiedUrl,
      type: "m3u8",
      format: "hls",
      quality: "1080p Master HLS",
      hasDub: true,
      supportsDualAudio: true,
    };
  } catch (err: any) {
    console.error("resolveKAA error:", err);
    return null;
  }
}
