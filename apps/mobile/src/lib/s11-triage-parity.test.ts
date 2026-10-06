/**
 * S11 device/server parity (spec 6.1): the phone runs the same engine on the same rule set and must give
 * exactly the results the shared safety fixtures state. The same file is run on the server side by
 * packages/clinical; if the two ever disagree, one of them is wrong about a red.
 * The phone gets the rule set as JSON (bundled or refreshed), so it is round-tripped through JSON here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BP_CARE_V1, expectationWithDefaults, grade, summarise, type ResultSummary, type RuleSet, type TriageInput } from "@tarragon/clinical";

interface Fixture {
  id: string;
  input: TriageInput;
  expect: Partial<ResultSummary>;
}
const file = join(__dirname, "../../../../packages/clinical/fixtures/safety-cases.json");
const fixtures: { cases: Fixture[] } = JSON.parse(readFileSync(file, "utf8"));
const deviceRules = JSON.parse(JSON.stringify(BP_CARE_V1)) as RuleSet;

describe("triage parity on the device", () => {
  it("loads the shared fixtures", () => expect(fixtures.cases.length).toBeGreaterThan(40));
  it.each(fixtures.cases.map((c) => [c.id, c] as const))("%s gives the fixture result", (_id, c) => {
    const input = JSON.parse(JSON.stringify(c.input)) as TriageInput;
    expect(summarise(grade(input, deviceRules))).toEqual(expectationWithDefaults(c.expect));
  });
});
