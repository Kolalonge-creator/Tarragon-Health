import { NextRequest, NextResponse } from "next/server";

const cookieSet = jest.fn();
jest.mock("next/headers", () => ({
  cookies: jest.fn().mockResolvedValue({ set: (...args: unknown[]) => cookieSet(...args) }),
}));

import {
  IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_COOKIE,
  buildIdleTimeoutRedirect,
  isBackgroundTelemetryPath,
  isIdleTimeoutExemptPath,
  isSessionIdle,
  stampActivity,
  stampActivityCookie,
} from "./idle-timeout";

beforeEach(() => {
  cookieSet.mockReset();
});

describe("isSessionIdle", () => {
  const now = 1_000_000_000_000;

  it("is not idle when no last-activity cookie has ever been set (fresh session)", () => {
    expect(isSessionIdle(undefined, now)).toBe(false);
  });

  it("is not idle when the cookie value is unparseable", () => {
    expect(isSessionIdle("not-a-number", now)).toBe(false);
  });

  it("is not idle when the gap is under the threshold", () => {
    const lastSeen = now - (IDLE_TIMEOUT_MS - 1000);
    expect(isSessionIdle(String(lastSeen), now)).toBe(false);
  });

  it("is idle when the gap exceeds the threshold", () => {
    const lastSeen = now - (IDLE_TIMEOUT_MS + 1000);
    expect(isSessionIdle(String(lastSeen), now)).toBe(true);
  });
});

describe("isBackgroundTelemetryPath", () => {
  it("recognises the device-heartbeat endpoint", () => {
    expect(isBackgroundTelemetryPath("/api/heartbeat")).toBe(true);
  });

  it("recognises the page-tracker endpoint", () => {
    expect(isBackgroundTelemetryPath("/api/track")).toBe(true);
  });

  it("does not match a real page or a different API route", () => {
    expect(isBackgroundTelemetryPath("/patient/dashboard")).toBe(false);
    expect(isBackgroundTelemetryPath("/api/heartbeats")).toBe(false);
    expect(isBackgroundTelemetryPath("/api/tracker")).toBe(false);
  });
});

describe("isIdleTimeoutExemptPath", () => {
  it("exempts /reset-password (regression: locked-account recovery would otherwise get idle-timed-out mid password-entry)", () => {
    expect(isIdleTimeoutExemptPath("/reset-password")).toBe(true);
  });

  it("exempts /forgot-password", () => {
    expect(isIdleTimeoutExemptPath("/forgot-password")).toBe(true);
  });

  it("exempts /login/mfa-challenge", () => {
    expect(isIdleTimeoutExemptPath("/login/mfa-challenge")).toBe(true);
  });

  it("exempts the guest-checkout flow (regression: an in-progress purchase would otherwise get silently dropped mid payment-entry)", () => {
    expect(isIdleTimeoutExemptPath("/checkout")).toBe(true);
    expect(isIdleTimeoutExemptPath("/checkout/video_visit_credit")).toBe(true);
    expect(isIdleTimeoutExemptPath("/checkout/continue")).toBe(true);
    expect(isIdleTimeoutExemptPath("/checkout/receipt")).toBe(true);
  });

  it("does not exempt a real dashboard route", () => {
    expect(isIdleTimeoutExemptPath("/patient/dashboard")).toBe(false);
  });
});

describe("stampActivity", () => {
  it("sets the last-activity cookie to the given timestamp", () => {
    const response = NextResponse.next();
    stampActivity(response, 1_000_000_000_000);
    expect(response.cookies.get(LAST_ACTIVITY_COOKIE)?.value).toBe("1000000000000");
  });

  it("gives the cookie a browser-side lifetime far longer than the idle threshold", () => {
    // Regression: an earlier version set maxAge to IDLE_TIMEOUT_MS + 60s
    // (~31 minutes), so a session abandoned for LONGER than that had its
    // cookie expire and get dropped by the browser before the next request
    // arrived — isSessionIdle() then saw no cookie and read that as "fresh,
    // never stamped", waving a genuinely long-abandoned session through
    // instead of bouncing it to /login?reason=idle. The cookie's own
    // maxAge must comfortably outlive any realistic abandonment window;
    // staleness is judged by the stored timestamp, never by whether the
    // cookie itself still exists.
    const response = NextResponse.next();
    stampActivity(response, Date.now());
    const maxAge = response.cookies.get(LAST_ACTIVITY_COOKIE)?.maxAge ?? 0;
    expect(maxAge).toBeGreaterThan(IDLE_TIMEOUT_MS / 1000 + 60 * 60); // outlives 30min+1hr
  });

  it("end-to-end: a session abandoned for 2 hours is still caught as idle, not waved through as 'fresh'", () => {
    // The cookie the ORIGINAL activity-stamping request wrote (2 hours ago).
    const response = NextResponse.next();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    stampActivity(response, twoHoursAgo);
    const cookie = response.cookies.get(LAST_ACTIVITY_COOKIE)!;

    // The cookie must still be "alive" from the browser's own perspective
    // (maxAge not yet elapsed) 2 hours later, so the next request actually
    // presents it rather than nothing at all.
    expect(cookie.maxAge ?? 0).toBeGreaterThan(2 * 60 * 60);

    // And once presented, it correctly reads as idle-expired — not as a
    // fresh, never-stamped session.
    expect(isSessionIdle(cookie.value, Date.now())).toBe(true);
  });
});

describe("stampActivityCookie", () => {
  // Regression: nothing stamped or cleared th_last_seen at the moment a
  // session actually begins, so a user whose PREVIOUS session ended any way
  // other than explicit sign-out (browser closed, refresh token naturally
  // expired) still had that old session's stale cookie sitting in their
  // browser — logging back in with a correct password redirected straight
  // into a page read that stale timestamp as idle-expired and bounced them
  // right back to /login?reason=idle, immediately after a successful login.
  it("writes a fresh timestamp via cookies().set(), matching stampActivity's own cookie name/options", async () => {
    await stampActivityCookie(1_000_000_000_000);

    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieSet.mock.calls[0]!;
    expect(name).toBe(LAST_ACTIVITY_COOKIE);
    expect(value).toBe("1000000000000");
    expect((options as { maxAge: number }).maxAge).toBeGreaterThan(
      IDLE_TIMEOUT_MS / 1000 + 60 * 60
    );
  });

  it("defaults to the current time when no timestamp is given", async () => {
    const before = Date.now();
    await stampActivityCookie();
    const after = Date.now();

    const [, value] = cookieSet.mock.calls[0]!;
    const stamped = Number(value);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });

  it("never throws, even if cookies() itself rejects", async () => {
    const { cookies } = jest.requireMock<{ cookies: jest.Mock }>("next/headers");
    cookies.mockRejectedValueOnce(new Error("no request context"));

    await expect(stampActivityCookie()).resolves.toBeUndefined();
  });
});

describe("buildIdleTimeoutRedirect", () => {
  it("redirects to /login with reason=idle and the original path preserved", () => {
    const request = new NextRequest("https://app.tarragonhealth.com/patient/vitals");
    const response = buildIdleTimeoutRedirect(request);

    // 303, not the default 307 — a 307 would replay a Server Action POST
    // (submitted from an idle session) as a POST to /login instead of a
    // clean GET landing. See buildIdleTimeoutRedirect's own comment.
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("reason")).toBe("idle");
    expect(location.searchParams.get("redirect")).toBe("/patient/vitals");
  });

  it("clears every sb-prefixed cookie from the request, plus the activity cookie", () => {
    const request = new NextRequest("https://app.tarragonhealth.com/patient/vitals", {
      headers: {
        cookie: "sb-abc-auth-token=secret; sb-abc-auth-token.1=secret2; unrelated=keep-me; th_last_seen=123",
      },
    });
    const response = buildIdleTimeoutRedirect(request);

    const setCookies = response.cookies.getAll();
    const cleared = new Set(
      setCookies.filter((c) => c.value === "" || c.maxAge === 0).map((c) => c.name)
    );
    expect(cleared.has("sb-abc-auth-token")).toBe(true);
    expect(cleared.has("sb-abc-auth-token.1")).toBe(true);
    expect(cleared.has("th_last_seen")).toBe(true);
    expect(cleared.has("unrelated")).toBe(false);
  });
});
