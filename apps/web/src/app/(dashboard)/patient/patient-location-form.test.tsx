/** @jest-environment jsdom */
/**
 * Regression test for the state-dropdown data-loss bug: the free-text state
 * field was replaced with a <Select> of canonical NIGERIAN_STATES values,
 * but the field used to accept arbitrary text (patient-location.ts has no
 * enum), so an existing profile can carry a value with no matching
 * <option> (different casing, "FCT" instead of "Abuja", a stray typo). A
 * <Select> whose defaultValue matches no <option> silently falls back to
 * the first one ("Select…") - on the next save, that blank submission would
 * have overwritten the patient's real saved state with NULL. This proves
 * a non-matching on-file value is kept as its own selected option instead
 * of being silently dropped, and that a canonical value still selects
 * normally.
 */
import { render, screen } from "@testing-library/react";
import { PatientLocationForm } from "./patient-location-form";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock("./actions", () => ({
  updatePatientLocation: jest.fn(),
}));

describe("PatientLocationForm — state dropdown", () => {
  it("keeps a non-canonical on-file value selected instead of silently blanking it", () => {
    render(<PatientLocationForm initial={{ state: "lagos state", city: null, area: null }} />);

    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.value).toBe("lagos state");
    expect(screen.getByText("lagos state (on file, please reselect)")).toBeTruthy();
  });

  it("selects the matching canonical option normally when the on-file value is a real state", () => {
    render(<PatientLocationForm initial={{ state: "Lagos", city: null, area: null }} />);

    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.value).toBe("Lagos");
    expect(screen.queryByText(/on file, please reselect/)).toBeNull();
  });

  it("defaults to unselected when nothing is on file yet, same as before", () => {
    render(<PatientLocationForm initial={{ state: null, city: null, area: null }} />);

    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});
