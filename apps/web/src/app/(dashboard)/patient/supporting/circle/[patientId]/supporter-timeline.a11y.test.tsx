/** @jest-environment jsdom */
/** Care Circle P4: the family timeline in plain words, newest first, with a source on each line, and calm empty and error states. */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { parseTimeline } from "@/lib/care-circle/model";
import { SupporterTimeline, timelineLine } from "./supporter-timeline";

let timeline: { isPending: boolean; isError: boolean; isSuccess: boolean; data: unknown };
jest.mock("@/lib/queries/care-circle", () => {
  const actual = jest.requireActual("@/lib/queries/care-circle");
  return { ...actual, useSupporterTimeline: () => timeline };
});

const EVENTS = parseTimeline([
  { at: "2026-11-03T10:00:00Z", kind: "test_reviewed", code: "hba1c", source: "clinician" },
  { at: "2026-11-02T10:00:00Z", kind: "help_done", code: "visit", source: "patient" },
  { at: "2026-11-01T10:00:00Z", kind: "appointment_missed", source: "system" },
  { at: "2026-10-30T10:00:00Z", kind: "not_a_kind", source: "system" },
]);

describe("SupporterTimeline", () => {
  it("drops an unknown event kind rather than showing it", () => {
    expect(EVENTS).toHaveLength(3);
  });

  it("reads each event in plain words with its source", async () => {
    timeline = { isPending: false, isError: false, isSuccess: true, data: EVENTS };
    render(<SupporterTimeline patientId="p" name="Mama" locale="en" />);
    expect(screen.getByText("Average blood sugar (HbA1c) was reviewed by a doctor")).toBeTruthy();
    expect(screen.getByText("Missed an appointment")).toBeTruthy();
    expect(screen.getByText(/From the care team/)).toBeTruthy();
    expect(screen.getByText(/From Mama/)).toBeTruthy();
    expect(timelineLine(EVENTS[1]!, "en")).toMatch(/^Help given: /);
    await expectNoA11yViolations(<SupporterTimeline patientId="p" name="Mama" locale="en" />);
  });

  it("says so when there is nothing, and when the read failed", () => {
    timeline = { isPending: false, isError: false, isSuccess: true, data: [] };
    const { unmount } = render(<SupporterTimeline patientId="p" name="Mama" locale="en" />);
    expect(screen.getByText("Nothing to show from the last 90 days.")).toBeTruthy();
    unmount();
    timeline = { isPending: false, isError: true, isSuccess: false, data: undefined };
    render(<SupporterTimeline patientId="p" name="Mama" locale="en" />);
    expect(screen.getByText("We could not load this just now.")).toBeTruthy();
  });
});
