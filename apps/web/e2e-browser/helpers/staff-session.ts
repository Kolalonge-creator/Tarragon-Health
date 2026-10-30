import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { adminClient, pollUntil } from "./supabase-admin";

// Shared by the events journeys (E5 to E7). Local stack only: global-setup.ts refuses any other Supabase URL, and every account and
// row made here is is_test and prefixed [e2e-test].

const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function psql(sql: string): string {
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { encoding: "utf8" }).trim();
}

export interface Account {
  userId: string;
  email: string;
  password: string;
}

export async function login(page: Page, who: { email: string; password: string }, landing?: RegExp): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.locator("#email").fill(who.email);
    await page.locator("#password").fill(who.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL(landing ?? ((url) => !url.pathname.startsWith("/login")), { timeout: 45_000 });
      return;
    } catch {
      if (attempt === 1) throw new Error("sign-in did not leave /login after two attempts");
    }
  }
}

/** The dev server compiles a route on its first request and can answer it with the 404 page; reload before treating that as real. */
export async function gotoRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const missing = (await page.getByText(/We couldn.t find that page/).count()) > 0;
    if (!missing) return;
    await page.waitForTimeout(3_000);
    await page.reload();
  }
}

/** A signed-in doctor (a clinician account with an active senior clinical_staff row) in the given organisation. */
export async function makeDoctor(label: string, runId: string, organisationId: string): Promise<Account & { staffId: string }> {
  const email = `e2e-test-${label}-${runId}@example.com`;
  const password = `E2e-test-pw-${runId}-!Aa1`;
  const { data: user, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `[e2e-test] ${label}` },
    app_metadata: { signup_exempt: "true" },
  });
  if (error || !user.user) throw error ?? new Error(`${label} create failed`);
  await pollUntil(async () => {
    const { data } = await adminClient.from("profiles").select("id").eq("id", user.user.id).maybeSingle();
    return data;
  });
  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ role: "clinician", organisation_id: organisationId, is_active: true, onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.user.id);
  if (updateError) throw updateError;
  psql(`update public.profiles set is_test = true where id = '${user.user.id}'`);
  const staffId = psql(`insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at,
      verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values ('${organisationId}', '${user.user.id}', '[e2e-test] ${label}', 'MDCN', 'E2E-${label}-${runId}', true, 'active', now(),
      (select id from public.profiles order by created_at limit 1), 'senior_medical_officer', 'employed', 2, true, (select id from public.profiles order by created_at limit 1), true)
    returning id`);
  return { userId: user.user.id, email, password, staffId };
}

export async function deleteAccount(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await adminClient.auth.admin.deleteUser(userId);
  } catch {
    // best effort: every row here is is_test and lives in a throwaway local database
  }
}
