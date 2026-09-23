/** @jest-environment jsdom */
/**
 * Regression coverage for the 2026-09-23 resequencing: onboarding used to
 * open on ConsentStep; it now opens on IntentStep, and ConsentStep only
 * appears once an intent has been chosen. Proves the new step order without
 * driving the whole flow (consent/demographics/intake each have their own
 * dedicated tests) — this only needs to reach the intent -> consent
 * transition to prove the resequencing actually happened.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingFlow } from "./onboarding-flow";

jest.mock("@/lib/queries/consent", () => ({
  useCurrentConsentVersions: () => ({
    data: [{ id: "v-tos", consent_type: "terms_of_service", version: 1, title: "Terms", body: "" }],
    isLoading: false,
  }),
}));

// Neither is reached by any test below (both only render once
// demographicsDone) — mocked purely to avoid dragging their "use server"
// actions.ts import chains (next/cache) into this jsdom test environment.
jest.mock("@/app/(dashboard)/patient/patient-location-form", () => ({
  PatientLocationForm: () => null,
}));
jest.mock("./intake-step", () => ({ IntakeStep: () => null }));

const BASE_INITIAL = {
  consentDone: false,
  demographicsDone: false,
  intakeDone: false,
  dateOfBirth: null as string | null,
  sex: null as "male" | "female" | null,
  location: { state: null, city: null, area: null },
};

describe("OnboardingFlow — intent-first sequencing", () => {
  it("opens on the intent step, not consent", () => {
    render(
      <OnboardingFlow
        profile={{ id: "patient-1", fullName: "Amaka" }}
        careTeamSlot={<div data-testid="care-team" />}
        existingPlan={null}
        initial={BASE_INITIAL}
      />
    );

    expect(screen.getByText("What brings you here?")).toBeTruthy();
    expect(screen.queryByText("Your agreement")).toBeNull();
    expect(screen.queryByTestId("care-team")).toBeNull();
  });

  it("reveals consent (and the care-team slot) only after an intent is chosen", () => {
    render(
      <OnboardingFlow
        profile={{ id: "patient-1", fullName: "Amaka" }}
        careTeamSlot={<div data-testid="care-team" />}
        existingPlan={null}
        initial={BASE_INITIAL}
      />
    );

    fireEvent.click(screen.getByText("I want to stay ahead of problems"));

    expect(screen.queryByText("What brings you here?")).toBeNull();
    expect(screen.getByText("Your agreement")).toBeTruthy();
    expect(screen.getByTestId("care-team")).toBeTruthy();
  });

  it("skips the intent step entirely for someone reopening an already-started flow", () => {
    render(
      <OnboardingFlow
        profile={{ id: "patient-1", fullName: "Amaka" }}
        careTeamSlot={<div data-testid="care-team" />}
        existingPlan={null}
        initial={{ ...BASE_INITIAL, consentDone: true }}
      />
    );

    expect(screen.queryByText("What brings you here?")).toBeNull();
    expect(screen.getByTestId("care-team")).toBeTruthy();
  });
});
