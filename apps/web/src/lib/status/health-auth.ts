/**
 * SR1: authenticates a call to /api/health/deep by a shared secret, in a header (`x-health-secret`) or as a bearer token.
 * Constant-time comparison. "not_configured" when the secret is unset or too short to be a secret, so the route fails
 * closed rather than open.
 */
export const MIN_HEALTH_SECRET_LENGTH = 24;

export type HealthAuthResult = "ok" | "denied" | "not_configured";

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isHealthRequestAuthorised(headers: Headers, secret: string | undefined): HealthAuthResult {
  if (!secret || secret.length < MIN_HEALTH_SECRET_LENGTH) return "not_configured";
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const presented = headers.get("x-health-secret") ?? bearer;
  return presented !== "" && constantTimeEqual(presented, secret) ? "ok" : "denied";
}
