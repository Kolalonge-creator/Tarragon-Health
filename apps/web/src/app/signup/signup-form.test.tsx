/** @jest-environment jsdom */
/**
 * Regression test for a real bug found during a live UX walkthrough
 * (2026-09-18): submitting the signup form with a single invalid field
 * (e.g. a mistyped phone number) wiped every other field too — first name,
 * last name, email, all gone, forcing a full retype. Confirmed to be a
 * React internal: a <form action={...}> resets its uncontrolled inputs
 * synchronously at submit time, before the server action even resolves, so
 * a `defaultValue` sourced from the action's returned state is always one
 * submission too late. The fix has the action echo back the non-sensitive
 * submitted values, and the form restores them imperatively via refs once
 * that state lands.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { SignupForm } from "./signup-form";

let callCount = 0;
jest.mock("./actions", () => ({
  signUp: jest.fn(async () => {
    callCount += 1;
    return {
      error: "Enter a valid phone number",
      field: "phone",
      values: {
        firstName: "Amara",
        lastName: "Okonkwo",
        email: "amara@example.com",
        countryCode: "+234",
        phone: "123",
        state: "",
      },
    };
  }),
}));

describe("SignupForm", () => {
  beforeEach(() => {
    callCount = 0;
  });

  it("restores first name, last name and email after a single field's validation error", async () => {
    render(<SignupForm />);

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Amara" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Okonkwo" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "amara@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "TestPass123!" } });

    fireEvent.click(screen.getByText("Create account"));

    // Wait for the mocked action's error to render (confirms the state
    // transition — and the DOM reset that comes with it — has happened).
    await screen.findByText("Enter a valid phone number");
    expect(callCount).toBe(1);

    // The whole point of the fix: these must NOT have been wiped by the
    // reset, even though only the phone field was actually invalid.
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Amara");
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Okonkwo");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "amara@example.com"
    );
  });
});
