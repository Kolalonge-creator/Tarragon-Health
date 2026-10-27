import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CHECKBACK_DRAFT, DESCRIBE_DRAFT, EXPLAINER_DRAFT, SAFETY_NET_DRAFT } from "@tarragon/symptom-triage-engine";

jest.mock("../clinical-signoff/symptom-ux-actions", () => ({ signSymptomUxConfigAction: async () => undefined }));

import { SymptomUxPanel } from "./symptom-ux-panel";

describe("SymptomUxPanel (the hub shows what the CMO signs, in full)", () => {
  const waiting = [
    { kind: "checkback" as const, version: 1, rules: CHECKBACK_DRAFT },
    { kind: "describe" as const, version: 1, rules: DESCRIBE_DRAFT },
    { kind: "explainer" as const, version: 1, rules: EXPLAINER_DRAFT },
    { kind: "safety_net" as const, version: 1, rules: SAFETY_NET_DRAFT },
  ];
  const html = renderToStaticMarkup(<SymptomUxPanel waiting={waiting} />);

  it("renders one form per waiting item, each with the kind and version it signs and a required tick", () => {
    expect((html.match(/<form/g) ?? []).length).toBe(4);
    for (const k of ["checkback", "describe", "explainer", "safety_net"]) expect(html).toContain(`name="kind" value="${k}"`);
    expect((html.match(/<input type="checkbox"[^>]*required[^>]*name="understood"/g) ?? []).length).toBe(4);
  });

  it("shows the content that will apply: timing numbers, phrases, reasons and trigger lines", () => {
    expect(html).toContain("asked 48 hours later");
    expect(html).toContain("my body is hot");
    expect(html).toContain("sudden, very strong headache");
    expect(html).toContain("you lose some of your vision");
  });

  it("says plainly that the emergency number is not confirmed, and that no helpline is included", () => {
    expect(html).toMatch(/NOT confirmed, so it is not shown to patients/);
    expect(html).toMatch(/No helpline number is included/);
  });

  it("a draft that cannot be read is not signable", () => {
    const bad = renderToStaticMarkup(<SymptomUxPanel waiting={[{ kind: "checkback", version: 2, rules: { nonsense: true } }]} />);
    expect(bad).toMatch(/could not be read/);
    expect(bad).toMatch(/<input type="checkbox"[^>]*disabled[^>]*name="understood"/);
    expect(bad).toMatch(/<button[^>]*disabled/);
  });

  it("renders nothing when nothing waits", () => {
    expect(renderToStaticMarkup(<SymptomUxPanel waiting={[]} />)).toBe("");
  });
});
