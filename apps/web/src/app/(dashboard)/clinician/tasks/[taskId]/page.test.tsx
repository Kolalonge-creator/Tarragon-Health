/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
const taskRow = jest.fn();
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
});

describe("ClinicianTaskPage", () => {
  it("reads no patient for a task the clinician does not hold", async () => {
    taskRow.mockReturnValue({ data: null, error: null });
    await renderPage();
    expect(screen.getByText(/do not hold this task/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says it could not load, rather than 'not held', when the read failed", async () => {
    taskRow.mockReturnValue({ data: null, error: { message: "boom" } });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a denied summary as a denial, not as an empty summary", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    rpc.mockResolvedValue({ data: { status: "denied" }, error: null });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/do not have access/);
    expect(screen.queryByText("Patient summary")).toBeNull();
  });

  it("shows a load error when the summary call fails", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await renderPage();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });

  it("offers the outcome form for an ordinary task", async () => {
    taskRow.mockReturnValue(held("amber_bp_review"));
    rpc.mockResolvedValue({ data: { status: "ok", care_circle: { active_members: 0 } }, error: null });
    await renderPage();
    expect(screen.getByText("complete-form")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("clinician_patient_summary", expect.objectContaining({ p_patient: "22222222-2222-4222-8222-222222222222" }));
  });

  it("sends a written question to its own page instead of the generic form", async () => {
    taskRow.mockReturnValue(held("async_question"));
    rpc.mockResolvedValue({ data: { status: "ok", care_circle: { active_members: 0 } }, error: null });
    await renderPage();
    expect(screen.queryByText("complete-form")).toBeNull();
    expect(screen.getByRole("link", { name: /written questions/ }).getAttribute("href")).toBe("/clinician/async-consults");
  });
});
