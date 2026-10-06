import { en, pcm } from "@tarragon/i18n";
import {
  CIRCLE_PERMISSIONS, circleErrorKey, inviteLinkPath, parseAccept, parseMyCircle, parseOpenAlerts, parsePreview, parseSupported,
  parseSupporterView, parseViewLog, permissionKey,
} from "./model";

describe("care circle model", () => {
  it("every permission has copy in both languages", () => {
    for (const p of CIRCLE_PERMISSIONS) {
      expect(en[permissionKey(p)].length).toBeGreaterThan(0);
      expect(pcm[permissionKey(p)].length).toBeGreaterThan(0);
    }
  });

  it("parses a circle and falls back to empty on a shape it does not know", () => {
    const ok = parseMyCircle({
      members: [{ member_id: "m", name: "Ada", relationship: "Daughter", permissions: ["red_alerts"], expires_at: "2027-01-01T00:00:00Z", since: "2026-10-01T00:00:00Z" }],
      invites: [],
    });
    expect(ok.members).toHaveLength(1);
    expect(parseMyCircle({ members: [{ permissions: ["view_results"] }], invites: [] })).toEqual({ members: [], invites: [] });
    expect(parseMyCircle(null)).toEqual({ members: [], invites: [] });
  });

  it("drops a supported-person row that carries a legacy or unknown permission, keeps the rest", () => {
    const good = { patient_id: "p", member_id: "m", name: "Mum", relationship: "Mother", permissions: ["pay_for_care"], expires_at: "2027-01-01T00:00:00Z" };
    expect(parseSupported([good, { ...good, permissions: ["view_results"] }, 5])).toEqual([good]);
    expect(parseSupported("nope")).toEqual([]);
  });

  it("the supporter view keeps a missing block missing (not shared is never rendered as zero)", () => {
    const v = parseSupporterView({ patient_id: "p", name: "Mum", relationship: "Mother", permissions: ["adherence_summary"], shared_until: "2027-01-01T00:00:00Z", adherence: { days: 7, taken: 3, due: 4, percent: 75 } });
    expect(v?.adherence?.percent).toBe(75);
    expect(v?.bp_trend).toBeUndefined();
    expect(v?.appointments).toBeUndefined();
    expect(parseSupporterView({ error: "x" })).toBeNull();
    expect(parseSupporterView(null)).toBeNull();
  });

  it("the supporter view type has no field that could carry a single reading", () => {
    const v = parseSupporterView({
      patient_id: "p", name: "Mum", relationship: "Mother", permissions: ["weekly_bp_trend"], shared_until: "2027-01-01T00:00:00Z",
      bp_trend: { weeks: [{ week_start: "2026-10-05", systolic: 141, diastolic: 90, readings: 3, taken_at: "2026-10-06T10:00:00Z", note: "dizzy" }], direction: "steady" },
    });
    expect(JSON.stringify(v)).not.toMatch(/taken_at|dizzy/);
  });

  it("parses alerts, the view log, the preview and the accept reply defensively", () => {
    expect(parseOpenAlerts([{ patient_id: "p", name: "Mum", since: "t" }, { nope: 1 }])).toHaveLength(1);
    expect(parseViewLog([{ viewer: "Ada", at: "t" }, null])).toHaveLength(1);
    expect(parsePreview({ ok: false })).toEqual({ ok: false });
    expect(parsePreview("garbage")).toEqual({ ok: false });
    expect(parsePreview({ ok: true, inviter_first_name: "Ngozi", relationship: "Daughter", permissions: ["red_alerts"], grant_days: 365, expires_at: "t" }).ok).toBe(true);
    expect(parseAccept({ ok: true, patient_id: "p", member_id: "m" }).ok).toBe(true);
    expect(parseAccept(undefined)).toEqual({ ok: false });
  });

  it("maps database refusals to copy and everything else to the generic message", () => {
    expect(circleErrorKey("invite_rate_limited")).toBe("circle.error.invite_rate_limited");
    expect(circleErrorKey("ERROR: circle_full")).toBe("circle.error.circle_full");
    expect(circleErrorKey("something odd")).toBe("circle.error.unknown");
    expect(circleErrorKey(undefined)).toBe("circle.error.unknown");
  });

  it("puts the token in the path, encoded, never in a query string", () => {
    const link = inviteLinkPath("abc-DEF_123");
    expect(link).toBe("/patient/supporting/join/abc-DEF_123");
    expect(link).not.toContain("?");
    expect(inviteLinkPath("a/b")).toBe("/patient/supporting/join/a%2Fb");
  });
});
