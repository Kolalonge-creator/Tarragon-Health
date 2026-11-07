/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RiskAssessmentForm } from "./risk-assessment-form";
import { saveRiskAssessmentDraft } from "./risk-assessment-draft-actions";

let mockDraft: unknown = null;
let mockDraftError = false;
let mockActing: { fullName: string | null } | null = null;

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: () => ({ data: mockDraft, isError: mockDraftError }),
}));
jest.mock("@/components/acting-for-context", () => ({ useActingFor: () => mockActing }));
jest.mock("@/lib/queries/vitals", () => ({ useVitalsReadings: () => ({ data: undefined }) }));
jest.mock("@/lib/queries/care-plans", () => ({ useCarePlans: () => ({ data: undefined }) }));
jest.mock("@/lib/queries/risk-assessment", () => ({ useRiskAssessmentResponses: () => ({ data: undefined }) }));
jest.mock("./actions", () => ({ submitRiskAssessment: jest.fn(async () => ({ success: true })) }));
jest.mock("./risk-assessment-draft-actions", () => ({
  loadRiskAssessmentDraft: jest.fn(),
  saveRiskAssessmentDraft: jest.fn(async () => ({ ok: true })),
  discardRiskAssessmentDraft: jest.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  mockDraft = null;
  mockDraftError = false;
  mockActing = null;
  jest.clearAllMocks();
});

describe("risk assessment: save and resume, review, more information needed (P14)", () => {
  it("saves the answers so far with the step the patient is on", async () => {
    render(<RiskAssessmentForm patientId="p1" />);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.change(screen.getByLabelText("Smoking"), { target: { value: "never" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    });
    expect(saveRiskAssessmentDraft).toHaveBeenCalledWith({ answers: expect.objectContaining({ smoking_status: "never" }), step: 2 });
    expect(screen.getByText(/Only you can see it/)).toBeTruthy();
  });

  it("says so when saving fails", async () => {
    (saveRiskAssessmentDraft as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Couldn't save your answers. Please try again." });
    render(<RiskAssessmentForm patientId="p1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't save/);
  });

  it("offers a saved draft and puts its answers back, on the step it was saved at", () => {
    mockDraft = {
      answers: { smoking_status: "current", cigarettes_per_day: "6_10", alcohol_use: "moderate", height_cm: "171", family_diabetes: "on" },
      step: 2,
      updatedAt: "2026-11-06T10:00:00Z",
    };
    render(<RiskAssessmentForm patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue where you left off" }));
    expect(screen.getByText(/Step 2 of 4/)).toBeTruthy();
    expect((screen.getByLabelText("Smoking") as HTMLSelectElement).value).toBe("current");
    expect((screen.getByLabelText("Cigarettes per day") as HTMLSelectElement).value).toBe("6_10");
    expect((screen.getByLabelText("Alcohol") as HTMLSelectElement).value).toBe("moderate");
    expect((screen.getByLabelText("Height (cm)") as HTMLInputElement).value).toBe("171");
    expect((screen.getByLabelText("Diabetes") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Continue where you left off" })).toBeNull();
  });

  it("shows a failed draft read as an error, not as no draft", () => {
    mockDraftError = true;
    render(<RiskAssessmentForm patientId="p1" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load your saved answers/);
  });

  it("offers no saving and no saved draft while acting for someone", () => {
    mockActing = { fullName: "Mum" };
    mockDraft = { answers: { smoking_status: "never" }, step: 2, updatedAt: "2026-11-06T10:00:00Z" };
    render(<RiskAssessmentForm patientId="mum" />);
    expect(screen.queryByRole("button", { name: "Save and finish later" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue where you left off" })).toBeNull();
  });

  it("asks the patient to check their answers before saving, and lists what is still needed", () => {
    render(<RiskAssessmentForm patientId="p1" />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText("Save assessment")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check your answers" }));
    expect(screen.getByText("More information needed")).toBeTruthy();
    expect(screen.getByText(/Choose one for smoking/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Go to lifestyle" })[0]);
    expect(screen.getByText(/Step 2 of 4/)).toBeTruthy();
  });
});
