/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import AutomationsPage from "./page";

const base = { purpose: null, owner: "unassigned", schedule: "* * * * *", source: "pg_cron", safety_critical: false, is_paused: false, paused_at: null, reason: null, last_run_at: null, last_status: null, registered: true };
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
beforeEach(() => rpc.mockReset());

describe("AutomationsPage", () => {
  it("shows a pause control for a routine job and none for a safety-critical job or a Vercel cron", async () => {
    rpc.mockResolvedValue({ data: [
      { ...base, job_name: "routine-job" },
      { ...base, job_name: "sweep-pages", safety_critical: true },
      { ...base, job_name: "/api/cron/fraud-sweep", source: "vercel" },
    ], error: null });
    render(await AutomationsPage(props()));
    expect(screen.getAllByText("Pause").length).toBe(2);
    expect(screen.getByText(/safety critical and cannot be paused/)).toBeTruthy();
    expect(screen.getByText(/scheduled by Vercel/)).toBeTruthy();
    expect(screen.getAllByText(/Owner: not recorded/).length).toBe(3);
  });
  it("flags a job that is not in the registry", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, job_name: "new-job", registered: false }], error: null });
    render(await AutomationsPage(props()));
    expect(screen.getByText("Not in the registry")).toBeTruthy();
  });
  it("a failed load is an error, never an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await AutomationsPage(props()));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("a refusal from a non-admin leaves the page", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(AutomationsPage(props())).rejects.toThrow("REDIRECT:/admin");
  });
});
