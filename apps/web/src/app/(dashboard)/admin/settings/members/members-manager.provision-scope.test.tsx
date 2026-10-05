/** @jest-environment jsdom */
/**
 * The create-a-login form used to offer every role (including Super Admin) and
 * every organisation to anyone holding users.provision. provisionMemberAction
 * now refuses a delegate outside their scope (lib/auth/member-provision-scope.ts),
 * so the form offers only what the server will accept: the delegable roles, and
 * the caller's own organisation, required. A Super Admin sees everything, as before.
 *
 * The server is the enforcement; this pins what the form offers.
 */
import { render, screen, within } from "@testing-library/react";
import { MembersManager } from "./members-manager";
import { USER_ROLES } from "@/lib/validation/members";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("./actions", () => ({
  provisionMemberAction: jest.fn(),
  createInstitutionOrgAction: jest.fn(),
  setMemberRoleAction: jest.fn(),
  setMemberPhoneAction: jest.fn(),
  setMemberActiveAction: jest.fn(),
  grantPermissionAction: jest.fn(),
  revokePermissionAction: jest.fn(),
  createCustomRoleAction: jest.fn(),
  setCustomRolePermissionsAction: jest.fn(),
  deleteCustomRoleAction: jest.fn(),
}));

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ORGS = [
  { id: ORG_A, name: "Org A", type: "tarragon" },
  { id: ORG_B, name: "Org B", type: "corporate" },
];

function renderForm(caller: { isSuperAdmin: boolean; organisationId: string | null }) {
  return render(
    <MembersManager
      members={[]}
      permissions={[]}
      customRoles={[]}
      organisations={ORGS}
      canProvision
      provisionCaller={caller}
      canManageOrgs={false}
      canAssignRoles={false}
      canEditContact={false}
      canSuspend={false}
      currentMemberId="me"
      suspendScope={{ isSuperAdmin: false, organisationId: null }}
      canGrant={false}
      canManageRoles={false}
      canViewActivity={false}
    />
  );
}

const optionValues = (select: HTMLElement) =>
  within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

describe("MembersManager create-a-login form", () => {
  it("offers a delegate only the delegable roles, never Super Admin", () => {
    renderForm({ isSuperAdmin: false, organisationId: ORG_A });

    const roles = optionValues(screen.getByLabelText("Role"));
    expect(roles).toEqual(["clinician", "care_coordinator"]);
    expect(roles).not.toContain("admin");
  });

  it("offers a delegate only their own organisation, preselected, required, with no 'None'", () => {
    renderForm({ isSuperAdmin: false, organisationId: ORG_A });

    const org = screen.getByLabelText("Organisation") as HTMLSelectElement;
    expect(optionValues(org)).toEqual([ORG_A]);
    expect(org.value).toBe(ORG_A);
    expect(org.required).toBe(true);
    expect(screen.queryByText(/Org B/)).toBeNull();
  });

  it("offers a Super Admin every role and every organisation, with 'None' and not required, as before", () => {
    renderForm({ isSuperAdmin: true, organisationId: null });

    expect(optionValues(screen.getByLabelText("Role"))).toEqual([...USER_ROLES]);
    expect(optionValues(screen.getByLabelText("Role"))).toContain("admin");

    const org = screen.getByLabelText("Organisation (optional)") as HTMLSelectElement;
    expect(optionValues(org)).toEqual(["", ORG_A, ORG_B]);
    expect(org.required).toBe(false);
  });

  it("SABOTAGE: the same form offers a Super Admin more than a delegate, so the caller is being read", () => {
    const delegate = renderForm({ isSuperAdmin: false, organisationId: ORG_A });
    const delegateRoles = optionValues(screen.getByLabelText("Role")).length;
    delegate.unmount();

    renderForm({ isSuperAdmin: true, organisationId: null });
    expect(optionValues(screen.getByLabelText("Role")).length).toBeGreaterThan(delegateRoles);
  });
});
