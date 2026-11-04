/**
 * Onboarding asks a Google sign-up (no phone on file) for a phone number before anything else, and never stops an account that
 * already has one or has finished onboarding.
 */
const getCurrentProfile = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(() => { throw new Error("flow data loaded"); }) }));
jest.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
jest.mock("@/components/your-care-team", () => ({ YourCareTeam: () => null }));
jest.mock("./onboarding-flow", () => ({ OnboardingFlow: () => null }));
jest.mock("./phone-step", () => ({ PhoneStep: () => null }));

import type { ReactElement } from "react";
import OnboardingPage from "./page";
import { PhoneStep } from "./phone-step";

const call = () => OnboardingPage({ searchParams: Promise.resolve({}) });
const base = { id: "p1", role: "patient", onboarding_completed_at: null, full_name: "Ada Obi", receives_care: true };

describe("onboarding phone gate", () => {
  it("shows the phone step, greeting by first name, when there is no phone on file", async () => {
    getCurrentProfile.mockResolvedValue({ ...base, phone: null });
    const page = (await call()) as ReactElement<{ children: ReactElement<{ firstName: string; asksDateOfBirth: boolean }> }>;
    expect(page.props.children.type).toBe(PhoneStep);
    expect(page.props.children.props.firstName).toBe("Ada");
    expect(page.props.children.props.asksDateOfBirth).toBe(true);
  });

  it("goes on to the normal flow when a phone is on file", async () => {
    getCurrentProfile.mockResolvedValue({ ...base, phone: "+2348012345678" });
    await expect(call()).rejects.toThrow("flow data loaded");
  });

  it("never holds an account that has finished onboarding", async () => {
    getCurrentProfile.mockResolvedValue({ ...base, phone: null, onboarding_completed_at: "2026-11-01T00:00:00Z" });
    await expect(call()).rejects.toThrow("redirect:/patient");
  });
});
