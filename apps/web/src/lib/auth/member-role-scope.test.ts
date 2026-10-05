import { roleScope, assignableRoles, DELEGATE_ASSIGNABLE_ROLES } from "./member-role-scope";
import { USER_ROLES } from "@/lib/validation/members";

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const SUPER_ADMIN = { id: "admin-1", isSuperAdmin: true, organisationId: null };
const DELEGATE = { id: "delegate-1", isSuperAdmin: false, organisationId: ORG_A };

describe("roleScope", () => {
  it("refuses self-assignment for anyone", () => {
    const d = roleScope(DELEGATE, { id: DELEGATE.id, role: "clinician", organisation_id: ORG_A });
    expect(d).toEqual({ allowed: false, reason: "self" });
  });

  it("allows a Super Admin to act on any member", () => {
    expect(roleScope(SUPER_ADMIN, { id: "x", role: "admin", organisation_id: null })).toEqual({ allowed: true });
    expect(roleScope(SUPER_ADMIN, { id: "x", role: "clinician", organisation_id: ORG_A })).toEqual({ allowed: true });
  });

  it("refuses a delegate targeting a Super Admin", () => {
    const d = roleScope(DELEGATE, { id: "x", role: "admin", organisation_id: null });
    expect(d).toEqual({ allowed: false, reason: "super_admin_target" });
  });

  it("refuses a delegate targeting a null-org account", () => {
    const d = roleScope(DELEGATE, { id: "x", role: "lab_partner", organisation_id: null });
    expect(d).toEqual({ allowed: false, reason: "no_organisation" });
  });

  it("refuses a delegate targeting another org", () => {
    const d = roleScope(DELEGATE, { id: "x", role: "clinician", organisation_id: ORG_B });
    expect(d).toEqual({ allowed: false, reason: "other_organisation" });
  });

  it("allows a delegate to act on a same-org member", () => {
    expect(roleScope(DELEGATE, { id: "x", role: "clinician", organisation_id: ORG_A })).toEqual({ allowed: true });
    expect(roleScope(DELEGATE, { id: "x", role: "care_coordinator", organisation_id: ORG_A })).toEqual({ allowed: true });
  });
});

describe("assignableRoles", () => {
  it("gives a Super Admin all roles", () => {
    expect(assignableRoles({ isSuperAdmin: true }, USER_ROLES)).toEqual([...USER_ROLES]);
  });

  it("gives a delegate only clinician and care_coordinator", () => {
    const roles = assignableRoles({ isSuperAdmin: false }, USER_ROLES);
    expect(roles).toEqual([...DELEGATE_ASSIGNABLE_ROLES]);
    expect(roles).not.toContain("admin");
    expect(roles).not.toContain("finance");
    expect(roles).not.toContain("analyst");
  });

  it("every delegate-assignable role is a real user role", () => {
    for (const r of DELEGATE_ASSIGNABLE_ROLES) {
      expect(USER_ROLES).toContain(r);
    }
  });
});
