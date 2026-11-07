/** @jest-environment jsdom */
/** P21: the name / date-of-birth card shows the current values read-only and offers a request, never an edit; hidden while acting. */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("./identity-change-actions", () => ({ requestIdentityChangeAction: jest.fn(async () => ({ ok: true })) }));

import { IdentityChangeCard } from "./identity-change-card";

describe("IdentityChangeCard", () => {
  it("shows the current name and date of birth with no editable field until a request is started", () => {
    render(<IdentityChangeCard fullName="Ada Obi" dateOfBirth="1971-03-14" acting={false} />);
    expect(screen.getByText("Ada Obi")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request a change to your name or date of birth" }));
    expect(screen.getByRole("radio", { name: "My name" })).toBeTruthy();
    expect(screen.getByLabelText("What it should say")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "My date of birth" }));
    expect((screen.getByLabelText("Your correct date of birth") as HTMLInputElement).type).toBe("date");
    expect(screen.getByRole("button", { name: "Send request" })).toBeTruthy();
  });

  it("while acting for someone, offers no request at all and says why", () => {
    render(<IdentityChangeCard fullName="Ada Obi" dateOfBirth={null} acting />);
    expect(screen.queryByRole("button", { name: /Request a change/ })).toBeNull();
    expect(screen.getByText(/Switch back to your own account/)).toBeTruthy();
    expect(screen.getByText("Not given")).toBeTruthy();
  });
});
