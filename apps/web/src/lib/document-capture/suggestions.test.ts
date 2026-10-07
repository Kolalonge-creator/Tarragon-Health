import {
  MAX_FIELD_VALUE_LENGTH,
  MAX_SUGGESTED_FIELDS,
  decisionsForRpc,
  fieldDecisionsSchema,
  normaliseSuggestions,
  summariseDecisions,
  type RawCapture,
  type SuggestedField,
} from "./suggestions";

function raw(fields: RawCapture["fields"], extra: Partial<RawCapture> = {}): RawCapture {
  return { ocr_text: "page text", fields, unreadable_reason: null, ...extra };
}

describe("normaliseSuggestions", () => {
  it("keeps label and value as printed and gives every field a stable key", () => {
    const out = normaliseSuggestions(
      raw([
        { label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" },
        { label: "White cell count", value: "6.0", unit: null, confidence: "medium" },
      ])
    );
    expect(out.fields.map((f) => f.key)).toEqual(["haemoglobin", "white_cell_count"]);
    expect(out.fields[0]).toMatchObject({ label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" });
    expect(out.fields[1]?.unit).toBeNull();
  });

  it("never converts or rounds: the value string is returned exactly (only trimmed)", () => {
    const out = normaliseSuggestions(raw([{ label: "Glucose", value: "  5.50 mmol/L ", confidence: "low" }]));
    expect(out.fields[0]?.value).toBe("5.50 mmol/L");
  });

  it("keeps a repeated label as separate fields with unique keys", () => {
    const out = normaliseSuggestions(
      raw([
        { label: "Blood pressure", value: "120/80", confidence: "high" },
        { label: "Blood pressure", value: "150/95", confidence: "high" },
        { label: "Blood pressure", value: "130/85", confidence: "low" },
      ])
    );
    expect(out.fields.map((f) => f.key)).toEqual(["blood_pressure", "blood_pressure_2", "blood_pressure_3"]);
  });

  it("drops an empty label, an empty value and an over-long value", () => {
    const out = normaliseSuggestions(
      raw([
        { label: "", value: "1", confidence: "high" },
        { label: "Cholesterol", value: "   ", confidence: "high" },
        { label: "Notes", value: "x".repeat(MAX_FIELD_VALUE_LENGTH + 1), confidence: "high" },
        { label: "Urea", value: "4.1", confidence: "high" },
      ])
    );
    expect(out.fields.map((f) => f.key)).toEqual(["urea"]);
  });

  it("caps the number of suggested fields", () => {
    const many = Array.from({ length: MAX_SUGGESTED_FIELDS + 20 }, (_, i) => ({ label: `Test ${i}`, value: String(i), confidence: "low" as const }));
    expect(normaliseSuggestions(raw(many)).fields).toHaveLength(MAX_SUGGESTED_FIELDS);
  });

  it("turns a label with no letters into a usable key", () => {
    expect(normaliseSuggestions(raw([{ label: "###", value: "1", confidence: "low" }])).fields[0]?.key).toBe("field");
  });

  it("carries the unreadable reason and caps the raw text", () => {
    const out = normaliseSuggestions(raw([], { unreadable_reason: " too blurred ", ocr_text: "y".repeat(30000) }));
    expect(out.unreadableReason).toBe("too blurred");
    expect(out.ocrText).toHaveLength(20000);
  });
});

describe("summariseDecisions", () => {
  const fields: SuggestedField[] = [
    { key: "hb", label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" },
    { key: "wbc", label: "White cells", value: "6.0", unit: null, confidence: "low" },
    { key: "plt", label: "Platelets", value: "250", unit: null, confidence: "medium" },
  ];

  it("cannot confirm until at least one field is accepted", () => {
    expect(summariseDecisions(fields, []).canConfirm).toBe(false);
    expect(summariseDecisions(fields, [{ key: "hb", accept: false }]).canConfirm).toBe(false);
  });

  it("counts accepted, edited and dropped fields", () => {
    const s = summariseDecisions(fields, [
      { key: "hb", accept: true, value: "12.4" },
      { key: "wbc", accept: true },
      { key: "plt", accept: false },
    ]);
    expect(s).toEqual({ accepted: 2, edited: 1, dropped: 1, canConfirm: true });
  });

  it("does not call a re-typed identical value an edit", () => {
    expect(summariseDecisions(fields, [{ key: "hb", accept: true, value: "12.1" }]).edited).toBe(0);
  });
});

describe("decisionsForRpc", () => {
  it("sends only keys that exist in the suggestion", () => {
    const fields: SuggestedField[] = [{ key: "hb", label: "Hb", value: "12", unit: null, confidence: "high" }];
    expect(decisionsForRpc(fields, [{ key: "hb", accept: true }, { key: "invented", accept: true, value: "1" }])).toEqual([{ key: "hb", accept: true }]);
  });
});

describe("fieldDecisionsSchema", () => {
  it("refuses an over-long edited value and too many decisions", () => {
    expect(fieldDecisionsSchema.safeParse([{ key: "a", accept: true, value: "x".repeat(MAX_FIELD_VALUE_LENGTH + 1) }]).success).toBe(false);
    expect(fieldDecisionsSchema.safeParse(Array.from({ length: MAX_SUGGESTED_FIELDS + 1 }, (_, i) => ({ key: `k${i}`, accept: true }))).success).toBe(false);
    expect(fieldDecisionsSchema.safeParse([{ key: "a", accept: true, value: "1" }]).success).toBe(true);
  });
});
