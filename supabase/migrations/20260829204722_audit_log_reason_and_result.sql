-- Tarragon Health
-- audit_log: add Reason and Result, the two fields private.audit_row_change()
-- (20260812030853_row_change_audit_triggers.sql) deliberately did not capture
--
-- That migration's own design-limits section says why: a generic AFTER trigger only ever fires
-- on a COMMITTED write, so "result" was structurally always "it happened" and wasn't worth a
-- column, and no caller had a way to say *why* it made a change. Both are real gaps once you ask
-- "can this audit trail answer why, or whether an attempt even succeeded" — a 2026-08-29 review
-- against a generic platform-architecture blueprint flagged both explicitly
-- (docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md §4).
--
-- What this adds, and no more:
--   - `reason` (nullable text): an optional caller-supplied justification. Same GUC pattern as
--     the existing actor fallback (app.audit_actor_id, 20260812041044) — a trusted server
--     context can `set_config('app.audit_reason', '<text>', true)` before a write inside the
--     same transaction, and private.audit_row_change() picks it up. Nothing sets it yet; wiring
--     it into specific RPCs (e.g. a clinician overriding a red-flag alert with a documented
--     reason) is a mechanical follow-up once this schema change is reviewed, same posture as the
--     original migration's own "extend the tables array" follow-up.
--   - `result` (text, not null, default 'success', check in success/denied/failed): for the
--     row-change trigger's own inserts this is always 'success' — a fact, not an assumption,
--     since the trigger by definition cannot fire on a rolled-back write. The column earns its
--     keep via the new private.audit_log_denied_action() helper below, which any RPC can call to
--     record a *rejected* attempt (permission denied, validation failure) as its own audit_log
--     row with result='denied' or 'failed' — something no trigger on a source table could ever
--     see, because a rejected attempt never becomes a row change. Wiring this into specific
--     guard clauses is, again, a deliberate follow-up, not done blanket here.
--
-- PHI posture, unchanged from the original migration's reasoning: reason is free text a caller
-- controls, so it must never carry patient-identifying or clinical detail — audit_log_select
-- grants read on a broader is_org_staff(organisation_id) check than several source tables'
-- own RLS, so anything written here is readable more widely than the row it describes. Same
-- "generic non-PHI nudge only" discipline already used for notification payloads.

alter table public.audit_log
  add column reason text,
  add column result text not null default 'success';

alter table public.audit_log
  add constraint audit_log_result_check check (result in ('success', 'denied', 'failed'));

comment on column public.audit_log.reason is
  'Optional caller-supplied justification for the action. Never PHI/clinical detail — see '
  '20260829204722_audit_log_reason_and_result.sql. Null means no caller supplied one.';
comment on column public.audit_log.result is
  'success | denied | failed. Row-change-trigger rows are always success (a trigger cannot fire '
  'on a rolled-back write); denied/failed rows come only from private.audit_log_denied_action().';

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_reason     text;
  v_org        uuid;
  v_entity_id  uuid;
  v_action     text;
  v_changed    text[];
  v_old        jsonb;
  v_new        jsonb;
  v_hash       text;
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
      -- Nothing changed except (at most) updated_at — a touch, not a real change.
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

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result)
  values (
    v_org, v_actor, v_action, tg_table_name, v_entity_id,
    jsonb_build_object(
      'changed_columns', to_jsonb(coalesce(v_changed, array[]::text[])),
      'row_hash', v_hash,
      'actor_resolved', v_actor is not null
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
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. Logs actor, action, entity, reason (from '
  'app.audit_reason if a caller set it), result (always success — see column comment), and the '
  'list of changed column NAMES (never values) plus a sha256 hash of the full row to '
  'public.audit_log. See 20260812030853_row_change_audit_triggers.sql for the original design '
  'and 20260829204722_audit_log_reason_and_result.sql for reason/result.';

-- Lets an RPC record a rejected attempt (permission denied, validation failure) as its own
-- audit_log row — the one thing no source-table trigger can ever see, because a rejected
-- attempt never becomes a committed row change. SECURITY DEFINER so a narrower policy on the
-- caller's role can never block the audit write itself, same rationale as audit_row_change().
-- Deliberately NOT wired into any guard clause by this migration — see header.
create or replace function private.audit_log_denied_action(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organisation_id uuid,
  p_reason text default null,
  p_result text default 'denied'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actor uuid;
begin
  if p_result not in ('denied', 'failed') then
    raise exception 'audit_log_denied_action: result must be denied or failed, got %', p_result;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, reason, result)
  values (p_organisation_id, v_actor, p_action, p_entity_type, p_entity_id, p_reason, p_result)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.audit_log_denied_action(text, text, uuid, uuid, text, text) is
  'Records a rejected attempt (result=denied|failed) as its own audit_log row — for RPCs that '
  'want to log a permission-denied or validation-failure attempt, which no row-change trigger '
  'can ever see. Opt-in per call site; not wired into anything by this migration. See '
  '20260829204722_audit_log_reason_and_result.sql.';

revoke all on function private.audit_log_denied_action(text, text, uuid, uuid, text, text) from public, anon;

-- Proof, not hope: reason/result actually behave as designed, and the check constraint
-- actually discriminates rather than passing vacuously. Everything below runs inside one
-- transaction that is rolled back at the end — no test data survives.
do $$
declare
  v_org uuid;
  v_profile_id uuid;
  v_baseline_ids uuid[];
  v_step1_id uuid;
  v_step2_id uuid;
  v_row record;
  v_denied_id uuid;
  v_rejected boolean;
begin
  select id, organisation_id into v_profile_id, v_org from public.profiles limit 1;
  if v_profile_id is null then
    raise notice 'SKIP: no profiles row to test against (empty database)';
    return;
  end if;

  -- now() is frozen for the whole transaction, so two audit_log rows inserted in this same
  -- block can share an identical created_at — "order by created_at desc limit 1" cannot
  -- reliably tell them apart. Track ids explicitly instead: snapshot what already exists for
  -- this entity+action, then after each update pick the id that wasn't there before.
  select coalesce(array_agg(id), array[]::uuid[]) into v_baseline_ids from public.audit_log
    where entity_type = 'profiles' and entity_id = v_profile_id and action = 'profiles.updated';

  -- 1. A normal row-change trigger fire with app.audit_reason set picks up the reason and
  --    always lands result=success. Updates an existing row (never inserts a fake profiles
  --    row — id is FK'd to auth.users) with a harmless, reverted-by-rollback change.
  perform set_config('app.audit_reason', 'gap-analysis migration proof block', true);

  update public.profiles set full_name = coalesce(full_name, '') || ' (audit-proof-test-1)'
    where id = v_profile_id;

  select id into v_step1_id from public.audit_log
    where entity_type = 'profiles' and entity_id = v_profile_id and action = 'profiles.updated'
      and id <> all (v_baseline_ids);
  select * into v_row from public.audit_log where id = v_step1_id;

  if v_row.reason is distinct from 'gap-analysis migration proof block' then
    raise exception 'FAIL: audit_row_change did not pick up app.audit_reason (got %)', v_row.reason;
  end if;
  if v_row.result is distinct from 'success' then
    raise exception 'FAIL: row-change trigger result should always be success (got %)', v_row.result;
  end if;

  -- Clear via empty string, not SQL NULL — set_config's new_value is typed text and does not
  -- reset the setting when passed an actual NULL; audit_row_change()'s own nullif(...,'') is
  -- exactly what maps this back to a real NULL reason.
  perform set_config('app.audit_reason', '', true);

  -- 2. A row-change fire with no reason set leaves reason null, not an empty string.
  update public.profiles set full_name = coalesce(full_name, '') || ' (audit-proof-test-2)'
    where id = v_profile_id;

  select id into v_step2_id from public.audit_log
    where entity_type = 'profiles' and entity_id = v_profile_id and action = 'profiles.updated'
      and id <> all (v_baseline_ids || v_step1_id);
  select * into v_row from public.audit_log where id = v_step2_id;

  if v_row.reason is not null then
    raise exception 'FAIL: reason should be null when app.audit_reason was never set (got %)', v_row.reason;
  end if;

  -- 3. private.audit_log_denied_action() records a denied attempt as its own row.
  v_denied_id := private.audit_log_denied_action(
    'test.permission_denied', 'profiles', v_profile_id, v_org, 'proof-block negative test'
  );
  select * into v_row from public.audit_log where id = v_denied_id;
  if v_row.result is distinct from 'denied' or v_row.reason is distinct from 'proof-block negative test' then
    raise exception 'FAIL: audit_log_denied_action did not record result/reason correctly (result=%, reason=%)',
      v_row.result, v_row.reason;
  end if;

  -- 4. Sabotage check: the result CHECK constraint must actually reject an invalid value,
  --    proving it discriminates rather than passing vacuously.
  v_rejected := false;
  begin
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, result)
    values (v_org, null, 'test.bogus_result', 'profiles', v_profile_id, 'bogus');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: audit_log_result_check did not reject an invalid result value';
  end if;

  raise notice 'PASS: audit_log.reason/result behave as designed (4/4 checks)';

  raise exception 'rollback_test_data';
exception
  when others then
    if sqlerrm <> 'rollback_test_data' then
      raise;
    end if;
end $$;
