/**
 * P18 (spec 5.2): every timeline event type belongs to exactly one filter, every filter has at least one type, and no
 * filter means no type restriction.
 */
import { Constants } from "@tarragon/shared";
import { TIMELINE_FILTERS, TIMELINE_FILTER_OF, eventTypesFor } from "./timeline-filters";

describe("timeline filters", () => {
  it("covers every live event type exactly once", () => {
    const live = [...Constants.public.Enums.timeline_event_type].sort();
    expect(Object.keys(TIMELINE_FILTER_OF).sort()).toEqual(live);
    const covered = TIMELINE_FILTERS.flatMap((f) => eventTypesFor(f.id) ?? []).sort();
    expect(covered).toEqual(live);
  });

  it("gives every filter at least one type", () => {
    for (const f of TIMELINE_FILTERS) expect(eventTypesFor(f.id)!.length).toBeGreaterThan(0);
  });

  it("puts results under results and medicines under medicines", () => {
    expect(eventTypesFor("results")).toEqual(expect.arrayContaining(["lab_abnormal", "lab_completed", "document_uploaded"]));
    expect(eventTypesFor("medicines")).toEqual(expect.arrayContaining(["medication_missed", "prescription_signed"]));
  });

  it("restricts nothing when no filter is chosen", () => {
    expect(eventTypesFor(null)).toBeNull();
  });
});
