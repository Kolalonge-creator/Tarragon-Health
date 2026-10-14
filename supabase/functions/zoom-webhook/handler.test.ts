// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handleZoomWebhook, verifyZoomSignature } from "./handler.ts";
import { createMemoryInbox } from "../../../packages/integrations/src/support/memory-inbox.ts";

const SECRET = "zoom-secret-token";
type Row = Record<string, unknown>;

/** Just enough of a query builder for zoom-webhook: two tables, eq / neq / not filters, insert with a unique key on the audit table. */
function fakeDb(opts: { consultation?: Row | null; auditInsertError?: boolean } = {}) {
  const audit: Row[] = [];
  const consultation: Row | null = opts.consultation === undefined ? { id: "vc-1", zoom_meeting_id: "999", status: "scheduled" } : opts.consultation;
  const updates: Row[] = [];
  const db = {
    from(table: string) {
      if (table === "zoom_webhook_events") {
        return {
          insert(row: Row) {
            return { select: () => ({ maybeSingle: () => {
              if (opts.auditInsertError) return Promise.resolve({ data: null, error: { code: "XX000" } });
              if (audit.some((r) => r["provider_event_id"] === row["provider_event_id"])) return Promise.resolve({ data: null, error: { code: "23505" } });
              const r = { ...row, id: `a-${audit.length + 1}` };
              audit.push(r);
              return Promise.resolve({ data: { id: r.id }, error: null });
            } }) };
          },
          select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: () => Promise.resolve({ data: audit.find((r) => r["provider_event_id"] === v) ?? null, error: null }) }) }),
          update: (patch: Row) => ({ eq: (_c: string, id: string) => { const r = audit.find((x) => x["id"] === id); if (r) Object.assign(r, patch); return Promise.resolve({ error: null }); } }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: consultation ? { id: consultation["id"] } : null, error: null }) }) }),
        update: (patch: Row) => {
          const apply = (blocked: (status: unknown) => boolean) => { if (consultation && !blocked(consultation["status"])) { Object.assign(consultation, patch); updates.push(patch); } return Promise.resolve({ error: null }); };
          return { eq: () => ({ not: (_c: string, _op: string, list: string) => apply((s) => list.replace(/[()]/g, "").split(",").includes(String(s))), neq: (_c: string, v: string) => apply((s) => s === v) }) };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, audit, consultation, updates };
}

async function sign(body: string, ts = "1800000000"): Promise<Record<string, string>> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${body}`));
  return { "x-zm-request-timestamp": ts, "x-zm-signature": `v0=${Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("")}` };
}
const noFetch = () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve("") });
const post = async (body: string, deps: Parameters<typeof handleZoomWebhook>[1], signed = true) => {
  const res = await handleZoomWebhook(new Request("https://x.test/zoom", { method: "POST", body, headers: signed ? await sign(body) : { "x-zm-request-timestamp": "1", "x-zm-signature": "v0=bad" } }), deps);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};
const ended = JSON.stringify({ event: "meeting.ended", event_ts: 1700, payload: { object: { id: 999, uuid: "u-1" } } });
const started = JSON.stringify({ event: "meeting.started", event_ts: 1600, payload: { object: { id: 999, uuid: "u-1" } } });
const mk = (extra: Partial<Parameters<typeof handleZoomWebhook>[1]> = {}) => {
  const f = fakeDb();
  const store = createMemoryInbox();
  return { f, store, deps: { secret: SECRET, db: f.db, store, appBaseUrl: undefined, fetch: noFetch, ...extra } };
};

Deno.test("signature check: fails closed without a secret, rejects a missing or wrong one", async () => {
  assertEquals(await verifyZoomSignature(null, "{}", "1", "v0=x"), false);
  assertEquals(await verifyZoomSignature(SECRET, "{}", null, "v0=x"), false);
  assertEquals(await verifyZoomSignature(SECRET, "{}", "1", null), false);
  const h = await sign("{}");
  assertEquals(await verifyZoomSignature(SECRET, "{}", h["x-zm-request-timestamp"]!, h["x-zm-signature"]!), true);
});

Deno.test("method, bad JSON and the url validation handshake", async () => {
  const { deps } = mk();
  assertEquals((await handleZoomWebhook(new Request("https://x.test", { method: "GET" }), deps)).status, 405);
  assertEquals((await post("not json", deps)).json["error"], "invalid_json");
  const ok = await post(JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc123" } }), deps);
  assertEquals(ok.json["plainToken"], "abc123");
  assertEquals(typeof ok.json["encryptedToken"], "string");
  assertEquals((await post(JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "v0:1:forged body" } }), deps)).json["error"], "invalid_challenge");
  assertEquals((await post(JSON.stringify({ event: "endpoint.url_validation", payload: {} }), deps)).json["error"], "not_configured");
  assertEquals((await post(JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc" } }), { ...deps, secret: null })).json["error"], "not_configured");
});

Deno.test("a bad signature is stored rejected, answered as before, and changes nothing", async () => {
  const { f, store, deps } = mk();
  assertEquals((await post(ended, deps, false)).json["error"], "invalid_signature");
  assertEquals(store.rows[0]?.status, "rejected");
  assertEquals(f.consultation?.["status"], "scheduled");
  assertEquals(f.audit.length, 0);
  // no store: still answered the same way
  assertEquals((await post(ended, { ...deps, store: null }, false)).json["error"], "invalid_signature");
});

Deno.test("started then ended completes the consultation; a redelivery of ended is a replay and changes nothing", async () => {
  const { f, store, deps } = mk();
  assertEquals((await post(started, deps)).json, { ok: true });
  assertEquals(f.consultation?.["status"], "started");
  assertEquals((await post(ended, deps)).json, { ok: true });
  assertEquals(f.consultation?.["status"], "completed");
  const endedAt = f.consultation?.["ended_at"];
  assertEquals((await post(ended, deps)).json, { ok: true, replay: true });
  assertEquals(f.consultation?.["ended_at"], endedAt);
  assertEquals(store.rows.map((r) => r.status), ["processed", "processed"]);
  assertEquals(store.rows[1]?.key, "meeting.ended:u-1:1700");
  assertEquals(store.rows[1]?.rawBody, ended);
});

Deno.test("out of order: a late 'started' after 'ended' never moves the consultation backwards", async () => {
  const { f, deps } = mk();
  await post(ended, deps);
  assertEquals(f.consultation?.["status"], "completed");
  await post(started, deps);
  assertEquals(f.consultation?.["status"], "completed");
});

Deno.test("a replay through the drain re-runs the handler safely", async () => {
  const { f, store, deps } = mk();
  await post(ended, deps);
  const before = JSON.stringify(f.consultation);
  store.replay(store.rows[0]!.id);
  const due = await store.claimDue(5);
  assertEquals(due.ok && due.data.length, 1);
  await post(ended, deps); // the redelivery path also leaves it unchanged
  assertEquals(JSON.stringify(f.consultation), before);
});

Deno.test("an unknown meeting, a missing id and an unrelated event type are acknowledged and noted", async () => {
  const none = mk();
  none.f.consultation && (none.f.consultation["zoom_meeting_id"] = "other");
  const f2 = fakeDb({ consultation: null });
  assertEquals((await post(ended, { ...none.deps, db: f2.db })).json, { ok: true });
  assertEquals(String(f2.audit[0]?.["error"]).startsWith("no video_consultations row"), true);
  const noId = JSON.stringify({ event: "meeting.ended", payload: { object: {} } });
  const f3 = fakeDb();
  assertEquals((await post(noId, { ...none.deps, db: f3.db, store: createMemoryInbox() })).json, { ok: true });
  assertEquals(String(f3.audit[0]?.["error"]).includes("missing payload.object.id"), true);
  const other = JSON.stringify({ event: "recording.completed", payload: { object: { id: 999, uuid: "u-9" } } });
  const f4 = fakeDb();
  assertEquals((await post(other, { ...none.deps, db: f4.db, store: createMemoryInbox() })).json, { ok: true });
  assertEquals(f4.audit[0]?.["processed_at"] !== undefined, true);
});

Deno.test("participant events are forwarded to the presence route and never stored in the inbox", async () => {
  const { store, deps } = mk({ appBaseUrl: "https://app.example" });
  const joined = JSON.stringify({ event: "meeting.participant_joined", payload: { object: { id: 999, uuid: "u-1" } } });
  const calls: string[] = [];
  const out = await post(joined, { ...deps, fetch: (url) => { calls.push(url); return noFetch(); } });
  assertEquals(out.json, { ok: true, forwarded: true });
  assertEquals(calls, ["https://app.example/api/zoom/webhook"]);
  assertEquals(store.rows.length, 0);
  const failing = await post(joined, { ...deps, fetch: () => Promise.reject(new Error("down")) });
  assertEquals(failing.status, 502);
  assertEquals((await post(joined, { ...deps, appBaseUrl: undefined })).json, { ok: true, forwarded: false });
});

Deno.test("a failing audit write is retried through the inbox (500) and a redelivery succeeds", async () => {
  const { store, deps } = mk();
  const broken = fakeDb({ auditInsertError: true });
  const first = await post(ended, { ...deps, db: broken.db });
  assertEquals(first.status, 500);
  assertEquals(store.rows[0]?.status, "failed");
  const healthy = fakeDb();
  assertEquals((await post(ended, { ...deps, db: healthy.db })).json, { ok: true });
  assertEquals(healthy.consultation?.["status"], "completed");
});

Deno.test("with the inbox unreachable the event is handled directly, as before", async () => {
  const { f, store, deps } = mk();
  store.failNext("record");
  assertEquals((await post(ended, deps)).json, { ok: true });
  assertEquals(f.consultation?.["status"], "completed");
  const f2 = fakeDb();
  assertEquals((await post(ended, { ...deps, db: f2.db, store: null })).json, { ok: true });
  const f3 = fakeDb({ auditInsertError: true });
  assertEquals((await post(ended, { ...deps, db: f3.db, store: null })).status, 500);
  // a signed body whose JSON is valid but not an object with an event still parses safely
  assertEquals((await post(JSON.stringify({ payload: {} }), { ...deps, store: createMemoryInbox() })).json, { ok: true });
});
