/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const acknowledge = jest.fn();
jest.mock("@/app/(dashboard)/patient/care-plan-acknowledge-action", () => ({
  acknowledgeCarePlanChange: (...a: unknown[]) => acknowledge(...a),
}));

import {
  CarePlanActionsByCategory,
  CarePlanChangeNotice,
  CarePlanEarlierVersions,
  CarePlanReviewDates,
} from "./care-plan-review-details";
import { CARE_PLAN_COPY } from "@/lib/care-plan/patient-copy";
import type { CarePlanRevision } from "@/lib/care-plan/plan-view";

function revision(over: Partial<CarePlanRevision>): CarePlanRevision {
  return {
    id: "r1",
    organisation_id: "o",
    patient_id: "p",
    care_plan_id: "c",
    version_number: 1,
    change_summary: "We added a morning blood pressure check.",
    needs_acknowledgement: true,
    plan_snapshot: { condition: "hypertension", actions: [] },
    published_by: "d",
    published_at: "2026-11-05T10:00:00Z",
    acknowledged_at: null,
    acknowledged_by: null,
    ...over,
  };
}

beforeEach(() => acknowledge.mockReset());

describe("CarePlanChangeNotice", () => {
  it("lists unacknowledged changes and hides after Got it saves them all", async () => {
    acknowledge.mockResolvedValue({ ok: true });
    const onAck = jest.fn();
    render(
      <CarePlanChangeNotice
        revisions={[revision({}), revision({ id: "r2", change_summary: "We moved your review to March.", published_at: "2026-11-06T10:00:00Z" })]}
        onAcknowledged={onAck}
      />,
    );
    expect(screen.getByText(CARE_PLAN_COPY.changeNoticeTitle)).toBeTruthy();
    expect(screen.getByText("We added a morning blood pressure check.")).toBeTruthy();
    expect(screen.getByText("We moved your review to March.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: CARE_PLAN_COPY.gotIt }));
    await waitFor(() => expect(screen.queryByText(CARE_PLAN_COPY.changeNoticeTitle)).toBeNull());
    expect(acknowledge).toHaveBeenCalledWith({ revisionId: "r1" });
    expect(acknowledge).toHaveBeenCalledWith({ revisionId: "r2" });
    expect(onAck).toHaveBeenCalled();
  });

  it("stays and says so when saving fails", async () => {
    acknowledge.mockResolvedValue({ ok: false });
    render(<CarePlanChangeNotice revisions={[revision({})]} onAcknowledged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: CARE_PLAN_COPY.gotIt }));
    await waitFor(() => expect(screen.getByText(CARE_PLAN_COPY.ackFailed)).toBeTruthy());
    expect(screen.getByText(CARE_PLAN_COPY.changeNoticeTitle)).toBeTruthy();
  });

  it("renders nothing when every change is acknowledged or did not ask for it", () => {
    const { container } = render(
      <CarePlanChangeNotice
        revisions={[revision({ acknowledged_at: "2026-11-06T00:00:00Z", acknowledged_by: "p" }), revision({ id: "r2", needs_acknowledgement: false })]}
        onAcknowledged={jest.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers no Got it while a supporter is acting for the patient", () => {
    render(<CarePlanChangeNotice revisions={[revision({})]} actingForName="Ada Obi" onAcknowledged={jest.fn()} />);
    expect(screen.queryByRole("button", { name: CARE_PLAN_COPY.gotIt })).toBeNull();
    expect(screen.getByText(CARE_PLAN_COPY.ackOnlyPatient("Ada"))).toBeTruthy();
  });
});

describe("CarePlanReviewDates", () => {
  it("shows both dates, or plain words when unset", () => {
    const { rerender } = render(<CarePlanReviewDates lastReviewedAt="2026-11-01T09:00:00Z" nextReviewAt="2027-02-01" />);
    expect(screen.getByText("1 Nov 2026")).toBeTruthy();
    expect(screen.getByText("1 Feb 2027")).toBeTruthy();
    rerender(<CarePlanReviewDates lastReviewedAt={null} nextReviewAt={null} />);
    expect(screen.getByText(CARE_PLAN_COPY.notReviewedYet)).toBeTruthy();
    expect(screen.getByText(CARE_PLAN_COPY.noNextReview)).toBeTruthy();
  });
});

describe("CarePlanActionsByCategory", () => {
  it("groups actions under category headings with why/when/how", () => {
    render(
      <CarePlanActionsByCategory
        actions={[
          { description: "Check your blood pressure", frequency: null, category: "monitoring", why: "To see if the dose works", when: "Every morning", how: "Sit quietly first" },
          { description: "Loose action", frequency: null, category: null, why: null, when: null, how: null },
        ]}
      />,
    );
    expect(screen.getByText("Checks you do at home")).toBeTruthy();
    expect(screen.getByText(CARE_PLAN_COPY.otherActions)).toBeTruthy();
    expect(screen.getByText("To see if the dose works")).toBeTruthy();
    expect(screen.getByText("Every morning")).toBeTruthy();
    expect(screen.getByText("Sit quietly first")).toBeTruthy();
  });

  it("says plainly when there are no actions", () => {
    render(<CarePlanActionsByCategory actions={[]} />);
    expect(screen.getByText(CARE_PLAN_COPY.noActions)).toBeTruthy();
  });
});

describe("CarePlanEarlierVersions", () => {
  it("lists each version with what changed and its actions, newest first", () => {
    render(
      <CarePlanEarlierVersions
        revisions={[
          revision({ id: "a", version_number: 1, change_summary: "First plan written." }),
          revision({
            id: "b",
            version_number: 2,
            change_summary: "Added a daily walk.",
            plan_snapshot: { actions: [{ description: "Walk 20 minutes", category: "lifestyle" }] },
          }),
        ]}
      />,
    );
    const labels = screen.getAllByText(/^Version \d/).map((n) => n.textContent);
    expect(labels[0]).toMatch(/^Version 2/);
    expect(screen.getByText("Added a daily walk.")).toBeTruthy();
    expect(screen.getByText("Walk 20 minutes")).toBeTruthy();
  });
});
