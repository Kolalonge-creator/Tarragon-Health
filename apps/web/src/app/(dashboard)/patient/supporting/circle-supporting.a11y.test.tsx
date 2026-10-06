/** @jest-environment jsdom */
/** The Care Circle half of the supporter home (S29): an open check-in request first, then the people who shared something. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CircleSupporting } from "./circle-supporting";

let people: { isSuccess: boolean; data: unknown[] };
let alerts: { data: unknown[] };
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const ack = jest.fn();
const setMode = jest.fn();
jest.mock("@/lib/queries/care-circle", () => ({
  useSupportedPeople: () => people,
  useOpenAlerts: () => alerts,
  useAckAlert: () => ({ mutateAsync: ack, isPending: false }),
  useSetAlertMode: () => ({ mutate: setMode, isPending: false }),
}));

const PERSON = { patient_id: "p1", member_id: "m1", name: "Mama Eze", relationship: "Mother", permissions: ["red_alerts"], expires_at: "2027-06-01T00:00:00Z", alert_mode: "push_and_app" };
beforeEach(() => {
  people = { isSuccess: true, data: [PERSON] };
  alerts = { data: [] };
  ack.mockReset();
  setMode.mockReset();
});

describe("CircleSupporting", () => {
  it("lists the people and links to each page", async () => {
    render(<CircleSupporting locale="en" />);
    expect(screen.getByText("Mama Eze")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/patient/supporting/circle/p1");
    cleanup();
    await expectNoA11yViolations(<CircleSupporting locale="en" />);
  });

  it("shows an open check-in request as an alert with a name and nothing clinical", () => {
    alerts = { data: [{ patient_id: "p1", name: "Mama Eze", since: "2026-10-06T10:00:00Z", called: false }] };
    render(<CircleSupporting locale="en" />);
    const a = screen.getByRole("alert");
    expect(a.textContent).toMatch(/Please check on Mama Eze/);
    expect(a.textContent).toMatch(/Please call Mama Eze now/);
    expect(a.textContent).not.toMatch(/blood|pressure|reading|result|emergency|critical/i);
  });

  it("marks a request as called with one tap, no text, and then says so", async () => {
    ack.mockResolvedValue(undefined);
    alerts = { data: [{ patient_id: "p1", name: "Mama Eze", since: "2026-10-06T10:00:00Z", called: false }] };
    render(<CircleSupporting locale="en" />);
    expect(screen.getByText("Needs attention")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I called them" })));
    expect(ack).toHaveBeenCalledWith("p1");
    expect(ack.mock.calls[0]).toHaveLength(1);
  });

  it("once called, the request shows as called and no longer needs attention", () => {
    alerts = { data: [{ patient_id: "p1", name: "Mama Eze", since: "2026-10-06T10:00:00Z", called: true }] };
    render(<CircleSupporting locale="en" />);
    expect(screen.queryByRole("button", { name: "I called them" })).toBeNull();
    expect(screen.getByText("You have marked this as called.")).toBeTruthy();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("lets a supporter who gets check-in requests drop the push, and says what that means", () => {
    people = { isSuccess: true, data: [{ ...PERSON, alert_mode: "app_only" }] };
    render(<CircleSupporting locale="en" />);
    const select = screen.getByLabelText("Check-in requests for Mama Eze") as HTMLSelectElement;
    expect(select.value).toBe("app_only");
    expect(screen.getByText(/you may not see a request until you open the app/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "push_and_app" } });
    expect(setMode).toHaveBeenCalledWith({ patientId: "p1", mode: "push_and_app" });
  });

  it("offers no alert setting to someone who was not given check-in requests, and no quiet hours to anyone", () => {
    people = { isSuccess: true, data: [{ ...PERSON, permissions: ["pay_for_care"] }] };
    render(<CircleSupporting locale="en" />);
    expect(screen.queryByLabelText(/Check-in requests for/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/quiet hours/i);
  });

  it("renders nothing at all for someone who is in no circle", () => {
    people = { isSuccess: true, data: [] };
    const { container } = render(<CircleSupporting locale="en" />);
    expect(container.textContent).toBe("");
  });
});
