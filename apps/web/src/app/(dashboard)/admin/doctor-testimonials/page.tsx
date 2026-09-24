import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { CreateDoctorTestimonialForm } from "./create-form";
import { DoctorTestimonialModerationButtons } from "./moderation-buttons";

export const metadata = { title: "Doctor testimonials" };

export default async function AdminDoctorTestimonialsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defence in depth.
  if (profile?.role !== "admin") redirect("/admin");
  if (!profile.organisation_id) redirect("/admin");

  const supabase = await createClient();
  const [{ data: testimonials, error: testimonialsError }, { data: staff, error: staffError }] =
    await Promise.all([
      supabase.from("doctor_testimonials").select("*").order("created_at", { ascending: false }),
      // Scoped to the admin's own org: private.is_org_staff() lets an
      // `admin` account see clinical_staff platform-wide, which would
      // otherwise let this picker offer a clinician from a different
      // organisation than the one this testimonial gets tagged with.
      supabase
        .from("clinical_staff")
        .select("id, full_name")
        .eq("organisation_id", profile.organisation_id)
        .eq("active", true)
        .order("full_name", { ascending: true }),
    ]);

  const submitted = (testimonials ?? []).filter((t) => t.status === "submitted");
  const reviewed = (testimonials ?? []).filter((t) => t.status !== "submitted");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor testimonials"
        description="There is no doctor-facing submission flow here, by design (founder decision, 2026-09-24): an admin adds a quote only after getting the doctor's consent off-platform, then publishes it separately below. Attribution stays first name + role only, never a surname, tier, specialty, or credential."
      />

      {staffError && (
        <LoadFailure>
          The clinician list could not be loaded, so a new testimonial cannot be added right now.
        </LoadFailure>
      )}
      {!staffError && <CreateDoctorTestimonialForm staff={staff ?? []} />}

      <Card>
        <CardHeader>
          <CardTitle>Awaiting review{testimonialsError ? "" : ` (${submitted.length})`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {testimonialsError && (
            <LoadFailure>
              The testimonial queue could not be loaded. This is not a report that nothing is
              waiting for review. Reload to try again.
            </LoadFailure>
          )}
          {!testimonialsError && submitted.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          {submitted.map((t) => (
            <div key={t.id} className="rounded-md border border-charcoal-ink/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-charcoal-ink">{t.display_name}</p>
                {t.condition && <Badge variant="grey">{t.condition}</Badge>}
              </div>
              <p className="mt-1 text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
              <p className="mt-1 text-xs text-charcoal-ink/60">
                Consent: {t.consent_reference}
              </p>
              <DoctorTestimonialModerationButtons
                id={t.id}
                displayName={t.display_name}
                quote={t.quote}
                consentReference={t.consent_reference}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!testimonialsError && reviewed.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing reviewed yet.</p>
          )}
          {reviewed.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-charcoal-ink/10 p-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{t.display_name}</p>
                <p className="mt-1 text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant={t.status === "published" ? "green" : "grey"}>{t.status}</Badge>
                {t.condition && <Badge variant="grey">{t.condition}</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
