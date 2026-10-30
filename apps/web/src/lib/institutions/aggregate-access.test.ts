/**
 * S75 A2: every institution aggregate read is recorded (who, which organisation, which surface) under the
 * caller's own session, a refused caller records nothing, and a failure to write the record is reported but
 * does not take the dashboard down. No health value is ever passed to the record call.
 */
jest.mock("server-only", () => ({}));

const rpc = jest.fn();
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

let profileRow: { role: string; organisation_id: string } | null = { role: "hmo_admin", organisation_id: "org-1" };
let user: { id: string } | null = { id: "u-1" };
let profileError: { code?: string; message: string } | null = null;
let countReply: { count: number | null; error: { message: string } | null } = { count: 25, error: null };
let orgReply: { data: { min_cohort_size: number } | null } = { data: { min_cohort_size: 10 } };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: profileError }) }) }) }),
    rpc: (...a: unknown[]) => rpc(...a),
  })),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "organisations") {
        return { select: () => ({ eq: () => ({ single: async () => orgReply }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: async () => countReply }) }) };
    },
  }),
}));

import { requireInstitutionAggregateAccess } from "./aggregate-access";

beforeEach(() => {
  rpc.mockReset();
  captureException.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  profileRow = { role: "hmo_admin", organisation_id: "org-1" };
  user = { id: "u-1" };
  profileError = null;
  countReply = { count: 25, error: null };
  orgReply = { data: { min_cohort_size: 10 } };
});

describe("requireInstitutionAggregateAccess audit", () => {
  it("records one read with only the organisation and a surface label", async () => {
    const access = await requireInstitutionAggregateAccess("org-1", "hmo_dashboard");
    expect(access?.organisationId).toBe("org-1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_institution_aggregate_read", {
      p_organisation_id: "org-1",
      p_surface: "hmo_dashboard",
    });
  });

  it("uses a generic surface label when none is given", async () => {
    await requireInstitutionAggregateAccess("org-1");
    expect(rpc).toHaveBeenCalledWith("log_institution_aggregate_read", {
      p_organisation_id: "org-1",
      p_surface: "institution_aggregate",
    });
  });

  it("records nothing for a refused caller (another organisation, a patient, no session)", async () => {
    expect(await requireInstitutionAggregateAccess("org-2", "hmo_dashboard")).toBeNull();
    profileRow = { role: "patient", organisation_id: "org-1" };
    expect(await requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).toBeNull();
    user = null;
    expect(await requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still returns the aggregates, and reports to Sentry, when the audit write fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const access = await requireInstitutionAggregateAccess("org-1", "hmo_dashboard");
    expect(access?.organisationId).toBe("org-1");
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe("requireInstitutionAggregateAccess failed reads", () => {
  it("reports the real cohort size and suppression when every read succeeds", async () => {
    const access = await requireInstitutionAggregateAccess("org-1", "hmo_dashboard");
    expect(access).toMatchObject({ cohortSize: 25, minCohortSize: 10, suppressed: false });
  });

  it("throws when the cohort size cannot be read, rather than reporting 0 people", async () => {
    countReply = { count: null, error: { message: "boom" } };
    await expect(requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).rejects.toThrow(/cohort size/);
  });

  it("throws when no count comes back at all", async () => {
    countReply = { count: null, error: null };
    await expect(requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).rejects.toThrow(/cohort size/);
  });

  it("throws when the caller's own profile read fails, rather than refusing an entitled admin", async () => {
    profileRow = null;
    profileError = { code: "08006", message: "connection lost" };
    await expect(requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).rejects.toBeDefined();
  });

  it("still refuses (null) when there is simply no profile row", async () => {
    profileRow = null;
    profileError = { code: "PGRST116", message: "no rows" };
    expect(await requireInstitutionAggregateAccess("org-1", "hmo_dashboard")).toBeNull();
  });

  it("falls back to the cautious default floor when the threshold cannot be read", async () => {
    orgReply = { data: null };
    const access = await requireInstitutionAggregateAccess("org-1", "hmo_dashboard");
    expect(access?.minCohortSize).toBe(10);
  });
});
