import { describe, expect, it } from "@jest/globals";
import { diagnosticSearchCopy } from "./diagnostic-search-copy";

describe("diagnostic search copy", () => {
  const entries = Object.entries(diagnosticSearchCopy);
  const values = Object.values(diagnosticSearchCopy);
  it("has no em dashes", () => {
    expect(values.filter((v) => v.includes("—"))).toEqual([]);
  });
  it("never claims accreditation, approval or certification", () => {
    expect(values.filter((v) => /\b(accredited|approved|certified)\b/i.test(v))).toEqual([]);
  });
  it("never praises a partner", () => {
    expect(entries.filter(([k, v]) => k.startsWith("dxsearch.partner.") && /\b(better|best|trusted|recommended)\b/i.test(v))).toEqual([]);
  });
  it("the partner explainer says the placement is commercial and the choice is the patient's", () => {
    expect(diagnosticSearchCopy["dxsearch.partner.explainer"]).toMatch(/business agreement/);
    expect(diagnosticSearchCopy["dxsearch.partner.explainer"]).toMatch(/pay Tarragon/);
    expect(diagnosticSearchCopy["dxsearch.partner.explainer"]).toMatch(/free to choose/);
  });
  it("every key is in the dxsearch namespace", () => {
    expect(Object.keys(diagnosticSearchCopy).filter((k) => !k.startsWith("dxsearch."))).toEqual([]);
  });
});
