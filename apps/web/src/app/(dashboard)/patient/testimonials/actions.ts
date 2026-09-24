"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TESTIMONIAL_CONDITIONS } from "@/lib/testimonials/conditions";

export type SubmitTestimonialState = { error?: string; message?: string } | undefined;

const CONDITION_VALUES = TESTIMONIAL_CONDITIONS.map((c) => c.value) as [string, ...string[]];

const schema = z.object({
  display_name: z.string().trim().min(1, "Enter a display name").max(80),
  quote: z.string().trim().min(20, "A few more words help: at least 20 characters").max(500),
  // .nullable() because FormData.get() returns null (not undefined) for a
  // key that's missing entirely — .optional() alone doesn't accept that.
  condition: z
    .union([z.enum(CONDITION_VALUES), z.literal("")])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Consented testimonial submission — the RLS insert policy on
 * patient_testimonials already requires consent_to_publish=true and
 * status='submitted' from the caller's own patient_id, so this is a thin
 * validated pass-through, not a privileged write. An admin reviews and
 * publishes separately (never auto-published).
 */
export async function submitTestimonial(
  _prevState: SubmitTestimonialState,
  formData: FormData,
): Promise<SubmitTestimonialState> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };
  if (!profile.organisation_id) return { error: "This account has no organisation on file" };

  const parsed = schema.safeParse({
    display_name: formData.get("display_name"),
    quote: formData.get("quote"),
    condition: formData.get("condition"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("patient_testimonials").insert({
    organisation_id: profile.organisation_id,
    patient_id: profile.id,
    display_name: parsed.data.display_name,
    quote: parsed.data.quote,
    condition: parsed.data.condition,
    consent_to_publish: true,
    status: "submitted",
  });
  if (error) return { error: error.message };

  return { message: "Thank you. Our team will review it before it's shared." };
}
