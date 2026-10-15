/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import FollowUpsPage from "./page";

const row = {
  id: "11111111-1111-4111-8111-111111111111", patient_id: "22222222-2222-4222-8222-222222222222", patient_first_name: "Ada", kind: "lab_request",
  source_table: "lab_orders", abnormal_result: true, owner_id: "33333333-3333-4333-8333-333333333333", due_at: "2026-10-05T09:00:00Z",
  state: "open", overdue: true, escalated_at: null, escalation_route: null, outcome: null, outcome_reason: null, closed_at: null,
};

beforeEach(() => rpc.mockReset());

describe("FollowUpsPage", () => {
  it("lists a follow-up with its flags and the close form (outcome and reason both required)", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    render(await FollowUpsPage());
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Waiting on a result")).toBeTruthy();
    expect((screen.getByLabelText("Outcome") as HTMLSelectElement).required).toBe(true);
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).required).toBe(true);
    expect(rpc).toHaveBeenCalledWith("list_clinical_follow_ups", { p_include_closed: false });
  });

  it("says plainly when there are none", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(await FollowUpsPage());
    expect(screen.getByText(/no open follow-ups/)).toBeTruthy();
  });

  it("a failed load is an error, never 'you have none'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(await FollowUpsPage());
    expect(screen.getByRole("alert").textContent).toMatch(/not the same as having none/);
    expect(screen.queryByText(/no open follow-ups/)).toBeNull();
  });
});
