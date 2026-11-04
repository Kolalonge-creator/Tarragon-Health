import { buildManualDraft, manualRowsSchema, transcriptRows } from "./manual-entry";

/**
 * CDE-02: typed results go through the same validation as an AI reading. A typed value is never trusted more than a machine one.
 */
describe("buildManualDraft", () => {
  it("converts a typed unit to the catalogue unit, exactly as for an AI reading", () => {
    const draft = buildManualDraft(manualRowsSchema.parse([{ code: "creatinine", value: 105, unit: "umol/l" }]));
    if ("error" in draft) throw new Error(draft.error);
    const [row] = draft.rows;
    expect(row?.code).toBe("creatinine");
    expect(row?.status).toBe("ready");
    expect(row?.converted).toBe(true);
    expect(row?.value).toBeCloseTo(1.19, 1);
    expect(row?.confidence).toBe("high");
  });

  it("surfaces an implausible typed value instead of filing it", () => {
    const draft = buildManualDraft(manualRowsSchema.parse([{ code: "creatinine", value: 9999, unit: "mg/dL" }]));
    if ("error" in draft) throw new Error(draft.error);
    expect(draft.rows[0]?.status).toBe("implausible");
  });

  it("keeps a test outside the catalogue as unmapped, for the doctor to read", () => {
    const draft = buildManualDraft(manualRowsSchema.parse([{ code: "other", label: "Zinc protoporphyrin", value: 80, unit: "ug/dL" }]));
    if ("error" in draft) throw new Error(draft.error);
    expect(draft.rows[0]?.status).toBe("unmapped");
    expect(draft.rows[0]?.code).toBeNull();
    expect(draft.rows[0]?.reportedLabel).toBe("Zinc protoporphyrin");
  });

  it("maps an unlisted name to the catalogue when it is one, and refuses it doubling a listed test", () => {
    const named = buildManualDraft(manualRowsSchema.parse([{ code: "other", label: "Ferritin", value: 80, unit: "ng/mL" }]));
    if ("error" in named) throw new Error(named.error);
    expect(named.rows[0]?.code).toBe("ferritin");
    const doubled = buildManualDraft(
      manualRowsSchema.parse([{ code: "ferritin", value: 80, unit: "ng/mL" }, { code: "other", label: "Serum ferritin", value: 81, unit: "ng/mL" }]),
    );
    expect(doubled).toEqual({ error: expect.stringContaining("entered twice") });
  });

  it("refuses the same test twice and an unknown code", () => {
    const twice = buildManualDraft(manualRowsSchema.parse([{ code: "hba1c", value: 6.1, unit: "%" }, { code: "hba1c", value: 6.2, unit: "%" }]));
    expect(twice).toEqual({ error: expect.stringContaining("entered twice") });
    const unknown = buildManualDraft(manualRowsSchema.parse([{ code: "made_up", value: 1, unit: "x" }]));
    expect(unknown).toEqual({ error: expect.stringContaining("not in the list") });
  });

  it("keeps the lab's own flag, specimen and comment beside each row, in order", () => {
    const draft = buildManualDraft(
      manualRowsSchema.parse([{ code: "hba1c", value: 6.8, unit: "%", labFlag: "high", specimen: "Whole blood", comment: "Fasting" }]),
    );
    if ("error" in draft) throw new Error(draft.error);
    expect(draft.details).toEqual([{ labFlag: "high", specimen: "Whole blood", comment: "Fasting" }]);
  });

  it("requires a result on every row and a name for an unlisted test", () => {
    expect(manualRowsSchema.safeParse([{ code: "hba1c", unit: "%" }]).success).toBe(false);
    expect(manualRowsSchema.safeParse([{ code: "other", value: 3 }]).success).toBe(false);
    expect(manualRowsSchema.safeParse([]).success).toBe(false);
  });
});

describe("transcriptRows", () => {
  it("prints exactly what was typed, not the converted value", () => {
    const rows = transcriptRows(manualRowsSchema.parse([{ code: "creatinine", value: 105, unit: "umol/l", labRange: "62-106", labFlag: "none" }]));
    expect(rows).toEqual([{ test: "Creatinine", result: "105", unit: "umol/l", labRange: "62-106", labFlag: "", specimenComment: "" }]);
  });
});
