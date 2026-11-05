/**
 * Profile & settings under the 2FA group requirement (/admin/settings/two-factor).
 *
 * Regression (2026-11-05, found in the browser check before merge): when the account's group required 2FA and it had no factor,
 * the page showed "Turn on two-factor sign-in to continue" but no set-up card. A bulk edit had wrapped the card in the same
 * condition that hides it, so a held account could open only this page and do nothing on it: a lock-out. Pinned here:
 *  - required, no factor: the notice AND exactly one set-up card;
 *  - required, with a factor: the card in its "on" state, told it is required (no turn-off control);
 *  - not required: the card as before, once, with no notice.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string) => Promise<{ data: unknown; error: unknown }>>();
const listFactors = jest.fn<() => Promise<{ data: unknown }>>();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "u1", email: "doc@example.com" }),
  createClient: async () => ({ rpc: (fn: string) => rpc(fn), auth: { mfa: { listFactors: () => listFactors() } } }),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ id: "u1", role: "clinician", full_name: "Doc", phone: null, receives_care: null, staff_number: null }),
  getCurrentClinicalStaff: async () => null,
}));
jest.mock("@/lib/clinical/staff-folio", () => ({ fetchStaffFolios: async () => new Map() }));
jest.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
// The cards are client components with their own tests; here only which ones render, and with what, matters.
jest.mock("@/components/account/mfa-settings-card", () => ({
  MfaSettingsCard: ({ verifiedFactorId, required }: { verifiedFactorId: string | null; required?: boolean }) =>
    `[mfa-card factor=${verifiedFactorId ?? "none"} required=${String(required ?? false)}]`,
}));
for (const m of [
  "@/components/account/change-password-form",
  "@/components/account/change-phone-card",
  "@/components/account/passkeys-card",
  "@/components/account/sign-out-other-devices-card",
  "@/app/(dashboard)/patient/patient-location-form",
]) {
  jest.mock(m, () => new Proxy({}, { get: () => () => null }));
}
jest.mock("./join-employer-code-form", () => ({ JoinEmployerCodeForm: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import AccountPage from "./page";

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve(search) }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("Profile & settings and the 2FA group requirement", () => {
  beforeEach(() => {
    rpc.mockReset();
    listFactors.mockReset();
  });

  it("required with no factor: shows the notice and the set-up card, once", async () => {
    rpc.mockResolvedValue({ data: [{ required: true, has_verified_factor: false }], error: null });
    listFactors.mockResolvedValue({ data: { totp: [] } });
    const html = await render({ mfa: "required", redirect: "/clinician" });
    expect(html).toContain("Turn on two-factor sign-in to continue");
    expect(count(html, "[mfa-card factor=none required=true]")).toBe(1);
  });

  it("required with a factor: the card says it is required, and a continue link is offered", async () => {
    rpc.mockResolvedValue({ data: [{ required: true, has_verified_factor: true }], error: null });
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f1", status: "verified" }] } });
    const html = await render({ redirect: "/clinician" });
    expect(html).not.toContain("Turn on two-factor sign-in to continue");
    expect(count(html, "[mfa-card factor=f1 required=true]")).toBe(1);
    expect(html).toContain("Continue to where you were going");
  });

  it("not required: the card as before, once, and no notice", async () => {
    rpc.mockResolvedValue({ data: [{ required: false, has_verified_factor: false }], error: null });
    listFactors.mockResolvedValue({ data: { totp: [] } });
    const html = await render();
    expect(html).not.toContain("Turn on two-factor sign-in to continue");
    expect(count(html, "[mfa-card factor=none required=false]")).toBe(1);
  });

  it("an unreadable requirement, when the proxy sent the person here, holds the page in the required state with the card", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    listFactors.mockResolvedValue({ data: { totp: [] } });
    const html = await render({ mfa: "required" });
    expect(html).toContain("We could not check your sign-in settings");
    expect(count(html, "[mfa-card factor=none")).toBe(1);
  });

  it("an unreadable requirement on an ordinary visit tells nobody 2FA is now required", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    listFactors.mockResolvedValue({ data: { totp: [] } });
    const html = await render();
    expect(html).not.toContain("Turn on two-factor sign-in to continue");
    expect(count(html, "[mfa-card factor=none required=false]")).toBe(1);
  });
});
