import { describe, expect, it } from "@jest/globals";
import {
  NEVER_HIDDEN_MOBILE_SECTIONS,
  NEVER_HIDDEN_WEB_HREFS,
  PATIENT_PAGE_GATES,
  hiddenMobileSections,
  hiddenWebHrefs,
  isGateHidden,
  type PatientGateId,
} from "./patient-page-gates";

const gate = (id: PatientGateId) => {
  const g = PATIENT_PAGE_GATES.find((x) => x.id === id);
  if (!g) throw new Error(`no gate ${id}`);
  return g;
};

describe("isGateHidden", () => {
  it("shows a page whose guard is open", () => {
    expect(isGateHidden(gate("diary"), { guardOpen: true, holds: null })).toBe(false);
    expect(isGateHidden(gate("appointments"), { guardOpen: true, holds: false })).toBe(false);
  });
  it("hides a closed page that holds nothing for the person", () => {
    expect(isGateHidden(gate("diary"), { guardOpen: false, holds: null })).toBe(true);
    expect(isGateHidden(gate("appointments"), { guardOpen: false, holds: false })).toBe(true);
  });
  it("fails closed for hiding: a guard that could not be read counts as closed", () => {
    expect(isGateHidden(gate("resultPassport"), { guardOpen: null, holds: null })).toBe(true);
    expect(isGateHidden(gate("membership"), { guardOpen: null, holds: false })).toBe(true);
  });
  it("keeps a closed page that holds something for the person", () => {
    expect(isGateHidden(gate("recordsRequests"), { guardOpen: false, holds: true })).toBe(false);
    expect(isGateHidden(gate("membership"), { guardOpen: false, holds: true })).toBe(false);
  });
  it("keeps a holdable page when we could not tell what the person holds (cannot prove it is empty)", () => {
    expect(isGateHidden(gate("appointments"), { guardOpen: false, holds: null })).toBe(false);
    expect(isGateHidden(gate("recordsRequests"), { guardOpen: null, holds: null })).toBe(false);
  });
});

describe("hiddenWebHrefs and hiddenMobileSections", () => {
  it("lists only the gates that were read and are closed", () => {
    const answers = {
      appointments: { guardOpen: false, holds: false },
      membership: { guardOpen: true, holds: null },
      recordsRequests: { guardOpen: false, holds: true },
    };
    expect([...hiddenWebHrefs(answers)]).toEqual(["/patient/appointments"]);
    expect(hiddenMobileSections(answers)).toEqual(["appointments"]);
  });
  it("hides nothing for a gate that was never read", () => {
    expect(hiddenWebHrefs({}).size).toBe(0);
    expect(hiddenMobileSections({})).toEqual([]);
  });
});

describe("the gate list", () => {
  it("never names a safety page, so no lookup can hide emergency, red-flag or care-team contact", () => {
    for (const g of PATIENT_PAGE_GATES) {
      for (const href of g.webHrefs) expect(NEVER_HIDDEN_WEB_HREFS).not.toContain(href);
      if (g.mobileSection) expect(NEVER_HIDDEN_MOBILE_SECTIONS).not.toContain(g.mobileSection);
    }
  });
  it("has one gate per page and one guard key per gate", () => {
    expect(new Set(PATIENT_PAGE_GATES.map((g) => g.id)).size).toBe(PATIENT_PAGE_GATES.length);
    expect(new Set(PATIENT_PAGE_GATES.map((g) => g.guard)).size).toBe(PATIENT_PAGE_GATES.length);
  });
});
