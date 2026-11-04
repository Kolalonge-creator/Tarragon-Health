/** @jest-environment jsdom */
/**
 * The supporter view (S29, safety case 21 on the screen side): renders only the blocks the database sent, shows weekly averages and
 * never a single reading, offers Pay only when it was allowed, and says one neutral thing when access has ended. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { SupporterView } from "./supporter-view";

let view: { isPending: boolean; data: unknown; isError?: boolean; refetch?: () => void };
let people: { data: unknown[] };
const mutateAsync = jest.fn();
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({
  useSupporterView: () => view,
  useSupportedPeople: () => people,
  useRevokeMember: () => ({ mutateAsync, isPending: false }),
  // S69b: the tools are off in these tests, so the digest and the shared jobs render nothing
  useToolsStatus: () => ({ data: { digest: false, tasks: false, missed_dose: false, grace_minutes: null } }),
  useWeeklyDigest: () => ({ isPending: false, isError: false, data: null }),
  useCircleTasks: () => ({ isPending: false, isError: true, data: undefined }),
  usePostTask: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useTaskAction: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const BASE = { patient_id: "p1", name: "Mama Eze", relationship: "Mother", permissions: [], shared_until: "2027-06-01T00:00:00Z" };
beforeEach(() => {
  view = { isPending: false, data: { ...BASE, permissions: ["adherence_summary"], adherence: { days: 7, taken: 3, due: 4, percent: 75 } } };
  people = { data: [{ patient_id: "p1", member_id: "m1" }] };
  mutateAsync.mockReset();
  push.mockReset();
});

describe("SupporterView", () => {
  it("shows only the adherence block when only that was shared", async () => {
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByText(/3 of 4 doses taken \(75 percent\)/)).toBeTruthy();
    expect(screen.queryByText(/Blood pressure/)).toBeNull();
    expect(screen.queryByText(/Appointments/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Pay for their care" })).toBeNull();
    cleanup();
    await expectNoA11yViolations(<SupporterView patientId="p1" locale="en" />);
  });

  it("shows weekly averages and a direction, never a single reading", () => {
    view = {
      isPending: false,
      data: { ...BASE, permissions: ["weekly_bp_trend"], bp_trend: { weeks: [{ week_start: "2026-09-28", systolic: 150, diastolic: 95, readings: 4 }, { week_start: "2026-10-05", systolic: 141, diastolic: 90, readings: 3 }], direction: "lower" } },
    };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/141 over 90 \(3 readings\)/)).toBeTruthy();
    expect(screen.getByText("Lower than the week before.")).toBeTruthy();
    expect(screen.queryByText(/Medicines this week/)).toBeNull();
  });

  it("shows the appointment block with no reason or clinician", () => {
    view = { isPending: false, data: { ...BASE, permissions: ["appointments"], appointments: { next_at: "2026-10-12T09:00:00Z", missed_30d: 1 } } };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByText(/Next appointment:/)).toBeTruthy();
    expect(screen.getByText(/Missed in the last 30 days: 1/)).toBeTruthy();
  });

  it("offers Pay only when the database said they can, and links to the pay page for that person", () => {
    view = { isPending: false, data: { ...BASE, permissions: ["pay_for_care"], can_pay: true } };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByRole("link", { name: "Pay for their care" }).getAttribute("href")).toBe("/patient/supporting/circle/p1/pay");
  });

  it("one calm, neutral message when nothing is shared right now (ended, never existed or paused look the same)", async () => {
    view = { isPending: false, data: null };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByRole("status").textContent).toBe("Nothing is being shared with you right now.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/paus|ended|removed|not available/i);
    expect(screen.queryByText(/Mama Eze/)).toBeNull();
    expect(screen.getAllByRole("link", { name: "People you support" }).length).toBeGreaterThan(0);
    cleanup();
    await expectNoA11yViolations(<SupporterView patientId="p1" locale="en" />);
  });

  it("titles the page with the person's name", () => {
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Mama Eze's care" })).toBeTruthy();
  });

  it("when only check-in requests are shared, says so calmly instead of showing an empty page", async () => {
    view = { isPending: false, data: { ...BASE, permissions: ["red_alerts"] } };
    render(<SupporterView patientId="p1" locale="en" />);
    const empty = screen.getByTestId("supporter-blocks-empty");
    expect(empty.textContent).toMatch(/Mama Eze has not shared anything to show here yet\./);
    expect(empty.textContent).toMatch(/You will still be told at once if they need help\./);
    expect(empty.textContent).not.toMatch(/pay/i);
    cleanup();
    await expectNoA11yViolations(<SupporterView patientId="p1" locale="en" />);
  });

  it("when only paying is shared, the empty state says paying still works", () => {
    view = { isPending: false, data: { ...BASE, permissions: ["pay_for_care"], can_pay: true } };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByTestId("supporter-blocks-empty").textContent).toMatch(/You can still pay for their care/);
  });

  it("does not show the empty state when a block is shared", () => {
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.queryByTestId("supporter-blocks-empty")).toBeNull();
  });

  it("a failed read says so and offers to try again", () => {
    const refetch = jest.fn();
    view = { isPending: false, data: undefined, isError: true, refetch } as typeof view;
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load this page/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("lets the supporter leave, after confirming", async () => {
    const confirm = jest.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mutateAsync.mockResolvedValue(undefined);
    render(<SupporterView patientId="p1" locale="en" />);
    const leave = screen.getByRole("button", { name: "Leave this Care Circle" });
    await act(async () => fireEvent.click(leave));
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(leave));
    expect(mutateAsync).toHaveBeenCalledWith("m1");
    expect(push).toHaveBeenCalledWith("/patient/supporting");
    confirm.mockRestore();
  });

  it("has no export, copy or download control", () => {
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.queryByRole("button", { name: /export|download|copy|print/i })).toBeNull();
  });
});
