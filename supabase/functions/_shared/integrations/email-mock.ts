import { parseResendWebhook, validateSendEmail, type EmailProvider, type SendEmailInput } from "./email.ts";
import { fail, ok } from "./result.ts";

export interface MockEmailControl {
  /** Every distinct email accepted, in order. A repeated idempotency key is not added twice. */
  readonly outbox: readonly SendEmailInput[];
  suppress(address: string): void;
  failNextCall(): void;
  readonly webhookSecret: string;
}

export function createMockEmail(): EmailProvider & MockEmailControl {
  const webhookSecret = "whsec_bW9jay1zZWNyZXQ="; // base64("mock-secret")
  const outbox: SendEmailInput[] = [];
  const byKey = new Map<string, string>();
  const suppressed = new Set<string>();
  let failNext = false;

  return {
    name: "mock",
    isMock: true,
    outbox,
    webhookSecret,
    suppress(address) {
      suppressed.add(address.toLowerCase());
    },
    failNextCall() {
      failNext = true;
    },

    async send(input) {
      if (failNext) {
        failNext = false;
        return fail("network", "Could not reach the vendor");
      }
      const invalid = validateSendEmail(input);
      if (invalid) return invalid;
      if (suppressed.has(input.to.toLowerCase())) return fail("suppressed", "Address is suppressed", false);
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return ok({ providerMessageId: existing });
      const id = `mock_email_${outbox.length + 1}`;
      byKey.set(input.idempotencyKey, id);
      outbox.push(input);
      return ok({ providerMessageId: id });
    },

    async parseWebhook(rawBody, headers, nowMs) {
      return parseResendWebhook(webhookSecret, rawBody, headers, nowMs);
    },
  };
}
