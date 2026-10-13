// S12: the database side of the triage handler, over the service-role client. Kept free of any
// import so the same file can be exercised with a fake client in packages/clinical.
import type { RuleSetForGrading, TriageContext, TriagePorts } from "../_shared/triage/observation-handler.ts";
import type { CoverageContext, CoveragePorts } from "../_shared/triage/coverage-handler.ts";

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call<T>(client: RpcClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

export function triagePorts(client: RpcClient): TriagePorts {
  return {
    async loadContext(observationId, recheck) {
      const raw = await call<Record<string, unknown> | null>(client, "triage_context_for_observation", {
        p_observation_id: observationId,
        p_recheck: recheck,
      });
      if (!raw || raw["found"] !== true) return { found: false } satisfies TriageContext;
      return { found: true, isTest: raw["isTest"] === true, basis: typeof raw["basis"] === "string" ? raw["basis"] : "", input: raw["input"] as TriageContext["input"] };
    },
    async loadRuleSet(code) {
      const raw = await call<{ id: string; status: "draft" | "approved"; rules: RuleSetForGrading["rules"] } | null>(
        client,
        "triage_rule_set_for_grading",
        { p_code: code },
      );
      return raw ? { id: raw.id, status: raw.status, rules: raw.rules } : null;
    },
    async record({ observationId, result, ruleSetId, causationId, basis }) {
      await call(client, "record_triage_result", {
        p_observation_id: observationId,
        p_result: result,
        p_rule_set_id: ruleSetId,
        p_causation_id: causationId,
        p_basis: basis,
      });
    },
  };
}

/** P6: the database side of the silence and adherence handler. */
export function coveragePorts(client: RpcClient): CoveragePorts {
  return {
    async loadContext(patientId, trigger, day) {
      const raw = await call<Record<string, unknown> | null>(client, "triage_context_for_coverage", {
        p_patient: patientId,
        p_trigger: trigger,
        p_day: day,
      });
      if (!raw || raw["found"] !== true) return { found: false } satisfies CoverageContext;
      return { found: true, input: raw["input"] as CoverageContext["input"] };
    },
    async loadRuleSet(code) {
      const raw = await call<{ id: string; status: "draft" | "approved"; rules: RuleSetForGrading["rules"] } | null>(
        client,
        "triage_rule_set_for_grading",
        { p_code: code },
      );
      return raw ? { id: raw.id, status: raw.status, rules: raw.rules } : null;
    },
    async record({ patientId, trigger, day, result, ruleSetId, causationId, context }) {
      await call(client, "record_coverage_triage_result", {
        p_patient: patientId,
        p_trigger: trigger,
        p_day: day,
        p_result: result,
        p_rule_set_id: ruleSetId,
        p_context: context,
        p_causation_id: causationId,
      });
    },
  };
}
