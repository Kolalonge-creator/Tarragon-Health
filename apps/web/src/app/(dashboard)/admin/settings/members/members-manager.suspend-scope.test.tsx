/** @jest-environment jsdom */
/**
 * The members screen used to offer "Suspend login" on every row to anyone holding
 * users.suspend. The set_member_active RPC refuses a delegated holder for a Super
 * Admin, a null-organisation (partner / platform-level) login, and a member of
 * another organisation, so the screen offered buttons that could only produce an
 * error. It now mirrors the RPC's scope rule (lib/auth/member-suspend-scope.ts)
 * and says why where it hides the control.
 *
 * These tests render the real screen. The RPC is the enforcement; this only pins
 * what is offered.
 */
import { render, screen } from "@testing-library/react";
import { MembersManager } from "./members-manager";
import type { MemberRow } from "./page";

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

function member(over: Partial<MemberRow> & Pick<MemberRow, "id" | "full_name" | "role">): MemberRow {
  return {
    email: `${over.id}@example.test`,
    phone: null,
    organisation_id: ORG_A,
    organisation_name: "Org A",
    custom_role_id: null,
    custom_role_name: null,
    is_active: true,
    grants: [],
    ...over,
  };
}

const ME = member({ id: "me", full_name: "Me Delegate", role: "clinician" });
const PEER = member({ id: "peer", full_name: "Peer Inorg", role: "clinician" });
const OTHER_ORG = member({
  id: "other",
  full_name: "Other Orgmember",
  role: "clinician",
  organisation_id: ORG_B,
  organisation_name: "Org B",
});
const PARTNER = member({
  id: "partner",
  full_name: "Null Orgpartner",
  role: "lab_partner",
  organisation_id: null,
  organisation_name: null,
});
const BOSS = member({
  id: "boss",
  full_name: "Super Admin",
  role: "admin",
  organisation_id: null,
  organisation_name: null,
});

const MEMBERS = [ME, PEER, OTHER_ORG, PARTNER, BOSS];

function renderManager(scope: { isSuperAdmin: boolean; organisationId: string | null }, currentMemberId: string, canSuspend = true) {
  return render(
    <MembersManager
      members={MEMBERS}
      permissions={[]}
      customRoles={[]}
      organisations={[]}
      canProvision={false}
      provisionCaller={{ isSuperAdmin: false, organisationId: null }}
      canManageOrgs={false}
      canAssignRoles={false}
      canEditContact={false}
      canSuspend={canSuspend}
      currentMemberId={currentMemberId}
      suspendScope={scope}
      canGrant={false}
      canManageRoles={false}
      canViewActivity={false}
    />
  );
}

const suspendButtons = () => screen.queryAllByRole("button", { name: "Suspend login" });

describe("MembersManager suspend controls", () => {
  it("offers a delegated holder the button only for a non-admin member of their own organisation", () => {
    renderManager({ isSuperAdmin: false, organisationId: ORG_A }, ME.id);

    // Exactly one: the in-org peer. Not themselves, not the other org, not the
    // partner login, not the Super Admin.
    expect(suspendButtons()).toHaveLength(1);
  });

  it("explains each hidden control instead of leaving a silent gap", () => {
    renderManager({ isSuperAdmin: false, organisationId: ORG_A }, ME.id);

    expect(screen.getByText("Only a Super Admin can suspend or reinstate a Super Admin.")).toBeTruthy();
    expect(
      screen.getByText("Only a Super Admin can suspend or reinstate partner and platform-level logins.")
    ).toBeTruthy();
    expect(screen.getByText("You can only suspend or reinstate members of your own organisation.")).toBeTruthy();
  });

  it("offers a Super Admin the button on every row except their own, with no scope hints", () => {
    renderManager({ isSuperAdmin: true, organisationId: null }, BOSS.id);

    // ME, PEER, OTHER_ORG, PARTNER: four. BOSS is the caller.
    expect(suspendButtons()).toHaveLength(4);
    expect(screen.queryByText(/Only a Super Admin can suspend/)).toBeNull();
    expect(screen.queryByText(/own organisation/)).toBeNull();
  });

  it("shows a Reinstate button, subject to the same scope, for a suspended member", () => {
    const suspendedPeer = { ...PEER, is_active: false };
    render(
      <MembersManager
        members={[ME, suspendedPeer, { ...OTHER_ORG, is_active: false }]}
        permissions={[]}
        customRoles={[]}
        organisations={[]}
        canProvision={false}
        provisionCaller={{ isSuperAdmin: false, organisationId: null }}
        canManageOrgs={false}
        canAssignRoles={false}
        canEditContact={false}
        canSuspend
        currentMemberId={ME.id}
        suspendScope={{ isSuperAdmin: false, organisationId: ORG_A }}
        canGrant={false}
        canManageRoles={false}
        canViewActivity={false}
      />
    );

    expect(screen.queryAllByRole("button", { name: "Reinstate login" })).toHaveLength(1);
  });

  it("SABOTAGE: the same screen offers more to a Super Admin than to a delegate, so scope is being read", () => {
    const delegate = renderManager({ isSuperAdmin: false, organisationId: ORG_A }, ME.id);
    const delegateCount = suspendButtons().length;
    delegate.unmount();

    renderManager({ isSuperAdmin: true, organisationId: null }, BOSS.id);
    expect(suspendButtons().length).toBeGreaterThan(delegateCount);
  });

  it("offers nothing, and no hints, to someone without users.suspend", () => {
    renderManager({ isSuperAdmin: false, organisationId: ORG_A }, ME.id, false);

    expect(suspendButtons()).toHaveLength(0);
    expect(screen.queryByText(/Only a Super Admin can suspend/)).toBeNull();
    expect(screen.queryByText(/own organisation/)).toBeNull();
  });
});
