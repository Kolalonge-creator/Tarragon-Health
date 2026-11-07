import { communityDeskQueueHref, showsCommunityEntry, withCommunityNav } from "./community-nav";
import type { NavSection } from "@/lib/navigation";
import type { StaffContext } from "@/lib/community/model";

const none: StaffContext = {
  is_admin: false, is_cmo: false, is_moderator: false, is_senior_moderator: false, is_safety_reviewer: false, is_clinician: false, has_desk: false,
};
const desk: StaffContext = { ...none, is_moderator: true, has_desk: true };
const sections: NavSection[] = [{ items: [{ label: "Dashboard", href: "/x", icon: "dashboard" }] }, { label: "Team", items: [] }];

describe("Community desk nav gating (COM-31: given a role, not by account)", () => {
  it("shows to any staff role the database says has the desk", () => {
    for (const role of ["care_coordinator", "clinician", "analyst", "finance"]) {
      expect(showsCommunityEntry(role, desk)).toBe(true);
      expect(showsCommunityEntry(role, none)).toBe(false);
    }
  });
  it("does not show to a clinician just for being a clinician or the CMO flag alone without the desk", () => {
    expect(showsCommunityEntry("clinician", { ...none, is_clinician: true })).toBe(false);
  });
  it("never shows when the lookup failed, for a patient, or for admin (admin's static menu carries it)", () => {
    expect(showsCommunityEntry("clinician", null)).toBe(false);
    expect(showsCommunityEntry("patient", desk)).toBe(false);
    expect(showsCommunityEntry("admin", { ...desk, is_admin: true })).toBe(false);
  });
  it("adds one link in the right place and leaves the input alone", () => {
    const out = withCommunityNav(sections, "clinician", desk);
    expect(out[1].items.map((i) => i.href)).toEqual(["/community-desk"]);
    expect(sections[1].items).toHaveLength(0);
    const fin = withCommunityNav(sections, "finance", desk);
    expect(fin[0].items.at(-1)?.href).toBe("/community-desk");
  });
  it("does not add a second link if the menu already has one", () => {
    const once = withCommunityNav(sections, "finance", desk);
    expect(withCommunityNav(once, "finance", desk)).toBe(once);
  });
  it("returns the sections unchanged when not relevant", () => {
    expect(withCommunityNav(sections, "clinician", none)).toBe(sections);
  });
  it("builds queue links with an encoded tab", () => {
    expect(communityDeskQueueHref()).toBe("/community-desk/queue");
    expect(communityDeskQueueHref("safety")).toBe("/community-desk/queue?tab=safety");
    expect(communityDeskQueueHref("a&b")).toBe("/community-desk/queue?tab=a%26b");
  });
});
