import { showsCommunityEntry, withCommunityNav } from "./community-nav";
import type { NavSection } from "@/lib/navigation";
import type { StaffContext } from "@/lib/community/model";

const none: StaffContext = { is_admin: false, is_cmo: false, is_moderator: false, is_safety_reviewer: false, is_clinician: false };
const sections: NavSection[] = [{ items: [{ label: "Dashboard", href: "/x", icon: "dashboard" }] }, { label: "My work", items: [] }];

describe("Community nav gating", () => {
  it("shows to a care coordinator only with a moderator or safety reviewer duty", () => {
    expect(showsCommunityEntry("care_coordinator", none)).toBe(false);
    expect(showsCommunityEntry("care_coordinator", { ...none, is_moderator: true })).toBe(true);
    expect(showsCommunityEntry("care_coordinator", { ...none, is_safety_reviewer: true })).toBe(true);
    expect(showsCommunityEntry("care_coordinator", { ...none, is_clinician: true, is_cmo: true })).toBe(false);
  });
  it("shows to a clinician who is the CMO or an active clinician", () => {
    expect(showsCommunityEntry("clinician", none)).toBe(false);
    expect(showsCommunityEntry("clinician", { ...none, is_clinician: true })).toBe(true);
    expect(showsCommunityEntry("clinician", { ...none, is_cmo: true })).toBe(true);
    expect(showsCommunityEntry("clinician", { ...none, is_moderator: true })).toBe(false);
  });
  it("never shows when the lookup failed or for other roles", () => {
    expect(showsCommunityEntry("clinician", null)).toBe(false);
    expect(showsCommunityEntry("admin", { ...none, is_admin: true })).toBe(false);
    expect(showsCommunityEntry("patient", { ...none, is_moderator: true })).toBe(false);
  });
  it("adds one link in the right place and leaves the input alone", () => {
    const out = withCommunityNav(sections, "clinician", { ...none, is_clinician: true });
    expect(out[1].items.map((i) => i.label)).toEqual(["Community"]);
    expect(out[1].items[0].href).toBe("/clinician/community");
    expect(sections[1].items).toHaveLength(0);
    const cc = withCommunityNav(sections, "care_coordinator", { ...none, is_moderator: true });
    expect(cc[0].items.at(-1)?.href).toBe("/dashboard/care-coordinator/community");
  });
  it("returns the sections unchanged when not relevant", () => {
    expect(withCommunityNav(sections, "clinician", none)).toBe(sections);
  });
});
