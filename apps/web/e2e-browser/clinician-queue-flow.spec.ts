import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestPatient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";

// S16-S20 Stage 6 (W6.2): the clinician queue, click-through. Next task, finish it with a coded outcome, hand a second one back with a
// reason, a claim that runs out (the sweep returns the task and the page says so), and a task the clinical lead withdraws while it is held.
// Runs against the local stack only (global-setup refuses anything else). Tasks are created the way the SQL proofs create them, as the table
// owner through psql against E2E_DB_URL (default: the local stack's database), because the producers need engine events this flow does not
// care about. Every account and row is marked is_test and prefixed [e2e-test]. Not run in CI by default: it needs `supabase start` and a
// reset database, see e2e-browser/README.md.

const runId = Date.now().toString();
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function psqlValue(sql: string): string {
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { encoding: "utf8" }).trim();
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

interface Staff {
  userId: string;
  email: string;
  password: string;
}

test.describe("clinician queue (S16-S20)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let patient: TestPatient;
  let doctor: Staff;
  let lead: Staff;

  async function makeClinician(label: string, tier: "senior_medical_officer" | "chief_medical_officer", competencies: string[]): Promise<Staff> {
    const email = `e2e-test-${label}-${runId}@example.com`;
    const password = `E2e-test-pw-${runId}-!Aa1`;
    const { data: user, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `[e2e-test] ${label}` } });
    if (error || !user.user) throw error ?? new Error(`${label} create failed`);
    await pollUntil(async () => {
      const { data: row } = await adminClient.from("profiles").select("id").eq("id", user.user.id).maybeSingle();
      return row;
    });
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ role: "clinician", organisation_id: patient.organisationId, is_active: true, onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.user.id);
    if (updateError) throw updateError;
    // is_test is written as the table owner: the service-role REST client has no access to the private schema a profile write reaches for it
    psqlValue(`update public.profiles set is_test = true where id = '${user.user.id}'`);
    const comps = competencies.map((c) => `('${patient.organisationId}', (select id from s), '${c}', (select id from public.profiles order by created_at limit 1), true)`).join(",");
    psqlValue(`with s as (
        insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at,
          verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
        values ('${patient.organisationId}', '${user.user.id}', '[e2e-test] ${label}', 'MDCN', 'E2E-${label}-${runId}', true, 'active', now(),
          (select id from public.profiles order by created_at limit 1), '${tier}', 'contracted', 2, true, (select id from public.profiles order by created_at limit 1), true)
        returning id
      ), c as (
        ${competencies.length ? `insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values ${comps}` : "select 1"}
      ), b as (
        insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
        values ('${patient.organisationId}', '${user.user.id}', now() - interval '1 minute', now() + interval '3 hours', 'queue', true)
      ) select 1;`);
    return { userId: user.user.id, email, password };
  }

  /** A fresh routine task for the test patient; returns its id. Any older open one is closed first so the dedup rule cannot merge into it. */
  function newTask(): string {
    psqlValue(`update public.clinical_tasks set state = 'cancelled' where patient_id = '${patient.userId}' and state not in ('completed','cancelled');
      update public.task_claims set ended_at = now(), end_reason = 'cancelled' where ended_at is null and task_id in (select id from public.clinical_tasks where patient_id = '${patient.userId}');`);
    return psqlValue(`select private.create_clinical_task('${patient.userId}', 'amber_bp_review');`);
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createTestPatient(runId);
    // The queue only offers a test task to a test clinician (ct.is_test = me.is_test) and a task takes the patient's flag, so the patient is a test row too.
    psqlValue(`update public.profiles set is_test = true where id = '${patient.userId}'`);
    doctor = await makeClinician("doctor", "senior_medical_officer", ["hypertension", "adult_general"]);
    lead = await makeClinician("lead", "chief_medical_officer", []);
  });

  test.afterAll(async () => {
    try {
      psqlValue(`delete from public.task_claims where task_id in (select id from public.clinical_tasks where patient_id = '${patient.userId}');`);
    } catch {
      // cleanup is best effort; the rows are is_test and the organisation is deleted below
    }
    await deleteTestPatient(patient);
    for (const s of [doctor, lead]) if (s) await adminClient.auth.admin.deleteUser(s.userId);
  });

  test("Next task, then finish it with a coded outcome", async ({ page }) => {
    const taskId = newTask();
    await login(page, doctor);
    await gotoRoute(page, "/clinician/queue");
    await page.getByRole("button", { name: "Next task" }).click();
    await page.waitForURL(`**/clinician/tasks/${taskId}`, { timeout: 30_000 });
    // free text alone is only a note: the form refuses to finish without a code
    await page.locator("#complete-note").fill("Reviewed the readings");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expect(page).toHaveURL(new RegExp(`/clinician/tasks/${taskId}`));
    await page.locator("#complete-code").selectOption("completed_action_taken");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await page.waitForURL("**/clinician/queue?done=1", { timeout: 30_000 });
    expect(psqlValue(`select state || ':' || coalesce(outcome ->> 'code','') from public.clinical_tasks where id = '${taskId}'`)).toContain("completed");
  });

  test("hand a task back with a reason", async ({ page }) => {
    const taskId = newTask();
    await login(page, doctor);
    await gotoRoute(page, "/clinician/queue");
    await page.getByRole("button", { name: "Next task" }).click();
    await page.waitForURL(`**/clinician/tasks/${taskId}`, { timeout: 30_000 });
    // no reason is pre-selected: the button does nothing until one is chosen
    await expect(page.locator("#handback-reason")).toHaveValue("");
    await page.locator("#handback-reason").selectOption("needs_information");
    await page.getByRole("button", { name: "Hand back" }).click();
    await page.waitForURL("**/clinician/queue?handed_back=1", { timeout: 30_000 });
    expect(psqlValue(`select count(*) from public.task_claims where task_id = '${taskId}' and ended_at is not null and end_reason like 'handed_back%'`)).toBe("1");
    // the same clinician is barred from the same task after needs_information (D7): the queue has nothing for them
    await page.getByRole("button", { name: "Next task" }).click();
    await page.waitForURL(/\/clinician\/queue\?none=1/, { timeout: 30_000 });
  });

  test("a claim that runs out returns the task and the page says so", async ({ page }) => {
    const taskId = newTask();
    await login(page, doctor);
    await gotoRoute(page, "/clinician/queue");
    await page.getByRole("button", { name: "Next task" }).click();
    await page.waitForURL(`**/clinician/tasks/${taskId}`, { timeout: 30_000 });
    psqlValue(`update public.task_claims set expires_at = now() - interval '1 minute' where task_id = '${taskId}' and ended_at is null; update public.clinical_tasks set claim_expires_at = now() - interval '1 minute' where id = '${taskId}'; select private.expire_task_claims();`);
    await page.goto(`/clinician/tasks/${taskId}`);
    await expect(page.getByText("You do not hold this task. It may have timed out and returned to the queue.")).toBeVisible();
  });

  test("a task the clinical lead withdraws is shown as withdrawn", async ({ page }) => {
    const taskId = newTask();
    await login(page, doctor);
    await gotoRoute(page, "/clinician/queue");
    await page.getByRole("button", { name: "Next task" }).click();
    await page.waitForURL(`**/clinician/tasks/${taskId}`, { timeout: 30_000 });
    // the lead cancels it, as the lead (the function checks auth.uid()), in one transaction
    psqlValue(`begin;
      select set_config('request.jwt.claims', json_build_object('sub', '${lead.userId}', 'role', 'authenticated')::text, true);
      set local role authenticated;
      select public.cancel_clinical_task('${taskId}', '[e2e-test] withdrawn while held');
      commit;`);
    await page.goto(`/clinician/tasks/${taskId}`);
    await expect(page.getByText("This task was withdrawn by the clinical lead. Nothing more is needed from you on it.")).toBeVisible();
  });
});
