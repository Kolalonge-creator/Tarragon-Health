/** Hostname helpers for marketing vs platform routing (see docs/MARKETING_SITE_SPEC.md §0). */

export function isAppHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname.startsWith("app.") || hostname === "app.localhost";
}

export function isMarketingHost(host: string): boolean {
  return !isAppHost(host);
}
