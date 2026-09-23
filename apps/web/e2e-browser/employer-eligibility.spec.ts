import { expect, test } from "@playwright/test";
import { adminClient } from "./helpers/supabase-admin";

// Genuinely public, unauthenticated flow (apps/web/src/app/(marketing)/_components/
// eligibility-actions.ts uses a service-role client, no auth check) — the
// closest thing to the audit's "NGO journey" that actually exists in this
// codebase today. There is no funding_programme/NGO model; what's built is
// an employer/HMO eligibility-roster checker on /corporate and /hmo.
const runId = Date.now().toString();
const companyName = `AcmeCorpE2E${runId}`;
const coveredPhoneDigits = `80${runId.slice(-8)}`;
const coveredPhoneE164 = `+234${coveredPhoneDigits}`;
// Same digits, formatted the way a real visitor would type them (leading 0,
// spaces) — proves normalizePhone() in eligibility-actions.ts, not just an
// already-E.164 string.
const coveredPhoneAsTyped = `0${coveredPhoneDigits}`;

test.describe("employer eligibility checker (/corporate)", () => {
  let organisationId: string;

  test.beforeAll(async () => {
    const { data: org, error } = await adminClient
      .from("organisations")
      .insert({ name: `[e2e-test] ${companyName} Ltd`, type: "corporate", is_active: true })
      .select("id")
      .single();
    if (error || !org) throw error ?? new Error("organisation insert returned no row");
    organisationId = org.id;

    // public.employer_roster_status is ('pending' | 'claimed' | 'removed' |
    // 'invited' | 'departed') — no 'active' value exists. checkEligibility()
    // only excludes 'removed' (.neq("status", "removed")), so 'pending' (the
    // table's own default, matching a roster member added but not yet
    // claimed — the exact scenario this test's copy assertion describes:
    // "Sign up... and your coverage attaches automatically") is correct.
    const { error: rosterError } = await adminClient.from("employer_roster_members").insert({
      organisation_id: organisationId,
      phone: coveredPhoneE164,
      full_name: "[e2e-test] Roster Member",
      status: "pending",
    });
    if (rosterError) throw rosterError;
  });

  test.afterAll(async () => {
    if (organisationId) await adminClient.from("organisations").delete().eq("id", organisationId);
  });

  test("a phone number on the roster is confirmed covered", async ({ page }) => {
    await page.goto("/corporate");
    await page.locator("#elig-company").fill(companyName);
    await page.locator("#elig-phone").fill(coveredPhoneAsTyped);
    await page.getByRole("button", { name: "Check my coverage" }).click();

    // The action echoes back exactly what the caller typed, never the real
    // organisation name (deliberate anti-enumeration design — see
    // eligibility-actions.ts's own comment) — assert on the typed value.
    await expect(page.getByText(`Good news: ${companyName} covers you on Tarragon.`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "Create my account" })).toBeVisible();
  });

  test("the same company but a phone number NOT on the roster gets partner_no_match, not covered", async ({ page }) => {
    await page.goto("/corporate");
    await page.locator("#elig-company").fill(companyName);
    await page.locator("#elig-phone").fill("08099999999");
    await page.getByRole("button", { name: "Check my coverage" }).click();

    await expect(
      page.getByText(`${companyName} works with Tarragon, but this number isn't on their list yet`),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("a company with no partner match at all captures a lead, not an error", async ({ page }) => {
    const unmatchedCompany = `NoPartnerE2E${runId}`;
    await page.goto("/corporate");
    await page.locator("#elig-company").fill(unmatchedCompany);
    await page.locator("#elig-phone").fill("08088888888");
    await page.getByRole("button", { name: "Check my coverage" }).click();

    await expect(page.getByText("We don't work with them yet")).toBeVisible({ timeout: 10_000 });

    const { data: lead } = await adminClient
      .from("leads")
      .select("id, name, source")
      .eq("name", unmatchedCompany)
      .eq("source", "eligibility_corporate")
      .maybeSingle();
    expect(lead).not.toBeNull();
    if (lead) await adminClient.from("leads").delete().eq("id", lead.id);
  });
});
