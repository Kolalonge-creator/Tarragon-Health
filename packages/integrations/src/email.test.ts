import { describe, expect, it } from "@jest/globals";
import { createMockEmail, createResendEmail, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runEmailContract } from "./contracts/email.contract";
import { signSvix, signSvixRaw } from "./support/svix";

runEmailContract("mock", () => {
  const mock = createMockEmail();
  return { provider: mock, suppress: (a) => mock.suppress(a), failNextCall: () => mock.failNextCall(), signedWebhook: (b, now) => signSvix(mock.webhookSecret, b, now) };
});

const WEBHOOK_SECRET = "whsec_cmVzZW5kLXRlc3Q="; // base64("resend-test")

function fakeResend() {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const seen = new Map<string, string>();
  let failNext = false;
  const suppressed = new Set<string>();
  const fetch: FetchLike = async (url, init) => {
    if (failNext) {
      failNext = false;
      throw new TypeError("fetch failed");
    }
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init.headers, body });
    if (init.headers["Authorization"] !== "Bearer re_test_key") return { status: 401, ok: false, text: async () => JSON.stringify({ message: "API key is invalid" }) };
    const idem = init.headers["Idempotency-Key"] as string;
    const id = seen.get(idem) ?? `em_${seen.size + 1}`;
    seen.set(idem, id);
    return { status: 200, ok: true, text: async () => JSON.stringify({ id }) };
  };
  return { fetch, calls, failNextCall: () => (failNext = true), suppressed };
}

runEmailContract("resend adapter over a fake vendor", () => {
  const fake = fakeResend();
  const provider = createResendEmail({
    apiKey: "re_test_key",
    from: "Tarragon Health <care@example.com>",
    webhookSecret: WEBHOOK_SECRET,
    fetch: fake.fetch,
    isSuppressed: async (a) => fake.suppressed.has(a),
  });
  return { provider, suppress: (a) => fake.suppressed.add(a.toLowerCase()), failNextCall: fake.failNextCall, signedWebhook: (b, now) => signSvix(WEBHOOK_SECRET, b, now) };
});

describe("mock email", () => {
  it("a repeated idempotency key returns the same id and sends once", async () => {
    const mock = createMockEmail();
    const input = { to: "a@example.com", subject: "Hello from your care team", text: "Open the app.", audience: "patient" as const, idempotencyKey: "n-1:email" };
    const a = await mock.send(input);
    const b = await mock.send(input);
    expect(a).toEqual(b);
    expect(mock.outbox).toHaveLength(1);
  });

  it("rejects a webhook body that is signed but not JSON, and reads a non-object body as an unmapped event", async () => {
    const mock = createMockEmail();
    const now = Date.now();
    const bad = await signSvixRaw(mock.webhookSecret, "not json", now);
    const r = await mock.parseWebhook(bad.rawBody, bad.headers, now);
    expect(r.ok === false && r.error.code).toBe("bad_response");
    const arr = await signSvixRaw(mock.webhookSecret, "[1]", now);
    const a = await mock.parseWebhook(arr.rawBody, arr.headers, now);
    expect(a.ok && a.data).toBeNull();
  });
});

describe("resend adapter", () => {
  const input = { to: "a@example.com", subject: "Hello from your care team", text: "Open the app.", audience: "patient" as const, idempotencyKey: "n-1:email", tags: { kind: "message_waiting" } };

  it("sends the vendor's request shape: bearer key, idempotency header, one recipient, tags as name and value", async () => {
    const fake = fakeResend();
    const p = createResendEmail({ apiKey: "re_test_key", from: "Tarragon Health <care@example.com>", fetch: fake.fetch });
    await p.send(input);
    const call = fake.calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.headers["Idempotency-Key"]).toBe("n-1:email");
    expect(call.body).toMatchObject({ from: "Tarragon Health <care@example.com>", to: ["a@example.com"], tags: [{ name: "kind", value: "message_waiting" }] });
  });

  it("sets Reply-To when configured, and omits it otherwise", async () => {
    const fake = fakeResend();
    await createResendEmail({ apiKey: "re_test_key", from: "x <a@example.com>", replyTo: "care@example.com", fetch: fake.fetch }).send(input);
    await createResendEmail({ apiKey: "re_test_key", from: "x <a@example.com>", fetch: fake.fetch }).send({ ...input, idempotencyKey: "n-2:email" });
    expect(fake.calls[0]!.body["reply_to"]).toBe("care@example.com");
    expect(fake.calls[1]!.body["reply_to"]).toBeUndefined();
  });

  it("sends the same message once when the job retries with the same key", async () => {
    const fake = fakeResend();
    const p = createResendEmail({ apiKey: "re_test_key", from: "x <a@example.com>", fetch: fake.fetch });
    const a = await p.send(input);
    const b = await p.send(input);
    expect(a).toEqual(b);
  });

  it("maps a bad key to unauthorized, and keeps the key out of the error", async () => {
    const fake = fakeResend();
    const p = createResendEmail({ apiKey: "re_wrong_key_value", from: "x <a@example.com>", fetch: fake.fetch });
    const r = await p.send(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("unauthorized");
      expect(JSON.stringify(r)).not.toContain("re_wrong_key_value");
    }
  });

  it("treats a reply without an id as a bad response", async () => {
    const p = createResendEmail({ apiKey: "k", from: "x <a@example.com>", fetch: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
    const r = await p.send(input);
    expect(r.ok === false && r.error.code).toBe("bad_response");
  });

  it("will not verify webhooks until a secret is configured", async () => {
    const p = createResendEmail({ apiKey: "k", from: "x <a@example.com>", fetch: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
    const r = await p.parseWebhook("{}", { id: "a", timestamp: "1", signature: "v1,x" }, Date.now());
    expect(r.ok === false && r.error.code).toBe("not_configured");
  });

  it("rejects a signed webhook whose body is not JSON, and treats a non-object body as an unmapped event", async () => {
    const now = Date.now();
    const p = createResendEmail({ apiKey: "k", from: "x <a@example.com>", webhookSecret: WEBHOOK_SECRET, fetch: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
    const sign = async (raw: string) => (await signSvixRaw(WEBHOOK_SECRET, raw, now)).headers;
    const notJson = await p.parseWebhook("not json", await sign("not json"), now);
    expect(notJson.ok === false && notJson.error.code).toBe("bad_response");
    const array = await p.parseWebhook("[1]", await sign("[1]"), now);
    expect(array.ok && array.data).toBeNull();
  });
});
