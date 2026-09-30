// Termii adapter and provider selection, with fetch mocked. No real SMS is ever sent from a test.
// Run: deno test --no-config supabase/functions/auth-send-sms-hook/provider.test.ts

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { MockSmsProvider, providerFromEnv, TermiiSmsProvider, UnconfiguredSmsProvider } from "./provider.ts";

function termii(response: () => Promise<Response>, calls: Array<{ url: string; body: Record<string, unknown> }> = []) {
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return response();
  }) as typeof fetch;
  return new TermiiSmsProvider({ baseUrl: "https://v4.api.termii.com", apiKey: "k", senderId: "Tarragon", channel: "dnd", fetchImpl, timeoutMs: 50 });
}

Deno.test("sends to the ACCOUNT's Termii base URL (not a hard-coded host) on the dnd route, number without the plus, text as given", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const p = termii(() => Promise.resolve(new Response(JSON.stringify({ message_id: "m1" }), { status: 200 })), calls);
  const r = await p.send({ to: "+2348031234567", text: "Your TarragonHealth verification code is 123456. This code expires in 10 minutes. Do not share with anyone." });
  assertEquals(r, { ok: true, providerMessageId: "m1" });
  assertEquals(calls[0].url, "https://v4.api.termii.com/api/sms/send");
  assertEquals(calls[0].body.to, "2348031234567");
  assertEquals(calls[0].body.channel, "dnd");
  assertEquals(calls[0].body.sms, "Your TarragonHealth verification code is 123456. This code expires in 10 minutes. Do not share with anyone.");
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
    baseUrl: "https://v4.api.termii.com",
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

Deno.test("selection: unset refuses every send; mock only when asked for by name; termii only when fully configured", async () => {
  const unset = providerFromEnv(() => undefined);
  assert(unset instanceof UnconfiguredSmsProvider);
  assertEquals(await unset.send(), { ok: false, retryable: false, code: "provider_not_configured" });
  assert(providerFromEnv((k) => ({ SMS_PROVIDER: "mock" } as Record<string, string>)[k]) instanceof MockSmsProvider);
  assertThrows(() => providerFromEnv((k) => ({ SMS_PROVIDER: "termii" } as Record<string, string>)[k]));
  const env: Record<string, string> = {
    SMS_PROVIDER: "termii",
    TERMII_API_KEY: "k",
    TERMII_SENDER_ID: "Tarragon",
    TERMII_BASE_URL: "https://v4.api.termii.com/",
  };
  assert(providerFromEnv((k) => env[k]) instanceof TermiiSmsProvider);
  // The base URL is required, and must be https (the API key travels in the body).
  assertThrows(() => providerFromEnv((k) => ({ ...env, TERMII_BASE_URL: undefined as unknown as string })[k]));
  assertThrows(() => providerFromEnv((k) => ({ ...env, TERMII_BASE_URL: "http://v4.api.termii.com" })[k]));
  assertThrows(() => providerFromEnv((k) => ({ ...env, TERMII_BASE_URL: "https://evil.example/path" })[k]));
  assertThrows(() => providerFromEnv((k) => ({ SMS_PROVIDER: "twilio" } as Record<string, string>)[k]));
});

Deno.test("a 200 that is not code 'ok' did not send, and is not retried", async () => {
  const r = await termii(() => Promise.resolve(new Response(JSON.stringify({ code: "insufficient_balance", message: "x" }), { status: 200 })))
    .send({ to: "+2348031234567", text: "x" });
  assertEquals(r, { ok: false, retryable: false, code: "termii_insufficient_balance" });
});
