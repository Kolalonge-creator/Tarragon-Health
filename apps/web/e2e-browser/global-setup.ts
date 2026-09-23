/**
 * Hard safety gate: these specs create real signup/checkout/eligibility
 * data by driving the actual UI. They must only ever run against a fresh
 * local Supabase stack (`supabase start`), never against the live
 * production project (`.env.local`'s NEXT_PUBLIC_SUPABASE_URL, per
 * CLAUDE.md the one true go-forward project) — refuse to even start the
 * dev server if the configured URL isn't recognisably local.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i.test(url);

  if (!isLocal) {
    throw new Error(
      `Refusing to run browser E2E tests: NEXT_PUBLIC_SUPABASE_URL is "${
        url || "<unset>"
      }", which does not look like a local Supabase stack.\n\n` +
        "These tests create real signup, checkout, and eligibility data by driving the actual UI — " +
        "they must never run against the live production project.\n\n" +
        "Run `supabase start` (from the repo root) first, then set NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY to that stack's values (its CLI " +
        "output prints all three) before running `pnpm test:e2e-browser`. See e2e-browser/README.md.",
    );
  }
}
