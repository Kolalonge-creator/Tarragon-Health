"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { closePilotSchema, confirmPaymentSchema, createPilotSchema, pilotErrorText } from "./model";

export type PilotActionState = { error?: string; message?: string } | undefined;

/*
 * Finance steps for an employer seat pilot. Every step runs on the CALLER's own session (never the service role: the database
 * functions check private.is_finance() against auth.uid(), and a service-role client has no uid). The database is the authority;
 * these actions only validate the form and translate the answer.
 */

function revalidate(organisationId?: string) {
  if (organisationId) revalidatePath(`/admin/employers/${organisationId}`);
  revalidatePath("/dashboard/corporate/pilot");
}

export async function createPilot(_prev: PilotActionState, formData: FormData): Promise<PilotActionState> {
  if (!(await getCurrentUser())) return { error: "Not signed in" };
  const parsed = createPilotSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_employer_seat_pilot", {
    p_org: d.organisationId,
    p_benefit_package: d.benefitPackageId,
    p_seats: d.seats,
    p_starts_on: d.startsOn,
    p_ends_on: d.endsOn,
    p_terms_version: d.termsVersion,
  });
  if (error) return { error: pilotErrorText(error.message) };
  revalidate(d.organisationId);
  return { message: "Pilot created. Issue the invoice next." };
}

export async function issuePilotInvoice(_prev: PilotActionState, formData: FormData): Promise<PilotActionState> {
  if (!(await getCurrentUser())) return { error: "Not signed in" };
  const pilotId = String(formData.get("pilotId") ?? "");
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(pilotId)) return { error: "That pilot was not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_employer_seat_pilot_invoice", { p_pilot: pilotId });
  if (error) return { error: pilotErrorText(error.message) };
  revalidate(organisationId);
  return { message: "Invoice issued. Send it to the employer with the bank details or a Paystack payment link." };
}

export async function confirmPilotPayment(_prev: PilotActionState, formData: FormData): Promise<PilotActionState> {
  if (!(await getCurrentUser())) return { error: "Not signed in" };
  const parsed = confirmPaymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const organisationId = String(formData.get("organisationId") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_employer_seat_pilot_payment", {
    p_pilot: parsed.data.pilotId,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference,
  });
  if (error) return { error: pilotErrorText(error.message) };
  revalidate(organisationId);
  const result = (data as { result?: string } | null)?.result;
  return { message: result === "replay" ? "Already confirmed with this reference. Nothing changed." : "Payment recorded. The pilot is active." };
}

export async function closePilot(_prev: PilotActionState, formData: FormData): Promise<PilotActionState> {
  if (!(await getCurrentUser())) return { error: "Not signed in" };
  const parsed = closePilotSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const organisationId = String(formData.get("organisationId") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_employer_seat_pilot", { p_pilot: parsed.data.pilotId, p_reason: parsed.data.reason });
  if (error) return { error: pilotErrorText(error.message) };
  revalidate(organisationId);
  return { message: data === "ended" ? "Pilot ended. Members keep the Membership they were given." : "Pilot cancelled." };
}
