"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { leadSchema } from "@/lib/validation/lead";
import { pickFormValues } from "@/lib/forms/pick-form-values";
import { fdRpcData } from "@/lib/frontdesk/raw-db";
import { ENQUIRY_CONSENT_VERSION, ENQUIRY_CONSENT_WORDING, parseLeadContact } from "@/lib/frontdesk/lead-consent";

const LEAD_VALUE_FIELDS = ["name", "contact", "role", "goal", "message"] as const;

/**
 * What the visitor had already typed when a submission failed. Same bug
 * class as the signup/patient-location/guest-checkout forms: React resets
 * every uncontrolled field in an action-bound <form> once the action
 * returns, success or failure, so without this a Zod rejection on one field
 * (or a transient DB insert failure) silently wiped the whole marketing
 * contact form and forced a full re-type.
 */
export type LeadSubmittedValues = Partial<Record<(typeof LEAD_VALUE_FIELDS)[number], string>>;

function submittedValues(formData: FormData): LeadSubmittedValues {
  return pickFormValues(formData, LEAD_VALUE_FIELDS);
}

export type ContactActionState =
  | { error?: string; success?: boolean; values?: LeadSubmittedValues }
  | undefined;

export async function submitLead(
  _prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    contact: formData.get("contact"),
    role: formData.get("role"),
    goal: formData.get("goal") || undefined,
    message: formData.get("message") || undefined,
    source: formData.get("source") || "homepage",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      values: submittedValues(formData),
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error: "Lead capture is not configured yet. Please email us directly.",
      values: submittedValues(formData),
    };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("leads").insert({
    name: parsed.data.name,
    contact: parsed.data.contact,
    role: parsed.data.role,
    goal: parsed.data.goal ?? null,
    message: parsed.data.message ?? null,
    source: parsed.data.source,
  });

  if (error) {
    return {
      error: "We could not save your message. Please try again shortly.",
      values: submittedValues(formData),
    };
  }

  // Front Desk F4. Only with the explicit, separate consent tick: the enquiry above is stored and answered by a person either way, but it
  // joins the CRM and the follow-up emails only if the visitor agreed to exactly the wording shown beside the box. Best effort: the lead is
  // already saved, so a failure here is logged and never shown to the visitor as a failed submission.
  if (formData.get("consent") === "on") {
    try {
      const details = parseLeadContact(parsed.data.contact);
      const captured = await fdRpcData(supabase, "service_fd_capture_lead", {
        p_email: details.email,
        p_phone: details.phone,
        p_name: parsed.data.name,
        p_source: "website_form",
        p_message: parsed.data.message ?? null,
        p_consent: true,
        p_wording: ENQUIRY_CONSENT_WORDING,
        p_wording_version: ENQUIRY_CONSENT_VERSION,
      });
      if (captured.error) console.error("front desk: could not capture the enquiry", captured.error);
    } catch (e) {
      console.error("front desk: could not capture the enquiry", e);
    }
  }

  return { success: true };
}
