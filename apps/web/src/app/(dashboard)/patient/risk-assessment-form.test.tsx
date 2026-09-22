/** @jest-environment jsdom */
/**
 * Regression test for a launch-blocking bug: each wizard step was rendered
 * as `{step === N && <div>...}`, which unmounts a step's uncontrolled inputs
 * the moment the user clicks Next. By step 4, submitting only carried step
 * 4's fields — steps 1-3's answers were silently gone from FormData. The fix
 * keeps every step mounted (hidden via the `hidden` attribute instead of
 * being unmounted), so this test drives the whole wizard end to end and
 * asserts every field from every step is still present in the FormData the
 * server action receives.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { RiskAssessmentForm } from "./risk-assessment-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("@/lib/queries/vitals", () => ({
  useVitalsReadings: () => ({ data: undefined }),
}));
jest.mock("@/lib/queries/care-plans", () => ({
  useCarePlans: () => ({ data: undefined }),
}));
jest.mock("@/lib/queries/risk-assessment", () => ({
  useRiskAssessmentResponses: () => ({ data: undefined }),
}));

let capturedFormData: FormData | null = null;
jest.mock("./actions", () => ({
  submitRiskAssessment: jest.fn(async (_prevState: unknown, formData: FormData) => {
    capturedFormData = formData;
    return { success: true };
  }),
}));

describe("RiskAssessmentForm", () => {
  beforeEach(() => {
    capturedFormData = null;
  });

  it("carries every step's answers to the final submit, even after navigating past earlier steps", async () => {
    render(<RiskAssessmentForm patientId="patient-1" />);

    // --- Step 1: Family history ---
    fireEvent.click(screen.getByLabelText("Diabetes"));
    fireEvent.click(screen.getByLabelText("Hypertension"));
    fireEvent.click(screen.getByLabelText("Sickle cell"));
    fireEvent.click(screen.getByLabelText("Other")); // family_cancer_types "other"
    fireEvent.change(screen.getByLabelText("Which cancer type?"), {
      target: { value: "Skin cancer" },
    });
    fireEvent.click(screen.getByText("Next"));

    // --- Step 2: Lifestyle ---
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "current" } });
    fireEvent.change(screen.getByLabelText("Cigarettes per day"), { target: { value: "6_10" } });
    fireEvent.change(screen.getByLabelText("Alcohol"), { target: { value: "moderate" } });
    fireEvent.change(screen.getByLabelText("Exercise days/week"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Minutes per session"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Sleep (hours/night)"), { target: { value: "7_to_8" } });
    fireEvent.change(screen.getByLabelText("Stress level"), { target: { value: "moderate" } });
    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "170" } });
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "70" } });
    fireEvent.click(screen.getByLabelText("balanced"));
    fireEvent.click(screen.getByText("Next"));

    // --- Step 3: Past medical history & medications ---
    fireEvent.click(screen.getByLabelText("hypertension"));
    fireEvent.click(screen.getByLabelText("other")); // existing_diagnoses "other"
    fireEvent.change(screen.getByLabelText("Which diagnosis?"), {
      target: { value: "Thyroid disorder" },
    });
    fireEvent.change(screen.getByLabelText("Current medications (optional)"), {
      target: { value: "Amlodipine 5mg" },
    });
    fireEvent.click(screen.getByText("Next"));

    // --- Step 4: Vaccination & screening history ---
    fireEvent.click(screen.getByLabelText("I've had the HPV vaccine"));
    fireEvent.change(screen.getByLabelText("Any other vaccines? (optional)"), {
      target: { value: "Yellow fever" },
    });
    fireEvent.click(screen.getByLabelText("I've had an abnormal screening result before"));

    fireEvent.click(screen.getByText("Save assessment"));

    // Wait for the action's transition to settle (React wraps the pending ->
    // resolved state update in a microtask) before reading capturedFormData.
    await screen.findByText(
      "Thanks, your care plan preview below reflects your answers."
    );
    expect(capturedFormData).not.toBeNull();
    const fd = capturedFormData as FormData;

    // Step 1 fields must have survived navigating to steps 2-4.
    expect(fd.get("family_diabetes")).toBe("on");
    expect(fd.get("family_hypertension")).toBe("on");
    expect(fd.get("family_heart_disease")).toBeNull();
    expect(fd.get("family_sickle_cell")).toBe("on");
    expect(fd.getAll("family_cancer_types")).toEqual(["other"]);
    expect(fd.get("family_cancer_other_detail")).toBe("Skin cancer");

    // Step 2 fields must have survived navigating to steps 3-4.
    expect(fd.get("smoking_status")).toBe("current");
    expect(fd.get("cigarettes_per_day")).toBe("6_10");
    expect(fd.get("alcohol_use")).toBe("moderate");
    expect(fd.get("exercise_days_per_week")).toBe("3");
    expect(fd.get("exercise_minutes_per_session")).toBe("30");
    expect(fd.get("sleep_hours")).toBe("7_to_8");
    expect(fd.get("stress_level")).toBe("moderate");
    expect(fd.get("height_cm")).toBe("170");
    expect(fd.get("weight_kg")).toBe("70");
    expect(fd.getAll("diet_pattern")).toEqual(["balanced"]);

    // Step 3 fields must have survived navigating to step 4.
    expect(fd.getAll("existing_diagnoses").sort()).toEqual(["hypertension", "other"]);
    expect(fd.get("existing_diagnoses_other_detail")).toBe("Thyroid disorder");
    expect(fd.get("current_medications")).toBe("Amlodipine 5mg");

    // Step 4 fields (the only ones that ever reached the server before the fix).
    expect(fd.get("hpv_vaccinated")).toBe("on");
    expect(fd.get("other_vaccines_detail")).toBe("Yellow fever");
    expect(fd.get("prior_abnormal_result")).toBe("on");
  });

  /**
   * A second, separate bug found by actually clicking through the wizard as
   * a real user: `hidden` (and the `display: none` it produces) does NOT
   * exempt a control from native HTML constraint validation, despite this
   * file's own prior belief that it did. A `required` field left blank on
   * an earlier, now-hidden step silently blocked the browser's pre-submit
   * check — and since that field has no layout box, the browser couldn't
   * focus it or show its error either, so "Save assessment" just did
   * nothing with zero feedback. The fix drives validation manually
   * (`noValidate` + `handleSubmit`) and jumps back to whichever step owns
   * the first invalid control.
   */
  it("jumps back to the step with the unanswered required field instead of silently doing nothing", async () => {
    render(<RiskAssessmentForm patientId="patient-1" />);

    // Step 1: skip everything (nothing here is required).
    fireEvent.click(screen.getByText("Next"));

    // Step 2: leave every required Lifestyle field blank, go straight on.
    expect(screen.getByText("Step 2 of 4: Lifestyle")).toBeTruthy();
    fireEvent.click(screen.getByText("Next"));

    // Step 3: nothing required here either.
    fireEvent.click(screen.getByText("Next"));

    // Step 4: attempt the real submit.
    expect(screen.getByText("Step 4 of 4: Vaccination & screening")).toBeTruthy();
    fireEvent.click(screen.getByText("Save assessment"));

    // The submit must never reach the server action...
    expect(capturedFormData).toBeNull();
    // ...and the wizard must land back on the step that owns the first
    // unanswered required field (Smoking, the first control in step 2),
    // not leave the user stranded on step 4 with no explanation.
    expect(screen.getByText("Step 2 of 4: Lifestyle")).toBeTruthy();
  });
});
