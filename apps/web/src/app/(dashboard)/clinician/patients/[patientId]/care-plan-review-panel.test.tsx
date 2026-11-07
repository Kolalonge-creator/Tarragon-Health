/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";

const publishMutate = jest.fn();
const datesMutate = jest.fn();
let revisionsResult: { data: unknown; isError: boolean } = { data: [], isError: false };
jest.mock("@/lib/queries/care-plan-revisions", () => ({
  usePublishCarePlanRevision: () => ({ mutate: publishMutate, isPending: false }),
  useUpdateCarePlanReviewDates: () => ({ mutate: datesMutate, isPending: false }),
  useCarePlanRevisionsForPlan: () => revisionsResult,
}));

import { actionDetailLine, CarePlanReviewPanel, parseChangeNote, parseReviewDates, toDateInput } from "./care-plan-review-panel";
import type { Tables } from "@tarragon/shared";

const PLAN = {
  id: "plan-1",
  patient_id: "pat-1",
  organisation_id: "org",
  condition: "hypertension",
  status: "active",
  last_reviewed_at: "2026-11-01T11:00:00Z",
  next_review_at: "2027-02-01",
} as unknown as Tables<"care_plans">;

beforeEach(() => {
  publishMutate.mockReset();
  datesMutate.mockReset();
  revisionsResult = { data: [], isError: false };
});

describe("pure helpers", () => {
  it("actionDetailLine joins category and why/when/how, or returns null", () => {
    expect(actionDetailLine({ category: "monitoring", why_text: "W", when_text: "AM", how_text: null })).toBe(
      "Checks you do at home · Why: W · When: AM",
    );
    expect(actionDetailLine({ category: null, why_text: null, when_text: null, how_text: null })).toBeNull();
  });

  it("parseReviewDates accepts blanks and ordered dates, refuses bad or reversed ones", () => {
    expect(parseReviewDates({ lastReviewed: "", nextReview: "" })).toEqual({ ok: true, lastReviewedAt: null, nextReviewAt: null });
    expect(parseReviewDates({ lastReviewed: "2026-11-07", nextReview: "2027-02-07" })).toEqual({
      ok: true,
      lastReviewedAt: "2026-11-07T12:00:00+01:00",
      nextReviewAt: "2027-02-07",
    });
    expect(parseReviewDates({ lastReviewed: "07/11/2026", nextReview: "" }).ok).toBe(false);
    expect(parseReviewDates({ lastReviewed: "2026-11-07", nextReview: "2026-11-01" }).ok).toBe(false);
  });

  it("parseChangeNote trims and enforces 5 to 600 characters", () => {
    expect(parseChangeNote("  We added a check.  ")).toEqual({ ok: true, summary: "We added a check." });
    expect(parseChangeNote("hi").ok).toBe(false);
    expect(parseChangeNote("x".repeat(601)).ok).toBe(false);
  });

  it("toDateInput gives the Lagos calendar day", () => {
    expect(toDateInput("2026-11-06T23:30:00Z")).toBe("2026-11-07");
    expect(toDateInput("2027-02-01")).toBe("2027-02-01");
    expect(toDateInput(null)).toBe("");
  });
});

describe("CarePlanReviewPanel", () => {
  it("prefills the dates and saves them", () => {
    render(<CarePlanReviewPanel plan={PLAN} />);
    expect((screen.getByLabelText("Last reviewed") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("Next review") as HTMLInputElement).value).toBe("2027-02-01");
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(datesMutate).toHaveBeenCalledWith(
      { carePlanId: "plan-1", lastReviewedAt: "2026-11-01T12:00:00+01:00", nextReviewAt: "2027-02-01" },
      expect.anything(),
    );
  });

  it("publishes a change with the acknowledgement tick", () => {
    render(<CarePlanReviewPanel plan={PLAN} />);
    fireEvent.change(screen.getByPlaceholderText(/What changed/), { target: { value: "We added a morning check." } });
    fireEvent.click(screen.getByLabelText("Patient must acknowledge this change"));
    fireEvent.click(screen.getByRole("button", { name: "Save plan change" }));
    expect(publishMutate).toHaveBeenCalledWith(
      { carePlanId: "plan-1", changeSummary: "We added a morning check.", needsAcknowledgement: true },
      expect.anything(),
    );
  });

  it("refuses a too-short note without calling the database", () => {
    render(<CarePlanReviewPanel plan={PLAN} />);
    fireEvent.change(screen.getByPlaceholderText(/What changed/), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan change" }));
    expect(publishMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/5 to 600 characters/)).toBeTruthy();
  });

  it("shows each saved change with whether the patient acknowledged it", () => {
    revisionsResult = {
      data: [
        { id: "a", version_number: 2, published_at: "2026-11-05T10:00:00Z", change_summary: "Two", needs_acknowledgement: true, acknowledged_at: null },
        { id: "b", version_number: 1, published_at: "2026-11-01T10:00:00Z", change_summary: "One", needs_acknowledgement: true, acknowledged_at: "2026-11-02T10:00:00Z" },
      ],
      isError: false,
    };
    render(<CarePlanReviewPanel plan={PLAN} />);
    expect(screen.getByText("Waiting for the patient")).toBeTruthy();
    expect(screen.getByText(/Acknowledged 2 Nov 2026/)).toBeTruthy();
  });

  it("says so when the saved changes cannot be read", () => {
    revisionsResult = { data: undefined, isError: true };
    render(<CarePlanReviewPanel plan={PLAN} />);
    expect(screen.getByText("Could not load the saved plan changes.")).toBeTruthy();
  });
});
