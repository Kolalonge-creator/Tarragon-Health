"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { TESTIMONIAL_CONDITIONS } from "@/lib/testimonials/conditions";

export type DoctorTestimonialActionState = { error?: string; message?: string } | undefined;

const CONDITION_VALUES = TESTIMONIAL_CONDITIONS.map((c) => c.value) as [string, ...string[]];

const createSchema = z.object({
  clinical_staff_id: z.string().uuid("Choose a clinician"),
  display_name: z
    .string()
    .trim()
    .min(1, "Enter how this doctor should be credited")
    .max(40, "Keep this to a first name + role, not a full credential"),
  quote: z.string().trim().min(20, "A few more words help: at least 20 characters").max(500),
  // .nullable() because FormData.get() returns null (not undefined) for a
  // key that's missing entirely — .optional() alone doesn't accept that.
  condition: z
    .union([z.enum(CONDITION_VALUES), z.literal("")])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  consent_reference: z
    .string()
    .trim()
    .min(1, "Say where the off-platform consent for this quote/name is recorded"),
});

/**
 * There is no self-submit path for a doctor testimonial (founder decision,
 * 2026-09-24 — see supabase/migrations/20260924210347_doctor_testimonials.sql):
 * an admin creates the row, having already obtained consent to publish an
 * employee's name/quote OFF-platform (a signed release, an email, a
 * documented verbal OK), and records where that consent lives in
 * consent_reference. The RLS insert policy independently enforces
 * admin-only + status='submitted', so this is a validated pass-through, not
 * the only thing standing between a stray request and the table.
 */
export async function createDoctorTestimonial(
  _prevState: DoctorTestimonialActionState,
  formData: FormData,
): Promise<DoctorTestimonialActionState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { error: "Admin access required" };
  if (!profile.organisation_id) return { error: "This account has no organisation on file" };

  const parsed = createSchema.safeParse({
    clinical_staff_id: formData.get("clinical_staff_id"),
    display_name: formData.get("display_name"),
    quote: formData.get("quote"),
    condition: formData.get("condition"),
    consent_reference: formData.get("consent_reference"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // The clinician picker (apps/web/src/app/(dashboard)/admin/doctor-testimonials/page.tsx)
  // is scoped to the admin's own organisation, but `private.is_org_staff`
  // lets an admin see (and therefore could still POST) a clinical_staff_id
  // from another org — check it explicitly here for a clear error message;
  // `private.enforce_doctor_testimonial_org_match` on the table is the real,
  // unbypassable enforcement (see supabase/migrations/20260924211500_doctor_testimonials_org_match_and_condition_check.sql).
  const { data: staffOrg, error: staffLookupError } = await supabase
    .from("clinical_staff")
    .select("organisation_id")
    .eq("id", parsed.data.clinical_staff_id)
    .maybeSingle();
  if (staffLookupError) return { error: staffLookupError.message };
  if (!staffOrg || staffOrg.organisation_id !== profile.organisation_id) {
    return { error: "That clinician does not belong to your organisation." };
  }

  const { error } = await supabase.from("doctor_testimonials").insert({
    organisation_id: profile.organisation_id,
    clinical_staff_id: parsed.data.clinical_staff_id,
    display_name: parsed.data.display_name,
    quote: parsed.data.quote,
    condition: parsed.data.condition,
    consent_reference: parsed.data.consent_reference,
    created_by: profile.id,
    status: "submitted",
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/doctor-testimonials");
  return { message: "Saved as a draft. Publish it separately once you've checked it over." };
}

/**
 * Publish/decline is gated purely by doctor_testimonials_update's RLS
 * (private.is_admin()) plus the stamp_doctor_testimonial_review trigger,
 * which server-derives reviewed_by/reviewed_at — mirrors moderateTestimonial
 * in apps/web/src/app/(dashboard)/admin/testimonials/actions.ts. There is no
 * consent_to_publish column to gate on here (consent lives off-platform,
 * recorded in consent_reference, which the DB already refuses to leave
 * blank at creation time), so publish has no additional server-side check
 * beyond the admin role RLS already enforces.
 */
export async function moderateDoctorTestimonial(
  _prevState: DoctorTestimonialActionState,
  formData: FormData,
): Promise<DoctorTestimonialActionState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { error: "Admin access required" };

  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || (status !== "published" && status !== "declined")) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("doctor_testimonials").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/doctor-testimonials");
  return undefined;
}
