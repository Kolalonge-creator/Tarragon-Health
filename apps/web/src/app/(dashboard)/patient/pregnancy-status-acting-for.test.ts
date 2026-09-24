/**
 * setPregnancyStatus (actions.ts) writes into patient_pregnancy, whose RLS
 * is still self-or-staff-only (the reproductive-health domain never gets a
 * bare private.can_act_for() carve-out on this platform — see
 * reproductive_health_profiles' own RLS, which additionally requires a
 * category-scoped grant AND private.guardian_may_edit_confidential_domain).
 *
 * Found by /code-review ultra as a regression risk from the same-day
 * currentPatientOrg() acting-for fix (see diabetes-self-monitoring-acting-
 * for.test.ts): once currentPatientOrg() correctly resolves the acting-for
 * subject, a supporter's pregnancy-status save would resolve to the
 * dependent's id and then hit a bare, confusing RLS error, instead of the
 * pre-fix silent misattribution. This proves setPregnancyStatus instead
 * refuses cleanly with an explanatory message whenever acting-for is
 * active, before ever attempting the write — extending real write access
 * here is a deliberate future decision, not a default to reach for.
 */

const getActingFor = jest.fn();
jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: jest.fn(async (id: string) => id),
  getActingFor: (...args: unknown[]) => getActingFor(...args),
}));

const upsert = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "caller-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      }
      if (table === "patient_pregnancy") {
        return { upsert: (row: Record<string, unknown>) => { upsert(row); return { error: null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { setPregnancyStatus } from "./actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("setPregnancyStatus while acting for someone", () => {
  beforeEach(() => {
    upsert.mockReset();
    getActingFor.mockReset();
  });

  it("refuses cleanly, without ever writing, when acting for a dependent", async () => {
    getActingFor.mockResolvedValue({ profileId: "dependent-1", fullName: "A Dependent" });
    const result = await setPregnancyStatus(undefined, fd({ is_pregnant: "true" }));
    expect(result?.error).toMatch(/account holder themselves/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still works normally for the account holder's own record", async () => {
    getActingFor.mockResolvedValue(null);
    const result = await setPregnancyStatus(undefined, fd({ is_pregnant: "true" }));
    expect(result?.error).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ patient_id: "caller-1", is_pregnant: true }));
  });
});
