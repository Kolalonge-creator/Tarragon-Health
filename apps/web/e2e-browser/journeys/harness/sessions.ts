// S85 journey harness: real signed-in sessions.
//
// Seeding through the service role bypasses every row security policy, so on its own it proves nothing about who can see
// what. Journeys therefore sign in as a patient, a clinician and an institution administrator with a real password and the
// public anon key, exactly as the app does, and make their access assertions through those clients.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { journeyEnv } from "./env";
import { serviceClient } from "./drain";
import { sql, lit } from "./sql";

export type RoleName = "patient" | "clinician" | "corporate_admin" | "hmo_admin" | "admin";

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly label: string;
}

export async function createUser(runId: string, label: string, opts: { role: RoleName; organisationId: string; phone?: string; fullName?: string }): Promise<TestUser> {
  const admin = serviceClient();
  const email = `s85-${label}-${runId}@example.com`;
  const password = `S85-test-pw-${runId}-!Aa1`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: opts.fullName ?? `[s85] ${label}` },
  });
  if (error || !data.user) throw error ?? new Error(`createUser ${label} returned no user`);
  const id = data.user.id;
  // The profile row is created by a trigger when GoTrue inserts the user; wait for it, then set role, organisation and the
  // test flag with a direct update (user_metadata is never trusted for role or organisation).
  for (let i = 0; i < 40; i++) {
    if (sql(`select 1 from public.profiles where id = ${lit(id)};`) === "1") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  sql(
    `update public.profiles set role = ${lit(opts.role)}::public.user_role, organisation_id = ${lit(opts.organisationId)}, is_test = true, is_active = true` +
      (opts.phone ? `, phone = ${lit(opts.phone)}` : "") +
      ` where id = ${lit(id)};`,
  );
  return { id, email, password, label };
}

/** A client holding a real session for this user. Throws if the sign-in fails. */
export async function signIn(user: TestUser): Promise<SupabaseClient> {
  const { apiUrl, anonKey } = journeyEnv();
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in as ${user.label} failed: ${error.message}`);
  return client;
}

export function anonClient(): SupabaseClient {
  const { apiUrl, anonKey } = journeyEnv();
  return createClient(apiUrl, anonKey, { auth: { persistSession: false } });
}

export function newOrganisation(runId: string, name: string, type: string = "clinic"): string {
  const id = sql(
    `insert into public.organisations (name, type, metadata) values (${lit(`[s85] ${name} ${runId}`)}, ${lit(type)}, '{"s85_test": true}'::jsonb) returning id;`,
  );
  return id.split("\n")[0]!.trim();
}
