/** Hostname helpers for marketing vs platform routing (see docs/MARKETING_SITE_SPEC.md §0). */

export function isAppHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname.startsWith("app.") || hostname === "app.localhost";
}

/**
 * The canonical public host has no "www." (website Phase 5, 2026-11-05; the
 * live audit found www.tarragonhealth.ng serving every page with 200, a full
 * duplicate of the site). Returns the same URL on the bare host, or null when
 * no redirect is needed. Ports are kept so local work still behaves.
 */
export function wwwRedirectTarget(url: string, hostHeader?: string | null): string | null {
  const u = new URL(url);
  // The Host the visitor typed (behind Vercel, x-forwarded-host) wins over the
  // URL's host, which a framework may have normalised.
  const host = (hostHeader ?? u.host).toLowerCase();
  if (!host.startsWith("www.")) return null;
  // Set hostname and port separately: assigning `host` without a port keeps the URL's old port.
  const [hostname, port] = host.slice(4).split(":");
  u.hostname = hostname ?? "";
  u.port = port ?? "";
  return u.toString();
}

export function isMarketingHost(host: string): boolean {
  return !isAppHost(host);
}
