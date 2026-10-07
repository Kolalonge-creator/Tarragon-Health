import { mapDbError, paidTotalKobo, queryOk, reasonOk, recordSchema, searchRowsSchema } from "./model";

describe("input rules", () => {
  it("needs 3 to 80 characters to search", () => {
    expect(queryOk("ab")).toBe(false);
    expect(queryOk("  ab  ")).toBe(false);
    expect(queryOk("abc")).toBe(true);
    expect(queryOk("a".repeat(81))).toBe(false);
  });
  it("needs 10 to 500 characters of reason", () => {
    expect(reasonOk("too short")).toBe(false);
    expect(reasonOk("   padded   ")).toBe(false);
    expect(reasonOk("double charge reported")).toBe(true);
    expect(reasonOk("x".repeat(501))).toBe(false);
  });
});

describe("mapDbError", () => {
  it("maps the codes the functions raise", () => {
    expect(mapDbError("42501", "search")).toBe("denied");
    expect(mapDbError("22023", "search")).toBe("query");
    expect(mapDbError("22023", "open")).toBe("reason");
    expect(mapDbError("P0002", "open")).toBe("not_found");
  });
  it("never shows an unknown database message as written", () => {
    expect(mapDbError("XX000", "open")).toBe("failed");
    expect(mapDbError(undefined, "search")).toBe("failed");
  });
});

describe("paidTotalKobo", () => {
  it("counts only purchases where money changed hands", () => {
    const p = (status: string, amount_kobo: number) => ({ label: "x", amount_kobo, status, purchased_at: null });
    expect(paidTotalKobo([p("active", 100), p("completed", 50), p("pending_payment", 999), p("refunded", 999)])).toBe(150);
  });
});

describe("schemas", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("search rows carry minimal identity only", () => {
    const row = { patient_id: id, full_name: "A", patient_number: "TH-1", phone_masked: "+234***876", birth_year: 1981, is_active: true, is_test: false };
    expect(searchRowsSchema.safeParse([row]).success).toBe(true);
    const stripped = searchRowsSchema.parse([{ ...row, date_of_birth: "1981-03-09", phone: "+2348011119876" }]);
    expect(stripped[0]).not.toHaveProperty("date_of_birth");
    expect(stripped[0]).not.toHaveProperty("phone");
  });
  it("rejects a record with no purchases array", () => {
    expect(recordSchema.safeParse({ id, full_name: null, email: null, date_of_birth: null, sex: null, phone: null, city: null, state: null, patient_number: null, organisation_name: null, is_active: true, is_test: false, created_at: "2026-01-01", last_active_at: null }).success).toBe(false);
  });
});
