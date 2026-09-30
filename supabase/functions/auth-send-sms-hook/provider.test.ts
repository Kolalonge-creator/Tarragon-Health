// Termii adapter and provider selection, with fetch mocked. No real SMS is ever sent from a test.
// Run: deno test --no-config supabase/functions/auth-send-sms-hook/provider.test.ts

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { MockSmsProvider, providerFromEnv, TermiiSmsProvider } from "./provider.ts";

function termii(response: () => Promise<Response>, calls: Array<{ url: string; body: Record<string, unknown> }> = []) {
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return response();
  }) as typeof fetch;
  return new TermiiSmsProvider({ apiKey: "k", senderId: "Tarragon", channel: "dnd", fetchImpl, timeoutMs: 50 });
}

Deno.test("sends to the Termii SMS endpoint on the dnd route, number without the plus, text as given", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const p = termii(() => Promise.resolve(new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })), calls);
  const r = await p.send({ to: "+2348031234567", text: "Your TarragonHealth code is 123456" });
  assertEquals(r, { ok: true, providerMessageId: "m1" });
  assertEquals(calls[0].url, "https://api.ng.termii.com/api/sms/send");
  assertEquals(calls[0].body.to, "2348031234567");
  assertEquals(calls[0].body.channel, "dnd");
  assertEquals(calls[0].body.sms, "Your TarragonHealth code is 123456");
});

Deno.test("5xx and 429 are retryable, other 4xx are not, network and timeout are retryable", async () => {
  const code = async (status: number) =>
    await termii(() => Promise.resolve(new Response("{}", { status }))).send({ to: "+2348031234567", text: "x" });
  assertEquals(await code(503), { ok: false, retryable: true, code: "http_503" });
  assertEquals(await code(429), { ok: false, retryable: true, code: "http_429" });
  assertEquals(await code(400), { ok: false, retryable: false, code: "http_400" });
  const net = await termii(() => Promise.reject(new Error("boom"))).send({ to: "+2348031234567", text: "x" });
  assertEquals(net, { ok: false, retryable: true, code: "network" });
  const slow = new TermiiSmsProvider({
    apiKey: "k",
    senderId: "T",
    channel: "dnd",
    timeoutMs: 10,
    fetchImpl: ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      )) as typeof fetch,
  });
  assertEquals(await slow.send({ to: "+2348031234567", text: "x" }), { ok: false, retryable: true, code: "timeout" });
});

Deno.test("the provider result never echoes the api key or the payload", async () => {
  const r = await termii(() => Promise.reject(new Error("failed for k and 2348031234567"))).send({ to: "+2348031234567", text: "x" });
  const blob = JSON.stringify(r);
  assert(!blob.includes("2348031234567"));
  assert(!blob.includes('"k"'));
});

Deno.test("selection: mock by default; termii only when chosen and fully configured; anything else throws", () => {
  assert(providerFromEnv(() => undefined) instanceof MockSmsProvider);
  assert(providerFromEnv((k) => ({ SMS_PROVIDER: "mock" } as Record<string, string>)[k]) instanceof MockSmsProvider);
  assertThrows(() => providerFromEnv((k) => ({ SMS_PROVIDER: "termii" } as Record<string, string>)[k]));
  const env: Record<string, string> = { SMS_PROVIDER: "termii", TERMII_API_KEY: "k", TERMII_SENDER_ID: "Tarragon" };
  assert(providerFromEnv((k) => env[k]) instanceof TermiiSmsProvider);
  assertThrows(() => providerFromEnv((k) => ({ SMS_PROVIDER: "twilio" } as Record<string, string>)[k]));
});
