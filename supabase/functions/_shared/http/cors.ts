// Browser access to the edge functions the web app calls directly (order-checkout, order-verify, hmo-eligibility).
//
// supabase-js in the browser sends a preflight OPTIONS request and then the real call. A function that does not answer the
// preflight with the right CORS headers is blocked by the browser BEFORE any request is sent: the patient sees "Something went
// wrong", no order is made, and nothing reaches the function logs. The mobile app is not affected (native fetch, no CORS), which
// is why this stayed hidden until the first live web payment test (2026-10-30).
//
// Only our own web origins are allowed, and the origin is echoed back (never "*"), so another site cannot call these functions
// with a signed-in patient's browser. Every response gets the headers, including errors and 429s, because a browser hides the
// body of a response that lacks them. Retry-After is exposed so the page can read how long to wait.
//
// Wrap a function from the OUTSIDE: Deno.serve(withCors(withSentry(name, handler))). An uncaught error then still reaches the
// browser as a plain 500 with the headers, instead of as a misleading CORS failure.

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://tarragonhealth.ng",
  "https://www.tarragonhealth.ng",
  "https://app.tarragonhealth.ng",
  // local web development against the hosted project
  "http://localhost:3000",
  "http://app.localhost:3000",
]);

/** What supabase-js sends today; any other header the browser asks for in the preflight is echoed back for an allowed origin. */
const BASE_ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info, x-supabase-api-version";
// a header NAME list as a browser sends it: tokens separated by commas, nothing else
const SAFE_HEADER_LIST = /^[A-Za-z0-9-]+(\s*,\s*[A-Za-z0-9-]+)*$/;

function corsHeadersFor(req: Request): Headers {
  const h = new Headers();
  h.set("Vary", "Origin, Access-Control-Request-Headers");
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    const asked = req.headers.get("Access-Control-Request-Headers");
    h.set("Access-Control-Allow-Headers", asked && SAFE_HEADER_LIST.test(asked) ? `${BASE_ALLOWED_HEADERS}, ${asked}` : BASE_ALLOWED_HEADERS);
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Expose-Headers", "Retry-After");
    h.set("Access-Control-Max-Age", "600");
  }
  return h;
}

/** Wraps a handler: answers the preflight itself and adds the CORS headers to every other response. */
export function withCors(handler: (req: Request) => Response | Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadersFor(req) });
    let res: Response;
    try {
      res = await handler(req);
    } catch {
      // the error was already reported by the inner wrapper; the browser gets a readable 500, not a CORS failure
      res = Response.json({ error: "unknown" }, { status: 500 });
    }
    const extra = corsHeadersFor(req);
    const headers = new Headers(res.headers);
    extra.forEach((value, key) => headers.set(key, value));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
