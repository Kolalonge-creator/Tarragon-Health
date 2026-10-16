import type { CatalogueEntry } from "@tarragon/medicines";
import { lookupNafdacNumber } from "@tarragon/medicines";
import { t } from "@tarragon/i18n";
import {
  applyCatalogueLookup,
  applyPackSuggestion,
  nafdacLineKey,
  packScanAvailable,
  registerPackTextReader,
  scanPackPhoto,
  suggestionsFromText,
} from "./pack-scan";

const NORVASC: CatalogueEntry = {
  id: "c1",
  brandName: "Norvasc",
  genericName: "Amlodipine",
  strength: "5 mg",
  form: "tablet",
  nafdacNumber: "A4-1234",
  isVerified: true,
};
const FORM = { drugName: "", dose: "", nafdacNumber: "" };

afterEach(() => registerPackTextReader(null));

describe("typed NAFDAC number (works today, offline)", () => {
  it("with no catalogue at all the line is neutral and nothing blocks adding", () => {
    expect(nafdacLineKey("A4-1234", [])).toBe("packscan.nafdac.not_matched");
    expect(t("packscan.nafdac.not_matched")).toBe("We could not match this number. You can still add the medicine.");
  });
  it("found and verified gives the honest catalogue line", () => {
    expect(nafdacLineKey("a4-1234", [NORVASC])).toBe("packscan.nafdac.in_catalogue");
    expect(t("packscan.nafdac.in_catalogue")).toBe("This number is in our catalogue.");
  });
  it("an unverified row is not a match", () => {
    expect(nafdacLineKey("A4-1234", [{ ...NORVASC, isVerified: false }])).toBe("packscan.nafdac.not_matched");
  });
  it("empty is silent and nonsense is a gentle invalid line", () => {
    expect(nafdacLineKey("   ", [NORVASC])).toBeNull();
    expect(nafdacLineKey("banana", [NORVASC])).toBe("packscan.nafdac.invalid");
  });
  it("no patient wording calls a medicine genuine, fake, safe or approved on a match or a miss", () => {
    for (const key of ["packscan.nafdac.in_catalogue", "packscan.nafdac.not_matched", "packscan.nafdac.invalid", "packscan.nafdac.use_details"] as const) {
      expect(t(key)).not.toMatch(/genuine|fake|counterfeit|authentic|safe|approved/i);
    }
    // The one line that names authenticity says the match is NOT a check and sends the person to NAFDAC.
    expect(t("packscan.nafdac.not_a_check")).toMatch(/does not tell you whether your pack is genuine\. NAFDAC can/);
  });
  it("pre-fill happens only when applied, and only name and strength", () => {
    const lookup = lookupNafdacNumber("A4-1234", [NORVASC]);
    expect(FORM).toEqual({ drugName: "", dose: "", nafdacNumber: "" });
    expect(applyCatalogueLookup(FORM, lookup)).toEqual({ drugName: "Amlodipine", dose: "5 mg", nafdacNumber: "" });
  });
  it("a miss changes nothing", () => {
    expect(applyCatalogueLookup(FORM, { kind: "not_matched" })).toBe(FORM);
    expect(applyCatalogueLookup(FORM, { kind: "invalid" })).toBe(FORM);
  });
  it("keeps the person's own dose when the catalogue has none and the name is the same", () => {
    const lookup = lookupNafdacNumber("A4-1234", [{ ...NORVASC, strength: null }]);
    expect(applyCatalogueLookup({ drugName: "amlodipine", dose: "10mg", nafdacNumber: "" }, lookup).dose).toBe("10mg");
  });
  it("never leaves a dose typed for another medicine next to the catalogue name", () => {
    const lookup = lookupNafdacNumber("A4-1234", [{ ...NORVASC, strength: null }]);
    expect(applyCatalogueLookup({ drugName: "Metformin", dose: "500 mg", nafdacNumber: "" }, lookup)).toMatchObject({ drugName: "Amlodipine", dose: "" });
  });
  it("keeps the typed name when two rows disagree about it", () => {
    const rows = [NORVASC, { ...NORVASC, id: "c2", genericName: "Lisinopril" }];
    expect(applyCatalogueLookup({ drugName: "Mine", dose: "5 mg", nafdacNumber: "" }, lookupNafdacNumber("A4-1234", rows))).toMatchObject({ drugName: "Mine", dose: "5 mg" });
  });
  it("the unavailable path survives a delete that throws", async () => {
    await expect(scanPackPhoto("file:///p.jpg", [], { discardPhoto: async () => { throw new Error("busy"); } })).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("suggestions are never stored unless the person confirms", () => {
  it("applying one suggestion changes exactly one field and returns a new object", () => {
    const next = applyPackSuggestion(FORM, { field: "nafdacNumber", value: "A4-1234" });
    expect(next).toEqual({ drugName: "", dose: "", nafdacNumber: "A4-1234" });
    expect(next).not.toBe(FORM);
    expect(FORM).toEqual({ drugName: "", dose: "", nafdacNumber: "" });
  });
  it("a different name from the pack clears a strength typed for another medicine; the same name keeps it", () => {
    const form = { drugName: "Metformin", dose: "500 mg", nafdacNumber: "" };
    expect(applyPackSuggestion(form, { field: "drugName", value: "Amlodipine" })).toMatchObject({ drugName: "Amlodipine", dose: "" });
    expect(applyPackSuggestion(form, { field: "drugName", value: "metformin" })).toMatchObject({ dose: "500 mg" });
  });
  it("a suggestion that is rejected (never applied) leaves the form untouched", () => {
    const form = { drugName: "Amlodipine", dose: "10 mg", nafdacNumber: "" };
    const before = JSON.stringify(form);
    suggestionsFromText(["NAFDAC Reg. No. B4-9999", "Metformin 500mg"], [NORVASC]);
    expect(JSON.stringify(form)).toBe(before);
  });
  it("builds number, strength and known-name suggestions from text", () => {
    const s = suggestionsFromText(["NORVASC", "amlodipine 5mg", "NAFDAC Reg. No: A4-1234"], [NORVASC]);
    expect(s.nafdacNumbers[0]).toMatchObject({ value: "A4-1234", source: "labelled" });
    expect(s.strength).toBe("5 mg");
    expect(s.names.map((e) => e.id)).toEqual(["c1"]);
  });
});

describe("camera path is gated behind capability detection", () => {
  it("is unavailable until a native text reader is registered, and the photo is still deleted", async () => {
    expect(packScanAvailable()).toBe(false);
    const discard = jest.fn(async () => undefined);
    expect(await scanPackPhoto("file:///p.jpg", [NORVASC], { discardPhoto: discard })).toEqual({ kind: "unavailable" });
    expect(discard).toHaveBeenCalledWith("file:///p.jpg");
  });
  it("with a reader: returns suggestions only, and deletes the photo afterwards", async () => {
    registerPackTextReader({ recognise: async () => ["NAFDAC Reg. No. A4-1234", "Amlodipine 5mg"] });
    expect(packScanAvailable()).toBe(true);
    const discard = jest.fn(async () => undefined);
    const out = await scanPackPhoto("file:///p.jpg", [NORVASC], { discardPhoto: discard });
    expect(out.kind).toBe("suggestions");
    expect(discard).toHaveBeenCalledTimes(1);
  });
  it("text with nothing useful is 'nothing_read'", async () => {
    registerPackTextReader({ recognise: async () => ["take with water"] });
    expect((await scanPackPhoto("file:///p.jpg", [], { discardPhoto: async () => undefined })).kind).toBe("nothing_read");
  });
  it("a reader that throws is 'failed', never a crash, and the photo is still deleted", async () => {
    registerPackTextReader({ recognise: async () => { throw new Error("native"); } });
    const discard = jest.fn(async () => undefined);
    expect(await scanPackPhoto("file:///p.jpg", [], { discardPhoto: discard })).toEqual({ kind: "failed" });
    expect(discard).toHaveBeenCalledTimes(1);
  });
  it("a failing delete does not turn a good read into an error", async () => {
    registerPackTextReader({ recognise: async () => ["A4-1234"] });
    const out = await scanPackPhoto("file:///p.jpg", [], { discardPhoto: async () => { throw new Error("busy"); } });
    expect(out.kind).toBe("suggestions");
  });
  it("the default delete is best effort and never throws (no native filesystem in tests)", async () => {
    await expect(scanPackPhoto("file:///missing.jpg", [])).resolves.toEqual({ kind: "unavailable" });
  });
});
