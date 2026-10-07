// S85 journey harness: the triage rule set the database currently holds, and the (test only) approval fixture.
//
// Rule: a journey never hard-codes a clinical grade and never signs anything. It reads whichever bp_care_triage version the
// database would grade with (approved if one exists, else the newest draft), and derives the expected grade by running the
// engine on the same facts with those same rules.
//
// The fixture: on a fresh local stack there is no approved version (approval is a Chief Medical Officer signature). So the
// downstream pipeline (queue, page, Care Circle alert) can be exercised, a TEST chief medical officer may approve the newest
// draft inside this disposable local database, through the same RPC a real approval uses. It is opt in
// (S85_FIXTURE_APPROVE_RULESET=1), refuses any non-local database, and the journey still reports d1-rule-approved as pending
// because a test account is not a real signature.

import { sql, sqlRows, lit } from "./sql";
import { journeyEnv, isLocalUrl } from "./env";

export interface RuleSetRow {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  readonly approved_by: string | null;
  readonly approver_is_test: boolean | null;
}

export function currentRuleSet(code = "bp_care_triage"): RuleSetRow | null {
  const rows = sqlRows<RuleSetRow>(
    `select rs.id, rs.code, rs.version, rs.status, rs.approved_by, p.is_test as approver_is_test
       from public.triage_rule_sets rs left join public.profiles p on p.id = rs.approved_by
      where rs.code = ${lit(code)} and rs.status in ('approved', 'draft')
      order by (rs.status = 'approved') desc, rs.version desc limit 1`,
  );
  return rows[0] ?? null;
}

/** True only when an approved row exists and a non test account approved it (a real signature). */
export function hasRealApproval(rs: RuleSetRow | null): boolean {
  return rs !== null && rs.status === "approved" && rs.approver_is_test === false;
}

export function fixtureApprovalEnabled(): boolean {
  return process.env.S85_FIXTURE_APPROVE_RULESET === "1";
}

/** Approve the newest draft as a TEST chief medical officer. Local database only. Returns the approved row. */
export function fixtureApproveNewestDraft(cmoProfileId: string, code = "bp_care_triage"): RuleSetRow {
  const { dbUrl, apiUrl } = journeyEnv();
  if (!isLocalUrl(dbUrl) || !isLocalUrl(apiUrl)) throw new Error("fixture approval refused: not a local database");
  const cmoIsTest = sql(`select coalesce(is_test, false) from public.profiles where id = ${lit(cmoProfileId)};`);
  if (cmoIsTest !== "t") throw new Error("fixture approval refused: the approver is not a test account");
  const draft = sqlRows<{ id: string }>(
    `select id from public.triage_rule_sets where code = ${lit(code)} and status = 'draft' order by version desc limit 1`,
  )[0];
  if (!draft) throw new Error("fixture approval: no draft rule set to approve");
  sql(`
    begin;
    select set_config('request.jwt.claims', json_build_object('sub', ${lit(cmoProfileId)}, 'role', 'authenticated')::text, true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    do $$
    declare t record;
    begin
      for t in select code from public.task_types where is_active and needs_confirmation and confirmed_at is null loop
        perform public.confirm_task_type(t.code, 'S85 local test fixture, not a real confirmation');
      end loop;
    end $$;
    select public.approve_triage_rule_set(${lit(draft.id)}::uuid, 'S85 local test fixture, not a real signature');
    reset role;
    commit;
  `);
  const now = currentRuleSet(code);
  if (!now || now.status !== "approved") throw new Error("fixture approval did not result in an approved row");
  return now;
}
