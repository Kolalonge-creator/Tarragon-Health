/**
 * Helpers for the app host's per-request nonce policy (src/proxy.ts builds it with lib/security/csp-policy.ts) and for the
 * violation reports it sends to /api/csp-report. Reports are summarised without ids, tokens or query strings.
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
