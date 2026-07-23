import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TestimonialModerationButtons } from "./moderation-buttons";

export default async function AdminTestimonialsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defense in depth.
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const { data: testimonials } = await supabase
    .from("patient_testimonials")
    .select("*")
    .order("created_at", { ascending: false });

  const submitted = (testimonials ?? []).filter((t) => t.status === "submitted");
  const reviewed = (testimonials ?? []).filter((t) => t.status !== "submitted");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Testimonials</h1>
        <p className="text-sm text-charcoal-ink/60">
          Consented patient quotes — publishing makes a quote visible on the marketing site.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting review ({submitted.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {submitted.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          {submitted.map((t) => (
            <div key={t.id} className="rounded-md border border-charcoal-ink/10 p-3">
              <p className="text-sm font-medium text-charcoal-ink">{t.display_name}</p>
              <p className="mt-1 text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
              <TestimonialModerationButtons id={t.id} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviewed.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing reviewed yet.</p>
          )}
          {reviewed.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-charcoal-ink/10 p-3">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{t.display_name}</p>
                <p className="mt-1 text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</p>
              </div>
              <Badge variant={t.status === "published" ? "green" : "grey"}>{t.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
