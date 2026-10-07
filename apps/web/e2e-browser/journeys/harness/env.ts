// S85 journey harness: environment and the local-only guard.
//
// Every journey writes real rows (users, readings, pages, notifications). It must only ever run against a disposable
// local Supabase stack. global-setup.ts already refuses a non-local API URL; this module adds the same refusal for the
// direct database URL the harness uses for seeding, so a stray DATABASE_URL pointing at production cannot be used.

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])$/i;

export function isLocalUrl(raw: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `journey harness: ${name} is not set. Run \`supabase start\` and export the local stack's values (see e2e-browser/journeys/README.md).`,
    );
  }
  return v;
}

export interface JourneyEnv {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly serviceKey: string;
  readonly dbUrl: string;
}

let cached: JourneyEnv | undefined;

export function journeyEnv(): JourneyEnv {
  if (cached) return cached;
  const apiUrl = must("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = must("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = must("SUPABASE_SERVICE_ROLE_KEY");
  // The default is the Supabase CLI's own local database port. A second stack on the same machine sets E2E_DATABASE_URL.
  const dbUrl = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!isLocalUrl(apiUrl)) throw new Error(`journey harness: refusing a non-local NEXT_PUBLIC_SUPABASE_URL (${apiUrl})`);
  if (!isLocalUrl(dbUrl)) throw new Error("journey harness: refusing a non-local E2E_DATABASE_URL");
  cached = { apiUrl, anonKey, serviceKey, dbUrl };
  return cached;
}

/** A short unique run id so rows from two runs never collide and can be told apart. */
export function newRunId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}
