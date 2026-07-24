"use server";

import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const checkSchema = z.object({
  company: z.string().trim().min(2, "Enter your company or HMO name").max(120),
  phone: z
    .string()
    .trim()
    .min(7, "Enter the phone number your employer has for you")
    .max(20),
  contact: z.string().trim().max(200).optional(),
  source: z.enum(["corporate", "hmo"]),
});

export type EligibilityState =
  | { status: "covered"; orgName: string }
  | { status: "partner_no_match"; orgName: string }
  | { status: "no_partner" }
  | { status: "lead_saved" }
  | { error: string }
  | undefined;

/** Normalise Nigerian numbers to E.164 the same way the roster stores them. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  if (digits.startsWith("234")) return `+${digits}`;
  return `+234${digits}`;
}

/**
 * "Is my company covered?": the Omada/One Medical eligibility checker.
 * Same service-role carve-out as the contact form (the marketing site's only
 * other Supabase touchpoint): reads are minimal and privacy-shaped; the
 * caller must supply BOTH the organisation name (so we only ever echo back a
 * name they typed) AND their own phone number (exact roster match, never a
 * listing). A miss quietly becomes a lead so the B2B pipeline still learns
 * about demand.
 */
export async function checkEligibility(
  _prev: EligibilityState,
  formData: FormData
): Promise<EligibilityState> {
  const parsed = checkSchema.safeParse({
    company: formData.get("company"),
    phone: formData.get("phone"),
    contact: formData.get("contact") || undefined,
    source: formData.get("source"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "The checker is not available right now; contact us instead." };
  }

  const supabase = createServiceRoleClient();
  const orgType = parsed.data.source === "hmo" ? "hmo" : "corporate";

  const { data: org } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("type", orgType)
    .eq("is_active", true)
    .ilike("name", `%${parsed.data.company}%`)
    .limit(1)
    .maybeSingle();

  if (org) {
    const { data: member } = await supabase
      .from("employer_roster_members")
      .select("id")
      .eq("organisation_id", org.id)
      .eq("phone", normalizePhone(parsed.data.phone))
      .neq("status", "removed")
      .limit(1)
      .maybeSingle();
    if (member) {
      return { status: "covered", orgName: org.name };
    }
    return { status: "partner_no_match", orgName: org.name };
  }

  // No partner match: capture the demand as a lead (same table the contact
  // page writes; this is the marketing site's sanctioned write path).
  await supabase.from("leads").insert({
    name: parsed.data.company,
    contact: parsed.data.contact || normalizePhone(parsed.data.phone),
    role: parsed.data.source === "hmo" ? "hmo" : "employer",
    message: `Eligibility check: no partner match for "${parsed.data.company}"`,
    source: `eligibility_${parsed.data.source}`,
  });
  return { status: "no_partner" };
}
