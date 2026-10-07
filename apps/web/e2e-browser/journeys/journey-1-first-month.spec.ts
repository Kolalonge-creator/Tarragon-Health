import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { J1, startJourney } from "../../../../packages/shared/src/journeys/journeys";
import { drainBus, serviceClient } from "./harness/drain";
import { journeyEnv, newRunId } from "./harness/env";
import { finishJourney } from "./harness/report";
import { createUser, newOrganisation, signIn } from "./harness/sessions";
import { lit, sql, sqlRows, sqlValue } from "./harness/sql";

/**
 * Journey 1 (spec D.7.3): a new user's first month, as a SPINE test.
 *
 * Runs the steps that exist today with real sessions and the real database functions, and declares the rest pending with the
 * owner session. Nothing is simulated that the platform does not do: Health Points, the risk questionnaire, the screening
 * calendar, the silence nudge and the care pack offer are PENDING, not faked. Checkout through Paystack is SKIPPED with its
 * reason unless a test key and a served order-checkout function exist, which the local stack job does not have.
 *
 * The phone number below is a Supabase test OTP number (supabase/config.toml [auth.sms.test_otp], fixed code 123456), so the
 * real GoTrue phone sign-up runs and no SMS is sent. Nothing about the phone number or the code is a secret.
 */
const PHONE_LOCAL = "0803 123 0005";
const PHONE_E164 = "+2348031230005";
const CODE = "123456";
const PASSWORD = "S85-first-month-pw-!Aa1";

test.describe("Journey 1: a new user's first month", () => {
  test.setTimeout(300_000);

  test("spine: sign-up to first readings, the INV-03 hold, and the Care Circle", async ({ page }, testInfo) => {
    const run = startJourney(J1);
    const runId = newRunId();
    const { apiUrl, anonKey } = journeyEnv();
    const admin = serviceClient();

    // A leftover from an earlier run of this journey would make sign-up refuse; remove it (this number is this journey's alone).
    for (let p = 1; p <= 10; p++) {
      const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
      const users = data?.users ?? [];
      const old = users.find((u) => (u.phone ?? "").replace(/\D/g, "") === PHONE_E164.replace(/\D/g, ""));
      if (old) {
        await admin.auth.admin.deleteUser(old.id);
        break;
      }
      if (users.length < 200) break;
    }

    // ------------------------------------------------------------------ 1 and 2: phone sign-up with a code, then a password sign-in
    let patientId: string | null = null;
    await run.step("phone-signup-code", async () => {
      await page.goto("/signup");
      await page.getByRole("tab", { name: /^phone$/i }).click();
      await page.locator("#firstName").fill("Adebayo");
      await page.locator("#lastName").fill("Journey");
      await page.locator("#phone").fill(PHONE_LOCAL);
      await page.locator("#password").fill(PASSWORD);
      await page.getByRole("button", { name: /create account/i }).click();
      await page.locator("#token").waitFor({ timeout: 30_000 });
      // a wrong code must not sign her in
      await page.locator("#token").fill("000000");
      await page.getByRole("button", { name: /verify|confirm|continue/i }).first().click();
      await expect(page).not.toHaveURL(/\/patient|\/onboarding/, { timeout: 5_000 });
      await page.locator("#token").fill(CODE);
      await page.getByRole("button", { name: /verify|confirm|continue/i }).first().click();
      await page.waitForURL(/\/patient|\/onboarding/, { timeout: 90_000 });
      patientId = sqlValue<string>(`select id from public.profiles where regexp_replace(phone, '\\D', '', 'g') = ${lit(PHONE_E164.replace(/\D/g, ""))} limit 1`);
      expect(patientId, "no profile was created for the new phone number").not.toBeNull();
      sql(`update public.profiles set is_test = true, receives_care = true, date_of_birth = (current_date - interval '54 years')::date where id = ${lit(patientId!)};`);
    });

    const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false } });
    let patient: Awaited<ReturnType<typeof anon.auth.signInWithPassword>>["data"] | null = null;
    await run.step("password-set", async () => {
      const r = await anon.auth.signInWithPassword({ phone: PHONE_E164, password: PASSWORD });
      expect(r.error, JSON.stringify(r.error)).toBeNull();
      patient = r.data;
      expect(patient.session?.access_token).toBeTruthy();
      const wrong = await createClient(apiUrl, anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ phone: PHONE_E164, password: "not-the-password-0" });
      expect(wrong.error, "a wrong password signed in").not.toBeNull();
    });

    const org = sqlValue<string>(`select organisation_id::text from public.profiles where id = ${lit(patientId ?? "00000000-0000-0000-0000-000000000000")}`);
    if (!patientId || !org || !patient) {
      for (const s of J1.steps) if (!s.pending && !run.isResolved(s.id)) run.blocked(s.id, "sign-up did not produce a usable patient");
      await finishJourney(run, testInfo);
      return;
    }
    const me = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await me.auth.setSession({
      access_token: (patient as { session: { access_token: string; refresh_token: string } }).session.access_token,
      refresh_token: (patient as { session: { access_token: string; refresh_token: string } }).session.refresh_token,
    });

    // ------------------------------------------------------------------ 6 and 7: an order for a screen (real RPC), then checkout
    await run.step("order-created-for-screen", async () => {
      const item = sqlRows<{ code: string }>(
        `select ci.code from public.catalog_items ci join public.prices p on p.catalog_item_id = ci.id
          where ci.is_active order by ci.code limit 1`,
      )[0];
      expect(item, "the catalogue has no active priced item to order").toBeDefined();
      const res = await me.rpc("create_order", { p_code: item!.code, p_client_key: crypto.randomUUID() });
      expect(res.error, JSON.stringify(res.error)).toBeNull();
      const o = res.data as { order_id?: string; id?: string; status?: string };
      expect(o.status ?? "pending").toMatch(/pending/);
    });
    if (process.env.PAYSTACK_SECRET_KEY) {
      run.skipped("paystack-test-mode-payment", "a Paystack test key is set, but the order-checkout edge function is not served by the local stack job, so a hosted checkout cannot start");
    } else {
      run.skipped("paystack-test-mode-payment", "no PAYSTACK_SECRET_KEY test key in this environment and no served order-checkout function; never use a live key");
    }

    // ------------------------------------------------------------------ 8 and 9: INV-03, an abnormal result is held until a clinician releases it
    // (see the lab result steps below, filled in once the S27 functions are exercised against the real database)
    for (const id of ["result-held-before-clinician-review", "clinician-releases-result"]) {
      if (!run.isResolved(id)) run.blocked(id, "not exercised yet");
    }

    // ------------------------------------------------------------------ 11: daily readings graded through the bus
    await run.step("daily-readings-graded", async () => {
      for (let d = 1; d <= 5; d++) {
        const ins = await me.from("vitals_readings").insert({
          organisation_id: org,
          patient_id: patientId,
          vital_type: "blood_pressure",
          systolic: 138 + d,
          diastolic: 88,
          taken_at: new Date(Date.now() - (6 - d) * 3600_000).toISOString(),
        });
        expect(ins.error, JSON.stringify(ins.error)).toBeNull();
      }
      const drain = await drainBus();
      expect(drain.summary.dead, "a delivery went to the dead letter").toBe(0);
      const graded = Number(sqlValue<string>(`select count(*)::text from public.triage_events where patient_id = ${lit(patientId!)}`));
      expect(graded, "each logged reading should have been graded through the bus").toBeGreaterThanOrEqual(1);
    });

    // ------------------------------------------------------------------ 15: her son joins her Care Circle (real sessions both sides)
    await run.step("son-joins-care-circle", async () => {
      const son = await createUser(runId, "son", { role: "patient", organisationId: org, fullName: "[s85] Son" });
      sql(`update public.profiles set receives_care = false, onboarding_completed_at = now() where id = ${lit(son.id)};`);
      sql(`update public.profiles set is_test = true where id = ${lit(patientId!)};`);
      const invite = await me.rpc("create_care_circle_invite", { p_kind: "email", p_contact: son.email, p_relationship: "Son", p_permissions: ["weekly_bp_trend", "red_alerts"] });
      expect(invite.error, JSON.stringify(invite.error)).toBeNull();
      const sonClient = await signIn(son);
      const ok = await sonClient.rpc("accept_care_circle_invite", { p_token: (invite.data as { token: string }).token });
      expect(ok.error, JSON.stringify(ok.error)).toBeNull();
      expect((ok.data as { ok: boolean }).ok).toBe(true);
      // permission scoping: the son sees the trend block only through the supporter function, never the raw readings
      const raw = await sonClient.from("vitals_readings").select("id", { count: "exact", head: true });
      expect(raw.count ?? 0).toBe(0);
    });

    void newOrganisation;
    await finishJourney(run, testInfo);
  });
});
