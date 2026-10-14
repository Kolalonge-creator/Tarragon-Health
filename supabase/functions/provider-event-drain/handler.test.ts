// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleDrain } from "./handler.ts";
import { createMemoryInbox } from "../../../packages/integrations/src/support/memory-inbox.ts";

const req = (secret?: string, method = "POST") => new Request("https://x.test/drain", { method, headers: secret ? { "x-provider-drain-secret": secret } : {} });

Deno.test("fails closed without a secret, with a wrong one, or with the wrong method", async () => {
  const store = createMemoryInbox();
  const ok = () => Promise.resolve({ ok: true as const });
  const deps = { secret: "s", store, dispatchers: { paystack: ok, zoom: ok, resend: ok } };
  assertEquals((await handleDrain(req("s", "GET"), deps)).status, 405);
  assertEquals((await handleDrain(req("s"), { ...deps, secret: null })).status, 503);
  assertEquals((await handleDrain(req("x"), deps)).status, 401);
  assertEquals((await handleDrain(req(), deps)).status, 401);
});

Deno.test("retries a failed event once it is due, through the right provider's handler, and reports the counts", async () => {
  const store = createMemoryInbox();
  await store.record({ provider: "zoom", eventType: "meeting.ended", idempotencyKey: "k1", rawBody: "{}", verified: true });
  const lease = await store.claim(store.rows[0]!.id);
  if (!lease.ok || !lease.data) throw new Error("claim failed");
  await store.fail(store.rows[0]!.id, lease.data, "down", false);
  const seen: string[] = [];
  const handler = (name: string) => () => { seen.push(name); return Promise.resolve({ ok: true as const }); };
  const deps = { secret: "s", store, dispatchers: { paystack: handler("paystack"), zoom: handler("zoom"), resend: handler("resend") } };
  assertEquals(await (await handleDrain(req("s"), deps)).json(), { processed: 0, failed: 0 }); // backoff not over
  store.advance(60_000);
  assertEquals(await (await handleDrain(req("s"), deps)).json(), { processed: 1, failed: 0 });
  assertEquals(seen, ["zoom"]);
  store.failNext("claimDue");
  assertEquals((await handleDrain(req("s"), deps)).status, 502);
});
