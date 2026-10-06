import { parseInbox, collectionErrorKey, dispenseReasonText, medicineNames, parseMyPharmacy, parsePharmacyOptions, parseSendResult, staffErrorText } from "./collection";

describe("pharmacy collection parsers", () => {
  it("reads what the patient sees, and rejects a malformed state rather than guessing", () => {
    expect(parseMyPharmacy({ sent: false, state: "signed" })).toEqual({ sent: false, state: "signed" });
    expect(parseMyPharmacy({ sent: true, state: "sent", pharmacy_name: "A", collection_code: "K7M2QX9P", needs_other_pharmacy: false })).toMatchObject({ sent: true });
    expect(parseMyPharmacy({ sent: true, state: "sent" })).toBeNull();
    expect(parseMyPharmacy(null)).toBeNull();
    expect(parseMyPharmacy("sent")).toBeNull();
  });

  it("rejects an option with an unknown stock value", () => {
    expect(parsePharmacyOptions([{ stock: "plenty" }])).toBeNull();
    expect(parsePharmacyOptions("x")).toBeNull();
    expect(parsePharmacyOptions([])).toEqual([]);
  });

  it("accepts only an 8 character code", () => {
    expect(parseSendResult({ collection_code: "K7M2QX9P", pharmacy_name: "A" })).toEqual({ code: "K7M2QX9P", pharmacyName: "A" });
    expect(parseSendResult({ collection_code: "K7M2", pharmacy_name: "A" })).toBeNull();
  });

  it("lists medicine names only, and survives junk", () => {
    expect(medicineNames([{ drug_name: "Amlodipine", dose: "5 mg", indication: "x" }, { drug_name: "Losartan" }])).toEqual(["Amlodipine", "Losartan"]);
    expect(medicineNames("nope")).toEqual([]);
    expect(medicineNames([{ dose: "5 mg" }])).toEqual([]);
  });

  it("never shows the database's own words", () => {
    expect(collectionErrorKey("consent_required")).toBe("pharmacy.error.consent");
    expect(collectionErrorKey(null)).toBe("pharmacy.error");
    expect(collectionErrorKey("prescription_not_current")).toBe("pharmacy.error.not_current");
    expect(staffErrorText("pharmacy_not_active")).toMatch(/not active/);
    expect(staffErrorText("pharmacy_collection_off")).toBe("Pharmacy collection is not switched on yet.");
    expect(staffErrorText("note_too_long")).toBe("Please keep the note under 500 characters.");
    expect(staffErrorText(undefined)).toBe("That could not be done. Please try again.");
    expect(dispenseReasonText(undefined)).toBe("That could not be recorded. Please try again.");
    expect(dispenseReasonText("not_active")).toMatch(/no longer active/);
  });
});

describe("parseInbox", () => {
  const ok = { prescription_id: "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11", collection_code: "K7M2QX9P", state: "sent", sent_at: null, dispensed_at: null, first_name: "Ada", medicine_count: 1, has_open_flag: false, is_test: false };
  it("reads a good inbox and treats none as empty", () => {
    expect(parseInbox([ok])).toEqual([ok]);
    expect(parseInbox(null)).toEqual([]);
  });
  it("an unreadable inbox is a failed read, never an empty list", () => {
    expect(parseInbox([{ ...ok, state: "weird" }])).toBeNull();
    expect(parseInbox("x")).toBeNull();
  });
});
