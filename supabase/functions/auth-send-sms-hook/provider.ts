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
  readonly name: "mock" | "termii";
  send(message: { to: string; text: string }): Promise<SendResult>;
}

/** Message text is the code and the brand name, nothing else (spec section 10, INV-07 spirit). */
export function buildOtpText(otp: string): string {
  return `Your TarragonHealth code is ${otp}`;
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

export interface TermiiConfig {
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
      const response = await doFetch("https://api.ng.termii.com/api/sms/send", {
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
      const body = (await response.json().catch(() => ({}))) as { message_id?: string };
      return { ok: true, providerMessageId: body.message_id };
    } catch (error) {
      // A timeout or network failure is worth one retry; the error text is never surfaced (could echo the payload).
      return { ok: false, retryable: true, code: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Mock unless Termii is explicitly selected AND fully configured; a half-configured Termii fails loudly, never silently mocks. */
export function providerFromEnv(get: (key: string) => string | undefined): SmsProvider {
  const selected = (get("SMS_PROVIDER") ?? "mock").toLowerCase();
  if (selected === "mock") return new MockSmsProvider();
  if (selected === "termii") {
    const apiKey = get("TERMII_API_KEY");
    const senderId = get("TERMII_SENDER_ID");
    if (!apiKey || !senderId) throw new Error("SMS_PROVIDER=termii requires TERMII_API_KEY and TERMII_SENDER_ID");
    return new TermiiSmsProvider({ apiKey, senderId, channel: get("TERMII_CHANNEL") ?? "dnd" });
  }
  throw new Error(`Unknown SMS_PROVIDER "${selected}"`);
}
