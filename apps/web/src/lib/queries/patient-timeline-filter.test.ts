/**
 * P18: the timeline filter is applied in the query (so "Load more" pages through the filtered list), and the unfiltered
 * query is unchanged. Month headings use the Lagos date, whatever the viewer's timezone.
 */
const calls: { method: string; args: unknown[] }[] = [];
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { loadPatientTimeline } from "./patient-timeline";
import { groupEventsByMonth } from "@/components/patient-timeline";

function fakeSupabase() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) b[m] = (...args: unknown[]) => (calls.push({ method: m, args }), b);
  b.range = async (...args: unknown[]) => (calls.push({ method: "range", args }), { data: [], error: null });
  return { from: () => b } as never;
}

beforeEach(() => (calls.length = 0));

describe("loadPatientTimeline", () => {
  it("restricts the query to the chosen event types", async () => {
    await loadPatientTimeline(fakeSupabase(), "p1", 10, 0, ["lab_completed", "lab_abnormal"]);
    expect(calls).toContainEqual({ method: "in", args: ["event_type", ["lab_completed", "lab_abnormal"]] });
    expect(calls).toContainEqual({ method: "range", args: [0, 9] });
  });

  it("adds no type restriction when no filter is chosen", async () => {
    await loadPatientTimeline(fakeSupabase(), "p1", 10, 0);
    expect(calls.some((c) => c.method === "in")).toBe(false);
  });
});

describe("groupEventsByMonth", () => {
  it("files an event by its Lagos month", () => {
    // 23:30 UTC on 31 October is 00:30 on 1 November in Lagos.
    const groups = groupEventsByMonth([{ id: "e1", occurred_at: "2026-10-31T23:30:00Z" } as never]);
    expect(groups.map((g) => g.label)).toEqual(["November 2026"]);
  });
});
