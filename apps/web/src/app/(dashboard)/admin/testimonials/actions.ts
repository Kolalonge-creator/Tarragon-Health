"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type TestimonialModerationState = { error?: string } | undefined;

/**
 * Publish/decline is gated purely by patient_testimonials_update's RLS
 * (private.is_admin()) plus the stamp_testimonial_review trigger, which
 * server-derives reviewed_by/reviewed_at — this action just needs to be an
 * admin session and pass the intended status through.
 */
export async function moderateTestimonial(
  _prevState: TestimonialModerationState,
  formData: FormData,
): Promise<TestimonialModerationState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { error: "Admin access required" };

  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || (status !== "published" && status !== "declined")) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();

  // Consent is what makes publishing a patient's words lawful, so it is
  // checked here rather than only being greyed out in the UI. Declining a
  // quote publishes nothing and needs no such check.
  if (status === "published") {
    const { data: testimonial, error: readError } = await supabase
      .from("patient_testimonials")
      .select("consent_to_publish")
      .eq("id", id)
      .single();
    if (readError) return { error: readError.message };
    if (!testimonial?.consent_to_publish) {
      return {
        error:
          "This patient has not consented to publication, so this quote cannot go on the public site.",
      };
    }
  }

  const { error } = await supabase.from("patient_testimonials").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/testimonials");
  return undefined;
}
