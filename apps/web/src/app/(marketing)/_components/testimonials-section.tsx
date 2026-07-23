import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Section, SectionHeading } from "./section";

/**
 * Consented, doctor-reviewed-free patient quotes — never invented, never
 * scraped (see patient_testimonials RLS: patients submit with explicit
 * consent, an admin publishes). Renders nothing until at least one quote is
 * published, same "dormant until real" pattern as the home-visit/logistics
 * partner rows — no placeholder or invented quotes ever stand in.
 */
export async function TestimonialsSection() {
  const supabase = createServiceRoleClient();
  const { data: testimonials } = await supabase
    .from("patient_testimonials")
    .select("id, display_name, quote")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(6);

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
