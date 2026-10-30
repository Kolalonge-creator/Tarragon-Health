/** @jest-environment jsdom */
/** Design audit P2: the add form lives behind a button, not on the page. */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("./add-medication-form", () => ({ AddMedicationForm: () => <div>the add form</div> }));

import { AddMedicationSheet } from "./add-medication-sheet";

describe("AddMedicationSheet", () => {
  it("shows only a button until opened, then the form in a dialog that can be closed", () => {
    render(<AddMedicationSheet patientId="p1" />);
    expect(screen.queryByText("the add form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add a medication/ }));
    expect(screen.getByRole("dialog", { name: "Add a medication" })).not.toBeNull();
    expect(screen.getByText("the add form")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("the add form")).toBeNull();
  });
});
