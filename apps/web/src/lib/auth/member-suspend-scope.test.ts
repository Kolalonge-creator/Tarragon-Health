/**
 * suspendScope() mirrors the scope rule inside public.set_member_active
 * (20261004194229_set_member_active_scope_and_audit.sql). The RPC is the real
 * enforcement; this decides what the members screen offers. These cases are the
 * RPC's own refusals, in the RPC's own order, so the screen and the database
 * cannot quietly drift apart.
 */
import { SUSPEND_SCOPE_HINT, suspendScope } from "./member-suspend-scope";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const SUPER_ADMIN = { id: "sa", isSuperAdmin: true, organisationId: null };
const DELEGATE_A = { id: "del", isSuperAdmin: false, organisationId: ORG_A };
const DELEGATE_NO_ORG = { id: "del0", isSuperAdmin: false, organisationId: null };

const target = (over: Partial<{ id: string; role: string; organisation_id: string | null }> = {}) => ({
  id: "t",
  role: "clinician",
  organisation_id: ORG_A as string | null,
  ...over,
});

describe("suspendScope", () => {
  describe("a Super Admin", () => {
    it.each([
      ["a member of any organisation", target({ organisation_id: ORG_B })],
      ["another Super Admin", target({ role: "admin", organisation_id: null })],
      ["a null-organisation partner login", target({ role: "lab_partner", organisation_id: null })],
    ])("may act on %s", (_label, t) => {
      expect(suspendScope(SUPER_ADMIN, t)).toEqual({ allowed: true });
    });
  });

  describe("a delegated users.suspend holder", () => {
    it("may act on a non-admin member of their own organisation", () => {
      expect(suspendScope(DELEGATE_A, target())).toEqual({ allowed: true });
    });

    it("is refused a Super Admin", () => {
      expect(suspendScope(DELEGATE_A, target({ role: "admin", organisation_id: null }))).toEqual({
        allowed: false,
        reason: "super_admin_target",
      });
    });

    it("is refused a Super Admin even when that account carries their organisation", () => {
      expect(suspendScope(DELEGATE_A, target({ role: "admin", organisation_id: ORG_A }))).toEqual({
        allowed: false,
        reason: "super_admin_target",
      });
    });

    it("is refused a null-organisation account (partner / platform-level login)", () => {
      expect(suspendScope(DELEGATE_A, target({ role: "lab_partner", organisation_id: null }))).toEqual({
        allowed: false,
        reason: "no_organisation",
      });
    });

    it("is refused a member of another organisation", () => {
      expect(suspendScope(DELEGATE_A, target({ organisation_id: ORG_B }))).toEqual({
        allowed: false,
        reason: "other_organisation",
      });
    });

    it("with no organisation of their own is refused every org member, never matched by null", () => {
      expect(suspendScope(DELEGATE_NO_ORG, target())).toEqual({
        allowed: false,
        reason: "other_organisation",
      });
    });
  });

  describe("your own row", () => {
    it.each([
      ["a Super Admin", SUPER_ADMIN],
      ["a delegate", DELEGATE_A],
    ])("is never offered to %s", (_label, caller) => {
      expect(suspendScope(caller, target({ id: caller.id }))).toEqual({ allowed: false, reason: "self" });
    });
  });

  describe("SABOTAGE controls: the rule is reading the inputs, not refusing or allowing everything", () => {
    it("the same delegate is allowed in-org and refused out-of-org", () => {
      expect(suspendScope(DELEGATE_A, target({ organisation_id: ORG_A })).allowed).toBe(true);
      expect(suspendScope(DELEGATE_A, target({ organisation_id: ORG_B })).allowed).toBe(false);
    });

    it("the same target is allowed for a Super Admin and refused for a delegate", () => {
      const t = target({ organisation_id: ORG_B });
      expect(suspendScope(SUPER_ADMIN, t).allowed).toBe(true);
      expect(suspendScope(DELEGATE_A, t).allowed).toBe(false);
    });
  });

  describe("hints", () => {
    it("explains every refusal except the caller's own row", () => {
      expect(SUSPEND_SCOPE_HINT.self).toBeNull();
      expect(SUSPEND_SCOPE_HINT.super_admin_target).toMatch(/Super Admin/);
      expect(SUSPEND_SCOPE_HINT.no_organisation).toMatch(/partner and platform-level/);
      expect(SUSPEND_SCOPE_HINT.other_organisation).toMatch(/own organisation/);
    });
  });
});
