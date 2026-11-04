/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const signInWithOAuth = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth } }) }));

import { GoogleSignInButton } from "./google-sign-in-button";

beforeEach(() => signInWithOAuth.mockReset().mockResolvedValue({ error: null }));

describe("GoogleSignInButton", () => {
  it("starts Google sign-in back through /auth/callback, carrying the destination", async () => {
    render(<GoogleSignInButton redirectTo="/patient/supporting" />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const arg = signInWithOAuth.mock.calls[0][0];
    expect(arg.provider).toBe("google");
    const url = new URL(arg.options.redirectTo);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("redirect")).toBe("/patient/supporting");
    expect(url.searchParams.get("via")).toBe("google");
  });

  it("says so, and lets the person try again, when Google sign-in cannot start", async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error("provider is not enabled") });
    render(<GoogleSignInButton label="Sign up with Google" />);
    fireEvent.click(screen.getByRole("button", { name: /Sign up with Google/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
