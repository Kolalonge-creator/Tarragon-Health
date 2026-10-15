import type { ErrorEvent } from "@sentry/nextjs";
import { scrubPiiBeforeSend } from "./scrub-pii";

function event(over: Record<string, unknown>): ErrorEvent {
  return { type: undefined, ...over } as unknown as ErrorEvent;
}

describe("scrubPiiBeforeSend", () => {
  it("redacts emails and phone numbers in the message, exception, extra, contexts and breadcrumbs", () => {
    const out = scrubPiiBeforeSend(
      event({
        message: "failed for ada@example.com",
        exception: { values: [{ value: "Key (email)=(bola@example.com) already exists; call +2348031234567" }] },
        extra: { who: "chi@example.com", nested: { phone: "+234 803 123 4567" } },
        contexts: { c: { note: "dee@example.com" } },
        breadcrumbs: [{ message: "sent to eke@example.com", data: { to: "+2348031234567" } }],
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/@example\.com/);
    expect(json).not.toMatch(/8031234567/);
    expect(json).toContain("[redacted-email]");
  });

  it("drops request bodies, cookies, auth headers and query strings", () => {
    const out = scrubPiiBeforeSend(
      event({
        request: {
          url: "https://app.test/auth/callback?token=secret&email=ada@example.com",
          query_string: "token=secret&email=ada@example.com",
          data: { phone: "+2348031234567" },
          cookies: { sb: "session" },
          headers: { Cookie: "sb=session", Authorization: "Bearer x", "X-Service-Key": "k", Accept: "text/html" },
        },
      }),
    );
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toEqual({ Accept: "text/html" });
    expect(out.request?.query_string).toBe("[redacted-query]");
    expect(out.request?.url).toBe("https://app.test/auth/callback");
  });
});
