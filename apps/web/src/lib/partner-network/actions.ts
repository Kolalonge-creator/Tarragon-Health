"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { nairaInputToKobo } from "@/lib/format-money";
import {
  complaintFormSchema,
  declareSourcingSchema,
  describePartnerError,
  disputeSchema,
  messageSchema,
  paidSchema,
  recordSourcingSchema,
  resolveComplaintSchema,
  settlementIdSchema,
  suspendSchema,
  termsSchema,
  verifySourcingSchema,
  voidSchema,
} from "./model";

/**
 * S74 server actions. Each one validates its input, runs as the signed-in person (never the service role) and calls exactly one database function.
 * The database checks who may do what and returns the reason in words; nothing here moves money (no Paystack call exists in this file) and nothing here
 * decides a result's release.
 */
export type PartnerActionState = { error?: string; success?: boolean } | undefined;

const fail = (message: string): PartnerActionState => ({ error: message });
const firstIssue = (e: { issues: Array<{ message: string }> }): string => e.issues[0]?.message ?? "Please check the form.";

async function call(fn: string, args: Record<string, unknown>, revalidate: string): Promise<PartnerActionState> {
  const { error } = await loose(await createClient()).rpc(fn, args);
  if (error) return fail(describePartnerError(error));
  revalidatePath(revalidate);
  return { success: true };
}

// ---- Admin and CMO: complaints, suspension, reinstatement -------------------------------------------------------------------------------
export async function recordComplaintAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = complaintFormSchema.safeParse({
    kind: formData.get("kind"),
    partner: formData.get("partner"),
    category: formData.get("category"),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!p.success) return fail(firstIssue(p.error));
  return call("record_partner_complaint", { p_kind: p.data.kind, p_id: p.data.partner, p_category: p.data.category, p_note: p.data.note ?? null }, "/admin/partner-quality");
}

export async function resolveComplaintAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = resolveComplaintSchema.safeParse({ id: formData.get("id"), outcome: formData.get("outcome"), note: formData.get("note") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("resolve_partner_complaint", { p_id: p.data.id, p_outcome: p.data.outcome, p_note: p.data.note }, "/admin/partner-quality");
}

export async function suspendPartnerAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = suspendSchema.safeParse({ kind: formData.get("kind"), partner: formData.get("partner"), reason: formData.get("reason") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("suspend_partner_from_new_work", { p_kind: p.data.kind, p_id: p.data.partner, p_reason: p.data.reason }, "/admin/partner-quality");
}

export async function reinstatePartnerAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = suspendSchema.safeParse({ kind: formData.get("kind"), partner: formData.get("partner"), reason: formData.get("reason") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("reinstate_partner", { p_kind: p.data.kind, p_id: p.data.partner, p_reason: p.data.reason }, "/admin/partner-quality");
}

// ---- Admin: settlement (bookkeeping only; no transfer is ever started) --------------------------------------------------------------------
export async function runSettlementAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const month = String(formData.get("month") ?? "");
  const m = /^(\d{4}-\d{2})$/.exec(month);
  const { error } = await loose(await createClient()).rpc("run_partner_settlement", { p_month: m ? `${m[1]}-01` : null });
  if (error) return fail(describePartnerError(error));
  revalidatePath("/admin/partner-settlements");
  return { success: true };
}

export async function issueSettlementAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = settlementIdSchema.safeParse({ id: formData.get("id") });
  if (!p.success) return fail("That statement could not be found.");
  return call("issue_settlement", { p_id: p.data.id }, "/admin/partner-settlements");
}

export async function recordPaidAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = paidSchema.safeParse({ id: formData.get("id"), reference: formData.get("reference") });
  if (!p.success) return fail("Please record the bank reference of the payment made outside the platform.");
  return call("record_settlement_paid", { p_id: p.data.id, p_reference: p.data.reference }, "/admin/partner-settlements");
}

export async function voidSettlementAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = voidSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("void_settlement", { p_id: p.data.id, p_reason: p.data.reason }, "/admin/partner-settlements");
}

export async function createTermsAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const basis = String(formData.get("basis") ?? "");
  const raw = String(formData.get("value") ?? "");
  // a fixed share is typed in naira and stored in kobo once, here; a percentage is typed in per cent and stored in basis points
  const value = basis === "fixed_kobo" ? nairaInputToKobo(raw) : Math.round(Number(raw) * 100);
  const p = termsSchema.safeParse({
    kind: formData.get("kind"),
    partner: formData.get("partner"),
    catalogCode: formData.get("catalog_code"),
    source: formData.get("source"),
    basis,
    value: value ?? Number.NaN,
    sponsorPaidOnly: formData.get("sponsor_paid_only") === "on",
    reason: formData.get("reason"),
  });
  if (!p.success) return fail(firstIssue(p.error));
  return call(
    "create_partner_settlement_terms",
    { p_kind: p.data.kind, p_partner: p.data.partner, p_catalog_code: p.data.catalogCode, p_source: p.data.source, p_basis: p.data.basis, p_value: p.data.value, p_sponsor_paid_only: p.data.sponsorPaidOnly, p_reason: p.data.reason },
    "/admin/partner-settlements",
  );
}

export async function approveTermsAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = settlementIdSchema.safeParse({ id: formData.get("id") });
  if (!p.success) return fail("Those terms could not be found.");
  return call("approve_partner_settlement_terms", { p_id: p.data.id }, "/admin/partner-settlements");
}

export async function verifySourcingAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = verifySourcingSchema.safeParse({ partner: formData.get("partner"), note: formData.get("note"), months: formData.get("months") ?? 12 });
  if (!p.success) return fail(firstIssue(p.error));
  return call("verify_pharmacy_sourcing", { p_partner: p.data.partner, p_note: p.data.note, p_review_months: p.data.months }, "/admin/partner-quality");
}

// ---- Partner: dispute a statement, declare sourcing, record a batch's source, reply in a conversation --------------------------------------
export async function disputeStatementAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = disputeSchema.safeParse({ id: formData.get("id"), note: formData.get("note") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("partner_dispute_settlement", { p_id: p.data.id, p_note: p.data.note }, "/pharmacist/statements");
}

export async function declareSourcingAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = declareSourcingSchema.safeParse({ statement: formData.get("statement") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("pharmacist_declare_sourcing", { p_statement: p.data.statement }, "/pharmacist/quality");
}

export async function recordDispenseSourcingAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = recordSourcingSchema.safeParse({ dispense: formData.get("dispense"), nafdac: formData.get("nafdac"), supplier: formData.get("supplier") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("pharmacist_record_dispense_sourcing", { p_dispense: p.data.dispense, p_nafdac_reg: p.data.nafdac, p_supplier: p.data.supplier }, "/pharmacist/history");
}

export async function pharmacistReplyAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = messageSchema.safeParse({ prescription: formData.get("prescription"), body: formData.get("body") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("pharmacist_send_message", { p_prescription: p.data.prescription, p_body: p.data.body }, "/pharmacist/messages");
}

// ---- Patient: write to the pharmacy a prescription was sent to ----------------------------------------------------------------------------
export async function patientMessagePharmacyAction(_prev: PartnerActionState, formData: FormData): Promise<PartnerActionState> {
  const p = messageSchema.safeParse({ prescription: formData.get("prescription"), body: formData.get("body") });
  if (!p.success) return fail(firstIssue(p.error));
  return call("patient_send_pharmacy_message", { p_prescription: p.data.prescription, p_body: p.data.body }, `/patient/pharmacy/collect/${p.data.prescription}`);
}
