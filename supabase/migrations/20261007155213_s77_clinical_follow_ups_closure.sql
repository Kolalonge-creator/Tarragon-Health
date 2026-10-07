-- S77 (spec 23.8, CMO decision S-20): one closure object for orders, referrals, lab requests and follow-up tasks.
--
-- WHAT THIS ADDS
--   * public.clinical_follow_ups: a follow-up has an owner, a due time, and closes ONLY with an outcome (done, declined, not_needed,
--     other) and a written reason (a CHECK, so no path can skip it). It points at the row it tracks (source_table, source_id) and never
--     copies it, so the existing referral, lab-order, prescription and alert follow-up rows stay as they are.
--   * clinical_follow_up_config: versioned, PROPOSED and unsigned (INV-16). v1 holds the CMO's S-20 times: an overdue follow-up goes to the
--     lead clinician after 24 hours (routine) and 4 hours (abnormal-result follow-ups). It is born INACTIVE; only the CMO's
--     sign_clinical_follow_up_config() can make a version active. Nothing is signed here.
--   * private.sweep_clinical_follow_ups(), on pg_cron every 15 minutes: marks overdue always; raises a clinical task (the S16 machinery,
--     task types follow_up_overdue and follow_up_overdue_abnormal) only when a SIGNED config is active. With no active config it marks overdue and
--     escalates nothing (so no unsigned value ever pages anyone). With no lead clinician the task goes to the open pool (visible, never silent).
--   * Reads: the owner, or a clinician with a tie to the patient (private.clinician_has_patient_access, INV-12). Nobody writes the table
--     directly; the four functions below are the only door. Neutral wording only (INV-07): the follow-up holds ids, a kind and an outcome code.
--   * A follow-up created from an alert snooze (alert_follow_up_tasks) is linked, and closes when the snooze task is done or dismissed.
--
-- NOTE ON "referral": public.referrals is the patient-refers-patient invitation table, not a clinical referral. The clinical referral is
-- public.specialist_referrals, so that is what source_table accepts. The existing referral chase sweeps are not touched or re-implemented.
--
-- Counts before writing (local tree reading, nothing live touched): no clinical_follow_ups table exists; alert_follow_up_tasks is unchanged except
-- for the two triggers added below. Live counts of alert_follow_up_tasks were NOT read (no production access in this track).

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED, versioned, unsigned)
-- ---------------------------------------------------------------------------
create table public.clinical_follow_up_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  signed_by      uuid references public.profiles (id) on delete restrict,
  signed_at      timestamptz,
  sign_note      text,
  created_at     timestamptz not null default now(),
  constraint clinical_follow_up_config_active_is_signed
    check (not is_active or (signed_by is not null and signed_at is not null))
);
create unique index clinical_follow_up_config_one_active on public.clinical_follow_up_config (is_active) where is_active;
comment on table public.clinical_follow_up_config is
  'S77 (S-20, INV-16): PROPOSED loop-closure times. A row is active only after the Chief Medical Officer signs it through sign_clinical_follow_up_config(); the overdue sweep reads the ACTIVE row and escalates nothing when there is none.';

-- follow-up-rules-begin
insert into public.clinical_follow_up_config (version, is_active, effective_from, rules) values (1, false, '2026-10-07', $json$
{
  "routine_escalate_after_hours": 24,
  "abnormal_escalate_after_hours": 4
}
$json$::jsonb);
-- follow-up-rules-end

-- only the signing function may make a row active, and an active row is never edited afterwards
create function private.clinical_follow_up_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a follow-up config version is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.signed_by is not null then
      raise exception 'a follow-up config version is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.rules is distinct from old.rules or new.version is distinct from old.version then
    raise exception 'a follow-up config version is never edited: add a new version' using errcode = '42501';
  end if;
  if (new.is_active, new.signed_by, new.signed_at) is distinct from (old.is_active, old.signed_by, old.signed_at)
     and coalesce(current_setting('tarragon.follow_up_config_sign', true), '') <> 'on' then
    raise exception 'a follow-up config version changes only through sign_clinical_follow_up_config()' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.clinical_follow_up_config_guard() from public, anon, authenticated;
create trigger clinical_follow_up_config_guard before insert or update or delete on public.clinical_follow_up_config
  for each row execute function private.clinical_follow_up_config_guard();

alter table public.clinical_follow_up_config enable row level security;
revoke all on public.clinical_follow_up_config from public, anon, authenticated;
grant select on public.clinical_follow_up_config to authenticated;
create policy clinical_follow_up_config_read on public.clinical_follow_up_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function public.sign_clinical_follow_up_config(p_version integer, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinical_follow_up_config%rowtype;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can sign the follow-up times' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked, in a sentence' using errcode = '22023';
  end if;
  select * into c from public.clinical_follow_up_config where version = p_version for update;
  if not found or c.is_active or c.signed_at is not null then
    raise exception 'only an unsigned version can be signed' using errcode = '22023';
  end if;
  perform set_config('tarragon.follow_up_config_sign', 'on', true);
  update public.clinical_follow_up_config set is_active = false where is_active;
  update public.clinical_follow_up_config
     set is_active = true, signed_by = (select auth.uid()), signed_at = now(), sign_note = btrim(p_note)
   where id = c.id;
  perform set_config('tarragon.follow_up_config_sign', 'off', true);
  perform private.log_audit('clinical_follow_up_config.signed', 'clinical_follow_up_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_clinical_follow_up_config(integer, text) from public, anon;
grant execute on function public.sign_clinical_follow_up_config(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The closure object
-- ---------------------------------------------------------------------------
create table public.clinical_follow_ups (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  kind                 text not null check (kind in ('order', 'referral', 'lab_request', 'follow_up')),
  -- The row being tracked. Linked, never copied. All four or none.
  source_table         text check (source_table in ('specialist_referrals', 'lab_orders', 'alert_follow_up_tasks', 'prescriptions')),
  source_id            uuid,
  -- true for a follow-up that waits on an abnormal result: the shorter escalation time applies (S-20)
  abnormal_result      boolean not null default false,
  owner_id             uuid not null references public.profiles (id) on delete restrict,
  due_at               timestamptz not null,
  state                text not null default 'open' check (state in ('open', 'acknowledged', 'closed')),
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references public.profiles (id) on delete restrict,
  closed_at            timestamptz,
  closed_by            uuid references public.profiles (id) on delete restrict,
  outcome              text check (outcome in ('done', 'declined', 'not_needed', 'other')),
  outcome_reason       text,
  overdue_at           timestamptz,
  escalated_at         timestamptz,
  escalation_task_id   uuid references public.clinical_tasks (id) on delete set null,
  -- 'raised' = a task went to the patient's lead clinician; 'to_pool' = no lead clinician, the task went to the open pool
  escalation_route     text check (escalation_route in ('raised', 'to_pool')),
  created_by           uuid not null references public.profiles (id) on delete restrict,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint clinical_follow_ups_source_pair check ((source_table is null) = (source_id is null)),
  -- A follow-up closes only with an outcome and a reason (S-20). This is the rule, so no code path can skip it.
  constraint clinical_follow_ups_closes_with_outcome check (
    (state = 'closed') = (outcome is not null and closed_at is not null and closed_by is not null)
    and (state <> 'closed' or char_length(btrim(coalesce(outcome_reason, ''))) >= 10)
  ),
  constraint clinical_follow_ups_ack_pair check ((acknowledged_at is null) = (acknowledged_by is null))
);
create unique index clinical_follow_ups_one_open_per_source on public.clinical_follow_ups (source_table, source_id)
  where source_id is not null and state <> 'closed';
create index clinical_follow_ups_owner_idx on public.clinical_follow_ups (owner_id, state, due_at);
create index clinical_follow_ups_patient_idx on public.clinical_follow_ups (patient_id, created_at desc);
create index clinical_follow_ups_sweep_idx on public.clinical_follow_ups (due_at) where state <> 'closed';
create trigger clinical_follow_ups_set_updated_at before update on public.clinical_follow_ups
  for each row execute function private.set_updated_at();
comment on table public.clinical_follow_ups is
  'S77 (23.8, S-20): one closure object across orders, referrals, lab requests and follow-up tasks. Closes only with an outcome and a reason. Holds ids and neutral facts only (INV-07). Written only by the follow-up functions.';

-- Every change comes through a follow-up function (which sets the flag); a bare write, even by the table owner, is refused.
create function private.guard_clinical_follow_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('tarragon.follow_up_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a follow-up is never deleted: close it with an outcome' using errcode = '42501';
  end if;
  raise exception 'clinical_follow_ups change only through the follow-up functions' using errcode = '42501';
end $$;
revoke all on function private.guard_clinical_follow_up() from public, anon, authenticated;
create trigger clinical_follow_ups_guard before insert or update or delete on public.clinical_follow_ups
  for each row execute function private.guard_clinical_follow_up();

alter table public.clinical_follow_ups enable row level security;
revoke all on public.clinical_follow_ups from public, anon, authenticated;
grant select on public.clinical_follow_ups to authenticated;
-- INV-12: the owner, or a clinician tied to the patient. Admins and everyone else read nothing here (an admin uses the audited list function).
create policy clinical_follow_ups_read on public.clinical_follow_ups for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    and (owner_id = (select auth.uid()) or private.clinician_has_patient_access(patient_id))
  );

-- ---------------------------------------------------------------------------
-- 3. Task types the escalation raises (S16 machinery). Version 1, PROPOSED; creating a task still needs a signed config.
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('follow_up_overdue', 1, 8, 1440, 'medical_officer', '{}', 1440, 30, true, true, '{}',
   'S77 (S-20): an order, referral, lab request or follow-up task is overdue past the signed escalation time. PROPOSED class and window; the CMO may change them.'),
  ('follow_up_overdue_abnormal', 1, 4, 240, 'medical_officer', '{result_review}', 240, 30, true, true, '{}',
   'S77 (S-20): the same, for a follow-up that waits on an abnormal result. PROPOSED class and window; the CMO may change them.');

-- ---------------------------------------------------------------------------
-- 4. The functions (the only door)
-- ---------------------------------------------------------------------------
create function private.follow_up_actor_is_clinician(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.organisation_id = p_org and cs.doctor_tier is not null)
$$;
revoke all on function private.follow_up_actor_is_clinician(uuid) from public, anon, authenticated;

create function public.create_clinical_follow_up(
  p_patient uuid, p_kind text, p_due_at timestamptz, p_source_table text default null, p_source_id uuid default null,
  p_abnormal_result boolean default false, p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_owner uuid;
  v_ok boolean;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not private.follow_up_actor_is_clinician(v_org) or not private.clinician_has_patient_access(p_patient) then
    raise exception 'a follow-up is created by a clinician tied to the patient' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('order', 'referral', 'lab_request', 'follow_up') then
    raise exception 'unknown follow-up kind' using errcode = '22023';
  end if;
  if p_due_at is null or p_due_at <= now() then
    raise exception 'a follow-up needs a due time in the future' using errcode = '22023';
  end if;
  v_owner := coalesce(p_owner, v_uid);
  if v_owner <> v_uid and not exists (select 1 from public.clinical_staff cs
       where cs.profile_id = v_owner and cs.active and cs.organisation_id = v_org and cs.doctor_tier is not null) then
    raise exception 'the owner must be an active clinician' using errcode = '22023';
  end if;
  if (p_source_table is null) <> (p_source_id is null) then
    raise exception 'name both the source table and the source row, or neither' using errcode = '22023';
  end if;
  if p_source_table is not null then
    -- the tracked row must exist and belong to this patient
    v_ok := case p_source_table
      when 'specialist_referrals' then exists (select 1 from public.specialist_referrals x where x.id = p_source_id and x.patient_id = p_patient)
      when 'lab_orders' then exists (select 1 from public.lab_orders x where x.id = p_source_id and x.patient_id = p_patient)
      when 'alert_follow_up_tasks' then exists (select 1 from public.alert_follow_up_tasks x where x.id = p_source_id and x.patient_id = p_patient)
      when 'prescriptions' then exists (select 1 from public.prescriptions x where x.id = p_source_id and x.patient_id = p_patient)
      else false end;
    if not v_ok then raise exception 'that source row does not exist for this patient' using errcode = '22023'; end if;
  end if;
  perform set_config('tarragon.follow_up_write', 'on', true);
  insert into public.clinical_follow_ups (organisation_id, patient_id, kind, source_table, source_id, abnormal_result, owner_id, due_at, created_by, is_test)
  values (v_org, p_patient, p_kind, p_source_table, p_source_id, coalesce(p_abnormal_result, false), v_owner, p_due_at, v_uid, coalesce(v_test, false))
  returning id into v_id;
  perform set_config('tarragon.follow_up_write', 'off', true);
  perform private.log_audit('clinical_follow_up.created', 'clinical_follow_up', v_id, jsonb_build_object('kind', p_kind, 'abnormal_result', coalesce(p_abnormal_result, false)));
  return v_id;
end $$;

create function public.acknowledge_clinical_follow_up(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  f public.clinical_follow_ups%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into f from public.clinical_follow_ups where id = p_id for update;
  if not found or not private.follow_up_actor_is_clinician(f.organisation_id)
     or not (f.owner_id = v_uid or private.clinician_has_patient_access(f.patient_id)) then
    raise exception 'follow-up not found' using errcode = '42501';
  end if;
  if f.state <> 'open' then raise exception 'only an open follow-up can be acknowledged' using errcode = '22023'; end if;
  perform set_config('tarragon.follow_up_write', 'on', true);
  update public.clinical_follow_ups set state = 'acknowledged', acknowledged_at = now(), acknowledged_by = v_uid where id = p_id;
  perform set_config('tarragon.follow_up_write', 'off', true);
  perform private.log_audit('clinical_follow_up.acknowledged', 'clinical_follow_up', p_id, '{}'::jsonb);
end $$;

create function public.close_clinical_follow_up(p_id uuid, p_outcome text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  f public.clinical_follow_ups%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into f from public.clinical_follow_ups where id = p_id for update;
  if not found or not private.follow_up_actor_is_clinician(f.organisation_id)
     or not (f.owner_id = v_uid or private.clinician_has_patient_access(f.patient_id)) then
    raise exception 'follow-up not found' using errcode = '42501';
  end if;
  if f.state = 'closed' then raise exception 'this follow-up is already closed' using errcode = '22023'; end if;
  if p_outcome is null or p_outcome not in ('done', 'declined', 'not_needed', 'other') then
    raise exception 'closing needs an outcome: done, declined, not_needed or other' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'closing needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  perform set_config('tarragon.follow_up_write', 'on', true);
  update public.clinical_follow_ups
     set state = 'closed', outcome = p_outcome, outcome_reason = btrim(p_reason), closed_at = now(), closed_by = v_uid
   where id = p_id;
  perform set_config('tarragon.follow_up_write', 'off', true);
  perform private.log_audit('clinical_follow_up.closed', 'clinical_follow_up', p_id, jsonb_build_object('outcome', p_outcome));
end $$;

-- The list the screen reads. A clinician gets their own and tied rows (the same test as the RLS policy). An admin gets the organisation's rows
-- and every such read is written to the audit log (the follow-ups name a patient, so an admin read is never silent).
create function public.list_clinical_follow_ups(p_include_closed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_admin boolean := private.is_admin();
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not v_admin and not (v_org is not null and private.follow_up_actor_is_clinician(v_org)) then
    raise exception 'only a clinician or an admin can read follow-ups' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'patient_id', f.patient_id, 'patient_first_name', split_part(coalesce(p.full_name, ''), ' ', 1),
      'kind', f.kind, 'source_table', f.source_table, 'abnormal_result', f.abnormal_result, 'owner_id', f.owner_id,
      'due_at', f.due_at, 'state', f.state, 'overdue', (f.state <> 'closed' and f.due_at <= now()),
      'escalated_at', f.escalated_at, 'escalation_route', f.escalation_route,
      'outcome', f.outcome, 'outcome_reason', f.outcome_reason, 'closed_at', f.closed_at)
    order by (f.state = 'closed'), f.due_at), '[]'::jsonb)
    into v_rows
    from public.clinical_follow_ups f
    join public.profiles p on p.id = f.patient_id
   where (p_include_closed or f.state <> 'closed')
     and (case when v_admin then f.organisation_id = v_org
               else private.is_org_staff(f.organisation_id) and (f.owner_id = v_uid or private.clinician_has_patient_access(f.patient_id)) end);
  if v_admin then
    perform private.log_audit('clinical_follow_up.admin_read', 'clinical_follow_up', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  end if;
  return v_rows;
end $$;

revoke all on function public.create_clinical_follow_up(uuid, text, timestamptz, text, uuid, boolean, uuid) from public, anon;
revoke all on function public.acknowledge_clinical_follow_up(uuid) from public, anon;
revoke all on function public.close_clinical_follow_up(uuid, text, text) from public, anon;
revoke all on function public.list_clinical_follow_ups(boolean) from public, anon;
grant execute on function public.create_clinical_follow_up(uuid, text, timestamptz, text, uuid, boolean, uuid) to authenticated;
grant execute on function public.acknowledge_clinical_follow_up(uuid) to authenticated;
grant execute on function public.close_clinical_follow_up(uuid, text, text) to authenticated;
grant execute on function public.list_clinical_follow_ups(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The sweep
-- ---------------------------------------------------------------------------
create function private.sweep_clinical_follow_ups() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_cfg jsonb;
  v_marked integer := 0;
  v_escalated integer := 0;
  v_errors integer := 0;
  v_hours integer;
  v_task uuid;
  v_has_lead boolean;
begin
  -- 1. Overdue is always recorded, signed config or not.
  perform set_config('tarragon.follow_up_write', 'on', true);
  update public.clinical_follow_ups set overdue_at = now() where state <> 'closed' and due_at <= now() and overdue_at is null;
  get diagnostics v_marked = row_count;
  perform set_config('tarragon.follow_up_write', 'off', true);

  -- 2. Escalation reads the ACTIVE (signed) config. None active means mark only, escalate nothing.
  select rules into v_cfg from public.clinical_follow_up_config where is_active;
  if v_cfg is null then
    return jsonb_build_object('marked_overdue', v_marked, 'escalated', 0, 'errors', 0, 'config', 'none_active');
  end if;

  for r in select f.* from public.clinical_follow_ups f
            where f.state <> 'closed' and f.overdue_at is not null and f.escalated_at is null loop
    begin
      v_hours := case when r.abnormal_result then (v_cfg ->> 'abnormal_escalate_after_hours')::integer
                      else (v_cfg ->> 'routine_escalate_after_hours')::integer end;
      continue when v_hours is null or r.due_at + make_interval(hours => v_hours) > now();
      -- never silent: with an eligible lead clinician the task is offered to them first, otherwise it goes to the open pool
      v_task := private.create_clinical_task(r.patient_id,
        case when r.abnormal_result then 'follow_up_overdue_abnormal' else 'follow_up_overdue' end,
        null, 'follow_up:' || r.id);
      select t.state = 'offered_to_lead' into v_has_lead from public.clinical_tasks t where t.id = v_task;
      perform set_config('tarragon.follow_up_write', 'on', true);
      update public.clinical_follow_ups
         set escalated_at = now(), escalation_task_id = v_task, escalation_route = case when v_has_lead then 'raised' else 'to_pool' end
       where id = r.id;
      perform set_config('tarragon.follow_up_write', 'off', true);
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_follow_up.escalated', 'clinical_follow_up', r.id,
                jsonb_build_object('task_id', v_task, 'route', case when v_has_lead then 'raised' else 'to_pool' end, 'abnormal_result', r.abnormal_result));
      v_escalated := v_escalated + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform set_config('tarragon.follow_up_write', 'off', true);
      raise warning 'sweep_clinical_follow_ups: escalating % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_follow_up_sweep.error', 'clinical_follow_up', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'clinical_follow_up_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev1', 'Follow-up escalation failed for some items',
            format('%s overdue follow-up(s) could not be escalated by private.sweep_clinical_follow_ups(); see audit_log action clinical_follow_up_sweep.error. An overdue follow-up may not have reached the lead clinician.', v_errors),
            'clinical_follow_up_sweep', now(), now());
  end if;
  return jsonb_build_object('marked_overdue', v_marked, 'escalated', v_escalated, 'errors', v_errors, 'config', 'active');
end $$;
revoke all on function private.sweep_clinical_follow_ups() from public, anon, authenticated;

select cron.schedule('sweep-clinical-follow-ups', '*/15 * * * *', $$ select private.sweep_clinical_follow_ups(); $$);

-- ---------------------------------------------------------------------------
-- 6. Alert snooze link: a snooze follow-up task opens a follow-up, and closes it when the task is done or dismissed.
--    A failure here must never break the snooze (the clinician's action), but it is never silent either: it is written to the audit log.
-- ---------------------------------------------------------------------------
create function private.link_alert_follow_up_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_test boolean;
begin
  begin
    perform set_config('tarragon.follow_up_write', 'on', true);
    if tg_op = 'INSERT' then
      select cs.profile_id into v_owner from public.clinical_staff cs where cs.id = new.created_by;
      select p.is_test into v_test from public.profiles p where p.id = new.patient_id;
      if v_owner is not null then
        insert into public.clinical_follow_ups (organisation_id, patient_id, kind, source_table, source_id, owner_id, due_at, created_by, is_test)
        values (new.organisation_id, new.patient_id, 'follow_up', 'alert_follow_up_tasks', new.id, v_owner, new.due_at, v_owner, coalesce(v_test, false))
        on conflict do nothing;
      end if;
    elsif new.status <> 'open' and old.status = 'open' then
      update public.clinical_follow_ups
         set state = 'closed', closed_at = now(), closed_by = coalesce((select cs.profile_id from public.clinical_staff cs where cs.id = new.resolved_by), owner_id),
             outcome = case when new.status = 'done' then 'done' else 'not_needed' end,
             outcome_reason = 'Closed with the alert follow-up task that it tracks'
       where source_table = 'alert_follow_up_tasks' and source_id = new.id and state <> 'closed';
    end if;
    perform set_config('tarragon.follow_up_write', 'off', true);
  exception when others then
    perform set_config('tarragon.follow_up_write', 'off', true);
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'clinical_follow_up_link.error', 'alert_follow_up_task', new.id, jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
revoke all on function private.link_alert_follow_up_task() from public, anon, authenticated;
create trigger alert_follow_up_tasks_link_follow_up after insert or update of status on public.alert_follow_up_tasks
  for each row execute function private.link_alert_follow_up_task();

-- ---------------------------------------------------------------------------
-- 7. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if has_table_privilege('authenticated', 'public.clinical_follow_ups', 'INSERT') or has_table_privilege('authenticated', 'public.clinical_follow_ups', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_follow_ups', 'DELETE') then
    raise exception 'S77: authenticated can write clinical_follow_ups';
  end if;
  if has_table_privilege('anon', 'public.clinical_follow_ups', 'SELECT') or has_table_privilege('anon', 'public.clinical_follow_up_config', 'SELECT') then
    raise exception 'S77: anon can read follow-up tables';
  end if;
  foreach f in array array['public.create_clinical_follow_up(uuid,text,timestamptz,text,uuid,boolean,uuid)', 'public.acknowledge_clinical_follow_up(uuid)',
                           'public.close_clinical_follow_up(uuid,text,text)', 'public.list_clinical_follow_ups(boolean)', 'public.sign_clinical_follow_up_config(integer,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'S77: wrong execute privileges on %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.sweep_clinical_follow_ups()', 'EXECUTE') or has_function_privilege('authenticated', 'private.sweep_clinical_follow_ups()', 'EXECUTE') then
    raise exception 'S77: the sweep is executable by a signed-in role';
  end if;
  if exists (select 1 from public.clinical_follow_up_config where is_active or signed_by is not null) then
    raise exception 'S77: a follow-up config version was seeded signed or active';
  end if;
  if not exists (select 1 from cron.job where jobname = 'sweep-clinical-follow-ups' and schedule = '*/15 * * * *') then
    raise exception 'S77: the sweep is not scheduled every 15 minutes';
  end if;
end $$;
