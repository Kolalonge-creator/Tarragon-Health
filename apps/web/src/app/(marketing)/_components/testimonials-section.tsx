import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Section, SectionHeading } from "./section";

/**
 * Consented, doctor-reviewed-free patient quotes; never invented, never
 * scraped (see patient_testimonials RLS: patients submit with explicit
 * consent, an admin publishes). Renders nothing until at least one quote is
 * published, same "dormant until real" pattern as the home-visit/logistics
 * partner rows: no placeholder or invented quotes ever stand in.
 */
export async function TestimonialsSection() {
  // Never let a Supabase outage or a build-time-only environment (no service
  // role key available to the static export) break the marketing homepage;
  // same never-throw discipline as the ML client. Worst case: this section
  // just doesn't render, same as when there are zero published quotes.
  let testimonials: { id: string; display_name: string; quote: string }[] | null = null;
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("patient_testimonials")
      .select("id, display_name, quote")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(6);
    testimonials = data;
  } catch {
    testimonials = null;
  }

  if (!testimonials || testimonials.length === 0) return null;

  return (
    <Section variant="sage">
      <SectionHeading eyebrow="In their words" title="What patients say" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t) => (
          <figure key={t.id} className="rounded-xl bg-warm-ivory p-6 shadow-sm">
            <blockquote className="text-sm text-charcoal-ink/80">&ldquo;{t.quote}&rdquo;</blockquote>
            <figcaption className="mt-4 text-sm font-medium text-charcoal-ink">
              {t.display_name}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
