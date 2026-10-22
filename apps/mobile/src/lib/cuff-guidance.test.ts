import { parseCuffGuidance } from "./cuff-guidance";

const CONFIG = {
  sizes: [
    { key: "small_adult", minCm: 22, maxCm: 26 },
    { key: "adult", minCm: 27, maxCm: 34 },
  ],
  measureMinCm: 15,
  measureMaxCm: 60,
};

describe("cuff guidance answer (S07y)", () => {
  it("is null for the server's 'not signed yet' answer and for anything malformed, so the step never shows", () => {
    expect(parseCuffGuidance(null)).toBeNull();
    expect(parseCuffGuidance({})).toBeNull();
    expect(parseCuffGuidance({ version: 1, config: { sizes: [] }, cuff: null })).toBeNull();
    expect(parseCuffGuidance("x")).toBeNull();
  });

  it("reads a signed answer with no cuff recorded yet", () => {
    expect(parseCuffGuidance({ version: 1, config: CONFIG, cuff: null })).toMatchObject({ version: 1, cuff: null });
  });

  it("reads the recorded cuff and ignores an unknown cuff type or list answer", () => {
    const g = parseCuffGuidance({ version: 2, config: CONFIG, cuff: { cuff_type: "upper_arm", model: "Omron M2", arm_cm: 30, size_key: "adult", device_list: "list_empty" } });
    expect(g?.cuff).toEqual({ cuffType: "upper_arm", model: "Omron M2", armCm: 30, sizeKey: "adult", deviceList: "list_empty" });
    expect(parseCuffGuidance({ version: 2, config: CONFIG, cuff: { cuff_type: "finger" } })?.cuff).toBeNull();
    expect(parseCuffGuidance({ version: 2, config: CONFIG, cuff: { cuff_type: "wrist", device_list: "validated" } })?.cuff?.deviceList).toBeNull();
  });
});
