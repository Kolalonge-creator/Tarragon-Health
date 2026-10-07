import { describe, expect, it } from "@jest/globals";
import type { EmailProvider, SendEmailInput } from "../../../../supabase/functions/_shared/integrations/index.ts";

export interface EmailFixture {
  readonly provider: EmailProvider;
  /** Present when the fixture can make an address suppressed. */
  suppress?(address: string): void;
  failNextCall?(): void;
  /** Signs a Svix webhook the way Resend would, with the fixture's secret. */
  signedWebhook?(body: unknown, nowMs: number): Promise<{ rawBody: string; headers: { id: string; timestamp: string; signature: string } }>;
}

let n = 0;
const key = (): string => `contract-${Date.now().toString(36)}-${(n += 1)}`;
const base = { to: "ada@example.com", subject: "Your care team has a message", text: "Open the app to read it.", audience: "patient" as const };

export function runEmailContract(name: string, make: () => EmailFixture): void {
  const probe = make();
  const suppressible = probe.suppress !== undefined;
  const dropped = probe.failNextCall !== undefined ? it : it.skip;
  const signed = probe.signedWebhook !== undefined ? it : it.skip;
  const supp = suppressible ? it : it.skip;

  describe(`EmailProvider contract: ${name}`, () => {
    it("sends a neutral patient email and returns a provider id", async () => {
      const r = await make().provider.send({ ...base, idempotencyKey: key(), tags: { kind: "message_waiting" } });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.providerMessageId.length).toBeGreaterThan(0);
    });

    it("blocks patient email that names a condition, a reading, a result or a medicine (INV-07)", async () => {
      const f = make();
      const cases = [
        { subject: "Your blood pressure reading" },
        { text: "Your result is ready" },
        { text: "Time to take your metformin" },
        { html: "<p>Your 140/90 was high</p>" },
      ];
      for (const c of cases) {
        const r = await f.provider.send({ ...base, ...c, idempotencyKey: key() });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject({ code: "blocked_content", retryable: false });
      }
    });

    it("does not read markup as words: a class name alone never blocks a neutral email", async () => {
      const r = await make().provider.send({ ...base, html: '<p class="result reading">Open the app.</p>', idempotencyKey: key() });
      expect(r.ok).toBe(true);
    });

    it("blocks an attachment whose file name names the request (OQ-91)", async () => {
      const r = await make().provider.send({ ...base, idempotencyKey: key(), attachments: [{ filename: "lab-results.pdf", contentBase64: "AAAA" }] });
      expect(r.ok).toBe(false);
    });

    it("does not lint staff email", async () => {
      const r = await make().provider.send({ ...base, audience: "staff", subject: "Result released for review", idempotencyKey: key() });
      expect(r.ok).toBe(true);
    });

    it("refuses bad input: address, subject, body, key and tags", async () => {
      const f = make();
      const bad: Partial<SendEmailInput>[] = [
        { to: "nope" },
        { subject: "  " },
        { text: "" },
        { idempotencyKey: "" },
        { tags: { "bad tag": "x" } },
        { tags: { kind: "has space" } },
      ];
      for (const b of bad) {
        const r = await f.provider.send({ ...base, idempotencyKey: key(), ...b });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_input");
      }
    });

    supp("never sends to a suppressed address", async () => {
      const f = make();
      f.suppress!("bounced@example.com");
      const r = await f.provider.send({ ...base, to: "Bounced@Example.com", idempotencyKey: key() });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "suppressed", retryable: false });
    });

    dropped("returns a retryable failure, not an exception, when the vendor cannot be reached", async () => {
      const f = make();
      f.failNextCall!();
      const r = await f.provider.send({ ...base, idempotencyKey: key() });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "network", retryable: true });
    });

    signed("checks the webhook signature and maps delivered, hard bounce and soft bounce", async () => {
      const f = make();
      const now = Date.now();
      const mk = async (type: string, bounce?: string) =>
        f.signedWebhook!({ type, data: { email_id: "em_1", to: ["Ada@Example.com"], ...(bounce ? { bounce: { type: bounce } } : {}) } }, now);
      const delivered = await mk("email.delivered");
      const ok1 = await f.provider.parseWebhook(delivered.rawBody, delivered.headers, now);
      expect(ok1.ok && ok1.data).toEqual({ event: "delivered", emailId: "em_1", email: "ada@example.com" });
      const hard = await mk("email.bounced", "Permanent");
      const soft = await mk("email.bounced", "Transient");
      const h = await f.provider.parseWebhook(hard.rawBody, hard.headers, now);
      const s = await f.provider.parseWebhook(soft.rawBody, soft.headers, now);
      expect(h.ok && h.data?.event).toBe("bounced");
      expect(s.ok && s.data?.event).toBe("failed");
      const other = await mk("email.sent");
      const o = await f.provider.parseWebhook(other.rawBody, other.headers, now);
      expect(o.ok && o.data).toBeNull();
    });

    signed("rejects a webhook with a bad signature, a tampered body or a stale timestamp", async () => {
      const f = make();
      const now = Date.now();
      const w = await f.signedWebhook!({ type: "email.delivered", data: { email_id: "em_1", to: ["a@example.com"] } }, now);
      const badSig = await f.provider.parseWebhook(w.rawBody, { ...w.headers, signature: "v1,AAAA" }, now);
      const tampered = await f.provider.parseWebhook(w.rawBody.replace("em_1", "em_2"), w.headers, now);
      const stale = await f.provider.parseWebhook(w.rawBody, w.headers, now + 3_600_000);
      const missing = await f.provider.parseWebhook(w.rawBody, { id: null, timestamp: null, signature: null }, now);
      for (const r of [badSig, tampered, stale, missing]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_signature");
      }
    });
  });
}
