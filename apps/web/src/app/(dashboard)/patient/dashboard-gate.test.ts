import { dashboardGateRedirect } from "./dashboard-gate";

const base = { acting: false, onboardingCompleted: true, receivesCare: true as boolean | null };

describe("dashboardGateRedirect", () => {
  it("lets a patient who has finished onboarding through, on either kind of page", () => {
    expect(dashboardGateRedirect({ ...base, area: "patient" })).toBeNull();
    expect(dashboardGateRedirect({ ...base, area: "supporter" })).toBeNull();
  });

  it("sends anyone who has not finished onboarding to onboarding, supporter pages included", () => {
    expect(dashboardGateRedirect({ ...base, onboardingCompleted: false, area: "patient" })).toBe("/onboarding");
    expect(dashboardGateRedirect({ ...base, onboardingCompleted: false, receivesCare: false, area: "supporter" })).toBe("/onboarding");
  });

  it("still sends a support-only account away from every patient page", () => {
    expect(dashboardGateRedirect({ ...base, receivesCare: false, area: "patient" })).toBe("/patient/supporting");
  });

  it("lets a support-only account open its own supporter pages instead of redirecting them to themselves", () => {
    expect(dashboardGateRedirect({ ...base, receivesCare: false, area: "supporter" })).toBeNull();
  });

  it("never redirects someone who has opened the account of the person they support", () => {
    expect(dashboardGateRedirect({ ...base, acting: true, onboardingCompleted: false, receivesCare: false, area: "patient" })).toBeNull();
  });

  it("treats an unknown receives_care as a patient (only an explicit false is support-only)", () => {
    expect(dashboardGateRedirect({ ...base, receivesCare: null, area: "patient" })).toBeNull();
  });
});
