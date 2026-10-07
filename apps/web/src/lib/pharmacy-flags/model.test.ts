import { asNotice, flagFormSchema, itemLine, pharmacyPrescriptionRowsSchema, prescriberFlagRowsSchema } from "./model";

const ID = "11111111-1111-4111-8111-111111111111";

describe("flagFormSchema", () => {
  it("accepts a known kind and a trimmed reason of 10 to 500 characters", () => {
    const r = flagFormSchema.safeParse({ prescription: ID, kind: "out_of_stock", reason: "  Not in stock until Thursday  " });
    expect(r.success && r.data.reason).toBe("Not in stock until Thursday");
  });
  it("refuses a short reason, a long reason, an unknown kind and a bad id", () => {
    expect(flagFormSchema.safeParse({ prescription: ID, kind: "other", reason: "too short" }).success).toBe(false);
    expect(flagFormSchema.safeParse({ prescription: ID, kind: "other", reason: "x".repeat(501) }).success).toBe(false);
    expect(flagFormSchema.safeParse({ prescription: ID, kind: "dispensed", reason: "A long enough reason" }).success).toBe(false);
    expect(flagFormSchema.safeParse({ prescription: "nope", kind: "other", reason: "A long enough reason" }).success).toBe(false);
  });
  it("a reason of only spaces does not count", () => {
    expect(flagFormSchema.safeParse({ prescription: ID, kind: "other", reason: " ".repeat(20) }).success).toBe(false);
  });
});

describe("row schemas", () => {
  it("parses a pharmacy row and refuses a draft state", () => {
    const row = { prescription_id: ID, state: "sent", collection_code: "AB12", sent_at: null, dispensed_at: null, patient_name: "A", patient_number: "TH1", items: [{ drug: "X" }], open_flags: 0 };
    expect(pharmacyPrescriptionRowsSchema.safeParse([row]).success).toBe(true);
    expect(pharmacyPrescriptionRowsSchema.safeParse([{ ...row, state: "draft" }]).success).toBe(false);
  });
  it("a malformed prescriber row is a parse failure, not an empty list", () => {
    expect(prescriberFlagRowsSchema.safeParse([{ flag_id: ID }]).success).toBe(false);
  });
});

describe("itemLine", () => {
  it("joins the common keys and falls back safely", () => {
    expect(itemLine({ drug: "Drug", dose: "5 mg", frequency: "daily" })).toBe("Drug - 5 mg, daily");
    expect(itemLine({ other: 1 })).toBe("Item");
  });
});

describe("asNotice", () => {
  it("only a known notice id is shown", () => {
    expect(asNotice("flagged")).toBe("flagged");
    expect(asNotice("<script>")).toBeNull();
  });
});
