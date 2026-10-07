/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import AutomationsPage from "./page";

const base = { kind: "vercel_cron", schedule: "0 5 * * *", enabled: true, owner_role: null, owner_user_name: null, runbook_url: null, last_run_at: null, last_status: null, can_edit: true };
const rows = [
  { ...base, id: "11111111-1111-4111-8111-111111111111", name: "cron:broken-job", kind: "pg_cron", last_status: "failed", health: "failed", last_run_at: "2026-10-07T03:00:00Z" },
  { ...base, id: "22222222-2222-4222-8222-222222222222", name: "vercel:fraud-sweep", health: "unowned" },
  { ...base, id: "33333333-3333-4333-8333-333333333333", name: "vercel:ok-job", owner_role: "finance", health: "ok" },
];
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
beforeEach(() => rpc.mockReset());

describe("AutomationsPage", () => {
  it("shows the failed job first and the unowned one, with an owner form for an admin", async () => {
    rpc.mockResolvedValue({ data: rows, error: null });
    render(await AutomationsPage(props()));
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/Last run failed/);
    expect(screen.getByText("cron:broken-job")).toBeTruthy();
    expect(screen.getByText("vercel:fraud-sweep")).toBeTruthy();
    expect(headings.some((h) => /No owner yet/.test(h))).toBe(true);
    expect(screen.getAllByText("Save owner").length).toBeGreaterThan(0);
  });
  it("tells a read-only viewer they cannot set an owner", async () => {
    rpc.mockResolvedValue({ data: [{ ...rows[1], can_edit: false }], error: null });
    render(await AutomationsPage(props()));
    expect(screen.queryByText("Save owner")).toBeNull();
    expect(screen.getByText(/Only an admin can set an owner/)).toBeTruthy();
  });
  it("a failed load is an error, never an empty 'all fine'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await AutomationsPage(props()));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });
  it("sends someone the database refuses back to /admin", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(AutomationsPage(props())).rejects.toThrow("REDIRECT:/admin");
  });
});
