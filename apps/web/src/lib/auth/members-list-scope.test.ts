/**
 * membersListScope() decides what the Members & access page may show. The page
 * loads with the service role, which bypasses row-level security, so the page has
 * to scope itself. It matches the scope the actions enforce: a Super Admin sees
 * everyone; anyone else only the non-admin members of their own organisation.
 */
import { membersListScope } from "./members-list-scope";

const ORG_A = "11111111-1111-4111-8111-111111111111";

describe("membersListScope", () => {
  it("a Super Admin sees everyone", () => {
    expect(membersListScope({ isSuperAdmin: true, organisationId: null })).toEqual({ kind: "all" });
  });

  it("a Super Admin who happens to carry an organisation still sees everyone", () => {
    expect(membersListScope({ isSuperAdmin: true, organisationId: ORG_A })).toEqual({ kind: "all" });
  });

  it("anyone else sees only their own organisation", () => {
    expect(membersListScope({ isSuperAdmin: false, organisationId: ORG_A })).toEqual({
      kind: "organisation",
      organisationId: ORG_A,
    });
  });

  it("a non-admin with no organisation sees nothing, never 'everything with no organisation'", () => {
    expect(membersListScope({ isSuperAdmin: false, organisationId: null })).toEqual({ kind: "none" });
  });
});
