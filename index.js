export const config = { runtime: "edge" };

const BASE_URL = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const EXCLUDED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(request) {
  if (!BASE_URL) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const incomingUrl = new URL(request.url);
    const destination = BASE_URL + incomingUrl.pathname + incomingUrl.search;

    const forwardHeaders = new Headers();
    let realClientIp = null;

    for (const [name, value] of request.headers) {
      const lowerName = name.toLowerCase();

      if (EXCLUDED_HEADERS.has(lowerName)) continue;
      if (lowerName.startsWith("x-vercel-")) continue;
      if (lowerName === "x-real-ip") {
        realClientIp = value;
        continue;
      }
      if (lowerName === "x-forwarded-for") {
        if (!realClientIp) realClientIp = value;
        continue;
      }

      forwardHeaders.set(lowerName, value);
    }

    if (realClientIp) forwardHeaders.set("x-forwarded-for", realClientIp);

    const httpMethod = request.method;
    const supportsBody = httpMethod !== "GET" && httpMethod !== "HEAD";

    const fetchOptions = {
      method: httpMethod,
      headers: forwardHeaders,
      redirect: "manual",
    };

    if (supportsBody) {
      fetchOptions.body = request.body;
      fetchOptions.duplex = "half";
    }

    const upstreamResponse = await fetch(destination, fetchOptions);

    const responseHeaders = new Headers();

    for (const [key, value] of upstreamResponse.headers) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}