/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for GetStartedCard — the first thing a
 * brand-new patient sees on the Overview page (dashboard root). Covers the
 * three-step state, the single-step (already-monitored/healthy) state, the
 * partially-done state (mixing the done/not-done branches), and the acting
 * (caregiver-on-behalf-of) copy branch.
 */
import { expectNoA11yViolations } from "@/test/a11y";
import { GetStartedCard, type GetStartedProgress } from "./get-started-card";

const NOTHING_DONE: GetStartedProgress = {
  hasRiskAssessment: false,
  hasAnyVitals: false,
  hasMedications: false,
  needsMonitoringSteps: true,
};

const PARTIALLY_DONE: GetStartedProgress = {
  hasRiskAssessment: true,
  hasAnyVitals: false,
  hasMedications: false,
  needsMonitoringSteps: true,
};

const HEALTHY_ONE_STEP: GetStartedProgress = {
  hasRiskAssessment: false,
  hasAnyVitals: false,
  hasMedications: false,
  needsMonitoringSteps: false,
};

describe("GetStartedCard accessibility", () => {
  it("has no axe violations with all three steps outstanding", async () => {
    await expectNoA11yViolations(<GetStartedCard progress={NOTHING_DONE} />);
  });

  it("has no axe violations with one step done and two outstanding", async () => {
    await expectNoA11yViolations(<GetStartedCard progress={PARTIALLY_DONE} />);
  });

  it("has no axe violations for a healthy account's single-step card", async () => {
    await expectNoA11yViolations(<GetStartedCard progress={HEALTHY_ONE_STEP} />);
  });

  it("has no axe violations when a supporter is acting for the patient", async () => {
    await expectNoA11yViolations(
      <GetStartedCard progress={NOTHING_DONE} acting="Amaka" />
    );
  });

  it("has no axe violations in the Pidgin language branch", async () => {
    await expectNoA11yViolations(
      <GetStartedCard progress={NOTHING_DONE} language="pcm" />
    );
  });
});
