/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PatientOpenWork } from "./patient-open-work";

const text = (html: string) => html.replace(/<[^>]+>/g, "");
const known = (value: number) => ({ state: "known" as const, value });

describe("PatientOpenWork", () => {
  it("never says none open when a count failed", () => {
    const out = text(renderToStaticMarkup(<PatientOpenWork escalations={{ state: "unknown" }} alerts={known(0)} />));
    expect(out).toContain("could not be loaded");
    expect(out).not.toContain("No open");
  });
  it("says none open only when both counts are a known zero", () => {
    expect(text(renderToStaticMarkup(<PatientOpenWork escalations={known(0)} alerts={known(0)} />))).toBe(
      "No open escalations or clinical alerts.",
    );
  });
  it("counts and links each kind of open work", () => {
    const html = renderToStaticMarkup(<PatientOpenWork escalations={known(1)} alerts={known(2)} />);
    expect(text(html)).toBe("Open for this patient: 1 escalation, 2 clinical alerts");
    expect(html).toContain('href="/clinician/escalations"');
    expect(html).toContain('href="/clinician#clinical-alerts"');
  });
});
