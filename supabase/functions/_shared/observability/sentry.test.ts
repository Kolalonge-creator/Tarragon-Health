// Run: deno test --no-config --allow-env=SENTRY_DSN,SENTRY_ENVIRONMENT,SENTRY_RELEASE supabase/functions/_shared/observability/sentry.test.ts
import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import { buildEvent, captureEdgeError, parseDsn, scrubString, withSentry } from "./sentry.ts";

const DSN = "https://abc123@o1.ingest.sentry.io/4567";

function recorder() {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  return { calls, fakeFetch: fakeFetch as typeof fetch };
}

Deno.test("parseDsn builds the envelope endpoint and rejects junk", () => {
  assertEquals(parseDsn(DSN)?.endpoint, "https://o1.ingest.sentry.io/api/4567/envelope/");
  assertEquals(parseDsn(DSN)?.publicKey, "abc123");
  assertEquals(parseDsn(""), null);
  assertEquals(parseDsn("not a url"), null);
  assertEquals(parseDsn("https://o1.ingest.sentry.io/4567"), null); // no key
  assertEquals(parseDsn("https://k@o1.ingest.sentry.io/abc"), null); // non-numeric project
});

Deno.test("scrubString removes emails and phone numbers", () => {
  const out = scrubString("Key (email)=(ada@example.com) phone +2348031234567 failed");
  assertFalse(out.includes("ada@example.com"));
  assertFalse(out.includes("8031234567"));
});

Deno.test("buildEvent scrubs message, stack and extra, tags the function, never carries a request", () => {
  const err = new Error("duplicate key for ada@example.com");
  const ev = buildEvent("process-events", err, { note: "call +2348031234567", nested: { who: "bola@example.com" } }, { release: "abc1234" });
  const json = JSON.stringify(ev);
  assertFalse(json.includes("ada@example.com"));
  assertFalse(json.includes("bola@example.com"));
  assertFalse(json.includes("8031234567"));
  assertEquals(ev.tags.edge_function, "process-events");
  assertEquals(ev.release, "abc1234");
  assertEquals(ev.environment, "production");
  assertFalse("request" in ev);
  assertFalse("user" in ev);
});

Deno.test("captureEdgeError sends nothing when SENTRY_DSN is unset", async () => {
  Deno.env.delete("SENTRY_DSN");
  const { calls, fakeFetch } = recorder();
  assertEquals(await captureEdgeError("x", new Error("boom"), {}, fakeFetch), false);
  assertEquals(calls.length, 0);
});

Deno.test("captureEdgeError posts one envelope to the project endpoint when configured", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  Deno.env.set("SENTRY_RELEASE", "rel-1");
  try {
    const { calls, fakeFetch } = recorder();
    assert(await captureEdgeError("paystack-webhook", new Error("boom"), {}, fakeFetch));
    assertEquals(calls.length, 1);
    assert(calls[0]!.url.startsWith("https://o1.ingest.sentry.io/api/4567/envelope/?sentry_key=abc123"));
    const lines = calls[0]!.body.split("\n");
    assertEquals(lines.length, 3);
    assertEquals(JSON.parse(lines[1]!).type, "event");
    assertEquals(JSON.parse(lines[2]!).release, "rel-1");
  } finally {
    Deno.env.delete("SENTRY_DSN");
    Deno.env.delete("SENTRY_RELEASE");
  }
});

Deno.test("captureEdgeError never throws when the network does", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  try {
    const boom = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    assertEquals(await captureEdgeError("x", new Error("e"), {}, boom), false);
  } finally {
    Deno.env.delete("SENTRY_DSN");
  }
});

Deno.test("withSentry reports an uncaught throw and rethrows it unchanged", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  try {
    const { calls, fakeFetch } = recorder();
    const wrapped = withSentry("zoom-webhook", () => {
      throw new TypeError("handler failed");
    }, fakeFetch);
    const err = await assertRejects(() => wrapped(new Request("https://x.test/")), TypeError, "handler failed");
    assert(err instanceof TypeError);
    assertEquals(calls.length, 1);
  } finally {
    Deno.env.delete("SENTRY_DSN");
  }
});

Deno.test("withSentry reports a returned 5xx once, passes 2xx and 4xx through silently, returns the same response", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  try {
    const { calls, fakeFetch } = recorder();
    const r500 = new Response("no", { status: 500 });
    const out500 = await withSentry("a", () => r500, fakeFetch)(new Request("https://x.test/"));
    assert(out500 === r500);
    assertEquals(calls.length, 1);
    await withSentry("a", () => new Response("ok"), fakeFetch)(new Request("https://x.test/"));
    await withSentry("a", () => new Response("bad", { status: 401 }), fakeFetch)(new Request("https://x.test/"));
    assertEquals(calls.length, 1);
  } finally {
    Deno.env.delete("SENTRY_DSN");
  }
});

Deno.test("withSentry with no DSN behaves exactly like the bare handler", async () => {
  Deno.env.delete("SENTRY_DSN");
  const { calls, fakeFetch } = recorder();
  const res = await withSentry("a", () => new Response("hi", { status: 503 }), fakeFetch)(new Request("https://x.test/"));
  assertEquals(res.status, 503);
  assertEquals(calls.length, 0);
});

// ---- S88 review fixes -------------------------------------------------------------------------------------------------
import { HIGH_RISK_FUNCTIONS, parseFrames, resetSentryRateLimit, shortHash, stripUrls } from "./sentry.ts";

Deno.test("scrubString removes OTP-like runs, UUIDs, tokens, Postgres detail, JSON and URLs", () => {
  const cases: [string, string[]][] = [
    ["code 482913 for sign in", ["482913"]],
    ["otp 1234 rejected", ["1234"]],
    ["row 6f1c2d3e-9a8b-4c7d-8e6f-0a1b2c3d4e5f missing", ["6f1c2d3e", "0a1b2c3d4e5f"]],
    ["Unauthorized Bearer " + ["ey" + "JhbGciOiJIUzI1NiJ9", "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijk"].join("."), ["eyJ", "abcdefghijk"]],
    ["duplicate key value violates unique constraint. Key (phone)=(+2348031234567) already exists", ["8031234567"]],
    ["Key (email)=(ada@example.com) already exists", ["ada@example.com"]],
    ["Failing row contains (11, Ada Obi, 140/90)", ["Ada Obi", "140/90"]],
    ['Unexpected token in JSON {"note":"my chest hurts","glucose":"11.2"}', ["chest", "11.2"]],
    ['invalid input syntax for type uuid: "adaobi-not-a-uuid"', ["adaobi"]],
    ["fetch https://x.supabase.co/rest/v1/patients?id=eq.77&name=eq.Ada failed", ["rest/v1", "eq.77", "name=eq", "Ada"]],
    ["bad filter patient_id=in.(1,2,3) and status=eq.open", ["1,2,3", "eq.open"]],
  ];
  for (const [input, gone] of cases) {
    const out = scrubString(input);
    for (const bad of gone) assertFalse(out.includes(bad), `"${bad}" survived in: ${out}`);
  }
  assertEquals(stripUrls("GET https://u:p@api.example.com:8443/a/b?c=d#e"), "GET https://api.example.com:8443");
  assert(scrubString("HTTP 503 from upstream").includes("503"));
});

Deno.test("sabotage: the raw inputs do contain what the scrubber is meant to remove", () => {
  assert("code 482913 for sign in".includes("482913"));
  assert(!"x".includes("482913"));
});

Deno.test("high-risk functions send only the error class and a hash, never the message or extra text", () => {
  for (const fn of ["auth-send-sms-hook", "scribe-draft", "order-checkout", "payouts"]) {
    assert(HIGH_RISK_FUNCTIONS.has(fn));
    const ev = buildEvent(fn, new TypeError("OTP 482913 for Ada Obi"), { phase: "uncaught", note: "Ada Obi", status: 500, phone: "+2348031234567" });
    const json = JSON.stringify(ev);
    assertFalse(json.includes("482913"));
    assertFalse(json.includes("Ada"));
    assertFalse(json.includes("8031234567"));
    assertEquals(ev.exception.values[0]!.type, "TypeError");
    assert(/^message withheld \(ref [0-9a-f]{8}\)$/.test(ev.exception.values[0]!.value));
    assertEquals(ev.extra, { phase: "uncaught", status: 500 });
  }
  // Control: a normal function still carries its (scrubbed) message, so the withholding really is function-specific.
  const normal = buildEvent("process-events", new Error("boom here"), {});
  assertEquals(normal.exception.values[0]!.value, "boom here");
});

Deno.test("a multi-line message cannot leak through the stack, and frames are parsed", () => {
  const err = new Error("first\nAda Obi line two");
  err.stack = "Error: first\nAda Obi line two\n    at readIt (file:///src/functions/x/index.ts:12:3)\n    at file:///src/y.ts:4:5";
  const ev = buildEvent("process-events", err, {});
  const json = JSON.stringify(ev.exception.values[0]!.stacktrace);
  assertFalse(json.includes("Ada"));
  assertEquals(parseFrames(err.stack!), [
    { function: "readIt", filename: "index.ts", lineno: 12, colno: 3 },
    { function: "?", filename: "y.ts", lineno: 4, colno: 5 },
  ]);
  assertEquals(shortHash("a").length, 8);
});

Deno.test("withSentry does not wait for Sentry: a never-resolving capture does not delay a 5xx response", { sanitizeOps: false, sanitizeResources: false }, async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  resetSentryRateLimit();
  try {
    const hang = (() => new Promise(() => {})) as typeof fetch;
    const started = performance.now();
    const res = await withSentry("auth-send-sms-hook", () => new Response("no", { status: 502 }), hang)(new Request("https://x.test/"));
    assertEquals(res.status, 502);
    assert(performance.now() - started < 200, "response waited on Sentry");
    // And the throw path rethrows immediately too.
    const t0 = performance.now();
    await assertRejects(() => withSentry("auth-send-sms-hook", () => { throw new Error("x"); }, hang)(new Request("https://x.test/")), Error, "x");
    assert(performance.now() - t0 < 200);
  } finally {
    Deno.env.delete("SENTRY_DSN");
  }
});

Deno.test("withSentry hands the capture to EdgeRuntime.waitUntil when the platform has it", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  resetSentryRateLimit();
  const g = globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } };
  const held: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (p) => void held.push(p) };
  try {
    const { fakeFetch } = recorder();
    await withSentry("wait-until-fn", () => new Response("no", { status: 500 }), fakeFetch)(new Request("https://x.test/"));
    assertEquals(held.length, 1);
    await Promise.all(held);
  } finally {
    delete g.EdgeRuntime;
    Deno.env.delete("SENTRY_DSN");
  }
});

Deno.test("rate limit: one event per fingerprint per minute per function, a new fingerprint still goes out", async () => {
  Deno.env.set("SENTRY_DSN", DSN);
  resetSentryRateLimit();
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { calls, fakeFetch } = recorder();
    for (let i = 0; i < 5; i++) await captureEdgeError("rl-fn", new Error("same failure"), {}, fakeFetch);
    assertEquals(calls.length, 1);
    await captureEdgeError("rl-fn", new Error("another failure"), {}, fakeFetch);
    assertEquals(calls.length, 2);
    await captureEdgeError("other-fn", new Error("same failure"), {}, fakeFetch);
    assertEquals(calls.length, 3);
    now += 61_000;
    await captureEdgeError("rl-fn", new Error("same failure"), {}, fakeFetch);
    assertEquals(calls.length, 4);
    // A burst of 5xx responses from one function is one event.
    const wrapped = withSentry("burst-fn", () => new Response("no", { status: 500 }), fakeFetch);
    for (let i = 0; i < 10; i++) await wrapped(new Request("https://x.test/"));
    assertEquals(calls.length, 5);
  } finally {
    Date.now = realNow;
    Deno.env.delete("SENTRY_DSN");
  }
});
