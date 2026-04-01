// ============================================================
// Geo-Restricted Test Stream Worker
// Deploy this on Cloudflare Workers
// ============================================================

const ALLOWED_COUNTRIES = ["BD", "PK", "GB", "US", "AU", "CA"];

// Apple's official HLS test stream — globally accessible, no geo-restriction
const TEST_STREAM_URL = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/stream") {
      return await handleStream(request);
    }

    if (url.pathname === "/debug") {
      return handleDebug(request);
    }

    return new Response(
      JSON.stringify({
        usage: {
          stream: `${url.origin}/stream`,
          debug: `${url.origin}/debug`,
          note: "Add X-Forwarded-For header with any IP to test geo-restriction",
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

// ─────────────────────────────────────────────────────────────
// Stream handler — geo-checks X-Forwarded-For IP
// ─────────────────────────────────────────────────────────────
async function handleStream(request) {
  const xForwardedFor = request.headers.get("X-Forwarded-For");
  const cfCountry = request.headers.get("CF-IPCountry");

  let resolvedCountry = cfCountry;
  let resolvedIP = null;
  let geoSource = "CF-IPCountry";

  if (xForwardedFor) {
    resolvedIP = xForwardedFor.split(",")[0].trim();
    geoSource = "X-Forwarded-For";

    try {
      const geoRes = await fetch(
        `http://ip-api.com/json/${resolvedIP}?fields=countryCode,country,regionName,isp`
      );
      const geo = await geoRes.json();
      if (geo.countryCode) {
        resolvedCountry = geo.countryCode;
      }
    } catch (e) {
      resolvedCountry = cfCountry;
      geoSource = "CF-IPCountry (fallback)";
    }
  }

  const isAllowed = ALLOWED_COUNTRIES.includes(resolvedCountry);

  // ── BLOCKED ──────────────────────────────────────────────
  if (!isAllowed) {
    return new Response(
      JSON.stringify({
        error: "Geo-Restricted",
        reason: `Country '${resolvedCountry}' is not in the allowed list`,
        your_ip: resolvedIP || "unknown",
        geo_source: geoSource,
        allowed_countries: ALLOWED_COUNTRIES,
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // ── ALLOWED — proxy + rewrite relative URLs ───────────────
  const upstream = await fetch(TEST_STREAM_URL);
  const text = await upstream.text();

  // Base URL: everything up to the last slash
  const baseUrl = TEST_STREAM_URL.substring(0, TEST_STREAM_URL.lastIndexOf("/") + 1);

  // Rewrite relative segment/playlist URLs to absolute
  const rewritten = text.replace(
    /^(?!#)([^\s]+)$/gm,
    (match) => {
      if (match.startsWith("http://") || match.startsWith("https://")) return match;
      return baseUrl + match;
    }
  );

  return new Response(rewritten, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "X-Geo-Country": resolvedCountry,
      "X-Geo-Source": geoSource,
      "X-Resolved-IP": resolvedIP || "direct",
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Debug handler — dumps all received headers as JSON
// ─────────────────────────────────────────────────────────────
function handleDebug(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }

  return new Response(
    JSON.stringify(
      {
        message: "All headers received by the worker",
        method: request.method,
        url: request.url,
        headers,
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
