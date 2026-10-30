// The abnormal-result handler pages clinicians, drafts care plans and writes patient notices with the service role, and it is deployed
// with verify_jwt off (the database trigger calls it with the project's publishable key, which is public by design). Without a secret
// anyone who knew the URL and an organisation id could page every clinician in that organisation. The trigger now also sends the shared
// jobs secret (Vault notification_jobs_secret, edge secret NOTIFICATION_JOBS_SECRET), the same one expo-push-receipts already uses.
// This module has no Deno or network dependency so it can be tested directly.

export type JobsAuth = "ok" | "unauthorised" | "not_configured";

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** `expected` is the edge secret, `presented` the x-notification-jobs-secret header. An unset or empty secret never lets anyone in. */
export function checkJobsSecret(presented: string | null, expected: string | null | undefined): JobsAuth {
  if (!expected) return "not_configured";
  return sameSecret(presented ?? "", expected) ? "ok" : "unauthorised";
}
