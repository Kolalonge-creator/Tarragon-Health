import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aggregate,
  formatReport,
  matchesValue,
  scoreCase,
  type ActualRow,
  type ExpectedReport,
} from "./accuracy";
import { isReadableDocumentType, normaliseForVision } from "./heic";

/**
 * The scorer is the instrument the whole accuracy programme is read off. If it
 * flatters the engine, every number it produces is worthless — so it is tested
 * harder than the thing it measures, with particular attention to the two
 * outcomes that are allowed to fail a run.
 */

const row = (over: Partial<ActualRow> & { code: string }): ActualRow => ({
  value: null,
  valueText: null,
  status: "ready",
  reportedLabel: over.code.toUpperCase(),
  ...over,
});

const report = (analytes: ExpectedReport["analytes"]): ExpectedReport => ({
  lab: "Synlab Nigeria",
  analytes,
});

describe("matchesValue", () => {
  it("tolerates the rounding unit conversion introduces", () => {
    // 5.2 mmol/L x 38.67 = 201.084, hand-keyed from the page as 201.
    expect(matchesValue(201, 201.08)).toBe(true);
  });

  it("does not tolerate a genuinely different number", () => {
    // A digit misread moves a value far further than the tolerance.
    expect(matchesValue(11.2, 11.8)).toBe(false);
    expect(matchesValue(250, 350)).toBe(false);
  });

  it("keeps a floor so small values are not compared to nothing", () => {
    // Half a percent of 0.3 is 0.0015, which would fail on ordinary rounding of
    // a direct bilirubin. The 0.01 floor is what makes small analytes workable.
    // Asserted away from the boundary itself: comparing exactly at 0.01 tests
    // float representation, not the rule.
    expect(matchesValue(0.3, 0.305)).toBe(true);
    expect(matchesValue(0.3, 0.35)).toBe(false);
  });
});

describe("scoreCase", () => {
  it("scores a correct numeric reading", () => {
    const s = scoreCase("c1", report([{ code: "haemoglobin", value: 11.2 }]), [
      row({ code: "haemoglobin", value: 11.2 }),
    ]);
    expect(s.counts.correct).toBe(1);
    expect(s.counts.wrong).toBe(0);
  });

  it("scores a misread value as WRONG, not as a miss", () => {
    // This is the distinction the whole harness exists for: a filable number
    // that is wrong is harmful, and must never be filed under "missed".
    const s = scoreCase("c1", report([{ code: "haemoglobin", value: 11.2 }]), [
      row({ code: "haemoglobin", value: 1.12 }),
    ]);
    expect(s.counts.wrong).toBe(1);
    expect(s.counts.missed).toBe(0);
    expect(s.scores[0]!.detail).toContain("should be 11.2");
  });

  it("scores a reading the engine held back as BLOCKED, not wrong", () => {
    // The guards firing is the engine working. Scoring it as a harmful failure
    // would push future work toward disabling the guards.
    const s = scoreCase("c1", report([{ code: "haemoglobin", value: 11.2 }]), [
      row({ code: "haemoglobin", value: 112, status: "implausible" }),
    ]);
    expect(s.counts.blocked).toBe(1);
    expect(s.counts.wrong).toBe(0);
  });

  it("scores an analyte the engine never produced as MISSED", () => {
    const s = scoreCase("c1", report([{ code: "platelets", value: 250 }]), []);
    expect(s.counts.missed).toBe(1);
  });

  it("scores an invented filable reading as SPURIOUS", () => {
    // A value nobody wrote on the truth sheet, offered as ready to file, is the
    // single most dangerous thing this engine can produce.
    const s = scoreCase("c1", report([{ code: "haemoglobin", value: 11.2 }]), [
      row({ code: "haemoglobin", value: 11.2 }),
      row({ code: "potassium", value: 6.9 }),
    ]);
    expect(s.counts.spurious).toBe(1);
    expect(s.counts.correct).toBe(1);
  });

  it("does not count a held-back extra reading as spurious", () => {
    // The engine read something it should not have AND refused it. That is the
    // guards working, not an invented result.
    const s = scoreCase("c1", report([{ code: "haemoglobin", value: 11.2 }]), [
      row({ code: "haemoglobin", value: 11.2 }),
      row({ code: "potassium", value: 99, status: "implausible" }),
    ]);
    expect(s.counts.spurious).toBe(0);
  });

  it("scores qualitative results on the coded value", () => {
    const ok = scoreCase("c1", report([{ code: "genotype", valueText: "AS" }]), [
      row({ code: "genotype", valueText: "AS" }),
    ]);
    expect(ok.counts.correct).toBe(1);

    const bad = scoreCase("c1", report([{ code: "genotype", valueText: "AS" }]), [
      row({ code: "genotype", valueText: "AA" }),
    ]);
    expect(bad.counts.wrong).toBe(1);
    expect(bad.scores[0]!.detail).toContain('should be "AS"');
  });
});

describe("aggregate", () => {
  const cases = [
    scoreCase(
      "synlab-01",
      { lab: "Synlab", analytes: [{ code: "haemoglobin", value: 11.2 }, { code: "platelets", value: 250 }] },
      [row({ code: "haemoglobin", value: 11.2 }), row({ code: "platelets", value: 250 })],
    ),
    scoreCase(
      "afriglobal-01",
      { lab: "Afriglobal", analytes: [{ code: "haemoglobin", value: 13.0 }, { code: "wbc", value: 5.4 }] },
      [row({ code: "haemoglobin", value: 3.0 }), row({ code: "wbc", value: 5.4, status: "unknown_unit" })],
    ),
  ];

  it("computes recall over everything on the truth sheets", () => {
    const r = aggregate(cases);
    // Four readings keyed across two cases: two read correctly, one misread,
    // one held back by the unknown-unit guard.
    expect(r.totals.correct).toBe(2);
    expect(r.totals.wrong).toBe(1);
    expect(r.totals.blocked).toBe(1);
    expect(r.recall).toBeCloseTo(0.5, 5);
  });

  it("computes the harmful rate over what was OFFERED, not over the page", () => {
    // Three readings were offered as filable (2 correct + 1 wrong), so a third
    // of what a clinician could have filed was wrong. Dividing by everything on
    // the page instead would report 25% and understate the risk, because a
    // reading the engine held back was never offered to anyone.
    const r = aggregate(cases);
    expect(r.harmfulRate).toBeCloseTo(1 / 3, 5);
    expect(r.precision).toBeCloseTo(2 / 3, 5);
  });

  it("ranks the weakest analytes first so effort goes where failures are", () => {
    const r = aggregate(cases);
    expect(r.byAnalyte[0]!.recall).toBeLessThanOrEqual(r.byAnalyte.at(-1)!.recall);
  });

  it("breaks results down per laboratory, which is what the corpus is for", () => {
    const r = aggregate(cases);
    expect(r.byLab.map((l) => l.lab).sort()).toEqual(["Afriglobal", "Synlab"]);
  });

  it("names every harmful reading in the printed report", () => {
    const text = formatReport(aggregate(cases));
    expect(text).toContain("HARMFUL RATE");
    expect(text).toContain("afriglobal-01");
    expect(text).toContain("haemoglobin");
  });
});

describe("HEIC normalisation", () => {
  it("accepts the types an iPhone and a scanner actually produce", () => {
    for (const t of ["image/heic", "image/heif", "image/jpeg", "application/pdf"]) {
      expect(isReadableDocumentType(t)).toBe(true);
    }
    expect(isReadableDocumentType("image/tiff")).toBe(false);
    expect(isReadableDocumentType(null)).toBe(false);
  });

  it("converts a real HEIC into a JPEG the vision model can read", async () => {
    // A genuine HEIC, not a renamed JPEG: the upload path and the storage
    // bucket have always accepted image/heic while the model could not read it,
    // so every iPhone upload failed straight into "type it in by hand".
    const heic = readFileSync(path.join(__dirname, "__fixtures__", "sample.heic"));
    expect(heic.subarray(4, 8).toString()).toBe("ftyp");

    const out = await normaliseForVision(heic, "image/heic");
    expect(out.converted).toBe(true);
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.buffer.subarray(0, 3).toString("hex").toUpperCase()).toBe("FFD8FF");
  }, 30_000);

  it("passes an already-readable file through untouched", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const out = await normaliseForVision(jpeg, "image/jpeg");
    expect(out.converted).toBe(false);
    expect(out.buffer).toBe(jpeg);
  });

  it("returns the original bytes when conversion cannot work, never throws", async () => {
    // Degrading to the previous behaviour is the contract: this module can only
    // turn a guaranteed failure into a possible success, never the reverse.
    const notReallyHeic = Buffer.from("this is not an image at all");
    const out = await normaliseForVision(notReallyHeic, "image/heic");
    expect(out.converted).toBe(false);
    expect(out.buffer).toBe(notReallyHeic);
  }, 30_000);
});
