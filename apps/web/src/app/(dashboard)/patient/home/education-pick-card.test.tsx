/** @jest-environment jsdom */
/** P20: the Home learning pick names the reviewer only from the record, and claims no review when there is no reviewer. */
import { render } from "@testing-library/react";

let feed: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => ({ data: feed, error: null }) }),
}));

import { EducationPickCard } from "./education-pick-card";

const ITEM = { content_code: "x", code: "bp-basics", title: "Blood pressure basics", summary: "What the numbers mean", estimated_minutes: 4, status: null };

async function renderIt() {
  const el = await EducationPickCard({ acting: false });
  return render(<>{el}</>);
}

describe("EducationPickCard reviewer line", () => {
  it("names the reviewer from the record", async () => {
    feed = [{ ...ITEM, clinician_reviewed: true, reviewed_by_name: "Dr Amaka Obi" }];
    const { container } = await renderIt();
    expect(container.textContent).toContain("Reviewed by Dr Amaka Obi");
  });

  it("says nothing about review when no reviewer is recorded, even if the item is flagged reviewed", async () => {
    feed = [{ ...ITEM, clinician_reviewed: true, reviewed_by_name: null }];
    const { container } = await renderIt();
    expect(container.textContent).toContain("Blood pressure basics");
    expect(container.textContent).not.toMatch(/Reviewed/);
  });
});
