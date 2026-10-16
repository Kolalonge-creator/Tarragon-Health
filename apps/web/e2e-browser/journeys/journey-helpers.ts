import type { Page } from "@playwright/test";
import { adminClient, createTestPatient, pollUntil, type TestPatient } from "../helpers/supabase-admin";

/**
 * Shared helpers for the four D.7.3 journey specs (S85).
 *
 * Every helper here talks to the LOCAL Supabase stack only: global-setup.ts refuses to start the suite
 * unless NEXT_PUBLIC_SUPABASE_URL is a local address, and supabase-admin.ts reads the same variables.
 * Nothing here is ever safe to point at the live project. All rows are created with is_test = true (INV-13).
 */

/** A patient the journeys can log in as: a real confirmed account, flagged is_test, onboarding already done. */
export async function createJourneyPatient(runId: string): Promise<TestPatient> {
  const patient = await createTestPatient(runId);
  const { error } = await adminClient
    .from("profiles")
    .update({ is_test: true, onboarding_completed_at: new Date().toISOString(), date_of_birth: "1971-05-04" })
    .eq("id", patient.userId);
  if (error) throw error;
  return patient;
}

export async function loginAs(page: Page, patient: TestPatient): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(patient.email);
  await page.locator("#password").fill(patient.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/patient/, { timeout: 60_000 });
}

/**
 * Runs one pass of the event bus processor, the way pg_cron does every 15 seconds in production. A local
 * `supabase start` has no cron secret and does not serve edge functions unless `supabase functions serve`
 * is running with PROCESS_EVENTS_SECRET set, so this returns false (and the caller skips the downstream
 * assertions with a named reason) instead of failing when that is not the case.
 */
export async function drainEventBus(): Promise<boolean> {
  const secret = process.env.PROCESS_EVENTS_SECRET;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !base || !serviceKey) return false;
  try {
    const res = await fetch(`${base}/functions/v1/process-events`, {
      method: "POST",
      headers: { "x-process-events-secret": secret, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Polls for a row, draining the bus between looks. */
export async function pollWithDrain<T>(fn: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  return pollUntil(
    async () => {
      const found = await fn();
      if (found) return found;
      await drainEventBus();
      return null;
    },
    { timeoutMs, intervalMs: 2_000 },
  );
}

/** INV-07: a notification never names a condition, reading or result. */
export const CLINICAL_TERMS_FORBIDDEN_IN_NOTIFICATIONS = /\b(blood pressure|hypertension|diabetes|glucose|creatinine|mmHg|\d{2,3}\/\d{2,3})\b/i;
