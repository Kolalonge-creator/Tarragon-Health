import { withCors } from "./cors.ts";

const ok = () => Response.json({ ok: true });
const req = (method: string, origin: string | null) =>
  new Request("https://x.test/order-checkout", { method, headers: origin ? { Origin: origin } : {} });

Deno.test("preflight from our own site is answered with the headers, without calling the handler", async () => {
  let called = 0;
  const res = await withCors(() => { called++; return ok(); })(req("OPTIONS", "https://tarragonhealth.ng"));
  if (res.status !== 204 || called !== 0) throw new Error("preflight must be 204 and not reach the handler");
  if (res.headers.get("Access-Control-Allow-Origin") !== "https://tarragonhealth.ng") throw new Error("origin not echoed");
  if (!res.headers.get("Access-Control-Allow-Headers")?.includes("authorization")) throw new Error("authorization header not allowed");
  if (!res.headers.get("Access-Control-Allow-Methods")?.includes("POST")) throw new Error("POST not allowed");
});

Deno.test("another site gets no allow-origin header, on the preflight or the real call", async () => {
  const pre = await withCors(ok)(req("OPTIONS", "https://evil.example"));
  if (pre.headers.get("Access-Control-Allow-Origin") !== null) throw new Error("a foreign origin must not be allowed");
  const real = await withCors(ok)(req("POST", "https://evil.example"));
  if (real.headers.get("Access-Control-Allow-Origin") !== null) throw new Error("a foreign origin must not be allowed");
  if (real.headers.get("Access-Control-Allow-Origin") === "*") throw new Error("wildcard is never used");
});

Deno.test("a real call keeps its status and body and gains the headers, errors and 429s included", async () => {
  const limited = () => Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "7" } });
  const res = await withCors(limited)(req("POST", "https://app.tarragonhealth.ng"));
  if (res.status !== 429 || res.headers.get("Retry-After") !== "7") throw new Error("status or existing header lost");
  if (res.headers.get("Access-Control-Allow-Origin") !== "https://app.tarragonhealth.ng") throw new Error("headers missing on an error response");
  const body = await res.json() as { error: string };
  if (body.error !== "rate_limited") throw new Error("body lost");
});

Deno.test("a request with no Origin (mobile app, server) is unchanged apart from Vary", async () => {
  const res = await withCors(ok)(req("POST", null));
  if (res.status !== 200 || res.headers.get("Access-Control-Allow-Origin") !== null) throw new Error("no origin, no CORS headers");
});
