import { isAppHost } from "@/lib/marketing/host";

/**
 * Nonce-based script policy, step 1 of 2: REPORT-ONLY (security audit 2026-11-05, follow-up to H-headers).
 *
 * The enforced policy in next.config.ts still allows 'unsafe-inline' scripts, because Next streams its RSC payload through inline
 * <script> tags and a static page has no request to carry a nonce. This file adds a SECOND, report-only policy on the app host
 * with a fresh nonce per request. Next reads the nonce from the request's CSP header (it accepts the report-only header too:
 * next/dist/server/app-render/app-render.js) and stamps it on every script it renders dynamically. Nothing is blocked; the
 * browser only reports what a strict policy WOULD have blocked to /api/csp-report.
 *
 * Step 2 (enforcing) waits for evidence from those reports: every app-host page that is still statically prerendered would
 * lose its scripts under an enforced nonce policy, and the reports name them. Do not enforce before the reports are clean.
 *
 * Only script-src is tested here (plus object-src and base-uri, which a strict policy always sets). style-src stays out: React
 * renders inline style="" attributes everywhere and CSP has no nonce for those. The marketing host is left out: its pages are
 * statically generated, so every page would report, which is known and not useful.
 */

/** A fresh 128-bit nonce, base64. Unpredictable per request, which is the whole point of a nonce. */
export function newCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export const CSP_REPORT_PATH = "/api/csp-report";

/** The in-app Zoom call pages: same routes next.config.ts gives the consultation policy. Its WebAssembly engine needs wasm eval. */
export function isConsultationCallPath(pathname: string): boolean {
  return /^\/(patient|clinician)\/consultation\/[^/]+\/?$/.test(pathname) || /^\/patient\/supporting\/consultation\/[^/]+\/?$/.test(pathname);
}

/** Pages on the app host only. API routes return JSON, so a policy on them governs nothing. */
export function shouldAddNonceCsp(host: string, pathname: string): boolean {
  return isAppHost(host) && pathname !== "/api" && !pathname.startsWith("/api/");
}

/**
 * 'strict-dynamic' lets a nonced script load the scripts it needs (Next's chunks, the Google Maps loader, the Zoom SDK), so no host
 * list is needed. 'self' and https: are ignored by browsers that understand 'strict-dynamic' and keep older ones working.
 * Development adds 'unsafe-eval', which React needs for its dev error overlay and never in production.
 */
export function buildNonceCsp(nonce: string, opts: { inAppCall: boolean; dev: boolean }): string {
  const script = [
    "script-src",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'self'",
    "https:",
    ...(opts.inAppCall ? ["'wasm-unsafe-eval'"] : []),
    ...(opts.dev ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [script, "object-src 'none'", "base-uri 'self'", `report-uri ${CSP_REPORT_PATH}`].join("; ");
}

/** Never logs a query string (tokens, signed links), an id or a token: such a path segment becomes ":id". */
export function sanitiseReportPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    return null;
  }
  return path
    .split("/")
    // Route segments are short lowercase words. Anything with a digit or longer than 24 characters is an id or a capability
    // token (/checkout/pr_<code>, /share/<token>, /circle/join/<token>, /verify-rx/<hex>), so it never reaches the log.
    .map((seg) => (/\d/.test(seg) || seg.length > 24 ? ":id" : seg))
    .join("/")
    .slice(0, 200);
}

/** What a blocked resource was, without its path or query: "inline", "eval", "wasm-eval", "data", "blob", or an origin. */
export function sanitiseBlockedUri(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (["inline", "eval", "wasm-eval", "data", "blob", "self"].includes(raw)) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.slice(0, 40);
  }
}

export type CspViolationSummary = { directive: string | null; blocked: string | null; path: string | null; disposition: string | null };

/** Accepts both report formats: the legacy report-uri body ({"csp-report": {...}}) and the Reporting API array. */
export function summariseCspReports(body: unknown): CspViolationSummary[] {
  const raw: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const r of body) {
      if (r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation") {
        const inner = (r as { body?: unknown }).body;
        if (inner && typeof inner === "object") raw.push(inner as Record<string, unknown>);
      }
    }
  } else if (body && typeof body === "object") {
    const inner = (body as Record<string, unknown>)["csp-report"];
    if (inner && typeof inner === "object") raw.push(inner as Record<string, unknown>);
  }
  return raw.slice(0, 20).map((r) => {
    const directive = r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"];
    const disposition = r["disposition"];
    return {
      directive: typeof directive === "string" ? directive.slice(0, 60) : null,
      blocked: sanitiseBlockedUri(r["blocked-uri"] ?? r["blockedURL"]),
      path: sanitiseReportPath(r["document-uri"] ?? r["documentURL"]),
      disposition: typeof disposition === "string" ? disposition.slice(0, 20) : null,
    };
  });
}
