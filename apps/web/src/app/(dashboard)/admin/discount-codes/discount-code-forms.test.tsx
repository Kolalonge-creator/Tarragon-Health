/** @jest-environment jsdom */
/** T2-01 (2026-11-04): the retired Plus upgrade is never offered as a target for a new discount code; retired Plus is labelled as such. */
import { render, screen } from "@testing-library/react";

jest.mock("./actions", () => ({ createDiscountCode: jest.fn(), setDiscountCodeStatus: jest.fn() }));

import { CreateDiscountCodeForm } from "./discount-code-forms";

describe("CreateDiscountCodeForm item targets", () => {
  it("offers the Membership, labels retired Plus, and never offers the upgrade", () => {
    render(
      <CreateDiscountCodeForm
        items={[{ code: "membership_annual_no_panel", active: true }, { code: "membership_annual", active: false }, { code: "membership_upgrade_plus", active: false }]}
        cohorts={[]}
        today="2026-11-04"
      />,
    );
    const values = (screen.getAllByRole("checkbox") as HTMLInputElement[]).filter((c) => c.name === "item").map((c) => c.value);
    expect(values).toEqual(["membership_annual_no_panel", "membership_annual"]);
    expect(screen.getByText(/membership_annual \(retired, not sold\)/)).toBeTruthy();
  });
});
