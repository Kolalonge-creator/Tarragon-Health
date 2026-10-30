/** @jest-environment jsdom */
/**
 * 2026-10-30, first live sign-up of a test patient. Two things were unclear on the way in:
 *  - the agreement step listed the two optional choices (research, sharing group figures with a programme) as bare collapsed
 *    titles, with nothing to read and no way to act, so a patient could not tell what they were or whether continuing meant yes;
 *  - the way out of the health profile was labelled "Continue to the last step" at the very bottom, so people said there was no Skip.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { ConsentStep } from "./consent-step";
import { IntakeStep } from "./intake-step";

const mockVersions = [
  { id: "v1", consent_type: "data_processing", is_optional: false, title: "How we use your health information", body: "## Section\nRequired wording." },
  { id: "v2", consent_type: "terms_of_service", is_optional: false, title: "Terms of service", body: "## Section\nTerms wording." },
  { id: "v3", consent_type: "research", is_optional: true, title: "Use my information in approved research", body: "I agree that my information may be used in research that an ethics committee approved." },
  { id: "v4", consent_type: "sponsor_reporting", is_optional: true, title: "Share group figures with a programme", body: "I agree that the programme I joined may see figures about the whole group." },
];

jest.mock("@/lib/queries/consent", () => ({
  useCurrentConsentVersions: () => ({ data: mockVersions, isLoading: false }),
}));
jest.mock("./actions", () => ({ acceptConsents: jest.fn(async () => ({ success: true })) }));
jest.mock("@/app/(dashboard)/patient/risk-assessment-form", () => ({
  RiskAssessmentForm: ({ sex }: { sex?: string | null }) => <div data-testid="risk-form" data-sex={sex ?? "unknown"} />,
}));
jest.mock("@/app/(dashboard)/patient/add-medication-form", () => ({ AddMedicationForm: () => <div /> }));

describe("agreement step: the optional choices", () => {
  it("shows their full wording in the open, not behind a collapsed title", () => {
    render(<ConsentStep onComplete={jest.fn()} />);
    const body = screen.getByText(/ethics committee approved/);
    expect(body).toBeTruthy();
    expect(body.closest("details")).toBeNull();
    expect(screen.getByText(/the programme I joined may see figures/).closest("details")).toBeNull();
  });

  it("says plainly that continuing does not agree to them", () => {
    render(<ConsentStep onComplete={jest.fn()} />);
    expect(screen.getByText(/You are not agreeing to either of these by continuing/)).toBeTruthy();
    expect(screen.getByText(/choose them later under Privacy/)).toBeTruthy();
  });

  it("keeps the required documents collapsed to read, and does not list the optional ones among them", () => {
    render(<ConsentStep onComplete={jest.fn()} />);
    expect(screen.getByText("Terms of service").closest("details")).not.toBeNull();
    expect(screen.getByText("Use my information in approved research").closest("details")).toBeNull();
  });

  it("shows no optional section on the supporter path, which asks for the terms only", () => {
    render(<ConsentStep onComplete={jest.fn()} onlyTypes={["terms_of_service"]} />);
    expect(screen.queryByText(/Two choices that are yours/)).toBeNull();
  });
});

describe("health profile step: the way out", () => {
  it("has a Skip button at the top that skips, and the bottom one says Skip too", () => {
    const onSkip = jest.fn();
    render(<IntakeStep patientId="p1" onSkip={onSkip} intent="unsure" sex="male" />);
    fireEvent.click(screen.getByText("Skip this for now"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Skip for now and go to the last step"));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it("passes the recorded sex to the questionnaire", () => {
    render(<IntakeStep patientId="p1" onSkip={jest.fn()} intent="prevent" sex="male" />);
    expect(screen.getByTestId("risk-form").getAttribute("data-sex")).toBe("male");
  });
});
