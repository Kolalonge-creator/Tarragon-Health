import {
  NOT_FOUND_MESSAGE,
  SUPPLY_OUTCOME_MESSAGE,
  TOKEN_PATTERN,
  describeSupply,
  isSupplyOutcome,
  parseProof,
  presentStatus,
} from "./public-verification";
import { prescriptionVerifyUrl } from "./verify-url";

const proof = {
  status: "active",
  rx_number: "TRG-RX-2026-000366",
  drug_name: "Amlodipine",
  dose: "5 mg",
  frequency: "Once daily",
  quantity: "30 tablets",
  duration_days: 30,
  repeats_allowed: 2,
  repeats_used: 1,
  repeats_remaining: 1,
  supplies_dispensed: 1,
  supplies_permitted: 2,
  supply_available: true,
  last_supplied_on: "2026-10-01",
  signed_at: "2026-10-01T09:00:00Z",
  expires_at: "2027-04-01T00:00:00Z",
  version: 1,
  prescriber_name: "Ada Longe",
  prescriber_credential: "MDCN 123456",
};

describe("presentStatus", () => {
  it("only an active prescription reads as good; every other state says not to dispense", () => {
    expect(presentStatus("active").tone).toBe("good");
    for (const status of ["superseded", "expired", "cancelled"] as const) {
      const p = presentStatus(status);
      expect(p.tone).toBe("bad");
      expect(p.guidance).toMatch(/do not dispense|Do not dispense/);
    }
  });
});

describe("parseProof", () => {
  it("accepts the first row of the function result", () => {
    expect(parseProof([proof])?.drug_name).toBe("Amlodipine");
    expect(parseProof(proof)?.rx_number).toBe("TRG-RX-2026-000366");
  });
  it("treats nothing, a malformed row or an unknown status as not found, never as valid", () => {
    expect(parseProof([])).toBeNull();
    expect(parseProof(null)).toBeNull();
    expect(parseProof([{ ...proof, status: "valid" }])).toBeNull();
    expect(parseProof([{ status: "active" }])).toBeNull();
    expect(NOT_FOUND_MESSAGE).toMatch(/Do not dispense/);
  });
});

describe("token and URL", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(TOKEN_PATTERN.test("a".repeat(64))).toBe(true);
    for (const bad of ["a".repeat(63), "A".repeat(64), "g".repeat(64), `${"a".repeat(64)}x`, ""]) {
      expect(TOKEN_PATTERN.test(bad)).toBe(false);
    }
  });
  it("builds the QR address from the site URL without a double slash", () => {
    const token = "b".repeat(64);
    expect(prescriptionVerifyUrl(token)).toBe(`https://tarragonhealth.ng/verify-rx/${token}`);
  });
});

describe("supply wording", () => {
  const base = { supplies_dispensed: 1, supplies_permitted: 1, supply_available: false, repeats_allowed: 1, repeats_remaining: 1 };
  it("says a supply is available only when one is", () => {
    expect(describeSupply({ ...base, supply_available: true })).toMatch(/available/);
    expect(describeSupply(base)).toMatch(/request their next supply/);
    expect(describeSupply({ ...base, repeats_remaining: 0 })).toMatch(/Do not dispense again/);
  });
  it("every refusal outcome is a bad tone and only 'recorded' is good", () => {
    for (const [outcome, message] of Object.entries(SUPPLY_OUTCOME_MESSAGE)) {
      expect(message.tone).toBe(outcome === "recorded" ? "good" : "bad");
    }
    expect(isSupplyOutcome("recorded")).toBe(true);
    expect(isSupplyOutcome("<script>")).toBe(false);
    expect(isSupplyOutcome(undefined)).toBe(false);
  });
  it("a check that predates the supply fields is treated as not found rather than valid", () => {
    expect(parseProof([{ ...proof, supplies_dispensed: undefined }])).toBeNull();
  });
});
