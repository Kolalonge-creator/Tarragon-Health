/**
 * The Members & access page loads with the service role so it can show auth
 * emails. The service role bypasses row-level security, so the page decides what
 * the caller sees. It used to show every non-patient member of every organisation,
 * with emails, to anyone holding any user-administration permission. It now scopes
 * to the caller (lib/auth/members-list-scope.ts):
 *   - a Super Admin sees everyone;
 *   - anyone else sees only the non-admin members of their own organisation, and
 *     only their own organisation in the organisation list;
 *   - a non-admin with no organisation sees nothing.
 *
 * These tests run the real page against a small in-memory fake of the service
 * client that applies eq / neq / is / limit for real, then inspect the props the
 * page hands to the client component, and the whole serialised payload, so a leak
 * through any prop shows up.
 */
import type { ReactElement } from "react";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const profile = (id: string, over: Row = {}): Row => ({
  id,
  full_name: `Name ${id}`,
  role: "clinician",
  phone: null,
  organisation_id: ORG_A,
  custom_role_id: null,
  is_active: true,
  organisations: { name: "Org A" },
  custom_roles: null,
  ...over,
});

const ME = profile("me", { full_name: "Me Delegate" });
const PEER = profile("peer", { full_name: "Peer InOrg" });
const COORD = profile("coord", { role: "care_coordinator", full_name: "Coord InOrg" });
const ADMIN_IN_ORG_A = profile("admin-a", { role: "admin", full_name: "Admin InOrgA" });
const OTHER_ORG = profile("other", { organisation_id: ORG_B, organisations: { name: "Org B" }, full_name: "Other OrgB" });
const PARTNER = profile("partner", { role: "lab_partner", organisation_id: null, organisations: null, full_name: "Partner NullOrg" });
const SUPER = profile("super", { role: "admin", organisation_id: null, organisations: null, full_name: "Super Admin" });
const PATIENT = profile("patient", { role: "patient", full_name: "Patient InOrg" });

const TABLES: Record<string, Row[]> = {
  profiles: [ME, PEER, COORD, ADMIN_IN_ORG_A, OTHER_ORG, PARTNER, SUPER, PATIENT],
  organisations: [
    { id: ORG_A, name: "Org A", type: "tarragon" },
    { id: ORG_B, name: "Org B", type: "corporate" },
  ],
  permissions: [{ key: "users.suspend", label: "Suspend", category: "Users", description: null }],
  custom_roles: [],
  user_permission_grants: [
    { id: "g1", profile_id: "peer", permission_key: "users.suspend" },
    { id: "g2", profile_id: "other", permission_key: "users.provision" },
    { id: "g3", profile_id: "partner", permission_key: "partners.labs.manage" },
  ],
};

const AUTH_USERS = [
  { id: "me", email: "me@example.test" },
  { id: "peer", email: "peer@example.test" },
  { id: "coord", email: "coord@example.test" },
  { id: "admin-a", email: "admin-a@example.test" },
  { id: "other", email: "other.org@example.test" },
  { id: "partner", email: "partner.null@example.test" },
  { id: "super", email: "super@example.test" },
];

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private lim: number | undefined;
  constructor(private rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  limit(n: number) { this.lim = n; return this; }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.lim !== undefined) out = out.slice(0, this.lim);
    return Promise.resolve({ data: out, error: null }).then(resolve);
  }
}

type Caller = { id: string; role: string; organisation_id: string | null };
let caller: Caller = { id: "me", role: "clinician", organisation_id: ORG_A };
let callerKeys: string[] = ["users.suspend"];

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn(async () => caller),
}));
jest.mock("@/lib/auth/permissions", () => ({
  getCallerPermissions: jest.fn(async () => ({
    isSuperAdmin: caller.role === "admin",
    keys: new Set(callerKeys),
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: (table: string) => new FakeQuery(TABLES[table] ?? []),
    auth: { admin: { listUsers: async () => ({ data: { users: AUTH_USERS } }) } },
  })),
}));

import MembersPage from "./page";
import { MembersManager } from "./members-manager";

type ManagerProps = {
  members: { id: string; email: string | null; grants: { id: string }[] }[];
  organisations: { id: string; name: string }[];
};

function findManager(node: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === MembersManager) return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = findManager(k);
    if (found) return found;
  }
  return null;
}

async function loadProps(): Promise<ManagerProps> {
  const tree = await MembersPage();
  const manager = findManager(tree);
  if (!manager) throw new Error("MembersManager was not rendered");
  return manager.props as unknown as ManagerProps;
}

const ids = (p: ManagerProps) => p.members.map((m) => m.id).sort();

describe("Members & access page scope", () => {
  describe("a delegated user-administrator in organisation A", () => {
    beforeEach(() => {
      caller = { id: "me", role: "clinician", organisation_id: ORG_A };
      callerKeys = ["users.suspend"];
    });

    it("sees only the non-admin members of their own organisation", async () => {
      const p = await loadProps();
      expect(ids(p)).toEqual(["coord", "me", "peer"]);
    });

    it("is not shown another organisation's member, a partner login, or any Super Admin, even one carrying their organisation", async () => {
      const p = await loadProps();
      for (const hidden of ["other", "partner", "super", "admin-a", "patient"]) {
        expect(ids(p)).not.toContain(hidden);
      }
    });

    it("gets emails and grants only for the members they can see", async () => {
      const p = await loadProps();
      expect(p.members.find((m) => m.id === "peer")?.email).toBe("peer@example.test");
      expect(p.members.find((m) => m.id === "peer")?.grants).toHaveLength(1);
    });

    it("gets only their own organisation in the organisation list", async () => {
      const p = await loadProps();
      expect(p.organisations.map((o) => o.id)).toEqual([ORG_A]);
    });

    it("has nothing about any other organisation anywhere in what the page sends to the browser", async () => {
      const payload = JSON.stringify(await loadProps());
      for (const secret of [
        "other.org@example.test",
        "partner.null@example.test",
        "super@example.test",
        "admin-a@example.test",
        "Other OrgB",
        "Partner NullOrg",
        "Admin InOrgA",
        "Org B",
        "partners.labs.manage",
        "users.provision",
      ]) {
        expect(payload).not.toContain(secret);
      }
    });
  });

  describe("a non-admin with no organisation of their own", () => {
    it("sees no members and no organisations", async () => {
      caller = { id: "me", role: "clinician", organisation_id: null };
      callerKeys = ["users.suspend"];
      const p = await loadProps();
      expect(p.members).toEqual([]);
      expect(p.organisations).toEqual([]);
    });
  });

  describe("a Super Admin", () => {
    beforeEach(() => {
      caller = { id: "super", role: "admin", organisation_id: null };
      callerKeys = [];
    });

    it("still sees every non-patient member of every organisation, with emails", async () => {
      const p = await loadProps();
      expect(ids(p)).toEqual(["admin-a", "coord", "me", "other", "partner", "peer", "super"]);
      expect(p.members.find((m) => m.id === "other")?.email).toBe("other.org@example.test");
    });

    it("still never sees patients on this page", async () => {
      expect(ids(await loadProps())).not.toContain("patient");
    });

    it("still sees every organisation", async () => {
      const p = await loadProps();
      expect(p.organisations.map((o) => o.id).sort()).toEqual([ORG_A, ORG_B]);
    });
  });

  it("SABOTAGE: the same data shows a Super Admin more than a delegate, so the caller is being read", async () => {
    caller = { id: "me", role: "clinician", organisation_id: ORG_A };
    callerKeys = ["users.suspend"];
    const delegate = await loadProps();

    caller = { id: "super", role: "admin", organisation_id: null };
    callerKeys = [];
    const admin = await loadProps();

    expect(admin.members.length).toBeGreaterThan(delegate.members.length);
    expect(admin.organisations.length).toBeGreaterThan(delegate.organisations.length);
  });
});
