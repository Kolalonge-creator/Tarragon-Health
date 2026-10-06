/** @jest-environment jsdom */
/**
 * The supporter view (S29, safety case 21 on the screen side): renders only the blocks the database sent, shows weekly averages and
 * never a single reading, offers Pay only when it was allowed, and says one neutral thing when access has ended. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { SupporterView } from "./supporter-view";

let view: { isPending: boolean; data: unknown };
let people: { data: unknown[] };
const mutateAsync = jest.fn();
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/queries/care-circle", () => ({
  useSupporterView: () => view,
  useSupportedPeople: () => people,
  useRevokeMember: () => ({ mutateAsync, isPending: false }),
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

  it("one neutral message when access has ended or never existed", () => {
    view = { isPending: false, data: null };
    render(<SupporterView patientId="p1" locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/not available/);
    expect(screen.queryByText(/Mama Eze/)).toBeNull();
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
