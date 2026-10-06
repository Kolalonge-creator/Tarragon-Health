import { describe, expect, it } from "@jest/globals";
import { createMockPhone, isE164 } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runPhoneContract } from "./contracts/phone.contract";

let clock = 1_800_000_000_000;
runPhoneContract(
  "mock",
  () => {
    const mock = createMockPhone(() => clock);
    return { provider: mock, advanceMs: (ms) => (clock += ms), answer: (id, p) => mock.answer(id, p), failLeg: (id) => mock.failLeg(id), failNextCall: () => mock.failNextCall() };
  },
  () => clock,
);

describe("phone numbers", () => {
  it("accepts international numbers and rejects local format, words and the wrong type", () => {
    expect(isE164("+2348031234567")).toBe(true);
    expect(isE164("+447911123456")).toBe(true);
    for (const bad of ["08031234567", "+0803123456", "+234 803 123 4567", "+2348031", "+23480312345678901", "", null, 2348031234567, "Ada"]) expect(isE164(bad)).toBe(false);
  });
});

describe("mock phone control", () => {
  it("ignores an answer or a failure for a bridge it never made", () => {
    const mock = createMockPhone(() => clock);
    expect(() => {
      mock.answer("br_none", "patient");
      mock.failLeg("br_none");
    }).not.toThrow();
  });
  it("uses the real clock when none is given", async () => {
    const mock = createMockPhone();
    const r = await mock.connect({ encounterRef: "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44", patientPhone: "+2348031234567", clinicianPhone: "+2348097654321", maxMinutes: 5 });
    expect(r.ok && r.data.expiresAtMs).toBeGreaterThan(Date.now());
  });
});
