/**
 * provisionScope() is the enforcement for creating logins: provisionMemberAction
 * uses the service role, which bypasses every database policy, so the database
 * cannot tell who is asking. Probed against production on 2026-10-04: a login
 * created with metadata `role: admin` becomes an admin profile. These cases pin
 * who may create what.
 */
import { USER_ROLES } from "@/lib/validation/members";
import {
  DELEGATE_PROVISIONABLE_ROLES,
  provisionScope,
  provisionableOrganisations,
  provisionableRoles,
} from "./member-provision-scope";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const SUPER_ADMIN = { isSuperAdmin: true, organisationId: null };
const DELEGATE_A = { isSuperAdmin: false, organisationId: ORG_A };
const DELEGATE_NO_ORG = { isSuperAdmin: false, organisationId: null };

describe("provisionScope", () => {
  describe("a Super Admin", () => {
    it.each([
      ["a Super Admin login", { role: "admin", organisationId: null }],
      ["a partner login with no organisation", { role: "lab_partner", organisationId: null }],
      ["a finance login", { role: "finance", organisationId: null }],
      ["a clinician in any organisation", { role: "clinician", organisationId: ORG_B }],
    ])("may create %s", (_label, input) => {
      expect(provisionScope(SUPER_ADMIN, input)).toEqual({ allowed: true });
    });
  });

  describe("a delegated users.provision holder", () => {
    it.each(DELEGATE_PROVISIONABLE_ROLES)("may create a %s in their own organisation", (role) => {
      expect(provisionScope(DELEGATE_A, { role, organisationId: ORG_A })).toEqual({ allowed: true });
    });

    it("is refused a Super Admin login, in their own organisation or none", () => {
      for (const organisationId of [ORG_A, null, undefined]) {
        const d = provisionScope(DELEGATE_A, { role: "admin", organisationId });
        expect(d).toMatchObject({ allowed: false, reason: "super_admin_role" });
      }
    });

    it.each(["finance", "analyst", "pharmacist", "lab_partner", "lab_liaison", "corporate_admin", "hmo_admin", "patient"])(
      "is refused a %s login even in their own organisation",
      (role) => {
        expect(provisionScope(DELEGATE_A, { role, organisationId: ORG_A })).toMatchObject({
          allowed: false,
          reason: "role_not_allowed",
        });
      }
    );

    it.each([null, undefined, ""])("is refused a clinician with no organisation (%p)", (organisationId) => {
      expect(provisionScope(DELEGATE_A, { role: "clinician", organisationId })).toMatchObject({
        allowed: false,
        reason: "no_organisation",
      });
    });

    it("is refused a clinician in another organisation", () => {
      expect(provisionScope(DELEGATE_A, { role: "clinician", organisationId: ORG_B })).toMatchObject({
        allowed: false,
        reason: "other_organisation",
      });
    });

    it("with no organisation of their own is refused every organisation, never matched by null", () => {
      expect(provisionScope(DELEGATE_NO_ORG, { role: "clinician", organisationId: ORG_A })).toMatchObject({
        allowed: false,
        reason: "other_organisation",
      });
    });

    it("gets a message that says what to do", () => {
      const d = provisionScope(DELEGATE_A, { role: "admin", organisationId: null });
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.message).toMatch(/Super Admin/);
    });
  });

  describe("SABOTAGE controls: the rule reads its inputs, not refusing or allowing everything", () => {
    it("the same request is allowed for a Super Admin and refused for a delegate", () => {
      const req = { role: "admin", organisationId: null };
      expect(provisionScope(SUPER_ADMIN, req).allowed).toBe(true);
      expect(provisionScope(DELEGATE_A, req).allowed).toBe(false);
    });

    it("the same delegate is allowed in their organisation and refused in another", () => {
      expect(provisionScope(DELEGATE_A, { role: "clinician", organisationId: ORG_A }).allowed).toBe(true);
      expect(provisionScope(DELEGATE_A, { role: "clinician", organisationId: ORG_B }).allowed).toBe(false);
    });
  });

  describe("what the form offers", () => {
    const orgs = [{ id: ORG_A }, { id: ORG_B }];

    it("offers a Super Admin every role and every organisation", () => {
      expect(provisionableRoles(SUPER_ADMIN, USER_ROLES)).toEqual([...USER_ROLES]);
      expect(provisionableOrganisations(SUPER_ADMIN, orgs)).toHaveLength(2);
    });

    it("offers a delegate only the delegable roles, and only their own organisation", () => {
      expect(provisionableRoles(DELEGATE_A, USER_ROLES)).toEqual([...DELEGATE_PROVISIONABLE_ROLES]);
      expect(provisionableRoles(DELEGATE_A, USER_ROLES)).not.toContain("admin");
      expect(provisionableOrganisations(DELEGATE_A, orgs)).toEqual([{ id: ORG_A }]);
    });

    it("offers a delegate with no organisation none", () => {
      expect(provisionableOrganisations(DELEGATE_NO_ORG, orgs)).toEqual([]);
    });

    it("everything the form offers a delegate is something the server accepts", () => {
      for (const role of provisionableRoles(DELEGATE_A, USER_ROLES)) {
        for (const o of provisionableOrganisations(DELEGATE_A, orgs)) {
          expect(provisionScope(DELEGATE_A, { role, organisationId: o.id }).allowed).toBe(true);
        }
      }
    });
  });
});
