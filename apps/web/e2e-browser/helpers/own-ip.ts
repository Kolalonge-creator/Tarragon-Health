import { randomInt } from "node:crypto";

// Every browser test reaches the app from the same address, so every UI sign-in lands in one `login-email:ip:` bucket of 20 per
// 5 minutes (packages/auth/src/rate-limit.ts, in-process because CI has no Upstash). The suite sits close to that count: on
// 2026-10-30 (PR 1558) staff-patient-chat was refused with "Too many attempts" at its patient sign-in and again at both retries.
//
// getClientIp() reads the first entry of x-forwarded-for, and Next only fills that header when it is absent
// (`req.headers['x-forwarded-for'] ??= remoteAddress`), so a value sent by the browser is kept. Giving each file (or context) its
// own documentation-range address (2001:db8::/32, never routable) gives it its own bucket. The limiter itself is untouched and still
// runs on every sign-in; this is the same header Vercel supplies in production.
//
// Use `test.use({ extraHTTPHeaders: ownIp() })` for a spec on the `page` fixture. A context made with `browser.newContext()` does not
// inherit `use` options, so pass `{ extraHTTPHeaders: ownIp() }` to it directly.

const hextet = (): string => randomInt(0, 0x10000).toString(16);

export function ownIp(): { "x-forwarded-for": string } {
  return { "x-forwarded-for": `2001:db8:${hextet()}:${hextet()}:${hextet()}:${hextet()}:${hextet()}:${hextet()}` };
}
