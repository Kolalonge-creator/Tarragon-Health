import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "@/lib/analytics/source-scan";

/**
 * The summary module is tested on its own; this pins that the page still uses
 * it. A later edit that goes back to `count ?? 0` would put "All caught up"
 * back on a failed query, and no other test would notice.
 */
const code = codeOnly(readFileSync(join(__dirname, "page.tsx"), "utf8"));

describe("lab liaison page", () => {
  it("builds its tiles from buildLiaisonSummary", () => {
    expect(code).toContain("buildLiaisonSummary(");
  });

  it("does not turn a missing count or list into zero or empty", () => {
    expect(code).not.toMatch(/\?\?\s*0\b/);
    expect(code).not.toMatch(/Count\s*\?\?/);
  });

  it("keeps the patient-list failure message instead of 'No patients yet'", () => {
    expect(code).toContain("summary.patientListFailed");
  });
});
