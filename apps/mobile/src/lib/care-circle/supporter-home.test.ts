import { hasSharedBlocks, mergePeople } from "./supporter-home";
import { PRIMARY_SECTIONS, SECTIONS, SUPPORTER_PRIMARY_SECTIONS, SUPPORTER_SECTION_IDS, supporterSection } from "../sections";
import { needsDemographics } from "../demographics";
import type { SupportedPerson as CirclePerson } from "./parse";
import type { SupportedPerson as ManagedPerson } from "../acting";

const circle = (id: string, name: string): CirclePerson => ({
  patientId: id,
  memberId: `m-${id}`,
  name,
  relationship: "Mother",
  permissions: ["red_alerts"],
  expiresAt: "2027-06-01T00:00:00Z",
  alertMode: "push_and_app",
});
const managed = (id: string, fullName: string | null): ManagedPerson => ({ profileId: id, fullName, permissionLevel: "manage", isDependentAccount: false, organisationId: null });

describe("supporter home on the phone", () => {
  it("one row per person: the Care Circle and account access for the same person share a card", () => {
    const rows = mergePeople([circle("p1", "Mama Eze"), circle("p2", "Uncle Obi")], [managed("p1", "Mama Eze"), managed("p3", null)]);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    expect(rows[0].circle?.memberId).toBe("m-p1");
    expect(rows[0].managed?.profileId).toBe("p1");
    expect(rows[1].managed).toBeNull();
    expect(rows[2]).toMatchObject({ name: "This person", circle: null });
    expect(mergePeople([], [])).toEqual([]);
  });

  it("knows when a person shared nothing to show (only check-in requests or paying)", () => {
    expect(hasSharedBlocks({}, "en")).toBe(false);
    expect(hasSharedBlocks({ adherence: { taken: 1, due: 2, percent: 50 } }, "en")).toBe(true);
    expect(hasSharedBlocks({ appointments: { nextAt: null, missed30d: 0 } }, "en")).toBe(true);
    // a released doctor's note on its own is something to show, never the empty state
    expect(hasSharedBlocks({ doctorNote: { body: "Reviewed today.", writtenAt: "2026-11-03T10:00:00Z", authorStaffId: null, authorName: null } }, "en")).toBe(true);
    expect(hasSharedBlocks({ doctorNote: null }, "en")).toBe(false);
  });

  it("a supporter-only account opens on the people it supports, with tabs and a menu only for that", () => {
    expect(SUPPORTER_PRIMARY_SECTIONS[0].id).toBe("supporting");
    expect(SUPPORTER_PRIMARY_SECTIONS.length).toBeLessThanOrEqual(PRIMARY_SECTIONS.length);
    for (const s of SUPPORTER_PRIMARY_SECTIONS) expect(SUPPORTER_SECTION_IDS).toContain(s.id);
    // nothing about the supporter's own health is reachable
    for (const id of ["overview", "vitals", "medications", "labs", "myHealth", "passport", "emergency", "community"] as const) {
      expect(SUPPORTER_SECTION_IDS).not.toContain(id);
      expect(supporterSection(id)).toBe("supporting");
    }
    expect(supporterSection("messages")).toBe("messages");
    for (const id of SUPPORTER_SECTION_IDS) expect(SECTIONS.some((s) => s.id === id)).toBe(true);
  });

  it("a supporter-only account is never stopped for a date of birth or sex", () => {
    expect(needsDemographics({ role: "patient", sex: null, dateOfBirth: null, receivesCare: false, isDependent: false })).toBe(false);
    expect(needsDemographics({ role: "patient", sex: null, dateOfBirth: null, receivesCare: true, isDependent: false })).toBe(true);
  });
});
