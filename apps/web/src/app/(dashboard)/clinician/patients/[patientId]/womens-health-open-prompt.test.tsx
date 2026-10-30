import { renderToStaticMarkup } from "react-dom/server";
import { WomensHealthOpenPrompt, WOMENS_HEALTH_TAB } from "./womens-health-open-prompt";

describe("WomensHealthOpenPrompt (OQ-555)", () => {
  it("reads and audits nothing itself; it links to the deliberate open and says the open is recorded", () => {
    const out = renderToStaticMarkup(<WomensHealthOpenPrompt patientId="patient-1" />);
    expect(out).toContain(`href="/clinician/patients/patient-1?tab=${WOMENS_HEALTH_TAB}"`);
    expect(out).toContain("written to the audit log");
    expect(WOMENS_HEALTH_TAB).toBe("womens-health");
  });
});
