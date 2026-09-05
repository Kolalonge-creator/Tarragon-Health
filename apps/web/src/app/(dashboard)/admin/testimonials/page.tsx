import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { TestimonialModerationButtons } from "./moderation-buttons";

export default async function AdminTestimonialsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defense in depth.
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data: testimonials, error: testimonialsError } = await supabase
    .from("patient_testimonials")
    .select("*")
    .order("created_at", { ascending: false });

  const submitted = (testimonials ?? []).filter((t) => t.status === "submitted");
  const reviewed = (testimonials ?? []).filter((t) => t.status !== "submitted");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Testimonials"
        description="Patient quotes awaiting review. Publishing puts the quote and its display name on the public marketing site, so a quote with no recorded consent to publish cannot be published from here."
      />

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
                {/* The fact that decides whether this may be published at all,
                    now on the row rather than only in the table. */}
                <Badge variant={t.consent_to_publish ? "green" : "red"}>
                  {t.consent_to_publish ? "Consented to publish" : "No consent to publish"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
              <TestimonialModerationButtons
                id={t.id}
                displayName={t.display_name}
                quote={t.quote}
                consentToPublish={t.consent_to_publish}
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
                {!t.consent_to_publish && <Badge variant="red">No consent on file</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
