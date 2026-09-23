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
let nextResult: unknown = { success: true };
jest.mock("./actions", () => ({
  submitRiskAssessment: jest.fn(async (_prevState: unknown, formData: FormData) => {
    capturedFormData = formData;
    return nextResult;
  }),
}));

describe("RiskAssessmentForm", () => {
  beforeEach(() => {
    capturedFormData = null;
    nextResult = { success: true };
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

  /**
   * The primary bug this whole file's fixes trace back to: most of this
   * wizard's fields (everything except smoking_status/height_cm/weight_kg/
   * existing_diagnoses, which are genuinely React-controlled) are plain
   * uncontrolled inputs with no client-side tracking at all. Passing every
   * client-side check (the previous test's fix) only prevents a submission
   * that was never going to succeed anyway - it does nothing for a rejection
   * that happens server-side, past every client-side check, which is exactly
   * what submitRiskAssessment's own superRefine/DB-error paths can still
   * produce. Before this fix, React's reset-uncontrolled-fields-on-submit
   * behavior (see useRemountOnActionResult's own comment) meant a server
   * rejection silently wiped all 4 steps' answers with nothing to retype
   * from - the exact "whole form gone, no explanation" bug already fixed
   * here for signup and patient-location.
   */
  it("repopulates an uncontrolled field from the server's echoed values after a rejected submission", async () => {
    render(<RiskAssessmentForm patientId="patient-1" />);

    // Step 1: check an uncontrolled checkbox and fill the "other" detail
    // text field it reveals - neither has any client-side React tracking.
    fireEvent.click(screen.getByLabelText("Diabetes"));
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("Which cancer type?"), {
      target: { value: "Skin cancer" },
    });
    fireEvent.click(screen.getByText("Next"));

    // Step 2: fill every required field so the client-side check passes -
    // this submission is meant to reach the (mocked) server and be rejected
    // there, the scenario the previous test's fix does nothing for.
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "never" } });
    fireEvent.change(screen.getByLabelText("Alcohol"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Exercise days/week"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Minutes per session"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Sleep (hours/night)"), { target: { value: "7_to_8" } });
    fireEvent.change(screen.getByLabelText("Stress level"), { target: { value: "moderate" } });
    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "170" } });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next")); // step 3, nothing required

    // Simulate a server-side rejection past every client-side check —
    // echoing back exactly what was actually submitted, the way the real
    // action does via riskAssessmentValues(formData).
    nextResult = {
      error: "Something went wrong saving your assessment",
      values: {
        family_diabetes: true,
        family_cancer_types: ["other"],
        family_cancer_other_detail: "Skin cancer",
        smoking_status: "never",
        alcohol_use: "none",
        exercise_days_per_week: "3",
        exercise_minutes_per_session: "30",
        sleep_hours: "7_to_8",
        stress_level: "moderate",
        height_cm: "170",
      },
    };
    fireEvent.click(screen.getByText("Save assessment"));

    await screen.findByText("Something went wrong saving your assessment");

    // Back to step 1: the checkbox and its "other" detail text must still
    // be there — not silently wiped by the remount this fix's own
    // repopulation depends on.
    fireEvent.click(screen.getByText("Previous"));
    fireEvent.click(screen.getByText("Previous"));
    fireEvent.click(screen.getByText("Previous"));
    expect((screen.getByLabelText("Diabetes") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Other") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Which cancer type?") as HTMLInputElement).value).toBe("Skin cancer");
  });

  /**
   * A smaller, separate bug in the same area: cigarettes_per_day was only
   * ever mounted via `{smokingStatus === "current" && (...)}`, not the
   * `hidden` pattern every other field in this wizard uses - so toggling
   * smoking_status away from "current" and back within step 2 (no wizard
   * navigation at all) unmounted and remounted that <select>, discarding
   * whatever count was already picked. Fixed by keeping it always mounted,
   * merely hidden, with `required` made conditional so a hidden-but-
   * irrelevant field can't block submission per the native-constraint-
   * validation gotcha this file's other fix already deals with.
   */
  it("keeps the cigarettes-per-day answer when smoking status is toggled away and back", () => {
    render(<RiskAssessmentForm patientId="patient-1" />);
    fireEvent.click(screen.getByText("Next")); // to step 2

    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "current" } });
    fireEvent.change(screen.getByLabelText("Cigarettes per day"), { target: { value: "6_10" } });

    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "never" } });
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "current" } });

    expect((screen.getByLabelText("Cigarettes per day") as HTMLSelectElement).value).toBe("6_10");
  });

  /**
   * The identical bug, found in two more fields by a later review pass:
   * family_cancer_other_detail was mounted via `{showCancerOther && (...)}`
   * and existing_diagnoses_other_detail via `{showDiagnosesOther && (...)}` -
   * the same conditional-unmount pattern cigarettes_per_day had, just
   * gating a checkbox instead of a select. Unchecking "Other" and
   * re-checking it discarded whatever detail text was already typed.
   */
  it("keeps the family-cancer-type detail when 'Other' is unchecked and re-checked", () => {
    render(<RiskAssessmentForm patientId="patient-1" />);

    fireEvent.click(screen.getByLabelText("Other")); // family_cancer_types "other"
    fireEvent.change(screen.getByLabelText("Which cancer type?"), {
      target: { value: "Skin cancer" },
    });

    fireEvent.click(screen.getByLabelText("Other")); // uncheck
    fireEvent.click(screen.getByLabelText("Other")); // re-check

    expect((screen.getByLabelText("Which cancer type?") as HTMLInputElement).value).toBe("Skin cancer");
  });

  it("keeps the existing-diagnosis detail when 'other' is unchecked and re-checked", () => {
    render(<RiskAssessmentForm patientId="patient-1" />);
    fireEvent.click(screen.getByText("Next")); // step 2
    fireEvent.click(screen.getByText("Next")); // step 3

    fireEvent.click(screen.getByLabelText("other")); // existing_diagnoses "other"
    fireEvent.change(screen.getByLabelText("Which diagnosis?"), {
      target: { value: "Thyroid disorder" },
    });

    fireEvent.click(screen.getByLabelText("other")); // uncheck
    fireEvent.click(screen.getByLabelText("other")); // re-check

    expect((screen.getByLabelText("Which diagnosis?") as HTMLInputElement).value).toBe("Thyroid disorder");
  });

  /**
   * A real data-integrity bug introduced by the three "keeps the answer
   * when toggled away and back" fixes above: `hidden` alone keeps the DOM
   * value around, but a hidden-not-disabled field is still included in
   * FormData at submit — riskAssessmentSchema's superRefine only validates
   * *presence* when the category is selected (smoking_status === "current",
   * "other" checked), never *absence* when it isn't, so a stale value left
   * over from before the patient changed their mind would have silently
   * reached the server and been persisted to their clinical record as if
   * it were still current. `disabled` (not just `hidden`) is what actually
   * excludes a field's value from FormData while keeping it in the DOM.
   */
  it("does not submit a stale value for a field whose category was unselected before submitting", async () => {
    render(<RiskAssessmentForm patientId="patient-1" />);

    // Step 1: check "Other" cancer type, type a detail, then uncheck it.
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText("Which cancer type?"), {
      target: { value: "Skin cancer" },
    });
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.click(screen.getByText("Next"));

    // Step 2: pick "Currently smoke", a cigarette count, then change to
    // "Never smoked" — the same reconsideration a real patient might make.
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "current" } });
    fireEvent.change(screen.getByLabelText("Cigarettes per day"), { target: { value: "6_10" } });
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "never" } });
    fireEvent.change(screen.getByLabelText("Alcohol"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Exercise days/week"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Minutes per session"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Sleep (hours/night)"), { target: { value: "7_to_8" } });
    fireEvent.change(screen.getByLabelText("Stress level"), { target: { value: "moderate" } });
    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "170" } });
    fireEvent.click(screen.getByText("Next"));

    // Step 3: same reconsideration for existing diagnoses "other".
    fireEvent.click(screen.getByLabelText("other"));
    fireEvent.change(screen.getByLabelText("Which diagnosis?"), {
      target: { value: "Thyroid disorder" },
    });
    fireEvent.click(screen.getByLabelText("other"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText("Save assessment"));
    await screen.findByText("Thanks, your care plan preview below reflects your answers.");

    expect(capturedFormData).not.toBeNull();
    const fd = capturedFormData as FormData;
    // None of these were ever re-selected before submitting, so none of
    // them should have reached the server at all - not even as an empty
    // string, since a disabled field is excluded from FormData entirely.
    expect(fd.get("cigarettes_per_day")).toBeNull();
    expect(fd.get("family_cancer_other_detail")).toBeNull();
    expect(fd.get("existing_diagnoses_other_detail")).toBeNull();
    // The categories that would have made them relevant are genuinely
    // unselected too, not just visually hidden.
    expect(fd.get("smoking_status")).toBe("never");
    expect(fd.getAll("family_cancer_types")).toEqual([]);
    expect(fd.getAll("existing_diagnoses")).toEqual([]);
  });
});
