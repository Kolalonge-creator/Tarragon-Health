import { createResendEmail } from "./email-resend.ts";
import type { EmailProvider } from "./email.ts";
import type { FetchLike } from "./http.ts";
import { createPaystackPayment } from "./payment-paystack.ts";
import type { PaymentProvider } from "./payment.ts";
import { createZoomVideo } from "./video-zoom.ts";
import type { VideoProvider } from "./video.ts";

/**
 * Builds the REAL adapter from environment variables, or `null` when it is not configured (the `ml-client` pattern).
 * Never returns a mock: pass the result to `selectProvider`, which supplies a mock outside production only. Application
 * code must not call `createMock*` itself (a repo scan test enforces it).
 */
export type Env = Readonly<Record<string, string | undefined>>;

const has = (v: string | undefined): v is string => typeof v === "string" && v.length > 0;

export function paymentFromEnv(env: Env, fetch: FetchLike): PaymentProvider | null {
  if (!has(env["PAYSTACK_SECRET_KEY"])) return null;
  return createPaystackPayment({ secretKey: env["PAYSTACK_SECRET_KEY"], webhookSecret: has(env["PAYSTACK_WEBHOOK_SECRET"]) ? env["PAYSTACK_WEBHOOK_SECRET"] : undefined, fetch });
}

export function emailFromEnv(env: Env, fetch: FetchLike, isSuppressed?: (email: string) => Promise<boolean>): EmailProvider | null {
  if (!has(env["RESEND_API_KEY"]) || !has(env["RESEND_FROM"])) return null;
  return createResendEmail({ apiKey: env["RESEND_API_KEY"], from: env["RESEND_FROM"], webhookSecret: has(env["RESEND_WEBHOOK_SECRET"]) ? env["RESEND_WEBHOOK_SECRET"] : undefined, replyTo: has(env["RESEND_REPLY_TO"]) ? env["RESEND_REPLY_TO"] : undefined, fetch, isSuppressed });
}

export function videoFromEnv(env: Env, fetch: FetchLike): VideoProvider | null {
  const accountId = env["ZOOM_ACCOUNT_ID"];
  const clientId = env["ZOOM_CLIENT_ID"];
  const clientSecret = env["ZOOM_CLIENT_SECRET"];
  if (!has(accountId) || !has(clientId) || !has(clientSecret)) return null;
  // The Meeting SDK keys are optional: only an in-app SDK join needs them (S21 runs on links, OQ-126).
  const sdkKey = has(env["ZOOM_SDK_KEY"]) ? env["ZOOM_SDK_KEY"] : undefined;
  const sdkSecret = has(env["ZOOM_SDK_SECRET"]) ? env["ZOOM_SDK_SECRET"] : undefined;
  return createZoomVideo({ accountId, clientId, clientSecret, sdkKey, sdkSecret, webhookSecretToken: has(env["ZOOM_WEBHOOK_SECRET_TOKEN"]) ? env["ZOOM_WEBHOOK_SECRET_TOKEN"] : undefined, fetch });
}
