/**
 * S59c review fix: when the typed description contains danger wording nothing is saved and no alert is raised (the words are never stored or
 * sent), so the result screen must not promise that the care team "will take a look". That line is printed from `clinicianReviewRequired`,
 * so the danger result must set it to false. This is a source-level guard because the screen is a client component with heavy dependencies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../../app/(dashboard)/patient/symptom-triage-check.tsx"), "utf8");

function dangerFunctionBody(): string {
  const start = source.indexOf("function describeFoundDanger(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}

describe("the describe-it danger result", () => {
  it("never claims the care team will look at it", () => {
    const body = dangerFunctionBody();
    expect(body).toContain("clinicianReviewRequired: false");
    expect(body).not.toContain("clinicianReviewRequired: true");
  });

  it("is still an on-device emergency result that records nothing", () => {
    const body = dangerFunctionBody();
    expect(body).toContain('category: "emergency"');
    expect(body).toContain("recorded: false");
    expect(body).toContain("onDevice: true");
  });
});
