-- Tarragon Health
-- Wires audit_log.reason/result (added by 20260829204722_audit_log_reason_and_result.sql,
-- deliberately left unwired) into real call sites, and fixes a real regression found while
-- doing so.
--
-- ===========================================================================
-- Part 0 -- a real bug: private.audit_row_change() had silently stopped writing reason/result
-- ===========================================================================
-- 20260829204722 (20:47:22) added reason/result support to private.audit_row_change() -- it read
-- app.audit_reason and wrote it, plus a literal 'success', into every row-change audit_log insert.
-- 20260829222942 (22:29:42), three hours later and apparently branched off a copy of the function
-- that predated the first migration, did `create or replace function private.audit_row_change()`
-- again to add the unrelated cross_org_actor flag -- and its version's INSERT statement never
-- mentioned reason or result at all, silently reverting 20260829204722's wiring in the process.
-- Confirmed live via pg_get_functiondef before writing this migration (per CLAUDE.md's standing
-- "a live schema object can exist with no migration record" lesson, applied here to "the migration
-- record exists but a LATER migration silently clobbered what it did") -- the deployed function
-- has never captured a reason since 20260829222942 landed, though this was never noticed because:
--   - `result` for a row-change insert is always 'success' regardless (the column DEFAULT
--     achieves the same outcome whether or not the INSERT names the column), so nothing looked
--     broken there.
--   - 20260829204722's own closing proof block could not have caught this even if it had run
--     AFTER 20260829222942, because it checks the row within the SAME, not-yet-committed
--     transaction that inserted it -- uncommitted data a session itself just wrote is visible to
--     that session regardless of what the function's belt-and-braces logic actually does once
--     bytes hit disk under a real commit boundary. (Not what happened here -- this bug is a
--     genuine `create or replace` clobber, not a rollback-visibility issue -- but it is the same
--     class of "a proof block that never exercises a real commit boundary can look green while the
--     thing it proves is subtly wrong" lesson CLAUDE.md's "Rolled-back-txn validation ≠ CI replay"
--     entry already warns about, worth naming here since it is exactly why this went unnoticed for
--     three weeks.)
-- Part 0 below restores reason/result capture while keeping cross_org_actor -- this fix is a
-- precondition for the reason-capture wiring in Part 1: without it, reassign_escalation's
-- set_config('app.audit_reason', ...) call would have had no observable effect at all.
--
-- ===========================================================================
-- Part 1 -- reason capture: public.reassign_escalation()
-- ===========================================================================
-- The Chief Medical Officer's "Assign to..." control (escalation-worklist.tsx, canAssignCases) --
-- today a bare `.from("escalations").update({assigned_doctor_id, status: "open"})` from the
-- client. Replaced by an RPC that does the identical update (still SECURITY INVOKER, so RLS +
-- private.enforce_escalation_reassignment_authority remain the unchanged, real enforcement
-- boundary -- this function adds no privilege of its own) but first calls
-- set_config('app.audit_reason', ...) when the caller supplies one, so the AFTER UPDATE
-- audit_row_change_trg on escalations picks it up into audit_log.reason automatically. A
-- rebalancing reassignment ("doctor_b is overloaded this shift") is exactly the kind of judgment
-- call 20260829204722's header gave as the canonical reason-capture example.
--
-- ===========================================================================
-- Part 2 -- denied-action logging, and the durability problem it actually has
-- ===========================================================================
-- private.audit_log_denied_action() (20260829204722) was designed to be called "from inside the
-- guard clause when it rejects, before raising the exception" -- but a plain `perform
-- private.audit_log_denied_action(...); raise exception ...;` inside the SAME trigger/RPC
-- invocation does not work: PostgreSQL has no autonomous transactions, so when the RAISE
-- propagates and the enclosing transaction rolls back, it undoes the audit_log_denied_action INSERT
-- too -- the denial row would never actually survive to be read back. Confirmed by reasoning
-- through this codebase's own established test pattern (packages/db/tests/*.sql wraps a probed
-- write in `begin ... exception when others then ... end`, which is exactly a PL/pgSQL savepoint --
-- catching the guard's RAISE there rolls back to that savepoint, undoing anything the guard did
-- immediately before raising, audit insert included) rather than assumed. The two textbook fixes
-- for logging-across-a-rollback (a dblink/postgres_fdw loopback connection, or a mid-procedure
-- COMMIT) both need either a hardcoded connection credential (CLAUDE.md: never hardcode
-- credentials) or restructuring these functions into CALL-invoked procedures (a much bigger,
-- untested change to how this codebase's RPCs work) -- neither is a safe fit for this pass.
--
-- Instead: public.log_denied_action() is a thin, org-staff-gated wrapper around
-- private.audit_log_denied_action(), called from the APPLICATION layer (see
-- apps/web/src/lib/audit/log-denied-action.ts) as its OWN separate request, immediately after
-- catching a 42501 from the guard clause that just rejected the real attempt. Because it is a
-- genuinely separate request/transaction, it is durable regardless of what happened to the failed
-- attempt's own transaction. The DB-level guard clauses themselves (private.
-- enforce_escalation_reassignment_authority, private.enforce_emergency_escalation_tier,
-- public.amend_medication's prescribing-authority check) are UNCHANGED by this migration -- they
-- remain the real, unconditional enforcement boundary; log_denied_action only adds an
-- additive, best-effort audit trail on top, the same "this copy only gates the UI/logs the
-- attempt; the DB is the real boundary" posture already used throughout this codebase.
--
-- Wired call sites (see the PR description for the full list): escalation reassignment denial and
-- escalation claim denial (apps/web/src/lib/queries/escalations.ts), prescription-amendment
-- denial (apps/web/src/lib/queries/medications.ts).
--
-- Run: applied via Supabase MCP; local file name reconciled against list_migrations per CLAUDE.md.

-- ===========================================================================
-- Part 0
-- ===========================================================================
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_actor_org  uuid;
  v_reason     text;
  v_org        uuid;
  v_entity_id  uuid;
  v_action     text;
  v_changed    text[];
  v_old        jsonb;
  v_new        jsonb;
  v_hash       text;
  v_cross_org  boolean;
begin
  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );
  v_reason := nullif(current_setting('app.audit_reason', true), '');

  if tg_op = 'INSERT' then
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.created';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) where value is not null;
    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'UPDATE' then
    v_old       := to_jsonb(OLD);
    v_new       := to_jsonb(NEW);
    v_entity_id := (v_new ->> 'id')::uuid;
    v_org       := nullif(v_new ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.updated';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);

    if v_changed is null then
      -- Nothing changed except (at most) updated_at -- a touch, not a real change.
      return NEW;
    end if;

    v_hash := encode(extensions.digest(v_new::text, 'sha256'), 'hex');

  elsif tg_op = 'DELETE' then
    v_old       := to_jsonb(OLD);
    v_entity_id := (v_old ->> 'id')::uuid;
    v_org       := nullif(v_old ->> 'organisation_id', '')::uuid;
    v_action    := tg_table_name || '.deleted';
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    v_hash := encode(extensions.digest(v_old::text, 'sha256'), 'hex');
  end if;

  if v_actor is not null then
    select organisation_id into v_actor_org from public.profiles where id = v_actor;
  end if;
  v_cross_org := v_actor_org is not null and v_org is not null and v_actor_org <> v_org;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result)
  values (
    v_org, v_actor, v_action, tg_table_name, v_entity_id,
    jsonb_build_object(
      'changed_columns', to_jsonb(coalesce(v_changed, array[]::text[])),
      'row_hash', v_hash,
      'actor_resolved', v_actor is not null,
      'cross_org_actor', v_cross_org
    ),
    v_reason,
    'success'
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Logs actor, action, entity, reason (from app.audit_reason if a caller set it), result (always success for this trigger), cross_org_actor, and the list of changed column NAMES (never values) plus a sha256 hash of the full row, to public.audit_log. History: 20260812030853 (original), 20260829204722 (added reason/result), 20260829222942 (added cross_org_actor but silently reverted the reason/result wiring by branching off a stale copy -- see this migration''s header), this migration (restores reason/result, keeps cross_org_actor).';

-- ===========================================================================
-- Part 1
-- ===========================================================================
create or replace function public.reassign_escalation(
  p_escalation_id uuid,
  p_doctor_profile_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  if v_reason is not null then
    perform set_config('app.audit_reason', v_reason, true);
  end if;

  update public.escalations
  set assigned_doctor_id = p_doctor_profile_id,
      status = 'open'
  where id = p_escalation_id;

  -- Cleared unconditionally (not just when v_reason was set) so this GUC can
  -- never bleed into whatever else runs later in the same Postgres
  -- transaction -- matters most for a test harness that chains many
  -- operations in one begin/rollback block; in production each RPC call is
  -- already its own transaction and this would reset on its own regardless.
  perform set_config('app.audit_reason', '', true);

  if not found then
    raise exception 'Escalation not found, or not visible to you' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.reassign_escalation(uuid, uuid, text) is
  'CMO reassignment of a case to another doctor (docs/CLAUDE.md Clinical Tier Ladder, the "Assign to..." control), with an optional caller-supplied reason captured into audit_log.reason via app.audit_reason -- see 20260829204722_audit_log_reason_and_result.sql and this migration''s Part 0 fix to private.audit_row_change(). SECURITY INVOKER -- RLS plus private.enforce_escalation_reassignment_authority remain the real, unchanged enforcement boundary; this function adds no privilege of its own. p_reason is capped at 300 chars and must never carry patient-identifying or clinical detail -- see audit_log.reason''s own column comment.';

grant execute on function public.reassign_escalation(uuid, uuid, text) to authenticated;
revoke all on function public.reassign_escalation(uuid, uuid, text) from public, anon;

-- ===========================================================================
-- Part 2
-- ===========================================================================
create or replace function public.log_denied_action(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organisation_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organisation_id is null or not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return private.audit_log_denied_action(
    p_action, p_entity_type, p_entity_id, p_organisation_id, p_reason, 'denied'
  );
end;
$$;

comment on function public.log_denied_action(text, text, uuid, uuid, text) is
  'App-layer wrapper around private.audit_log_denied_action(), callable by any org-staff member to durably record that THEIR OWN just-attempted action was rejected. Deliberately a SEPARATE call from the guard clause that raised -- see this migration''s Part 2 header for why a same-transaction insert-then-raise cannot survive. Called from apps/web/src/lib/audit/log-denied-action.ts, fire-and-forget, right after the calling code catches a 42501 from reassign_escalation/escalations RLS (reassignment or claim denial) or amend_medication (prescribing-authority denial). Gated by private.is_org_staff(p_organisation_id) so a patient or a stranger to the org cannot use this to write arbitrary audit_log rows. p_reason must never carry patient-identifying or clinical detail, same as every other audit_log.reason caller.';

grant execute on function public.log_denied_action(text, text, uuid, uuid, text) to authenticated;
revoke all on function public.log_denied_action(text, text, uuid, uuid, text) from public, anon;

-- Proof, not hope -- the anon-EXECUTE gotcha (CLAUDE.md) has recurred five times on this project.
do $$
begin
  if has_function_privilege('anon', 'public.reassign_escalation(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'reassign_escalation is EXECUTE-able by anon -- ACL regressed';
  end if;
  if not has_function_privilege('authenticated', 'public.reassign_escalation(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'reassign_escalation is NOT EXECUTE-able by authenticated';
  end if;
  if has_function_privilege('anon', 'public.log_denied_action(text, text, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'log_denied_action is EXECUTE-able by anon -- ACL regressed';
  end if;
  if not has_function_privilege('authenticated', 'public.log_denied_action(text, text, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'log_denied_action is NOT EXECUTE-able by authenticated';
  end if;
end $$;

-- ===========================================================================
-- Part 0's own proof: reason/result genuinely restored, cross_org_actor genuinely preserved.
-- Whole block runs inside one transaction, rolled back at the end -- no test data survives.
-- ===========================================================================
do $$
declare
  v_org uuid;
  v_profile_id uuid;
  v_baseline_ids uuid[];
  v_step_id uuid;
  v_row record;
begin
  select id, organisation_id into v_profile_id, v_org from public.profiles limit 1;
  if v_profile_id is null then
    raise notice 'SKIP: no profiles row to test against (empty database)';
    return;
  end if;

  select coalesce(array_agg(id), array[]::uuid[]) into v_baseline_ids from public.audit_log
    where entity_type = 'profiles' and entity_id = v_profile_id and action = 'profiles.updated';

  perform set_config('app.audit_reason', 'audit_row_change reason-restore proof block', true);

  update public.profiles set full_name = coalesce(full_name, '') || ' (audit-reason-restore-proof)'
    where id = v_profile_id;

  select id into v_step_id from public.audit_log
    where entity_type = 'profiles' and entity_id = v_profile_id and action = 'profiles.updated'
      and id <> all (v_baseline_ids);
  select * into v_row from public.audit_log where id = v_step_id;

  perform set_config('app.audit_reason', '', true);

  if v_row.reason is distinct from 'audit_row_change reason-restore proof block' then
    raise exception 'FAIL: audit_row_change still does not pick up app.audit_reason after the fix (got %)', v_row.reason;
  end if;
  if v_row.result is distinct from 'success' then
    raise exception 'FAIL: row-change trigger result should always be success (got %)', v_row.result;
  end if;
  if not (v_row.event ? 'cross_org_actor') then
    raise exception 'FAIL: cross_org_actor (added 20260829222942) was lost by this fix -- event=%', v_row.event;
  end if;

  raise notice 'PASS: audit_row_change reason/result restored, cross_org_actor preserved (3/3 checks)';

  raise exception 'rollback_test_data';
exception
  when others then
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
