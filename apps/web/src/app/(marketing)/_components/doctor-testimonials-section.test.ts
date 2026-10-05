/**
 * Companion to testimonials-section.test.ts, for the doctor-side table added
 * alongside supabase/migrations/20260924210347_doctor_testimonials.sql.
 * Proves the same condition-filter risk (an unconditional `.eq("condition",
 * condition)` would break the homepage, which passes no condition), plus the
 * attribution rule from the 2026-09-24 founder decision: a published row's
 * bare `display_name` (e.g. "Dr. Adaeze") is never shown as-is — this
 * component always appends the fixed "· TarragonHealth care team" suffix at
 * render time, so a testimonial can never accidentally read like a
 * standalone named-doctor credential.
 */

jest.mock("@/lib/marketing/anon-client", () => ({
  marketingAnonClient: jest.fn(),
}));

import { marketingAnonClient } from "@/lib/marketing/anon-client";
import { DoctorTestimonialsSection } from "./doctor-testimonials-section";

type Row = { id: string; display_name: string; quote: string };

function mockSupabase(rows: Row[]) {
  const eqCalls: [string, unknown][] = [];
  const builder: {
    eq: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
  } = {
    eq: jest.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => Promise.resolve({ data: rows })),
  };
  const from = jest.fn(() => ({ select: jest.fn(() => builder) }));
  return { from, eqCalls };
}

// Reaches into the rendered element tree far enough to read the items array
// TestimonialsCarousel was given, without needing a full DOM render.
function itemsPassedToCarousel(el: unknown): { display_name: string }[] {
  const section = el as { props: { children: unknown[] } };
  const carousel = section.props.children[1] as { props: { items: { display_name: string }[] } };
  return carousel.props.items;
}

describe("DoctorTestimonialsSection", () => {
  const ROW: Row = { id: "d1", display_name: "Dr. Adaeze", quote: "A short published quote." };

  it("filters by condition when a condition prop is passed", async () => {
    const { from, eqCalls } = mockSupabase([ROW]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await DoctorTestimonialsSection({ condition: "hypertension" });

    expect(eqCalls).toEqual([
      ["status", "published"],
      ["condition", "hypertension"],
    ]);
    expect(el).not.toBeNull();
  });

  it("does not filter by condition when no condition prop is passed (homepage)", async () => {
    const { from, eqCalls } = mockSupabase([ROW]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    await DoctorTestimonialsSection();

    expect(eqCalls).toEqual([["status", "published"]]);
  });

  it("renders nothing when nothing is published for the requested condition", async () => {
    const { from } = mockSupabase([]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await DoctorTestimonialsSection({ condition: "diabetes" });

    expect(el).toBeNull();
  });

  it("always appends the generic role suffix, never the bare stored display_name", async () => {
    const { from } = mockSupabase([ROW]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await DoctorTestimonialsSection();

    const items = itemsPassedToCarousel(el);
    expect(items).toHaveLength(1);
    expect(items[0].display_name).toBe("Dr. Adaeze · TarragonHealth care team");
  });
});
