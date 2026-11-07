/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import type { StaffContext } from "@/lib/community/model";

const ctxMock = jest.fn<Promise<StaffContext | null>, []>();
jest.mock("@/components/community/staff-rpc", () => ({ getCommunityStaffContext: () => ctxMock() }));
jest.mock("next/navigation", () => ({ usePathname: () => "/community-desk", useSearchParams: () => new URLSearchParams() }));

import CommunityDeskLayout from "./layout";
import { isDeskItemActive } from "./desk-nav";

const none: StaffContext = {
  is_admin: false, is_cmo: false, is_moderator: false, is_senior_moderator: false, is_safety_reviewer: false, is_clinician: false, has_desk: false,
};

async function renderLayout(ctx: StaffContext | null) {
  ctxMock.mockResolvedValue(ctx);
  render(await CommunityDeskLayout({ children: <p>desk content</p> }));
}

describe("Community desk door (COM-31: given a role, not by account)", () => {
  it("refuses a staff account with no Community role and shows none of the desk", async () => {
    await renderLayout({ ...none, is_clinician: true });
    expect(screen.getByText(/given a Community role/)).toBeTruthy();
    expect(screen.queryByText("desk content")).toBeNull();
  });

  it("says the check failed rather than refusing when the role lookup failed", async () => {
    await renderLayout(null);
    expect(screen.getByText(/could not check your Community role/)).toBeTruthy();
    expect(screen.queryByText("desk content")).toBeNull();
  });

  it("opens for a moderator, with the worklist and no admin-only links", async () => {
    await renderLayout({ ...none, is_moderator: true, has_desk: true });
    expect(screen.getByText("desk content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Moderation worklist" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Safety$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Rota/ })).toBeNull();
  });

  it("shows the Safety section to a safety reviewer and the configuration links to an admin", async () => {
    await renderLayout({ ...none, is_safety_reviewer: true, is_admin: true, has_desk: true });
    expect(screen.getByRole("link", { name: "Safety" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rota/ }).getAttribute("href")).toBe("/admin/community/rota");
  });
});

describe("desk menu active state", () => {
  const overview = { label: "Overview", href: "/community-desk", exact: true };
  const queue = { label: "Moderation worklist", href: "/community-desk/queue" };
  const safety = { label: "Safety", href: "/community-desk/queue?tab=safety", matchTab: "safety" };
  it("marks exactly one of overview, worklist and safety", () => {
    expect(isDeskItemActive(overview, "/community-desk", null)).toBe(true);
    expect(isDeskItemActive(overview, "/community-desk/queue", null)).toBe(false);
    expect(isDeskItemActive(queue, "/community-desk/queue", "moderation")).toBe(true);
    expect(isDeskItemActive(queue, "/community-desk/queue", "safety")).toBe(false);
    expect(isDeskItemActive(safety, "/community-desk/queue", "safety")).toBe(true);
    expect(isDeskItemActive(safety, "/community-desk/queue", null)).toBe(false);
  });
});
