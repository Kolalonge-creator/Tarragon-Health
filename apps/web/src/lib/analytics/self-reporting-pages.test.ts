import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { SELF_REPORTING_PATHS } from "./load-failures";
import { codeOnly } from "./source-scan";

/**
 * The analytics load notice stays out of the way on the Overview and the
 * Investor page, because each already says, about its own figures, when
 * something did not load. That is only true while each page mounts exactly the
 * queries it reports on. A third query added to either page would then be
 * reported by neither the page nor the notice, which is the original problem
 * (a failed figure read as zero) returning on the two pages assumed safe.
 *
 * Scope: this reads the page file itself. A hook mounted indirectly through a
 * child component would not show up here.
 */

const read = (relativePath: string) => codeOnly(readFileSync(join(process.cwd(), relativePath), "utf8"));

/** The read hooks exported from queries.ts, meaning the ones that call useQuery. */
function readHooks(): string[] {
  return read("src/lib/analytics/queries.ts")
    .split("export function ")
    .slice(1)
    .filter((chunk) => chunk.includes("useQuery("))
    .map((chunk) => chunk.slice(0, chunk.indexOf("(")));
}

/** Which of those a page file calls. */
function hooksMountedBy(file: string): string[] {
  const source = read(file);
  return readHooks()
    .filter((name) => new RegExp(`\\b${name}\\(`).test(source))
    .sort();
}

describe("pages the load notice steps aside on", () => {
  it("are exactly the two that report their own failures", () => {
    expect([...SELF_REPORTING_PATHS].sort()).toEqual(["/analytics", "/analytics/investor"]);
  });

  it("Overview mounts only the six queries it reports on", () => {
    expect(hooksMountedBy("src/app/(dashboard)/analytics/_components/overview-dashboard.tsx")).toEqual([
      "useBusinessSummary",
      "useClinicalOutcomes",
      "useFacilityEngagement",
      "useFinancialSummary",
      "useGovernanceSummary",
      "useInvestorSummary",
    ]);
  });

  it("Investor mounts only the two queries it reports on", () => {
    expect(hooksMountedBy("src/app/(dashboard)/analytics/_components/investor-dashboard.tsx")).toEqual([
      "useFinanceInputs",
      "useInvestorSummary",
    ]);
  });

  it("can actually see hooks (guards the scan itself)", () => {
    expect(readHooks().length).toBeGreaterThan(40);
  });
});
