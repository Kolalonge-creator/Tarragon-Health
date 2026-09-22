import { NextRequest, NextResponse } from "next/server";
import {
  IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_COOKIE,
  buildIdleTimeoutRedirect,
  isBackgroundTelemetryPath,
  isSessionIdle,
  stampActivity,
} from "./idle-timeout";

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

describe("stampActivity", () => {
  it("sets the last-activity cookie to the given timestamp", () => {
    const response = NextResponse.next();
    stampActivity(response, 1_000_000_000_000);
    expect(response.cookies.get(LAST_ACTIVITY_COOKIE)?.value).toBe("1000000000000");
  });
});

describe("buildIdleTimeoutRedirect", () => {
  it("redirects to /login with reason=idle and the original path preserved", () => {
    const request = new NextRequest("https://app.tarragonhealth.com/patient/vitals");
    const response = buildIdleTimeoutRedirect(request);

    expect(response.status).toBe(307);
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
