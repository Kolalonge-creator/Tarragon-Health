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
