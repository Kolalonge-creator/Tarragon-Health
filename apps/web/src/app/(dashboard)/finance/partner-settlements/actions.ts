"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PartnerSettlementActionState = { error?: string; message?: string } | undefined;

/**
 * §91.11 provider settlement — the UI layer only. The reconciliation engine
 * itself (partner_statements/partner_statement_lines, match_partner_statement,
 * approve_partner_statement) already existed, fully built, from the
 * self-arranged-fulfilment-era partner-billing work
 * (20260821192256_partner_billing_reconcile_settle_refund.sql) — this was
 * discovered mid-Phase-11 and nothing about it needed rebuilding. What was
 * actually missing was any screen for finance staff to use it at all.
 *
 * A statement's own uniqueness constraint (provider_id, reference) is what
 * actually prevents entering the same Synlab invoice twice — this action
 * relies on that rather than checking first, so a race between two staff
 * members still lands on one row.
 *
 * Access note: partner_statements/partner_statement_lines RLS is gated on
 * private.is_org_staff(), which deliberately excludes the `finance` role
 * itself (recording/matching what a lab delivered is treated as a care-team
 * operations question, not a pure accounting one) — approve_partner_statement
 * then adds a SEPARATE finance.vendors.manage gate on top for the actual
 * payment commitment. In practice that means an `admin` account can use every
 * action on this page; a plain `finance`-role account can reach this page
 * (the /finance layout gate) but will get an RLS error attempting to create
 * or match a statement. That split is this pre-existing engine's own design
 * from 20260821192256_partner_billing_reconcile_settle_refund.sql, not
 * something this page changes.
 */
export async function createPartnerStatement(
  _prevState: PartnerSettlementActionState,
  formData: FormData,
): Promise<PartnerSettlementActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const providerId = formData.get("providerId") as string;
  const reference = (formData.get("reference") as string)?.trim();
  const periodStart = formData.get("periodStart") as string;
  const periodEnd = formData.get("periodEnd") as string;
  const invoicedTotalNaira = formData.get("invoicedTotalNaira") as string;
  const linesRaw = (formData.get("lines") as string) ?? "";

  if (!providerId) return { error: "Choose which laboratory this statement is from." };
  if (!reference) return { error: "Enter the invoice/reference number from the laboratory." };
  if (!periodStart || !periodEnd) return { error: "Enter the period this statement covers." };
  const invoicedTotalKobo = Math.round(parseFloat(invoicedTotalNaira) * 100);
  if (!Number.isFinite(invoicedTotalKobo) || invoicedTotalKobo <= 0) {
    return { error: "Enter the total amount invoiced, in naira." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "Your account has no organisation on file." };

  const lines = linesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [screenTypeCode, invoicedNaira, labOrderId, partnerReference] = line.split(",").map((v) => v?.trim());
      return {
        screen_type_code: screenTypeCode || null,
        invoiced_kobo: Math.round(parseFloat(invoicedNaira ?? "") * 100),
        lab_order_id: labOrderId || null,
        partner_reference: partnerReference || null,
      };
    });

  if (lines.some((l) => !Number.isFinite(l.invoiced_kobo) || l.invoiced_kobo < 0)) {
    return { error: "Every line needs a valid invoiced amount in naira as its second value." };
  }

  const { data: statement, error: statementError } = await supabase
    .from("partner_statements")
    .insert({
      organisation_id: profile.organisation_id,
      provider_id: providerId,
      reference,
      period_start: periodStart,
      period_end: periodEnd,
      invoiced_total_kobo: invoicedTotalKobo,
    })
    .select("id")
    .single();

  if (statementError || !statement) {
    return {
      error:
        statementError?.code === "23505"
          ? "A statement with that reference from this laboratory already exists."
          : (statementError?.message ?? "Could not save that statement."),
    };
  }

  if (lines.length > 0) {
    const { error: linesError } = await supabase.from("partner_statement_lines").insert(
      lines.map((l) => ({ ...l, statement_id: statement.id })),
    );
    if (linesError) return { error: `Statement saved, but line items failed: ${linesError.message}` };
  }

  revalidatePath("/finance/partner-settlements");
  return { message: "Statement saved. Match it against our orders next." };
}

export async function matchStatementAction(statementId: string): Promise<PartnerSettlementActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_partner_statement", { p_statement_id: statementId });
  if (error) return { error: error.message };
  revalidatePath("/finance/partner-settlements");
  const result = data as { status: string; variance_lines: number; difference_kobo: number };
  return {
    message:
      result.variance_lines === 0
        ? "Matched. Every line agrees with our own orders."
        : `Matched with ${result.variance_lines} line(s) disagreeing with our orders (difference: ${result.difference_kobo} kobo).`,
  };
}

export async function approveStatementAction(
  statementId: string,
  forceNote: string,
): Promise<PartnerSettlementActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_partner_statement", {
    p_statement_id: statementId,
    p_force_note: forceNote.trim() || undefined,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance/partner-settlements");
  const result = data as { agreed_kobo: number };
  return { message: `Approved. A vendor bill for ${result.agreed_kobo} kobo has been raised.` };
}
