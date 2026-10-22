import { activePasses, parseCaregiverInvites, parseCaregiverList } from "./caregivers";

const pass = (over: Record<string, unknown> = {}) => ({ pass_id: "p", relationship: "Daughter", state: "accepted", expires_at: "x", present: false, removable: false, name: null, ...over });
const list = (over: Record<string, unknown> = {}) => ({ role: "clinician", live: true, max: 1, passes: [pass()], invitable: [], ...over });

describe("parseCaregiverList", () => {
  it("accepts the shape the database sends", () => {
    expect(parseCaregiverList(list())?.passes[0]?.relationship).toBe("Daughter");
  });

  it("treats anything else as nothing to show, never as a half-rendered list", () => {
    for (const bad of [null, undefined, "x", {}, list({ role: "caregiver" }), list({ passes: [pass({ state: "cancelled" })] }), list({ max: 0 }), list({ passes: "no" })]) {
      expect(parseCaregiverList(bad)).toBeNull();
    }
  });

  it("counts only invited and accepted people against the cap", () => {
    const l = parseCaregiverList(list({ passes: [pass({ state: "invited" }), pass({ state: "accepted" }), pass({ state: "declined" }), pass({ state: "removed" })] }));
    expect(l && activePasses(l).map((p) => p.state)).toEqual(["invited", "accepted"]);
  });
});

describe("parseCaregiverInvites", () => {
  const invite = (over: Record<string, unknown> = {}) => ({
    pass_id: "p", encounter_id: "e", patient_id: "pt", patient_first_name: "Mama", relationship: "Daughter", state: "invited",
    scheduled_at: "x", expires_at: "x", join_opens_at: "x", join_closes_at: "x", joinable: false, final_media_mode: null, ...over,
  });

  it("reads a list of invites", () => {
    expect(parseCaregiverInvites([invite(), invite({ state: "accepted", final_media_mode: "audio_only" })])).toHaveLength(2);
  });

  it("returns an empty list for anything that does not match, including a removed invite", () => {
    expect(parseCaregiverInvites(null)).toEqual([]);
    expect(parseCaregiverInvites([invite({ state: "removed" })])).toEqual([]);
    expect(parseCaregiverInvites({})).toEqual([]);
  });
});
