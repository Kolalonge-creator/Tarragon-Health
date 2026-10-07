/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for VitalsForm — one of the most-used
 * patient surfaces (logging a BP/glucose/weight/etc. reading). Covers the
 * default (blood pressure) reading type and, on that SAME rendered instance,
 * switching to glucose (which renders a second, non-trivial control: a unit
 * <Select> beside the value input, plus an aria-describedby-linked hint) —
 * re-running axe against the interacted DOM, not a freshly mounted one, so a
 * violation only reachable after the switch (select still in the DOM +
 * glucose controls together) isn't missed.
 */
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("./actions", () => ({
  logVital: jest.fn(async () => undefined),
}));

describe("VitalsForm accessibility", () => {
  it("has no axe violations on the default (blood pressure) reading type", async () => {
    await expectNoA11yViolations(<VitalsForm patientId="patient-1" />);
  });

  it("has no axe violations after switching to the glucose reading type", async () => {
    const { container } = await expectNoA11yViolations(<VitalsForm patientId="patient-1" />);
    fireEvent.change(screen.getByLabelText("Reading type"), {
      target: { value: "glucose" },
    });
    // Re-run axe against the SAME container the switch happened in — the
    // Reading-type select is still present (lockedType is unset on this
    // page), alongside the glucose value input, unit <Select>, and hint.
    expect(await axe(container)).toHaveNoViolations();
  });
});
