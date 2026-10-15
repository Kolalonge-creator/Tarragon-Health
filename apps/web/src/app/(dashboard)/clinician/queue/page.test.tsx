/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
const heldRows = jest.fn();
const staff = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p), usePathname: () => "/clinician/queue" }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
// the surge and pause banner is an async server component with its own tests; the queue page is proved without it
jest.mock("@/components/capacity/ops-mode-banner", () => ({ OpsModeBanner: () => null }));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }),
  getCurrentClinicalStaff: () => Promise.resolve(staff()),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve(heldRows()) }) }) }) }),
  }),
}));
jest.mock("./forms", () => ({
  NextTaskForm: () => <div>next-task-form</div>,
  ExtendForm: () => <div>extend-form</div>,
}));

import ClinicianQueuePage from "./page";

const taskId = "11111111-1111-4111-8111-111111111111";
const open = { open: true, blocked: null, by_class: { "4": 2 }, offered: [], escalated_claimable: 0, reliability_score: 84.4 };
const answers = (summary: unknown, escalated: unknown = []) => {
  rpc.mockImplementation((name: string) => {
    if (name === "queue_summary") return Promise.resolve({ data: summary, error: null });
    if (name === "queue_escalated_overview") return Promise.resolve({ data: escalated, error: null });
    return Promise.resolve({ data: null, error: { message: "unexpected " + name } });
  });
};
const renderPage = async () => render(await ClinicianQueuePage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  rpc.mockReset();
  heldRows.mockReset();
  staff.mockReset();
  heldRows.mockReturnValue({ data: [], error: null });
  staff.mockReturnValue({ doctor_tier: "senior_medical_officer" });
});

describe("ClinicianQueuePage (S16-S20 D1, D2, D7 and the closed-queue reasons)", () => {
  it("says why the queue is closed, in words, and when a cooling-off ends", async () => {
    answers({ open: false, blocked: "queue_cooling_off", by_class: {}, cooling_off_until: "2026-10-14T12:30:00Z", reliability_score: 80 });
    await renderPage();
    expect(screen.getByText("Why the queue is closed to you")).toBeTruthy();
    expect(screen.getByText(/handed back several tasks recently/)).toBeTruthy();
    expect(screen.getByText(/It opens again at 13:30/)).toBeTruthy();
    expect(screen.queryByText(/queue_cooling_off/)).toBeNull();
  });

  it("gives the general sentence, never a code, for a reason it does not know", async () => {
    answers({ open: false, blocked: "queue_from_the_future", by_class: {} });
    await renderPage();
    expect(screen.getByText("The queue is closed to you right now.")).toBeTruthy();
    expect(screen.queryByText(/queue_from_the_future/)).toBeNull();
  });

  it("shows nothing about why when the queue is open", async () => {
    answers(open);
    await renderPage();
    expect(screen.queryByText("Why the queue is closed to you")).toBeNull();
    expect(screen.getByText("You are open for the queue.")).toBeTruthy();
  });

  it("lists the work offered to me first with the time the offer ends, and the count of escalated work I can take", async () => {
    answers({
      ...open, escalated_claimable: 2,
      offered: [{ task_id: taskId, type: "symptom_review", priority_class: 5, due_at: null, window_ends_at: "2026-10-14T12:30:00Z" }],
    });
    await renderPage();
    expect(screen.getByText("symptom review")).toBeTruthy();
    expect(screen.getByText(/Yours until/)).toBeTruthy();
    expect(screen.getByText(/2 escalated tasks are waiting that you can take/)).toBeTruthy();
  });

  it("says plainly when nothing is offered and no escalated work is claimable", async () => {
    answers(open);
    await renderPage();
    expect(screen.getByText("Nothing is offered to you right now.")).toBeTruthy();
    expect(screen.getByText("No escalated work you can take.")).toBeTruthy();
  });

  it("shows my own reliability score as a guide, not a verdict", async () => {
    answers(open);
    await renderPage();
    expect(screen.getByText(/84 out of 100/)).toBeTruthy();
    expect(screen.getByText(/decides nothing about your pay/)).toBeTruthy();
  });

  it("shows the clinical lead the escalated tasks with their age, and nobody else", async () => {
    staff.mockReturnValue({ doctor_tier: "chief_medical_officer" });
    answers(open, [{ task_id: taskId, type: "critical_result_review", priority_class: 2, due_at: null, escalated_at: "2026-10-14T10:00:00Z", age_minutes: 95, escalation_level: 1, handback_count: 0 }]);
    await renderPage();
    expect(screen.getByText("Escalated tasks (clinical lead)")).toBeTruthy();
    expect(screen.getByText("critical result review")).toBeTruthy();
    expect(screen.getByText("Escalated 95 minutes ago")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("queue_escalated_overview");
  });

  it("an ordinary clinician neither sees the lead list nor asks the database for it", async () => {
    answers(open);
    await renderPage();
    expect(screen.queryByText("Escalated tasks (clinical lead)")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("queue_escalated_overview");
  });

  it("says it could not load, rather than 'empty', when the lead list fails", async () => {
    staff.mockReturnValue({ doctor_tier: "chief_medical_officer" });
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === "queue_summary" ? { data: open, error: null } : { data: null, error: { message: "boom" } }));
    await renderPage();
    expect(screen.getAllByRole("alert").some((a) => /could not be loaded/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("No escalated tasks.")).toBeNull();
  });

  it("says it could not load the summary rather than showing an empty queue", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await renderPage();
    expect(screen.getAllByRole("alert").some((a) => /could not be loaded/.test(a.textContent ?? ""))).toBe(true);
  });
});
