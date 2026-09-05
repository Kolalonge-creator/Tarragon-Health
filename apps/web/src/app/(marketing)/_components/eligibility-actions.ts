"use server";

import { z } from "zod";
import { checkAuthRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isSpecificEnough, toSearchTerm } from "./eligibility-search-term";

const checkSchema = z.object({
  company: z.string().trim().min(4, "Enter your company or HMO name").max(120),
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
 * caller must supply BOTH the organisation name AND their own phone number
 * (exact roster match, never a listing). A miss quietly becomes a lead so the
 * B2B pipeline still learns about demand.
 *
 * Unauthenticated and service-role, so it is deliberately paranoid about
 * three things:
 *   - the company name is a search TERM, never a pattern (see toSearchTerm);
 *   - the response echoes back what the CALLER typed, never the matched
 *     organisation's own name, so the checker can't be used to read a partner
 *     name out of the database;
 *   - it is rate limited per IP and per phone number, because the
 *     (organisation, phone) branch is otherwise an unthrottled membership
 *     oracle over employer_roster_members.
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

  const searchTerm = toSearchTerm(parsed.data.company);
  if (!isSpecificEnough(searchTerm)) {
    return { error: "Enter your company or HMO name as it appears on your payslip or HMO card." };
  }

  const phone = normalizePhone(parsed.data.phone);

  const limit = await checkAuthRateLimit(
    "eligibility_check",
    phone,
    { limit: 10, windowSeconds: 600 },
    { limit: 5, windowSeconds: 3600 }
  );
  if (!limit.success) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "The checker is not available right now; contact us instead." };
  }

  const supabase = createServiceRoleClient();
  const orgType = parsed.data.source === "hmo" ? "hmo" : "corporate";

  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("type", orgType)
    .eq("is_active", true)
    .ilike("name", `%${searchTerm}%`)
    .limit(1)
    .maybeSingle();

  if (org) {
    const { data: member } = await supabase
      .from("employer_roster_members")
      .select("id")
      .eq("organisation_id", org.id)
      .eq("phone", phone)
      .neq("status", "removed")
      .limit(1)
      .maybeSingle();
    // orgName is what the CALLER typed, deliberately — never org.name. The
    // matched organisation's real name is not the caller's to learn from an
    // unauthenticated form.
    if (member) {
      return { status: "covered", orgName: parsed.data.company };
    }
    return { status: "partner_no_match", orgName: parsed.data.company };
  }

  // No partner match: capture the demand as a lead (same table the contact
  // page writes; this is the marketing site's sanctioned write path).
  await supabase.from("leads").insert({
    name: parsed.data.company,
    contact: parsed.data.contact || phone,
    role: parsed.data.source === "hmo" ? "hmo" : "employer",
    message: `Eligibility check: no partner match for "${parsed.data.company}"`,
    source: `eligibility_${parsed.data.source}`,
  });
  return { status: "no_partner" };
}
