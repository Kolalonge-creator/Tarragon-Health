/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
const taskRow = jest.fn();
// The page makes two audited reads (P6): the summary and the reason a triage rule raised the task. Each test sets what each returns.
let summaryResult: unknown = { data: null, error: null };
let explainerResult: unknown = { data: { status: "none" }, error: null };
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p), usePathname: () => "/clinician/tasks/x" }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ maybeSingle: () => Promise.resolve(taskRow()) }) }) }) }) }),
  }),
}));
jest.mock("../../queue/forms", () => ({
  CompleteForm: () => <div>complete-form</div>,
  ExtendForm: () => <div>extend-form</div>,
  HandBackForm: () => <div>handback-form</div>,
}));

import ClinicianTaskPage from "./page";

const id = "11111111-1111-4111-8111-111111111111";
const held = (type: string) => ({
  data: { id, type, priority_class: 2, due_at: null, claim_expires_at: null, patient_id: "22222222-2222-4222-8222-222222222222", state: "claimed" },
  error: null,
});
const renderPage = async () => render(await ClinicianTaskPage({ params: Promise.resolve({ taskId: id }) }));

beforeEach(() => {
  rpc.mockReset();
  taskRow.mockReset();
  explainerResult = { data: { status: "none" }, error: null };
  rpc.mockImplementation(async (name: string) => (name === "clinician_task_triage_explainer" ? explainerResult : summaryResult));
});

describe("ClinicianTaskPage", () => {
  it("reads no patient for a task the clinician does not hold", async () => {
    taskRow.mockReturnValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
    await renderPage();
    expect(screen.getByText(/do not hold this task/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("clinician_patient_summary", expect.anything());
  });

  it.each([
    ["withdrawn", /withdrawn by the clinical lead/],
    ["completed", /already been finished/],
    ["returned", /do not hold this task/],
  ])("says what became of a task that is no longer held: %s", async (what, words) => {
    taskRow.mockReturnValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: what, error: null });
    await renderPage();
    expect(screen.getByText(words)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("my_task_outcome", { p_task: id });
    expect(rpc).not.toHaveBeenCalledWith("clinician_patient_summary", expect.anything());
  });

  it("says it could not load, rather than 'not held', when the read failed", async () => {
    taskRow.mockReturnValue({ data: null, error: { message: "boom" } });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a denied summary as a denial, not as an empty summary", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    summaryResult = { data: { status: "denied" }, error: null };
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/do not have access/);
    expect(screen.queryByText("Patient summary")).toBeNull();
  });

  it("shows a load error when the summary call fails", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    summaryResult = { data: null, error: { message: "boom" } };
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });

  it("offers the outcome form for an ordinary task", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    summaryResult = { data: { status: "ok", care_circle: { active_members: 0 } }, error: null };
    await renderPage();
    expect(screen.getByText("complete-form")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("clinician_patient_summary", expect.objectContaining({ p_patient: "22222222-2222-4222-8222-222222222222" }));
  });

  it("sends a titration task to the proposed changes, which finish it by themselves (S16-S20 D4)", async () => {
    taskRow.mockReturnValue(held("titration_signoff"));
    rpc.mockResolvedValue({ data: { status: "ok", care_circle: { active_members: 0 } }, error: null });
    await renderPage();
    expect(screen.queryByText("complete-form")).toBeNull();
    expect(screen.getByRole("link", { name: /proposed changes/ }).getAttribute("href")).toBe(
      "/clinician/patients/22222222-2222-4222-8222-222222222222/care-plan-changes",
    );
  });

  it("offers the form for a critical result, whose outcome is coded", async () => {
    taskRow.mockReturnValue(held("critical_result_review"));
    rpc.mockResolvedValue({ data: { status: "ok", care_circle: { active_members: 0 } }, error: null });
    await renderPage();
    expect(screen.getByText("complete-form")).toBeTruthy();
    expect(screen.getByText(/closes its task by itself/)).toBeTruthy();
  });

  it("sends a written question to its own page instead of the generic form", async () => {
    taskRow.mockReturnValue(held("async_question"));
    summaryResult = { data: { status: "ok", care_circle: { active_members: 0 } }, error: null };
    await renderPage();
    expect(screen.queryByText("complete-form")).toBeNull();
    expect(screen.getByRole("link", { name: /written questions/ }).getAttribute("href")).toBe("/clinician/async-consults");
  });

  const okExplainer = {
    status: "ok",
    task_id: id,
    triage_event: {
      id: "33333333-3333-4333-8333-333333333333", grade: "amber", trigger_type: "silence", rule_id: "BP-A5", rule_set_code: "bp_care_triage",
      rule_set_version: 3, rule_set_status: "approved", matched_rule_ids: ["BP-A5"], explanation_key: "TRI-002", task_key: "BP-A5:2026-10-12",
      context: { type: "silence", lastReadingAt: "2026-10-12T09:00:00Z", sinceAt: "2026-09-01T00:00:00Z" }, created_at: "2026-10-20T06:52:00Z",
    },
  };

  it("P6: shows why a triage rule raised the task (rule id, rule set version, the facts it was given), after the hold check", async () => {
    taskRow.mockReturnValue(held("silence_check"));
    summaryResult = { data: { status: "ok", care_circle: { active_members: 0 } }, error: null };
    explainerResult = { data: okExplainer, error: null };
    await renderPage();
    expect(screen.getByText("Why this task was raised")).toBeTruthy();
    expect(screen.getByText(/Rule BP-A5, bp_care_triage version 3/)).toBeTruthy();
    expect(screen.getByText(/No blood pressure reading since/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("clinician_task_triage_explainer", { p_task: id });
  });

  it("P6: a task with no triage rule behind it shows no explainer, and a failed explainer read says so without hiding the task", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    summaryResult = { data: { status: "ok", care_circle: { active_members: 0 } }, error: null };
    explainerResult = { data: { status: "none" }, error: null };
    await renderPage();
    expect(screen.queryByText("Why this task was raised")).toBeNull();
    expect(screen.getByText("complete-form")).toBeTruthy();
  });

  it("P6: an explainer error is a visible line of its own, the task form is still there", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    summaryResult = { data: { status: "ok", care_circle: { active_members: 0 } }, error: null };
    explainerResult = { data: null, error: { message: "boom" } };
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/reason for this task could not be loaded/);
    expect(screen.getByText("complete-form")).toBeTruthy();
  });
});
