/**
 * The target server's port/base URL, computed once and shared by both
 * playwright.config.ts and fixtures.ts (rather than each re-deriving it,
 * which risks the two drifting apart — e.g. fixtures.ts computing the
 * "same origin" check against a different default port than the server
 * playwright.config.ts actually started).
 */
const rawPort = process.env.PLAYWRIGHT_PORT;
// A fixed default (not derived from anything per-process, e.g. process.pid)
// deliberately: this module is re-imported — and its top-level code
// genuinely re-executed, empirically confirmed, not just theoretically
// possible — by more than one Node process within a single `playwright
// test` invocation (the process that resolves webServer's command versus
// the process(es) that actually navigate the browser), so a PID-derived
// port was tried here and produced a REAL bug: the webServer bound one
// port while individual tests independently computed and connected to
// DIFFERENT ports each, none of which matched — page.goto() failing with
// ERR_CONNECTION_REFUSED on every test. A fixed value is the only way to
// guarantee every process that imports this module agrees on the same
// port. This DOES mean a genuine risk of colliding with another concurrent
// git worktree's own dev/E2E server (CLAUDE.md documents this repo's heavy
// concurrent-worktree practice — see also playwright.config.ts's webServer
// comment for a real instance of exactly that collision happening during
// this suite's own development) — the mitigation is PLAYWRIGHT_PORT, not
// automatic spreading: set it explicitly to a port you know is free when
// running this suite alongside another worktree's own server.
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
