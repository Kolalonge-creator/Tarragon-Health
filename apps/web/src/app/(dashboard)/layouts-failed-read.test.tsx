/** @jest-environment jsdom */
/**
 * The payer and provider-org layouts decide, from the caller's seat, whether to
 * show the console or "your login isn't linked yet". A failed seat read must not
 * be told to the person as the second.
 */
jest.mock("server-only", () => ({}));
jest.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

type Reply = { data: unknown; error: { message: string } | null };
let replies: Record<string, Reply> = {};
let role = "payer_admin";

jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role, full_name: "Ada" }) }));
jest.mock("@/lib/platform-modules", () => ({ isPlatformModuleEnabled: async () => true }));
jest.mock("@/components/dashboard-placeholder", () => ({
  DashboardPlaceholder: ({ comingUp }: { comingUp: string[] }) => <div data-testid="placeholder">{comingUp.join(" ")}</div>,
}));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});

import { render, screen } from "@testing-library/react";
import PayerLayout from "./payer/layout";
import ProviderOrgLayout from "./provider-org/layout";

const ok = (data: unknown): Reply => ({ data, error: null });
const fails: Reply = { data: null, error: { message: "boom" } };
const child = <p>console</p>;

describe("payer layout", () => {
  beforeEach(() => { role = "payer_admin"; });
  it("throws when the seat read fails, rather than saying the login is not linked", async () => {
    replies = { payer_administrators: fails };
    await expect(PayerLayout({ children: child })).rejects.toBeDefined();
  });
  it("shows the not-linked message for a genuinely seatless login", async () => {
    replies = { payer_administrators: ok([]) };
    render(await PayerLayout({ children: child }));
    expect(screen.getByTestId("placeholder").textContent).toContain("isn't linked to an insurer");
  });
  it("shows the console for a seat-holder", async () => {
    replies = { payer_administrators: ok([{ insurer_id: "i1" }]) };
    render(await PayerLayout({ children: child }));
    expect(screen.getByText("console")).toBeTruthy();
  });
});

describe("provider organisation layout", () => {
  beforeEach(() => { role = "provider_org_staff"; });
  it("throws when the seat read fails, rather than saying the login is not linked", async () => {
    replies = { provider_org_members: fails };
    await expect(ProviderOrgLayout({ children: child })).rejects.toBeDefined();
  });
  it("shows the not-linked message for a genuinely seatless login", async () => {
    replies = { provider_org_members: ok([]) };
    render(await ProviderOrgLayout({ children: child }));
    expect(screen.getByTestId("placeholder").textContent).toContain("isn't linked to an organisation");
  });
  it("shows the console for a seat-holder", async () => {
    replies = { provider_org_members: ok([{ organisation_id: "o1" }]) };
    render(await ProviderOrgLayout({ children: child }));
    expect(screen.getByText("console")).toBeTruthy();
  });
});
