/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
let allowed = true;
let loaded: unknown = { ok: true, data: { current: [], history: [], audit: [] } };
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ id: "p", language: "en" }) }));
jest.mock("@/lib/auth/permissions", () => ({ hasPermission: async () => allowed }));
jest.mock("@/lib/clinician-roster/load", () => ({ loadGrantsHistory: async () => loaded }));

import GrantsHistoryPage from "./page";

describe("grants history page", () => {
  it("sends a non-holder away before loading anything", async () => {
    allowed = false;
    await expect(GrantsHistoryPage()).rejects.toThrow("REDIRECT:/admin/settings");
    allowed = true;
  });
  it("shows who holds what, how, and that grants have no expiry", async () => {
    loaded = {
      ok: true,
      data: {
        current: [
          { permission_key: "ops.console.view", permission_label: "View ops console", source: "direct", holder_id: "11111111-1111-4111-8111-111111111111", holder_name: "Ada", holder_role: "finance", holder_active: true, granted_at: "2026-10-01T10:00:00Z", granted_by_name: "Founder", expires_at: null },
          { permission_key: "support.manage", permission_label: null, source: "role:Support lead", holder_id: "22222222-2222-4222-8222-222222222222", holder_name: "Bola", holder_role: "finance", holder_active: false, granted_at: null, granted_by_name: null, expires_at: null },
        ],
        history: [{ id: "33333333-3333-4333-8333-333333333333", permission_key: "ops.console.view", holder_id: "11111111-1111-4111-8111-111111111111", holder_name: "Ada", granted_at: "2026-10-01T10:00:00Z", granted_by_name: "Founder", revoked_at: "2026-10-02T10:00:00Z", revoked_by_name: "Founder" }],
        audit: [{ id: "a1", action: "permission.revoked", created_at: "2026-10-02T10:00:00Z", actor_name: "Founder", subject_name: "Ada", permission_key: null }],
      },
    };
    const h = renderToStaticMarkup(await GrantsHistoryPage());
    expect(h).toContain("View ops console");
    expect(h).toContain("Granted directly");
    expect(h).toContain("Through the role Support lead");
    expect(h).toContain("No expiry");
    expect(h).toContain("login suspended");
    expect(h).toContain("Removed");
    expect(h).toContain("permission.revoked");
  });
  it("a failed load says so", async () => {
    loaded = { ok: false, denied: true };
    const h = renderToStaticMarkup(await GrantsHistoryPage());
    expect(h).toContain("could not be loaded");
  });
});
