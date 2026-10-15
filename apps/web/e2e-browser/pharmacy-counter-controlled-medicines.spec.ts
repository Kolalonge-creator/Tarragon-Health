import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestPatient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";

// OQ-276 click-through (CMO decision 2026-10-07): the pharmacy counter checks the controlled-medicines list a second time. A pharmacist who
// enters the right collection code for a controlled medicine gets a plain refusal, sees nothing about the patient and has no supply form;
// the refusal is audited. An ordinary prescription still verifies and is recorded as supplied. Runs against the local stack only
// (global-setup refuses anything else). The S37 prescribing guard (closed by default) needs a log row and the update in ONE transaction,
// which the REST API cannot do, so the guard is opened through psql against E2E_DB_URL (default: the local stack's database).

const runId = Date.now().toString();
const SHOTS = process.env.E2E_SHOTS_DIR;
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CONTROLLED_TEXT = /controlled medicines list, and Tarragon does not supply controlled medicines from this screen\. Nothing was recorded/i;

function psql(sql: string): void {
  execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "pipe" });
}

async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.locator("#email").fill(who.email);
    await page.locator("#password").fill(who.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
      return;
    } catch {
      if (attempt === 1) throw new Error("sign-in did not leave /login after two attempts");
    }
  }
}

// The dev server compiles a route on its first request and can answer that one request with the 404 page; reload before treating it as real.
async function gotoRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await page.getByText("We couldn’t find that page").count()) === 0 && (await page.getByText("We couldn't find that page").count()) === 0) return;
    await page.waitForTimeout(3_000);
    await page.reload();
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("pharmacy counter: controlled medicines (OQ-276)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let patient: TestPatient;
  let pharmacist: { userId: string; email: string; password: string };
  let partnerId: string;
  let locationId: string;
  let controlledRx: string;
  let ordinaryRx: string;
  let controlledCode: string;
  let ordinaryCode: string;

  async function signedPrescription(drug: string): Promise<string> {
    // Built as the table owner, the way the SQL proofs do: the service-role REST client has no access to the private schema that some defaults reach.
    const items = JSON.stringify([{ drug, dose: "5 mg", quantity: "30 tablets" }]).replace(/'/g, "''");
    const out = execFileSync(
      "psql",
      [DB_URL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", `with r as (
        insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
        values ('${patient.organisationId}', '${patient.userId}', '${items}'::jsonb, 'signed', '${pharmacist.userId}', now(), true) returning id
      ), m as (
        insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
        select '${patient.organisationId}', '${patient.userId}', '${drug.replace(/'/g, "''")}', '5 mg', '30 tablets', 0, 'clinician', true, id from r returning prescription_id
      ) select prescription_id from m;`],
      { encoding: "utf8" },
    ).trim();
    if (!/^[0-9a-f-]{36}$/.test(out)) throw new Error(`prescription fixture returned "${out}"`);
    return out;
  }

  async function patientSends(prescription: string): Promise<string> {
    // The patient alone chooses the pharmacy and alone reads the code, so this runs as the patient, exactly as the app does.
    const asPatient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);
    const { error: signInError } = await asPatient.auth.signInWithPassword({ email: patient.email, password: patient.password });
    if (signInError) throw signInError;
    const { data, error } = await asPatient.rpc("patient_choose_pharmacy", { p_prescription: prescription, p_partner: partnerId, p_location: locationId });
    if (error || typeof data !== "string") throw error ?? new Error("choosing a pharmacy returned no code");
    return data;
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createTestPatient(runId);
    const { data: partner, error } = await adminClient
      .from("pharmacy_partners")
      .insert({ name: `[e2e-test] Counter Pharmacy ${runId}`, is_active: true, approved_at: new Date().toISOString(), license_verified_at: new Date().toISOString(), onboarding_status: "activated", regions: ["Lagos"] })
      .select("id")
      .single();
    if (error || !partner) throw error ?? new Error("partner insert failed");
    partnerId = partner.id;
    const { data: location, error: locError } = await adminClient
      .from("pharmacy_partner_locations")
      .insert({ pharmacy_partner_id: partnerId, name: `[e2e-test] Counter Lekki ${runId}`, state: "Lagos", address: "1 Test Road", is_active: true, verified_at: new Date().toISOString() })
      .select("id")
      .single();
    if (locError || !location) throw locError ?? new Error("location insert failed");
    locationId = location.id;

    const email = `e2e-test-counter-${runId}@example.com`;
    const password = `E2e-test-pw-${runId}-!Aa1`;
    const { data: user, error: userError } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "[e2e-test] Counter Pharmacist" } });
    if (userError || !user.user) throw userError ?? new Error("pharmacist create failed");
    await pollUntil(async () => {
      const { data: row } = await adminClient.from("profiles").select("id").eq("id", user.user.id).maybeSingle();
      return row;
    });
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ role: "pharmacist", organisation_id: patient.organisationId, is_active: true, onboarding_completed_at: new Date().toISOString(), pharmacy_partner_id: partnerId })
      .eq("id", user.user.id);
    if (updateError) throw updateError;
    pharmacist = { userId: user.user.id, email, password };

    // Open the S37 prescribing guard the way its own trigger allows: a log row and the update in one transaction.
    psql(`begin;
      insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
        select 'prescribing_enabled', 'switched_on', p.id, 'admin', 'OQ-276 browser e2e', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
      update public.go_live_guards set is_on = true, changed_at = now(), changed_by = (select id from public.profiles order by created_at limit 1), change_note = 'OQ-276 browser e2e' where key = 'prescribing_enabled';
      commit;`);

    controlledRx = await signedPrescription("Tramadol 50mg");
    ordinaryRx = await signedPrescription("Proofdrug Ordinary");
    controlledCode = await patientSends(controlledRx);
    ordinaryCode = await patientSends(ordinaryRx);
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    try {
      psql(`begin;
        insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
          select 'prescribing_enabled', 'switched_off', p.id, 'admin', 'OQ-276 browser e2e done', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
        update public.go_live_guards set is_on = false, changed_at = null, changed_by = null, change_note = null where key = 'prescribing_enabled';
        commit;`);
    } catch {
      // the local stack is disposable; a guard left on never reaches production
    }
    try {
      // the supply rows, medicines and prescriptions this spec made, so the organisation can be removed (owner access, like the fixtures)
      if (patient) psql(`delete from public.pharmacy_order_dispenses where patient_id = '${patient.userId}'; delete from public.prescription_collection_codes where prescription_id in (select id from public.prescriptions where patient_id = '${patient.userId}'); delete from public.medications where patient_id = '${patient.userId}'; delete from public.prescriptions where patient_id = '${patient.userId}';`);
    } catch {
      // disposable local stack; leftover rows only make the organisation delete below fall back to "left in place"
    }
    if (pharmacist) await adminClient.auth.admin.deleteUser(pharmacist.userId);
    if (patient) await deleteTestPatient(patient);
    if (partnerId) await adminClient.from("pharmacy_partners").delete().eq("id", partnerId);
  });

  test("a controlled medicine is refused at the counter with a plain message, nothing about the patient, and an audit row", async ({ page }) => {
    await login(page, pharmacist);
    await page.waitForURL(/\/pharmacist/, { timeout: 60_000 });
    await gotoRoute(page, `/pharmacist/prescriptions/${controlledRx}`);
    await page.locator("#collection_code").fill(controlledCode);
    await page.getByRole("button", { name: "Check code" }).click();

    await expect(page.getByText(CONTROLLED_TEXT)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/e2e-test\] Patient|Allergies on file/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /record (partial )?supply/i })).toHaveCount(0);
    await shot(page, "oq276-1-controlled-refused");

    const audit = await pollUntil(async () => {
      const { data } = await adminClient.from("audit_log").select("id, event").eq("action", "pharmacy.controlled_medicine_refused").eq("entity_id", controlledRx);
      return data && data.length > 0 ? data : null;
    });
    expect(audit[0].event).toMatchObject({ step: "verify" });
    const { count } = await adminClient.from("pharmacy_order_dispenses").select("id", { count: "exact", head: true }).eq("patient_id", patient.userId);
    expect(count).toBe(0);
    const { data: still } = await adminClient.from("prescriptions").select("state").eq("id", controlledRx).single();
    expect(still?.state).toBe("sent");
  });

  test("an ordinary prescription still verifies and is recorded as supplied", async ({ page }) => {
    await login(page, pharmacist);
    await page.waitForURL(/\/pharmacist/, { timeout: 60_000 });
    await gotoRoute(page, `/pharmacist/prescriptions/${ordinaryRx}`);
    await page.locator("#collection_code").fill(ordinaryCode);
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText(/Allergies on file/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(CONTROLLED_TEXT)).toHaveCount(0);

    const expiry = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await page.locator("#pharmacist").fill("Ada Counter");
    await page.locator("#registration").fill("PCN12345");
    await page.locator("#quantity").fill("30 tablets");
    await page.locator("#batch").fill("B-1234");
    await page.locator("#expiry").fill(expiry);
    await page.getByRole("button", { name: "Record supply" }).click();
    await expect(page.getByText("Recorded as supplied. The patient was told.")).toBeVisible({ timeout: 60_000 });
    await shot(page, "oq276-2-ordinary-recorded");

    const { data: done } = await adminClient.from("prescriptions").select("state").eq("id", ordinaryRx).single();
    expect(done?.state).toBe("dispensed");
  });
});
