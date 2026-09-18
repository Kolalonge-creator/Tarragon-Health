/**
 * The target server's port/base URL, computed once and shared by both
 * playwright.config.ts and fixtures.ts (rather than each re-deriving it,
 * which risks the two drifting apart — e.g. fixtures.ts computing the
 * "same origin" check against a different default port than the server
 * playwright.config.ts actually started).
 */
const rawPort = process.env.PLAYWRIGHT_PORT;
const parsedPort = rawPort ? Number(rawPort) : 3100;
if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  throw new Error(
    `PLAYWRIGHT_PORT must be a positive integer if set; got ${JSON.stringify(rawPort)}.`
  );
}
export const PORT = parsedPort;

// MUST be the `app.` subdomain, not a bare host: apps/web/src/proxy.ts and
// lib/marketing/host.ts's isAppHost() route every /patient/*, /clinician/*
// etc. path to the marketing site's 404 on any host that isn't "app.*" (or
// exactly "app.localhost", which every OS resolves to loopback with no
// /etc/hosts entry needed — RFC 6761). Confirmed live: hitting a plain
// 127.0.0.1/localhost origin serves the marketing 404 for every platform
// route, including an authenticated session's own post-login redirect.
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://app.localhost:${PORT}`;

export const APP_ORIGIN = new URL(BASE_URL).origin;
