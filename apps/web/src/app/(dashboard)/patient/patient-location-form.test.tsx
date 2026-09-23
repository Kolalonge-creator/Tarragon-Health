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
 * a genuinely unrecognized on-file value is kept as its own selected option
 * instead of being silently dropped, that a *recognizable* variant (per
 * resolveNigerianState in nigeria-states.ts — different casing, a trailing
 * "...State" suffix, an FCT/Abuja alias) is pre-selected on its canonical
 * spelling instead of falling back at all, and that an already-canonical
 * value still selects normally.
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
  it("pre-selects the canonical spelling for a recognizable non-canonical on-file value", () => {
    render(<PatientLocationForm initial={{ state: "lagos state", city: null, area: null }} />);

    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.value).toBe("Lagos");
    expect(screen.queryByText(/on file, please reselect/)).toBeNull();
  });

  it("keeps a genuinely unrecognized on-file value selected instead of silently blanking it", () => {
    render(<PatientLocationForm initial={{ state: "Neverland", city: null, area: null }} />);

    const select = screen.getByLabelText("State") as HTMLSelectElement;
    expect(select.value).toBe("Neverland");
    expect(screen.getByText("Neverland (on file, please reselect)")).toBeTruthy();
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

  /**
   * A subtler bug caught by review, in the fix for the bug directly above:
   * the "has `initial` genuinely changed?" check used `initial !== lastInitial`
   * - object reference equality. Server Component props are a *fresh object
   * reference on every render* (every RSC payload / router.refresh()), even
   * when every field is byte-identical to before - so that check fired on
   * essentially every refresh, including this form's OWN post-save
   * router.refresh() (see the effect keyed on `state`). If the patient
   * started typing a further correction into a field in the brief window
   * between the save's own remount and that save's own refresh delivering a
   * matching `initial` back, the reference check would treat it as "a new
   * external change," clear `values`, and remount a second time - silently
   * discarding whatever they'd since typed, even though nothing external
   * had actually changed. This proves a same-VALUE `initial` arriving via a
   * new object reference (simulating exactly that self-triggered refresh,
   * without going through an actual save) leaves an in-progress, unsubmitted
   * edit untouched.
   */
  it("does not discard an in-progress edit when a same-value initial prop arrives via a new object reference", () => {
    const initialA = { state: "Lagos", city: null, area: null };
    const { rerender } = render(<PatientLocationForm initial={initialA} />);

    const city = screen.getByLabelText("City") as HTMLInputElement;
    fireEvent.change(city, { target: { value: "Mid-edit correction" } });
    expect(city.value).toBe("Mid-edit correction");

    // A NEW object, but every field equal to initialA - exactly what a
    // Server Component re-render hands down even when nothing changed.
    const initialB = { state: "Lagos", city: null, area: null };
    expect(initialB).not.toBe(initialA);
    rerender(<PatientLocationForm initial={initialB} />);

    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Mid-edit correction");
  });

  /**
   * The scenario above proves a same-value `initial` never causes a
   * spurious remount on its own, but doesn't exercise the actual mechanism
   * this form uses to get there for its own post-save refresh specifically
   * (`knownServerValue` is synced to a successful save's echoed values, not
   * just to a changed `initial` prop - see the component's own comment).
   * This drives a REAL save through the mocked action first (so the
   * component's post-save router.refresh() effect actually fires and the
   * echo-driven remount actually happens), types a further correction into
   * the freshly-remounted field - simulating the patient refining their own
   * just-saved value before the save's own refresh has finished round-
   * tripping - then rerenders with a *new* `initial` object whose values
   * match what was just saved (exactly what that refresh would eventually
   * hand back). A version of the fix that only compared `initial` against
   * the literal previous `initial` prop (never syncing in the save's own
   * echo) would treat this incoming prop as "a change" purely because
   * nothing had updated its own bookkeeping to already expect it, clearing
   * `values` and remounting a second time - reverting the patient's further
   * correction back to the bare saved value.
   */
  it("does not discard a further in-progress correction when the save's own refresh delivers matching values back", async () => {
    const { rerender } = render(<PatientLocationForm initial={{ state: "Lagos", city: null, area: null }} />);

    fireEvent.click(screen.getByText("Save location"));
    await screen.findByText("Location saved.");
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Ikeja");

    const city = screen.getByLabelText("City") as HTMLInputElement;
    fireEvent.change(city, { target: { value: "Ikeja GRA" } });
    expect(city.value).toBe("Ikeja GRA");

    // A brand-new object (never seen by this component before) whose values
    // match exactly what was just saved - what the save's own
    // router.refresh() would eventually hand back.
    rerender(<PatientLocationForm initial={{ state: "Lagos", city: "Ikeja", area: null }} />);

    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Ikeja GRA");
  });
});
