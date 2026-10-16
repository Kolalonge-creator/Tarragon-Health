/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import SignupInvitesPage from "./page";

const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
const row = (o: Record<string, unknown>) => ({ id: "11111111-1111-4111-8111-111111111111", kind: "phone", identifier: "+2348011112222", label: "Lagos pilot", uses: 0, max_uses: 1, expires_at: "2026-12-01T00:00:00Z", revoked_at: null, status: "open", created_at: "2026-10-07T00:00:00Z", ...o });

function answer(list: unknown, on: unknown) {
  rpc.mockImplementation(async (fn: string) => (fn === "platform_switch_is_on" ? on : list));
}
beforeEach(() => rpc.mockReset());

describe("SignupInvitesPage", () => {
  it("shows the switch state and an open invite with a revoke button", async () => {
    answer({ data: [row({})], error: null }, { data: false, error: null });
    render(await SignupInvitesPage(props()));
    expect(screen.getByText(/OFF: anyone can sign up/)).toBeTruthy();
    expect(screen.getByText("+2348011112222")).toBeTruthy();
    expect(screen.getByText("Revoke")).toBeTruthy();
    expect(screen.getByText("Switch on invite-only sign-up")).toBeTruthy();
  });

  it("offers to open sign-up again when it is on, and gives no revoke for a used invite", async () => {
    answer({ data: [row({ status: "used", uses: 1 })], error: null }, { data: true, error: null });
    render(await SignupInvitesPage(props()));
    expect(screen.getByText(/ON\./)).toBeTruthy();
    expect(screen.getByText("Open sign-up to everyone")).toBeTruthy();
    expect(screen.queryByText("Revoke")).toBeNull();
  });

  it("never shows an unreadable setting as off", async () => {
    answer({ data: [], error: null }, { data: null, error: { message: "boom" } });
    render(await SignupInvitesPage(props()));
    expect(screen.getByText(/setting could not be read/)).toBeTruthy();
    expect(screen.queryByText(/OFF: anyone/)).toBeNull();
  });

  it("a failed list load is an error, not an empty list, and a refusal goes back to /admin", async () => {
    answer({ data: null, error: { message: "boom", code: "XX000" } }, { data: false, error: null });
    render(await SignupInvitesPage(props()));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    answer({ data: null, error: { message: "no", code: "42501" } }, { data: false, error: null });
    await expect(SignupInvitesPage(props())).rejects.toThrow("REDIRECT:/admin");
  });
});
