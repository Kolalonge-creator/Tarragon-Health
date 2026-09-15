import { supabase } from "./supabase";

/**
 * Native equivalent of components/testimonial-form.tsx +
 * app/(dashboard)/patient/testimonials/actions.ts's submitTestimonial. The
 * RLS insert policy on patient_testimonials already requires
 * consent_to_publish=true and status='submitted' from the caller's own
 * patient_id, so this is a thin validated pass-through, not a privileged
 * write -- same as web. An admin reviews and publishes separately.
 */
export async function submitTestimonial(
  displayName: string,
  quote: string
): Promise<{ error?: string; message?: string }> {
  const trimmedName = displayName.trim();
  const trimmedQuote = quote.trim();
  if (!trimmedName) return { error: "Enter a display name" };
  if (trimmedQuote.length < 20) return { error: "A few more words help: at least 20 characters" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "This account has no organisation on file" };

  const { error } = await supabase.from("patient_testimonials").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    display_name: trimmedName,
    quote: trimmedQuote,
    consent_to_publish: true,
    status: "submitted",
  });
  if (error) return { error: error.message };

  return { message: "Thank you. Our team will review it before it's shared." };
}
