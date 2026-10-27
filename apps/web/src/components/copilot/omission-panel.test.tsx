/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { OmissionPanel, OmissionResultView } from "./omission-panel";

const mockFlag = { value: false };
jest.mock("@tarragon/shared", () => {
  const actual = jest.requireActual("@tarragon/shared");
  return {
    ...actual,
    getProposedConfig: (key: string, ...rest: unknown[]) =>
      key === "copilot.omission_panel_enabled" ? { ...actual.getProposedConfig(key, ...rest), value: mockFlag.value } : actual.getProposedConfig(key, ...rest),
  };
});
jest.mock("@/lib/queries/allergies", () => ({ useAllergies: () => ({ data: [{ id: "a1", allergen: "Penicillin" }] }) }));
jest.mock("@/lib/queries/medications", () => ({ useMedications: () => ({ data: [{ id: "m1", drug_name: "Amlodipine" }, { id: "m2", drug_name: "Contraceptive pill" }] }) }));
jest.mock("@/lib/queries/care-plans", () => ({ useCarePlans: () => ({ data: [{ id: "p1", condition: "hypertension" }] }) }));
jest.mock("@/lib/queries/patient-care-gaps", () => ({
  usePatientCareGaps: () => ({ data: [{ gap_type: "unactioned_abnormal", condition_or_type: "Creatinine", opened_at: "2026-10-01" }] }),
}));

describe("OmissionPanel", () => {
  beforeEach(() => {
    mockFlag.value = false;
  });

  it("renders nothing while the flag is off, whatever the draft says", () => {
    const { container } = render(<OmissionPanel patientId="p" draftText="Give amoxicillin." />);
    expect(container.innerHTML).toBe("");
  });

  it("when on: flags the allergy clash, the unmentioned result, the missing interval and the unmentioned medicine; never shows a sensitive item", () => {
    mockFlag.value = true;
    render(<OmissionPanel patientId="p" draftText="Give amoxicillin 500 mg." />);
    const flags = Array.from(document.querySelectorAll("[data-flag]")).map((e) => e.getAttribute("data-flag"));
    expect(flags).toEqual(expect.arrayContaining(["drug_vs_allergy", "result_not_mentioned", "no_follow_up_interval", "medication_not_mentioned"]));
    expect(screen.getByLabelText("Source items not used").textContent).toContain("Creatinine");
    expect(document.body.textContent).not.toMatch(/contraceptive/i);
    expect(screen.getByText(/not yet been signed/)).toBeTruthy();
  });

  it("an empty draft shows nothing even when on", () => {
    mockFlag.value = true;
    const { container } = render(<OmissionPanel patientId="p" draftText="  " />);
    expect(container.innerHTML).toBe("");
  });

  it("has no control that could block signing: no buttons, and the result type says blocksSigning is false", () => {
    render(<OmissionResultView result={{ blocksSigning: false, flags: [], sourceItemsNotUsed: [], rulesVersion: 1, rulesStatus: "confirmed" }} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Nothing to flag from the record.")).toBeTruthy();
  });
});
