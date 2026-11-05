import {
  LAB_NOT_CONTRACTED_STATEMENT,
  formatRequestCode,
  labRequestVerifyUrl,
  normaliseRequestRef,
  parseRequestProof,
  presentRequestStatus,
} from "./request-verification";

describe("request form verification helpers (T2 Phase 3)", () => {
  it("accepts a token or a typed code, in any case, with spaces and dashes; refuses anything else", () => {
    const token = "ab".repeat(32);
    expect(normaliseRequestRef(token.toUpperCase())).toBe(token);
    expect(normaliseRequestRef("abcde-23456")).toBe("ABCDE23456");
    expect(normaliseRequestRef(" ABCDE 23456 ")).toBe("ABCDE23456");
    // the code alphabet has no 0, O, 1, I, L or U
    expect(normaliseRequestRef("ABCDE2345O")).toBeNull();
    expect(normaliseRequestRef("ABCDE1234L")).toBeNull();
    expect(normaliseRequestRef("ABCDE2345")).toBeNull();
    expect(normaliseRequestRef("'; drop table--")).toBeNull();
    expect(normaliseRequestRef("ab".repeat(31))).toBeNull();
  });

  it("prints the code in two groups and points the QR at the public check", () => {
    expect(formatRequestCode("ABCDE23456")).toBe("ABCDE-23456");
    expect(labRequestVerifyUrl("f".repeat(64))).toMatch(/\/verify-request\/f{64}$/);
  });

  it("parses only a well-formed proof", () => {
    expect(parseRequestProof([])).toBeNull();
    expect(parseRequestProof([{ status: "forged", requested_by: "x" }])).toBeNull();
    const p = parseRequestProof([
      { status: "valid", order_number: "LO-1", issued_on: "2026-11-04", tests: ["HbA1c", 3], patient_initials: "A. O.", requested_by: "Dr X", requester_registration: null },
    ]);
    expect(p).toEqual({
      status: "valid",
      order_number: "LO-1",
      issued_on: "2026-11-04",
      tests: ["HbA1c"],
      patient_initials: "A. O.",
      requested_by: "Dr X",
      requester_registration: null,
    });
  });

  it("never implies the laboratory is contracted or obliged", () => {
    expect(LAB_NOT_CONTRACTED_STATEMENT).toMatch(/no agreement with the laboratory/);
    expect(LAB_NOT_CONTRACTED_STATEMENT).toMatch(/not obliged/);
    expect(LAB_NOT_CONTRACTED_STATEMENT).toMatch(/pays the laboratory directly/);
    for (const s of ["valid", "used", "cancelled"] as const) {
      const v = presentRequestStatus(s);
      expect(`${v.headline} ${v.guidance}`).not.toMatch(/partner|contracted|must accept/i);
    }
    expect(presentRequestStatus("cancelled").tone).toBe("bad");
    // a form a laboratory has already taken a sample against must not read as acceptable to a second laboratory
    expect(presentRequestStatus("used").tone).toBe("bad");
    expect(presentRequestStatus("used").guidance).toMatch(/Do not run these tests again/);
  });
});
