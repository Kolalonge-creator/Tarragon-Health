import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Deliberately reads the same env vars the app itself uses, not a separate
// "test project" config — global-setup.ts already refused to run this suite
// at all unless NEXT_PUBLIC_SUPABASE_URL looks like a local Supabase stack,
// so by the time this module loads it's safe to assume these point at that
// stack, not production.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "e2e-browser tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set to a local " +
      "Supabase stack's values (run `supabase start` and read its output, or `supabase status -o env`).",
  );
}

export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface TestPatient {
  userId: string;
  email: string;
  password: string;
  organisationId: string;
}

/**
 * Creates a real, email-confirmed patient account with a real password (so
 * a spec can log in through the actual /login form) and a real
 * organisation. Mirrors apps/web/e2e/abnormal-screening-escalation.e2e.test.ts's
 * pattern exactly, including the follow-up UPDATE workaround that test's own
 * comment documents in detail: private.handle_new_user() strips the leading
 * '+' from a phone passed to createUser, and role/organisation_id set via
 * user_metadata at creation time are never picked up by the trigger (it
 * fires before GoTrue's own follow-up app_metadata attach) — so both are set
 * via a direct UPDATE after the trigger-provisioned profiles row appears,
 * never trusted to createUser's metadata.
 */
export async function createTestPatient(runId: string): Promise<TestPatient> {
  const { data: org, error: orgError } = await adminClient
    .from("organisations")
    .insert({ name: `[e2e-test] Browser E2E ${runId}`, type: "clinic", metadata: { e2e_test: true } })
    .select("id")
    .single();
  if (orgError || !org) throw orgError ?? new Error("organisation insert returned no row");

  const email = `e2e-test-patient-${runId}@example.com`;
  const password = `E2e-test-pw-${runId}-!Aa1`;
  const { data: user, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "[e2e-test] Patient" },
  });
  if (userError || !user.user) throw userError ?? new Error("patient user create failed");
  const userId = user.user.id;

  await pollUntil(async () => {
    const { data } = await adminClient.from("profiles").select("id").eq("id", userId).maybeSingle();
    return data;
  });

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ role: "patient", organisation_id: org.id, phone: `+2343${runId.slice(-9)}` })
    .eq("id", userId);
  if (updateError) throw updateError;

  return { userId, email, password, organisationId: org.id };
}

/** Deletes the auth user (cascades profile + dependent rows) and its organisation. */
export async function deleteTestPatient(patient: TestPatient): Promise<void> {
  await adminClient.auth.admin.deleteUser(patient.userId);
  const { error } = await adminClient.from("organisations").delete().eq("id", patient.organisationId);
  if (error) {
    // Same caveat as the Jest E2E test: some tables (e.g. audit_log) hold
    // this organisation_id under ON DELETE RESTRICT by design — a leftover
    // [e2e-test]-prefixed org is expected, not a bug in this cleanup.
    console.warn(`[e2e-test] organisation ${patient.organisationId} left in place: ${error.message}`);
  }
}

/**
 * Seeds a service_purchases + payment_transactions pair whose end state is
 * byte-for-byte what private.apply_service_purchase_payment() (the same
 * AFTER INSERT trigger the real Paystack webhook's INSERT fires — see
 * supabase/functions/paystack-webhook/handler.ts and
 * supabase/migrations/20260831143207_service_purchase_checkout_and_payment_trigger.sql,
 * refined by 20260905060745 and 20260910215431) produces for a genuinely
 * completed payment — without ever calling Paystack or the webhook. The
 * trigger is the SAME code running against the SAME local stack the app
 * itself talks to, so this proves the UI layer honestly reflects real DB
 * state, not that the payment flow's webhook code works (that's
 * supabase/functions/paystack-webhook/index.test.ts's job).
 */
export async function seedActiveServicePurchase(
  patientId: string,
  organisationId: string,
  productCode: string,
  runId: string,
): Promise<{ productName: string }> {
  const { data: product, error: productError } = await adminClient
    .from("service_products")
    .select("id, name, price_kobo, currency")
    .eq("code", productCode)
    .eq("is_active", true)
    .single();
  if (productError || !product) {
    throw productError ?? new Error(`no active service_products row for code=${productCode}`);
  }

  const reference = `e2e-test-ref-${runId}`;

  const { error: purchaseError } = await adminClient.from("service_purchases").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    service_product_id: product.id,
    status: "pending_payment",
    amount_kobo: product.price_kobo,
    currency: product.currency,
    pending_payment_provider_ref: reference,
  });
  if (purchaseError) throw purchaseError;

  const { error: txnError } = await adminClient.from("payment_transactions").insert({
    provider: "paystack",
    provider_event_id: reference,
    event_type: "charge.success",
    amount_minor: product.price_kobo,
    currency: product.currency,
    raw_payload: {
      event: "charge.success",
      data: {
        reference,
        amount: product.price_kobo,
        currency: product.currency,
        metadata: { kind: "service_purchase", profile_id: patientId, item_code: productCode },
      },
    },
  });
  if (txnError) throw txnError;

  // The AFTER INSERT trigger runs synchronously in the same statement, but
  // poll anyway — matching this repo's own established idiom for every
  // trigger-driven assertion (see abnormal-screening-escalation.e2e.test.ts)
  // rather than assuming zero latency.
  // Both columns, truly OR'd in one call (mirroring the webhook's own
  // .or() usage) — the trigger nulls pending_payment_provider_ref and moves
  // the reference onto payment_provider_ref on success, so chaining a
  // separate .eq() before .or() would AND them together and never match
  // post-trigger.
  await pollUntil(async () => {
    const { data } = await adminClient
      .from("service_purchases")
      .select("status")
      .or(`payment_provider_ref.eq.${reference},pending_payment_provider_ref.eq.${reference}`)
      .maybeSingle();
    return data?.status === "active" ? data : null;
  });

  return { productName: product.name };
}
