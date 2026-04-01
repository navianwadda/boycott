// ============================================================
// Geo-Restricted Test Stream Worker
// Deploy this on Cloudflare Workers
// ============================================================

const ALLOWED_COUNTRIES = ["BD", "PK", "GB", "US", "AU", "CA"];

// Free public test HLS stream (Mux test stream - no license issues)
const TEST_STREAM_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ── Route: /stream ───────────────────────────────────────
    if (url.pathname === "/stream") {
      return await handleStream(request);
    }

    // ── Route: /debug  (shows all headers received) ──────────
    if (url.pathname === "/debug") {
      return handleDebug(request);
    }

    // ── Default: usage info ──────────────────────────────────
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
  const cfCountry = request.headers.get("CF-IPCountry"); // Cloudflare auto header

  let resolvedCountry = cfCountry;
  let resolvedIP = null;
  let geoSource = "CF-IPCountry";

  // If X-Forwarded-For is present, geolocate that IP
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
      // Fallback to CF country if ip-api fails
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

  // ── ALLOWED — redirect to test stream ────────────────────
  const upstream = await fetch(TEST_STREAM_URL);
return new Response(upstream.body, {
  headers: {
    "Content-Type": "application/vnd.apple.mpegurl",
    "Access-Control-Allow-Origin": "*",
    "X-Geo-Country": resolvedCountry,
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
