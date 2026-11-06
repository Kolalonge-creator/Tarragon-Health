/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CareCircleCard, OnboardingAnswersCard } from "./onboarding-and-circle-cards";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("OnboardingAnswersCard", () => {
  it("labels the answers as the patient's own, not a diagnosis", () => {
    const out = text(renderToStaticMarkup(
      <OnboardingAnswersCard read={{ status: "ok", value: { goals: ["stay_ahead"], conditions: ["hypertension"], answeredAt: null } }} />,
    ));
    expect(out).toContain("High blood pressure");
    expect(out).toContain("not a diagnosis");
  });
  it("never shows a refused or failed read as no answers", () => {
    for (const status of ["denied", "error"] as const) {
      const out = text(renderToStaticMarkup(<OnboardingAnswersCard read={{ status }} />));
      expect(out).toContain("Do not read this as none");
      expect(out).not.toContain("did not answer");
    }
  });
});

describe("CareCircleCard", () => {
  it("names each supporter, what they may see, and a pause", () => {
    const out = text(renderToStaticMarkup(
      <CareCircleCard
        read={{
          status: "ok",
          value: {
            pause: { until: "2026-11-10T00:00:00Z", alertsPaused: false },
            supporters: [{ name: "Ngozi", relationship: "Daughter", permissions: ["appointments"], primaryContact: true, since: null }],
          },
        }}
      />,
    ));
    expect(out).toContain("Ngozi (Daughter)");
    expect(out).toContain("Main contact");
    expect(out).toContain("paused sharing");
    expect(out).toContain("Urgent alerts still reach supporters");
    expect(out).toContain("May see:");
  });
  it("never shows a refused read as no supporters", () => {
    const out = text(renderToStaticMarkup(<CareCircleCard read={{ status: "denied" }} />));
    expect(out).toContain("not on this patient's care team");
    expect(out).not.toContain("No active supporters");
  });
});
