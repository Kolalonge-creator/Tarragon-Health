/** @jest-environment jsdom */
/**
 * The signed-out Care Circle landing (supporter join path): the inviter's first name, what the relative will see in their own voice,
 * how the invite was sent, and two ways in that both carry the link back. One kind message for every kind of bad link. Axe-clean.
 */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { InviteLandingCard, supporterAuthLinks } from "./invite-landing-card";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock("@/components/brand/guard-leaf-mark", () => ({ GuardLeafMark: () => <span aria-hidden /> }));

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";
const VALID = { ok: true as const, inviter_first_name: "Ngozi", permissions: ["weekly_bp_trend" as const, "red_alerts" as const], contact_kind: "email" as const, contact_hint: "a***@example.com" };

describe("InviteLandingCard", () => {
  it("says who invited them and what they will see, in their own voice, and nothing else about the patient", async () => {
    render(<InviteLandingCard token={TOKEN} landing={VALID} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Ngozi invited you to their Care Circle" })).toBeTruthy();
    expect(screen.getByText(/See Ngozi's weekly blood pressure trend/)).toBeTruthy();
    expect(screen.getByText(/Be asked to check on Ngozi/)).toBeTruthy();
    expect(screen.getByText(/This invite was sent to a\*\*\*@example\.com\. Use that email address/)).toBeTruthy();
    expect(screen.getByText(/we will not ask you any health questions/)).toBeTruthy();
    await expectNoA11yViolations(<InviteLandingCard token={TOKEN} landing={VALID} locale="en" />);
  });

  it("offers a supporter sign-up and a sign-in, each returning to the same invite", () => {
    render(<InviteLandingCard token={TOKEN} landing={VALID} locale="en" />);
    const back = encodeURIComponent(`/patient/supporting/join/${TOKEN}`);
    expect(screen.getByRole("link", { name: "Create a free supporter account" }).getAttribute("href")).toBe(`/signup?intent=support&redirect=${back}`);
    expect(screen.getByRole("link", { name: "I already have an account" }).getAttribute("href")).toBe(`/login?intent=support&redirect=${back}`);
    expect(supporterAuthLinks(TOKEN).signup).toContain("intent=support");
  });

  it("names a phone invite as a phone number", () => {
    render(<InviteLandingCard token={TOKEN} landing={{ ...VALID, contact_kind: "phone", contact_hint: "+234***45" }} locale="en" />);
    expect(screen.getByText(/Use that phone number/)).toBeTruthy();
  });

  it("shows one kind message for any link that does not work, and no way in", async () => {
    render(<InviteLandingCard token={TOKEN} landing={{ ok: false }} locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Ask the person who invited you to send a fresh link/);
    expect(screen.queryByRole("link")).toBeNull();
    await expectNoA11yViolations(<InviteLandingCard token={TOKEN} landing={{ ok: false }} locale="en" />);
  });

  it("names the rate limit, which is about the connection, not the invite", () => {
    render(<InviteLandingCard token={TOKEN} landing={{ ok: false, rate_limited: true }} locale="en" />);
    expect(screen.getByRole("alert").textContent).toMatch(/wait a few minutes/);
  });
});
