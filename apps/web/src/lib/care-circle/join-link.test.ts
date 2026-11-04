import { isJoinToken, joinLandingPath, joinPath, parseInviteLanding, parseInviteStatus, safeJoinRedirect } from "./join-link";
import { signupHrefFor } from "@/lib/auth/signup-href";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";

describe("join link", () => {
  it("accepts only the URL-safe token alphabet the database issues", () => {
    expect(isJoinToken(TOKEN)).toBe(true);
    for (const bad of ["", "short", "a b".repeat(10), "abc/def".repeat(4), "x".repeat(129), "abc%2F".repeat(5), null, 42]) {
      expect(isJoinToken(bad)).toBe(false);
    }
  });

  it("builds both paths from one token", () => {
    expect(joinPath(TOKEN)).toBe(`/patient/supporting/join/${TOKEN}`);
    expect(joinLandingPath(TOKEN)).toBe(`/circle/join/${TOKEN}`);
  });

  it("carries a redirect only when it is exactly a join link", () => {
    expect(safeJoinRedirect(joinPath(TOKEN))).toBe(joinPath(TOKEN));
    for (const bad of [
      `https://evil.example${joinPath(TOKEN)}`,
      `//evil.example${joinPath(TOKEN)}`,
      `${joinPath(TOKEN)}?next=/admin`,
      `${joinPath(TOKEN)}#x`,
      `${joinPath(TOKEN)}/../../admin`,
      "/patient/supporting",
      "/patient/supporting/join/",
      undefined,
    ]) {
      expect(safeJoinRedirect(bad)).toBeNull();
    }
  });

  it("keeps a supporter a supporter on the way from sign-in to sign-up", () => {
    expect(signupHrefFor(joinPath(TOKEN), true)).toBe(`/signup?intent=support&redirect=${encodeURIComponent(joinPath(TOKEN))}`);
    expect(signupHrefFor("/claim/x", false)).toBe(`/signup?redirect=${encodeURIComponent("/claim/x")}`);
    expect(signupHrefFor(null, false)).toBe("/signup");
  });

  it("parses the landing and drops anything it does not know", () => {
    expect(parseInviteLanding({ ok: true, inviter_first_name: "Ngozi", permissions: ["weekly_bp_trend", "made_up"], contact_kind: "email", contact_hint: "a***@x.com" })).toEqual({
      ok: true,
      inviter_first_name: "Ngozi",
      permissions: ["weekly_bp_trend"],
      contact_kind: "email",
      contact_hint: "a***@x.com",
    });
    expect(parseInviteLanding({ ok: true })).toEqual({ ok: false });
    expect(parseInviteLanding("nonsense")).toEqual({ ok: false });
  });

  it("parses a status and treats anything unknown as 'not available'", () => {
    expect(parseInviteStatus({ reason: "wrong_contact", contact_kind: "phone", contact_hint: "+234***12" }).reason).toBe("wrong_contact");
    expect(parseInviteStatus({ reason: "something_new" }).reason).toBe("not_available");
    expect(parseInviteStatus(null).reason).toBe("not_available");
  });
});
