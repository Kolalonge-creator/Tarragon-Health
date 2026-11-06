/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PatientSafetyStrip } from "./patient-safety-strip";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'");

describe("PatientSafetyStrip", () => {
  it("a refused read never says 'none recorded'", () => {
    const out = text(renderToStaticMarkup(<PatientSafetyStrip ageSex={null} allergies={{ kind: "denied" }} />));
    expect(out).toContain("Do not treat this as no allergies");
    expect(out).not.toContain("None recorded");
  });
  it("a failed read never says 'none recorded'", () => {
    const out = text(renderToStaticMarkup(<PatientSafetyStrip ageSex={null} allergies={{ kind: "error" }} />));
    expect(out).toContain("Could not be loaded");
    expect(out).not.toContain("None recorded");
  });
  it("an empty list says none recorded and shows age and sex", () => {
    const out = text(renderToStaticMarkup(<PatientSafetyStrip ageSex="54 years, female" allergies={{ kind: "none" }} />));
    expect(out).toContain("54 years, female");
    expect(out).toContain("None recorded");
  });
  it("writes severity and provenance in words", () => {
    const out = text(
      renderToStaticMarkup(
        <PatientSafetyStrip
          ageSex={null}
          allergies={{
            kind: "list",
            items: [{ id: "1", substance: "Penicillin", severity: "severe", provenance: "patient" }],
          }}
        />,
      ),
    );
    expect(out).toContain("Penicillin, severe (Entered by the patient)");
  });
});
