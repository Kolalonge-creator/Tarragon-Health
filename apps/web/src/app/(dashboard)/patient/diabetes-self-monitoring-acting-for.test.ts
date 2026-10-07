/**
 * currentPatientOrg() (used by logInsulin/logFootSelfCheck/logSickDay/
 * setPatientReportedDiabetesType) used to resolve identity from a plain
 * supabase.auth.getUser() instead of the acting-for subject the rest of the
 * Vitals & symptoms page already threads via resolveSubjectId — found during
 * the 2026-09-24 patient-dashboard audit. A supporter acting for a
 * dependent (e.g. a parent managing a diabetic child's account) had every
 * entry silently written under their OWN patient_id instead of the
 * dependent's — for the foot self-check specifically, that meant a same-day
 * urgent clinician_alerts row raised against the wrong, non-diabetic
 * patient (private.handle_foot_self_check(), see
 * 20260924071557_diabetes_self_monitoring_acting_supporter.sql's header).
 *
 * This proves the app-layer half of that fix: every write below is scoped
 * to the RESOLVED subject (what resolveSubjectId returns), never to the
 * raw signed-in caller id. The DB-layer half (the RLS policies that let a
 * 'manage' supporter actually write there, plus a full clinician_alerts
 * misattribution proof) is proven in
 * packages/db/tests/diabetes_self_monitoring_acting_supporter.sql.
 */

const CALLER_ID = "caller-profile-id";
const SUBJECT_ID = "dependent-profile-id"; // what resolveSubjectId returns while acting for someone
const ORG_ID = "org-1";

const resolveSubjectId = jest.fn();
jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: (...args: unknown[]) => resolveSubjectId(...args),
}));

const inserted: { table: string; row: Record<string, unknown> }[] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

function supabaseStub() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER_ID } } }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { organisation_id: ORG_ID } }),
            }),
          }),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return { error: null };
        },
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { error: null };
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub(),
}));

import { logInsulin, logFootSelfCheck, logSickDay, setPatientReportedDiabetesType } from "./actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("diabetes self-monitoring writes go to the acting-for subject, not the caller", () => {
  beforeEach(() => {
    inserted.length = 0;
    rpcCalls.length = 0;
    resolveSubjectId.mockReset().mockResolvedValue(SUBJECT_ID);
  });

  it("logInsulin inserts under the resolved subject", async () => {
    const result = await logInsulin(undefined, fd({ insulin_type: "analogue_rapid", units: "4" }));
    expect(result?.error).toBeUndefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe("insulin_logs");
    expect(inserted[0]!.row.patient_id).toBe(SUBJECT_ID);
    expect(inserted[0]!.row.patient_id).not.toBe(CALLER_ID);
    expect(inserted[0]!.row.organisation_id).toBe(ORG_ID);
  });

  it("logFootSelfCheck inserts under the resolved subject", async () => {
    const result = await logFootSelfCheck(undefined, fd({ any_problem: "true" }));
    expect(result?.error).toBeUndefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe("foot_self_checks");
    expect(inserted[0]!.row.patient_id).toBe(SUBJECT_ID);
    expect(inserted[0]!.row.patient_id).not.toBe(CALLER_ID);
  });

  it("logSickDay inserts under the resolved subject", async () => {
    const result = await logSickDay(undefined, fd({ appetite: "normal" }));
    expect(result?.error).toBeUndefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe("sick_day_logs");
    expect(inserted[0]!.row.patient_id).toBe(SUBJECT_ID);
    expect(inserted[0]!.row.patient_id).not.toBe(CALLER_ID);
  });

  it("setPatientReportedDiabetesType passes the resolved subject as p_patient_id", async () => {
    const result = await setPatientReportedDiabetesType(undefined, fd({ diabetes_type: "type_1" }));
    expect(result?.error).toBeUndefined();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.name).toBe("set_patient_reported_diabetes_type");
    expect(rpcCalls[0]!.args.p_patient_id).toBe(SUBJECT_ID);
    expect(rpcCalls[0]!.args.p_patient_id).not.toBe(CALLER_ID);
  });

  it("falls back to the caller's own id when nobody is being acted for", async () => {
    resolveSubjectId.mockResolvedValue(CALLER_ID);
    const result = await logInsulin(undefined, fd({ insulin_type: "nph", units: "2" }));
    expect(result?.error).toBeUndefined();
    expect(inserted[0]!.row.patient_id).toBe(CALLER_ID);
  });
});
