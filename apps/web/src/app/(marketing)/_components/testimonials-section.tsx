import { marketingAnonClient } from "@/lib/marketing/anon-client";
import { Section, SectionHeading } from "./section";
import { TestimonialsCarousel } from "./testimonials-carousel";

/**
 * Consented, doctor-reviewed-free patient quotes; never invented, never
 * scraped (see patient_testimonials RLS: patients submit with explicit
 * consent, an admin publishes). Renders nothing until at least one quote is
 * published, same "dormant until real" pattern as the home-visit/logistics
 * partner rows: no placeholder or invented quotes ever stand in.
 *
 * Reads through the shared marketing ANON client, not the service role. It
 * used to open a service-role client on the homepage render path, which both
 * broke the marketing-boundary rule in docs/MARKETING_SITE_SPEC.md §4 and
 * bought nothing: `patient_testimonials_public_read` already grants anon
 * SELECT on exactly `status = 'published'`, which is the only filter this
 * query wants, and anon holds the table-level SELECT grant (verified live).
 * The service-role key is also absent at build time, so the old client threw
 * on every prerender and this section rendered for nobody.
 *
 * Every other public marketing loader (lib/marketing/*) reads the same way.
 */
export async function TestimonialsSection() {
  // Never let a Supabase outage break the marketing homepage; same
  // never-throw discipline as the ML client. Worst case: this section just
  // doesn't render, same as when there are zero published quotes.
  let testimonials: { id: string; display_name: string; quote: string }[] | null = null;
  try {
    const supabase = marketingAnonClient();
    if (supabase) {
      const { data } = await supabase
        .from("patient_testimonials")
        .select("id, display_name, quote")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(6);
      testimonials = data;
    }
  } catch {
    testimonials = null;
  }

  if (!testimonials || testimonials.length === 0) return null;

  return (
    <Section variant="sage">
      <SectionHeading eyebrow="In their words" title="What patients say" />
      <TestimonialsCarousel items={testimonials} />
    </Section>
  );
}
