/** @jest-environment jsdom */
/**
 * P21: on the patient Profile page, "Sign out everywhere else" asks for confirmation first and then says it worked. The action itself
 * calls Supabase auth signOut({ scope: "others" }) (session-actions.ts, tested below). /account keeps its one-step button.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const signOut = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: (opts: unknown) => signOut(opts) } }),
  getCurrentUser: async () => ({ id: "u1" }),
}));
jest.mock("@/lib/auth/auth-error-message", () => ({ authErrorMessage: () => "Something went wrong." }));

import { SignOutOtherDevicesCard } from "./sign-out-other-devices-card";
import { signOutOtherSessions } from "./session-actions";

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
});

describe("signOutOtherSessions", () => {
  it("signs out only the other sessions", async () => {
    expect(await signOutOtherSessions(undefined, new FormData())).toEqual({ success: true });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("reports a failure instead of claiming success", async () => {
    signOut.mockResolvedValue({ error: { message: "x" } });
    expect(await signOutOtherSessions(undefined, new FormData())).toEqual({ error: "Something went wrong." });
  });
});

describe("SignOutOtherDevicesCard with confirmFirst", () => {
  it("asks first, signs nothing out on Cancel, then signs out and says so", async () => {
    render(<SignOutOtherDevicesCard confirmFirst />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));
    expect(screen.getByText(/Sign out of all your other devices and browsers\? You will stay signed in here\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, sign them out" }));
    });
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "others" }));
    expect(await screen.findByText("Done. Every other device and browser has been signed out.")).toBeTruthy();
  });

  it("without confirmFirst (the /account page) the button submits straight away, as before", () => {
    render(<SignOutOtherDevicesCard />);
    const button = screen.getByRole("button", { name: "Sign out everywhere else" });
    expect(button.getAttribute("type")).toBe("submit");
  });
});
