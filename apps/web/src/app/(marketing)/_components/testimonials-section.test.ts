/**
 * Regression test for the condition-tag filter added alongside
 * supabase/migrations/20260924205640_patient_testimonials_condition_tag.sql.
 *
 * The risk this guards against: TestimonialsSection is shared between the
 * homepage (no `condition` prop, wants every published quote) and a
 * condition page like /hypertension or /diabetes (wants only quotes tagged
 * for that condition). Calling `.eq("condition", condition)` unconditionally
 * would silently break the homepage, since every existing (and any future
 * general) testimonial has `condition = null` and would no longer match. This
 * proves the filter is applied only when a `condition` prop is actually
 * passed, and that the section still degrades to `null` when nothing is
 * published for that filter.
 */

jest.mock("@/lib/marketing/anon-client", () => ({
  marketingAnonClient: jest.fn(),
}));

import { marketingAnonClient } from "@/lib/marketing/anon-client";
import { TestimonialsSection } from "./testimonials-section";

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

describe("TestimonialsSection condition filter", () => {
  const ROW: Row = { id: "t1", display_name: "Amina O.", quote: "A short published quote." };

  it("filters by condition when a condition prop is passed", async () => {
    const { from, eqCalls } = mockSupabase([ROW]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await TestimonialsSection({ condition: "hypertension" });

    expect(eqCalls).toEqual([
      ["status", "published"],
      ["condition", "hypertension"],
    ]);
    expect(el).not.toBeNull();
  });

  it("does not filter by condition when no condition prop is passed (homepage)", async () => {
    const { from, eqCalls } = mockSupabase([ROW]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await TestimonialsSection();

    expect(eqCalls).toEqual([["status", "published"]]);
    expect(el).not.toBeNull();
  });

  it("renders nothing when nothing is published for the requested condition", async () => {
    const { from } = mockSupabase([]);
    (marketingAnonClient as jest.Mock).mockReturnValue({ from });

    const el = await TestimonialsSection({ condition: "diabetes" });

    expect(el).toBeNull();
  });
});
