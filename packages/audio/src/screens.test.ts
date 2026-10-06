import { describe, expect, it } from "@jest/globals";
import { HLP_CLIPS, NAV_CLIPS, tourOffer, type NavTab } from "./screens";
import { realManifest } from "./test-helpers";

describe("screen to clip maps", () => {
  const byId = new Map(realManifest().clips.map((c) => [c.id, c]));

  it("point only at clips in the manifest, one screen per clip", () => {
    for (const id of [...Object.values(NAV_CLIPS), ...Object.values(HLP_CLIPS)]) expect([id, byId.has(id)]).toEqual([id, true]);
    expect(new Set(Object.values(HLP_CLIPS)).size).toBe(Object.keys(HLP_CLIPS).length);
  });

  it("cover every HLP and NAV clip the manifest holds", () => {
    const mapped = new Set<string>([...Object.values(NAV_CLIPS), ...Object.values(HLP_CLIPS)]);
    const held = [...byId.values()].filter((c) => c.group === "HLP" || c.group === "NAV").map((c) => c.id);
    expect(held.filter((id) => !mapped.has(id))).toEqual([]);
    expect(Object.keys(NAV_CLIPS)).toHaveLength(7);
    expect(Object.keys(HLP_CLIPS)).toHaveLength(41);
  });

  it("downloads them after sign-up, and keeps later-release help off the phone until then", () => {
    expect(byId.get(NAV_CLIPS.home)!.bundle_group).toBe("post_signup");
    expect(byId.get(HLP_CLIPS.today)!.bundle_group).toBe("post_signup");
    expect(byId.get(HLP_CLIPS.pregnancy_tracker)!.release).toBe(3);
  });

  it("offers a walkthrough once per tab", () => {
    const seen = new Set<NavTab>(["home"]);
    expect(tourOffer("home", seen)).toBeNull();
    expect(tourOffer("care", seen)).toBe("NAV-003");
  });
});
