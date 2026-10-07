import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestPatient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";

// Click-through for the collection-only pharmacy model (spec Part C.2, OQ-16): the screens that used to carry delivery
// controls still render and still work after the delivery columns, statuses and RPC argument were removed. Runs against
// the local stack only (global-setup refuses anything else). Screenshots go to E2E_SHOTS_DIR when it is set.

const runId = Date.now().toString();
const SHOTS = process.env.E2E_SHOTS_DIR;

type StaffRole = "pharmacist" | "admin";
interface StaffUser {
  userId: string;
  email: string;
  password: string;
}

async function createStaff(role: StaffRole, organisationId: string, label: string): Promise<StaffUser> {
  const email = `e2e-test-${label}-${runId}@example.com`;
  const password = `E2e-test-pw-${runId}-!Aa1`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `[e2e-test] ${label}` },
  });
  if (error || !data.user) throw error ?? new Error(`${label} user create failed`);
  const userId = data.user.id;
  await pollUntil(async () => {
    const { data: row } = await adminClient.from("profiles").select("id").eq("id", userId).maybeSingle();
    return row;
  });
  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ role, organisation_id: organisationId, is_active: true, onboarding_completed_at: new Date().toISOString() })
    .eq("id", userId);
  if (updateError) throw updateError;
  return { userId, email, password };
}

async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("collection-only pharmacy screens", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let patient: TestPatient;
  let pharmacist: StaffUser;
  let admin: StaffUser;
  let partnerId: string;

  test.beforeAll(async () => {
    patient = await createTestPatient(runId);
    const { data: partner, error } = await adminClient
      .from("pharmacy_partners")
      .insert({ name: `[e2e-test] Click-through Pharmacy ${runId}`, is_active: false, regions: ["Lagos"] })
      .select("id")
      .single();
    if (error || !partner) throw error ?? new Error("partner insert failed");
    partnerId = partner.id;
    pharmacist = await createStaff("pharmacist", patient.organisationId, "pharmacist");
    admin = await createStaff("admin", patient.organisationId, "admin");
    const { error: linkError } = await adminClient.from("profiles").update({ pharmacy_partner_id: partnerId }).eq("id", pharmacist.userId);
    if (linkError) throw linkError;
  });

  test.afterAll(async () => {
    if (pharmacist) await adminClient.auth.admin.deleteUser(pharmacist.userId);
    if (admin) await adminClient.auth.admin.deleteUser(admin.userId);
    if (partnerId) await adminClient.from("pharmacy_partners").delete().eq("id", partnerId);
    if (patient) await deleteTestPatient(patient);
  });

  test("a pharmacist edits and saves the pharmacy profile, with no delivery control", async ({ page }) => {
    await login(page, pharmacist);
    await page.waitForURL(/\/pharmacist/, { timeout: 60_000 });
    await page.goto("/pharmacist/profile");
    await expect(page.locator("#p_name")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/offers delivery/i)).toHaveCount(0);
    await shot(page, "1-pharmacist-profile-before");

    const newName = `[e2e-test] Click-through Pharmacy Renamed ${runId}`;
    await page.locator("#p_name").fill(newName);
    await page.locator("#p_city").fill("Ikeja");
    await page.locator("#p_license_number").fill("PCN-CLICK-001");
    await page.getByRole("button", { name: "Save profile" }).click();

    const saved = await pollUntil(async () => {
      const { data } = await adminClient.from("pharmacy_partners").select("name, city, license_number").eq("id", partnerId).maybeSingle();
      return data?.name === newName ? data : null;
    });
    expect(saved.city).toBe("Ikeja");
    expect(saved.license_number).toBe("PCN-CLICK-001");
    await shot(page, "2-pharmacist-profile-saved");

    await page.goto("/pharmacist");
    await expect(page.getByText("PCN-CLICK-001").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^Delivery$/)).toHaveCount(0);
    await shot(page, "3-pharmacist-overview");
  });

  test("the admin pharmacies list shows the partner with no delivery field or badge", async ({ page }) => {
    await login(page, admin);
    await page.waitForURL(/\/admin/, { timeout: 60_000 });
    await shot(page, "4a-admin-home");
    await page.goto("/admin/settings/partners/pharmacies");
    await expect(page.getByText(/Click-through Pharmacy/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/offers delivery/i)).toHaveCount(0);
    await expect(page.locator("main").getByText(/^Delivery$/)).toHaveCount(0);
    await shot(page, "4-admin-pharmacies");
  });

  test("the operations dashboard pharmacy tile counts dispensed orders", async ({ page }) => {
    await login(page, admin);
    await page.waitForURL(/\/admin/, { timeout: 60_000 });
    await page.goto("/analytics/operations");
    const tile = page.getByText("Pharmacy orders").first();
    await expect(tile).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/dispensed/i).first()).toBeVisible();
    await expect(page.getByText(/avg/i).filter({ hasText: /pharmacy/i })).toHaveCount(0);
    await shot(page, "5-ops-dashboard");
  });

  test("the patient medications page renders with no delivery wording", async ({ page }) => {
    await login(page, patient);
    // A fresh patient lands on onboarding; finish it through the real UI, as b2c-signup-to-entitlement.spec.ts does.
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await page.getByRole("button", { name: /not sure yet/i }).click();
    await page.getByRole("checkbox", { name: /accept|agree/i }).check();
    await page.getByRole("button", { name: /i agree, continue/i }).click();
    await page.locator("#dateOfBirth").fill("1990-01-01");
    await page.locator("#sex").selectOption("female");
    await page.getByRole("button", { name: /save.*continue/i }).click();
    await page.getByRole("button", { name: /continue to the last step/i }).click();
    await page.getByRole("button", { name: /take me to my dashboard/i }).click();
    await page.waitForURL(/\/patient(?!\/onboarding)/, { timeout: 60_000 });

    await page.goto("/patient/medications");
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);
    await expect(page.getByText(/medication delivery|home delivery|out for delivery/i)).toHaveCount(0);
    await shot(page, "6-patient-medications");
  });
});
