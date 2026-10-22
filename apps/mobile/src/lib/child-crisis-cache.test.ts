import { crisisToShow } from "@tarragon/shared";
import { knownCrisisChildren, rememberChildCrisis } from "./child-crisis-cache";

describe("the last known crisis state survives a failed read", () => {
  it("remembers a severe result and forgets it only when a later successful read says it cleared", async () => {
    await rememberChildCrisis("c1", true);
    await rememberChildCrisis("c2", false);
    expect([...(await knownCrisisChildren())]).toEqual(["c1"]);
    await rememberChildCrisis("c1", false);
    expect((await knownCrisisChildren()).size).toBe(0);
  });

  it("a failed or still-loading read shows the lead from what was known; a successful read decides", () => {
    expect(crisisToShow(false, false, true)).toBe(true); // read failed, last known severe: lead stays
    expect(crisisToShow(false, false, false)).toBe(false); // nothing known: no lead invented
    expect(crisisToShow(true, false, true)).toBe(false); // a good read that says it cleared wins
    expect(crisisToShow(true, true, false)).toBe(true);
  });

  it("sabotage: a screen that ignored the cache on a failed read would hide a known crisis", () => {
    const naive = (readOk: boolean, computed: boolean) => (readOk ? computed : false);
    expect(naive(false, false)).toBe(false);
    expect(crisisToShow(false, false, true)).not.toBe(naive(false, false));
  });
});
