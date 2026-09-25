import { marketingAnonClient } from "@/lib/marketing/anon-client";
import { Section, SectionHeading } from "./section";
import { TestimonialsCarousel } from "./testimonials-carousel";

/**
 * Doctor-side counterpart to TestimonialsSection (./testimonials-section.tsx)
 * — reads doctor_testimonials instead of patient_testimonials. Same
 * "dormant until real" discipline: renders nothing until an admin has
 * published a real, off-platform-consented quote (see
 * supabase/migrations/20260924210347_doctor_testimonials.sql and
 * apps/web/src/app/(dashboard)/admin/doctor-testimonials/).
 *
 * Attribution is first name + a fixed generic role suffix only (founder
 * decision, 2026-09-24) — never a surname, tier, specialty, or credential —
 * so the suffix is appended here at render time rather than stored per row,
 * keeping it one place to change rather than baked into every quote.
 */
export async function DoctorTestimonialsSection({ condition }: { condition?: string } = {}) {
  let testimonials: { id: string; display_name: string; quote: string }[] | null = null;
  try {
    const supabase = marketingAnonClient();
    if (supabase) {
      let query = supabase
        .from("doctor_testimonials")
        .select("id, display_name, quote")
        .eq("status", "published");
      query = condition ? query.eq("condition", condition) : query;
      const { data } = await query.order("created_at", { ascending: false }).limit(6);
      testimonials = data?.map((row) => ({
        ...row,
        display_name: `${row.display_name} · TarragonHealth care team`,
      })) ?? null;
    }
  } catch {
    testimonials = null;
  }

  if (!testimonials || testimonials.length === 0) return null;

  return (
    <Section variant="sage">
      <SectionHeading eyebrow="From our care team" title="What our doctors say" />
      <TestimonialsCarousel items={testimonials} />
    </Section>
  );
}
