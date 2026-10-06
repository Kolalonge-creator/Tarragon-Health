import { asObject, httpJson, type FetchLike } from "./http.ts";
import { parseResendWebhook, validateSendEmail, type EmailProvider } from "./email.ts";
import { fail, ok } from "./result.ts";

export interface ResendConfig {
  readonly apiKey: string;
  /** The verified sender, for example `Tarragon Health <care@tarragonhealth.ng>`. */
  readonly from: string;
  readonly webhookSecret?: string;
  /** A monitored inbox for replies, so mail from the sending subdomain never dead-ends. */
  readonly replyTo?: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
  /** Looks the address up in `notification_email_suppressions` (S13). A suppressed address is never sent to. */
  readonly isSuppressed?: (email: string) => Promise<boolean>;
}

export function createResendEmail(config: ResendConfig): EmailProvider {
  const base = config.baseUrl ?? "https://api.resend.com";
  const deps = { fetch: config.fetch, timeoutMs: config.timeoutMs ?? 10_000 };

  return {
    name: "resend",
    isMock: false,

    async send(input) {
      const invalid = validateSendEmail(input);
      if (invalid) return invalid;
      if (config.isSuppressed && (await config.isSuppressed(input.to.toLowerCase()))) {
        return fail("suppressed", "Address is suppressed", false);
      }
      const res = await httpJson(deps, {
        url: `${base}/emails`,
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Idempotency-Key": input.idempotencyKey },
        body: {
          from: config.from,
          to: [input.to],
          reply_to: config.replyTo,
          subject: input.subject,
          text: input.text,
          html: input.html,
          tags: Object.entries(input.tags ?? {}).map(([name, value]) => ({ name, value })),
          attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
        },
      });
      if (!res.ok) return res;
      const id = asObject(res.data)?.["id"];
      return typeof id === "string" && id.length > 0 ? ok({ providerMessageId: id }) : fail("bad_response", "Resend sent an unexpected reply");
    },

    async parseWebhook(rawBody, headers, nowMs) {
      if (!config.webhookSecret) return fail("not_configured", "Webhook secret is not set", false);
      return parseResendWebhook(config.webhookSecret, rawBody, headers, nowMs);
    },
  };
}
