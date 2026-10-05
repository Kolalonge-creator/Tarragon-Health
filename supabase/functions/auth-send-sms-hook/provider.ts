// The ONLY module in the repository allowed to talk to an SMS vendor for auth codes (INV-08).
//
// The hook (handler.ts) depends on the SmsProvider interface, never on Termii directly, so the provider can be
// swapped or mocked and the INV-08 scan test can assert that nothing else imports this file. The mock is the
// default: Termii goes live only when SMS_PROVIDER=termii is set deliberately, after the sender ID is approved
// (OQ-21, D-05). Nothing here logs a phone number or a code.

export type SendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; retryable: boolean; code: string };

export interface SmsProvider {
  readonly name: "mock" | "termii" | "unconfigured";
  send(message: { to: string; text: string }): Promise<SendResult>;
}

/**
 * Termii's own OTP / Authentication template, with the brand filled in and nothing added:
 *   "Your {{Company Name}} verification code is {{OTP}}. This code expires in 10 minutes. Do not share with anyone."
 * The sender ID application is approved against exactly this sample, and Nigerian carriers route by template, so the text
 * must not drift from it. It names no condition, reading or result (INV-07) and carries only the code and the brand, plus
 * Termii's fixed expiry and do-not-share wording. The "10 minutes" is a promise: the Supabase phone OTP expiry must be
 * set to 600 seconds (docs/OPEN-QUESTIONS.md OQ-44).
 */
export function buildOtpText(otp: string): string {
  return `Your TarragonHealth verification code is ${otp}. This code expires in 10 minutes. Do not share with anyone.`;
}

export class MockSmsProvider implements SmsProvider {
  readonly name = "mock" as const;
  /** Test inspection only; holds the recipient and text in memory, never persisted or logged. */
  readonly sent: Array<{ to: string; text: string }> = [];
  constructor(private readonly script: SendResult[] = []) {}
  send(message: { to: string; text: string }): Promise<SendResult> {
    this.sent.push(message);
    const next = this.script.shift();
    return Promise.resolve(next ?? { ok: true, providerMessageId: `mock-${this.sent.length}` });
  }
}

/**
 * What the hook uses when SMS_PROVIDER is not set. It refuses every send (non-retryable), so enabling the hook before a
 * provider is chosen fails LOUDLY (Auth reports a delivery failure) instead of telling people a code was sent when
 * nothing was. The mock must be asked for by name (SMS_PROVIDER=mock), which belongs to local and test stacks only.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = "unconfigured" as const;
  send(): Promise<SendResult> {
    return Promise.resolve({ ok: false, retryable: false, code: "provider_not_configured" });
  }
}

export interface TermiiConfig {
  /** The account's own base URL, shown on the Termii dashboard (for example https://v4.api.termii.com). Not a constant. */
  baseUrl: string;
  apiKey: string;
  senderId: string;
  /** Termii route. "dnd" reaches numbers on the do-not-disturb list; OTPs must use it. */
  channel: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii" as const;
  constructor(private readonly cfg: TermiiConfig) {}

  async send(message: { to: string; text: string }): Promise<SendResult> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 4000);
    try {
      const response = await doFetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/api/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: this.cfg.apiKey,
          // Termii takes the number without the leading plus.
          to: message.to.replace(/^\+/, ""),
          from: this.cfg.senderId,
          sms: message.text,
          type: "plain",
          channel: this.cfg.channel,
        }),
      });
      if (response.status >= 500 || response.status === 429) {
        return { ok: false, retryable: true, code: `http_${response.status}` };
      }
      if (!response.ok) return { ok: false, retryable: false, code: `http_${response.status}` };
      const body = (await response.json().catch(() => ({}))) as { code?: string; message_id?: string };
      // Termii answers 200 with { code: "ok", message_id } on success. A 200 that says anything else did not send.
      if (body.code !== undefined && body.code !== "ok") {
        return { ok: false, retryable: false, code: `termii_${String(body.code).slice(0, 24)}` };
      }
      return { ok: true, providerMessageId: body.message_id };
    } catch (error) {
      // A timeout or network failure is worth one retry; the error text is never surfaced (could echo the payload).
      return { ok: false, retryable: true, code: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Unset means "no provider": every send is refused (see UnconfiguredSmsProvider). "mock" (sends nothing, reports
 * success) must be chosen explicitly; Termii only when fully configured. A half-configured Termii throws, never mocks.
 */
export function providerFromEnv(get: (key: string) => string | undefined): SmsProvider {
  const selected = (get("SMS_PROVIDER") ?? "").toLowerCase();
  if (selected === "") return new UnconfiguredSmsProvider();
  if (selected === "mock") return new MockSmsProvider();
  if (selected === "termii") {
    const apiKey = get("TERMII_API_KEY");
    const senderId = get("TERMII_SENDER_ID");
    const baseUrl = get("TERMII_BASE_URL");
    if (!apiKey || !senderId || !baseUrl) {
      throw new Error("SMS_PROVIDER=termii requires TERMII_API_KEY, TERMII_SENDER_ID and TERMII_BASE_URL");
    }
    // The key goes in the request body, so a non-https base URL would send it in clear text.
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl.replace(/\/+$/, ""))) {
      throw new Error("TERMII_BASE_URL must be an https URL with no path, for example https://v4.api.termii.com");
    }
    return new TermiiSmsProvider({ baseUrl, apiKey, senderId, channel: get("TERMII_CHANNEL") ?? "dnd" });
  }
  throw new Error(`Unknown SMS_PROVIDER "${selected}"`);
}
