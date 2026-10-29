/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SignupForm } from "@/app/signup/signup-form";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/app/signup/actions", () => ({ signUp: jest.fn(), signUpWithPhone: jest.fn(), verifyPhoneSignup: jest.fn(), resendPhoneSignupCode: jest.fn(), verifySignupEmailCode: jest.fn(), resendSignupEmail: jest.fn() }));

describe("texted codes are hidden until a provider is live", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TEXT_CODES_ENABLED;
    jest.resetModules();
  });

  it("is off by default", async () => {
    const { TEXT_CODES_ENABLED } = await import("./text-codes");
    expect(TEXT_CODES_ENABLED).toBe(false);
  });

  it("only the string 'true' turns it on", async () => {
    process.env.NEXT_PUBLIC_TEXT_CODES_ENABLED = "1";
    expect((await import("./text-codes")).TEXT_CODES_ENABLED).toBe(false);
    jest.resetModules();
    process.env.NEXT_PUBLIC_TEXT_CODES_ENABLED = "true";
    expect((await import("./text-codes")).TEXT_CODES_ENABLED).toBe(true);
  });

  it("the sign-up form shows no visible Phone tab while it is off", () => {
    render(<SignupForm />);
    const visiblePhoneTab = screen.queryAllByRole("tab", { name: /phone/i }).find((el) => el.closest(".hidden") === null);
    expect(visiblePhoneTab).toBeUndefined();
  });
});
