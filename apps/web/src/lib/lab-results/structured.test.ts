import {
  describeLabError,
  disclosureSchema,
  formatRange,
  refusalOf,
  myLabResultsSchema,
  resultEntrySchema,
  validateLabResultFile,
  withholdSchema,
} from "./structured";

const id = "11111111-1111-4111-8111-111111111111";

describe("validateLabResultFile", () => {
  it("accepts a PDF, JPG and PNG under 10 MB", () => {
    for (const type of ["application/pdf", "image/jpeg", "image/png"]) expect(validateLabResultFile({ type, size: 1000 })).toBeNull();
  });
  it("refuses other types (the bucket allows only these three), empty and oversized files", () => {
    expect(validateLabResultFile({ type: "image/heic", size: 1000 })).not.toBeNull();
    expect(validateLabResultFile({ type: "application/x-msdownload", size: 1000 })).not.toBeNull();
    expect(validateLabResultFile({ type: "application/pdf", size: 0 })).not.toBeNull();
    expect(validateLabResultFile({ type: "application/pdf", size: 10 * 1024 * 1024 + 1 })).not.toBeNull();
  });
});

describe("resultEntrySchema", () => {
  it("accepts numeric and qualitative items and carries no flag field", () => {
    const r = resultEntrySchema.safeParse({ orderId: id, panel: "essential", items: [{ analyte_code: "creatinine", value_numeric: 0.9, unit: "mg/dL" }, { analyte_code: "hbsag", value_text: "negative" }] });
    expect(r.success).toBe(true);
  });
  it("strips a flag the lab tries to send, so it can never reach the database", () => {
    const r = resultEntrySchema.parse({ orderId: id, panel: "essential", items: [{ analyte_code: "creatinine", value_numeric: 9, flag: "normal" }] });
    expect(JSON.stringify(r)).not.toContain("flag");
  });
  it("refuses an item with both or neither value, an unknown panel and free text", () => {
    expect(resultEntrySchema.safeParse({ orderId: id, panel: "essential", items: [{ analyte_code: "alt", value_numeric: 1, value_text: "positive" }] }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ orderId: id, panel: "essential", items: [{ analyte_code: "alt" }] }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ orderId: id, panel: "other", items: [] }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ orderId: id, panel: "essential", items: [{ analyte_code: "hbsag", value_text: "indeterminate" }] }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ orderId: id, panel: "essential", items: [{ analyte_code: "alt", value_numeric: -1 }] }).success).toBe(false);
  });
});

describe("disclosure and withhold forms", () => {
  it("a disclosure needs the attestation and a known method", () => {
    expect(disclosureSchema.safeParse({ resultId: id, method: "in_person", attested: true }).success).toBe(true);
    expect(disclosureSchema.safeParse({ resultId: id, method: "in_person" }).success).toBe(false);
    expect(disclosureSchema.safeParse({ resultId: id, method: "whatsapp", attested: true }).success).toBe(false);
  });
  it("a withhold needs a reason", () => {
    expect(withholdSchema.safeParse({ resultId: id, reason: " " }).success).toBe(false);
    expect(withholdSchema.safeParse({ resultId: id, reason: "Wrong patient" }).success).toBe(true);
  });
});

describe("describeLabError", () => {
  it("maps the stable codes to plain words and never echoes raw database text", () => {
    expect(describeLabError({ message: "lab_unit_mismatch" })).toMatch(/unit/);
    expect(describeLabError({ message: "lab_disclosure_needs_senior_clinician" })).toMatch(/senior/);
    expect(describeLabError({ message: "Not permitted" })).toMatch(/access/);
    const generic = describeLabError({ message: 'relation "lab_results" does not exist' });
    expect(generic).not.toMatch(/relation/);
  });
});

describe("myLabResultsSchema", () => {
  it("parses what my_lab_results returns and refuses an unknown status", () => {
    const row = { lab_result_id: id, received_at: "2026-10-06T10:00:00Z", panel_code: null, own_upload: false, status: "released", explain_allowed: true, has_file: false, items: [] };
    expect(myLabResultsSchema.safeParse([row]).success).toBe(true);
    expect(myLabResultsSchema.safeParse([{ ...row, status: "awaiting_review" }]).success).toBe(false);
  });
});

describe("formatRange", () => {
  it("writes a two sided, one sided and empty range", () => {
    expect(formatRange(70, 99, "mg/dL")).toBe("70 to 99 mg/dL");
    expect(formatRange(null, 200, "mg/dL")).toBe("up to 200 mg/dL");
    expect(formatRange(40, null, "mg/dL")).toBe("40 or more mg/dL");
    expect(formatRange(null, null, "")).toBe("");
  });
});

describe("refusalOf", () => {
  it("recognises the returned refusal and nothing else", () => {
    expect(refusalOf({ error: "not_permitted" })).toMatch(/access/);
    expect(refusalOf({ ok: true })).toBeNull();
    expect(refusalOf(null)).toBeNull();
  });
});
