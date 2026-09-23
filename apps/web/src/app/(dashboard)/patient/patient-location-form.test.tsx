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
import { fireEvent, render, screen } from "@testing-library/react";
import { PatientLocationForm } from "./patient-location-form";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const nextResult: unknown = { success: true, values: { state: "Lagos", city: "Ikeja", area: null } };
jest.mock("./actions", () => ({
  updatePatientLocation: jest.fn(async () => nextResult),
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

  /**
   * A subtler bug caught by review: `state.values` (the action's echo, used
   * to repopulate a field right after its own submission) never resets on
   * its own — `useActionState`'s state persists indefinitely, and this
   * component is never remounted by `router.refresh()` alone (only the
   * Server Component tree re-renders, handing it a fresh `initial` prop).
   * Left unchecked, a successful save's echoed values would keep winning
   * over `initial` forever, including over a *later*, legitimate external
   * edit (another tab, a caregiver) — silently overwriting it right back on
   * the next save, and permanently defeating the state-dropdown mismatch
   * detector above (a canonical value saved once would mean "on file,
   * please reselect" could never fire again even for a genuinely new
   * mismatch). This drives a real save, then re-renders with a changed
   * `initial` simulating exactly that external update, and asserts the new
   * `initial` wins rather than the stale echoed value.
   */
  it("lets a fresh initial prop override a stale echoed value from an earlier save", async () => {
    const { rerender } = render(<PatientLocationForm initial={{ state: "Lagos", city: null, area: null }} />);

    fireEvent.click(screen.getByText("Save location"));
    await screen.findByText("Location saved.");
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Ikeja");

    // Simulate a later, external change to this same profile's city -
    // exactly what router.refresh() would eventually hand this component
    // if a caregiver (or another tab) had edited it in the meantime.
    rerender(<PatientLocationForm initial={{ state: "Lagos", city: "Yaba", area: null }} />);

    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Yaba");
  });
});
