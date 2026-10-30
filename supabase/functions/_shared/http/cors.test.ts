import { withCors } from "./cors.ts";

const ok = () => Response.json({ ok: true });
const req = (method: string, origin: string | null, extra: Record<string, string> = {}) =>
  new Request("https://x.test/order-checkout", { method, headers: { ...(origin ? { Origin: origin } : {}), ...extra } });

Deno.test("preflight from our own site is answered with the headers, without calling the handler", async () => {
  let called = 0;
  const res = await withCors(() => { called++; return ok(); })(req("OPTIONS", "https://tarragonhealth.ng"));
  if (res.status !== 204 || called !== 0) throw new Error("preflight must be 204 and not reach the handler");
  if (res.headers.get("Access-Control-Allow-Origin") !== "https://tarragonhealth.ng") throw new Error("origin not echoed");
  if (!res.headers.get("Access-Control-Allow-Headers")?.includes("authorization")) throw new Error("authorization header not allowed");
  if (!res.headers.get("Access-Control-Allow-Methods")?.includes("POST")) throw new Error("POST not allowed");
  if (!res.headers.get("Vary")?.includes("Origin")) throw new Error("Vary: Origin missing");
});

Deno.test("another site, a lookalike, a substring and a null origin get no allow-origin header", async () => {
  for (const origin of ["https://evil.example", "https://tarragonhealth.ng.evil.example", "https://eviltarragonhealth.ng", "null", "http://tarragonhealth.ng"]) {
    const pre = await withCors(ok)(req("OPTIONS", origin));
    if (pre.headers.get("Access-Control-Allow-Origin") !== null) throw new Error(`origin ${origin} must not be allowed`);
    const real = await withCors(ok)(req("POST", origin));
    if (real.headers.get("Access-Control-Allow-Origin") !== null) throw new Error(`origin ${origin} must not be allowed`);
  }
});

Deno.test("a header the browser asks for in the preflight is allowed for our site, a malformed list is not echoed", async () => {
  const pre = await withCors(ok)(req("OPTIONS", "https://app.tarragonhealth.ng", { "Access-Control-Request-Headers": "authorization,x-new-sdk-header" }));
  if (!pre.headers.get("Access-Control-Allow-Headers")?.includes("x-new-sdk-header")) throw new Error("requested header was not allowed");
  const bad = await withCors(ok)(req("OPTIONS", "https://app.tarragonhealth.ng", { "Access-Control-Request-Headers": "x-a; evil=1, <script>" }));
  if (bad.headers.get("Access-Control-Allow-Headers")?.includes("evil")) throw new Error("a malformed list must not be echoed");
});

Deno.test("a real call keeps its status and body and gains the headers, errors and 429s included, and Retry-After is exposed", async () => {
  const limited = () => Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "7" } });
  const res = await withCors(limited)(req("POST", "https://app.tarragonhealth.ng"));
  if (res.status !== 429 || res.headers.get("Retry-After") !== "7") throw new Error("status or existing header lost");
  if (res.headers.get("Access-Control-Allow-Origin") !== "https://app.tarragonhealth.ng") throw new Error("headers missing on an error response");
  if (!res.headers.get("Access-Control-Expose-Headers")?.includes("Retry-After")) throw new Error("Retry-After is not exposed to the page");
  const body = await res.json() as { error: string };
  if (body.error !== "rate_limited") throw new Error("body lost");
});

Deno.test("a handler that throws still gives the browser a readable 500 with the headers", async () => {
  const boom = () => { throw new Error("db down"); };
  const res = await withCors(boom)(req("POST", "https://tarragonhealth.ng"));
  if (res.status !== 500) throw new Error("expected 500");
  if (res.headers.get("Access-Control-Allow-Origin") !== "https://tarragonhealth.ng") throw new Error("headers missing on a thrown error");
});

Deno.test("a request with no Origin (mobile app, server) is unchanged apart from Vary", async () => {
  const res = await withCors(ok)(req("POST", null));
  if (res.status !== 200 || res.headers.get("Access-Control-Allow-Origin") !== null) throw new Error("no origin, no CORS headers");
});

Deno.test("every function the web app calls from the browser is wrapped in withCors", async () => {
  for (const fn of ["order-checkout", "order-verify", "hmo-eligibility"]) {
    const src = await Deno.readTextFile(new URL(`../../${fn}/index.ts`, import.meta.url));
    if (!src.includes("Deno.serve(withCors(")) throw new Error(`${fn}/index.ts is not wrapped in withCors`);
  }
});
