-- W-02 override reason codes and case brief feedback (INNOVATION-BUILD-GAP.md W-02, Prompt 5). Revised after review; UNAPPLIED, so edited in place.
--
-- When a clinician disagrees with the system, a free-text reason is hard to learn from. This adds a short fixed code list so that, later and
-- only after the CMO approves the list, our own rules can be checked against what doctors actually changed. Until then the codes are
-- recorded and NOTHING reads them to rank, order or score anything.
--
-- The promise on screen is "it is never used to rate you". The data layer enforces it:
--   * every raw row below is readable by the clinician who wrote it ONLY (no CMO, finance or admin policy);
--   * the CMO sees counts through aggregate functions that carry no clinician field and report only groups of 3 or more.
--
--   1. enum public.override_reason_code: system_too_high, system_too_low, context_known, data_error, other. THE LIST AWAITS CMO APPROVAL.
--   2. public.alert_override_events + public.override_alert_level(): the alert override as a function that does what the direct update did
--      (the live trigger private.enforce_alert_override_clinical_only still fills overridden_by and overridden_at and refuses non-clinicians)
--      and records level, reason and the optional code in an append-only event row. clinician_alerts itself is NOT changed: the earlier idea of a
--      clinician_alerts.override_reason_code column is dropped (it was never applied), so an old schema or an unapproved code list cannot break an override.
--   3. public.clinical_task_override_reasons + record_task_override_reason(): a coded reason when a task is finished differently from what the
--      system suggested. Accepted if the caller held the claim at ANY time (task_claims history), so finishing the task does not race it.
--   4. public.case_brief_feedback + record_case_brief_feedback(): useful / unsafe / missing on an AI case brief, needing a real relationship to
--      the patient (private.clinician_has_patient_access). A code is only allowed with 'unsafe' or 'missing'. A clinician may change their mind:
--      a new row is inserted and the latest one is current.
--   5. Aggregate functions for the CMO: case_brief_feedback_counts, task_override_reason_counts, alert_override_reason_counts (groups under 3 omitted).
--
-- Counts before: 0 rows in the new tables; no column added. ROLLBACK: drop the three tables and the functions, then the enum.

create type public.override_reason_code as enum ('system_too_high', 'system_too_low', 'context_known', 'data_error', 'other');
comment on type public.override_reason_code is
  'W-02: why a clinician changed the system''s answer. The code list awaits CMO approval. Recorded for checking our own rules; not used by any ranking, queue order or score.';

-- Shared by the three tables below (the W-01 and W-10 branches carry their own copy of this idea; it is the same shape).
create function private.reject_change_append_only() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.reject_change_append_only() from public, anon, authenticated;

-- 1. Alert overrides -----------------------------------------------------------------------------------------------------
create table public.alert_override_events (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  alert_id             uuid not null references public.clinician_alerts (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  level                public.alert_level not null,
  reason               text not null check (char_length(btrim(reason)) >= 1),
  code                 public.override_reason_code,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index alert_override_events_alert_idx on public.alert_override_events (alert_id);
comment on table public.alert_override_events is
  'W-02: one row per alert override, with the optional coded reason. Append-only. Readable by the clinician who made it only; the CMO reads alert_override_reason_counts. Not used for ranking.';
alter table public.alert_override_events enable row level security;
create policy alert_override_events_read on public.alert_override_events for select to authenticated
  using (clinician_profile_id = (select auth.uid()));
grant select on public.alert_override_events to authenticated;
revoke insert, update, delete, truncate on public.alert_override_events from authenticated, anon;
create trigger alert_override_events_no_change before update or delete on public.alert_override_events
  for each row execute function private.reject_change_append_only();

create function public.override_alert_level(p_alert uuid, p_level public.alert_level, p_reason text, p_code public.override_reason_code default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a record;
  v_test boolean;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'Only an active clinician can override an alert''s classification' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select id, organisation_id into a from public.clinician_alerts where id = p_alert;
  if a.id is null or a.organisation_id is distinct from private.current_org_id() then
    raise exception 'alert not found' using errcode = '42501';
  end if;
  -- the same write the client made directly before; the live trigger fills overridden_by / overridden_at and refuses a non-clinician
  update public.clinician_alerts set override_level = p_level, override_reason = btrim(p_reason) where id = p_alert;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;
  insert into public.alert_override_events (organisation_id, alert_id, clinician_profile_id, level, reason, code, is_test)
  values (a.organisation_id, a.id, v_uid, p_level, btrim(p_reason), p_code, v_test)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.override_alert_level(uuid, public.alert_level, text, public.override_reason_code) from public, anon;
grant execute on function public.override_alert_level(uuid, public.alert_level, text, public.override_reason_code) to authenticated;

-- 2. Task completion reasons ---------------------------------------------------------------------------------------------
create table public.clinical_task_override_reasons (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  task_id              uuid not null references public.clinical_tasks (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  code                 public.override_reason_code not null,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint clinical_task_override_reasons_one_per_task unique (task_id, clinician_profile_id)
);
comment on table public.clinical_task_override_reasons is
  'W-02: coded reason recorded when a clinician finishes a task differently from what the system suggested. Append-only. Readable by the clinician who wrote it only; the CMO reads task_override_reason_counts. Not used for ranking.';
alter table public.clinical_task_override_reasons enable row level security;
create policy clinical_task_override_reasons_read on public.clinical_task_override_reasons for select to authenticated
  using (clinician_profile_id = (select auth.uid()));
grant select on public.clinical_task_override_reasons to authenticated;
revoke insert, update, delete, truncate on public.clinical_task_override_reasons from authenticated, anon;
create trigger clinical_task_override_reasons_no_change before update or delete on public.clinical_task_override_reasons
  for each row execute function private.reject_change_append_only();

create function public.record_task_override_reason(p_task uuid, p_code public.override_reason_code)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  t record;
  v_test boolean;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select id, organisation_id, claimed_by, is_test into t from public.clinical_tasks where id = p_task;
  -- the caller held the claim at any time (history), so recording after the task was finished or handed back still works
  if t.id is null or not (coalesce(t.claimed_by = v_uid, false) or exists (select 1 from public.task_claims c where c.task_id = t.id and c.clinician_id = v_uid)) then
    raise exception 'you did not hold this task' using errcode = '42501';
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;
  insert into public.clinical_task_override_reasons (organisation_id, task_id, clinician_profile_id, code, is_test)
  values (t.organisation_id, t.id, v_uid, p_code, v_test or coalesce(t.is_test, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_task_override_reason(uuid, public.override_reason_code) from public, anon;
grant execute on function public.record_task_override_reason(uuid, public.override_reason_code) to authenticated;

-- 3. Case brief feedback -------------------------------------------------------------------------------------------------
create table public.case_brief_feedback (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  case_brief_id        uuid not null references public.case_briefs (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  feedback             text not null check (feedback in ('useful', 'unsafe', 'missing')),
  code                 public.override_reason_code,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint case_brief_feedback_code_needs_concern check (code is null or feedback in ('unsafe', 'missing'))
);
create index case_brief_feedback_latest_idx on public.case_brief_feedback (case_brief_id, clinician_profile_id, created_at desc);
comment on table public.case_brief_feedback is
  'W-02: a clinician''s one-tap view of an AI-drafted case brief (useful, unsafe, missing something). Append-only; a changed mind is a new row and the latest row per clinician and brief is current. Readable by the clinician who wrote it only; the CMO reads case_brief_feedback_counts. Not used for ranking.';
alter table public.case_brief_feedback enable row level security;
create policy case_brief_feedback_read on public.case_brief_feedback for select to authenticated
  using (clinician_profile_id = (select auth.uid()));
grant select on public.case_brief_feedback to authenticated;
revoke insert, update, delete, truncate on public.case_brief_feedback from authenticated, anon;
create trigger case_brief_feedback_no_change before update or delete on public.case_brief_feedback
  for each row execute function private.reject_change_append_only();

create function public.record_case_brief_feedback(p_brief uuid, p_feedback text, p_code public.override_reason_code default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b record;
  v_test boolean;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_feedback not in ('useful', 'unsafe', 'missing') then
    raise exception 'feedback value not allowed' using errcode = '22023';
  end if;
  if p_code is not null and p_feedback = 'useful' then
    raise exception 'a reason code is only for unsafe or missing' using errcode = '22023';
  end if;
  select id, organisation_id, patient_id into b from public.case_briefs where id = p_brief;
  -- a real relationship to the case: the repo's clinician-patient helper
  if b.id is null or b.organisation_id is distinct from private.current_org_id() or not private.clinician_has_patient_access(b.patient_id) then
    raise exception 'brief not found' using errcode = '42501';
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;
  insert into public.case_brief_feedback (organisation_id, case_brief_id, clinician_profile_id, feedback, code, is_test)
  values (b.organisation_id, b.id, v_uid, p_feedback, p_code, v_test)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_case_brief_feedback(uuid, text, public.override_reason_code) from public, anon;
grant execute on function public.record_case_brief_feedback(uuid, text, public.override_reason_code) to authenticated;

-- 4. CMO aggregates: no clinician field, groups under 3 omitted ---------------------------------------------------------
create function public.case_brief_feedback_counts()
returns table (feedback text, code public.override_reason_code, responses integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read brief feedback counts' using errcode = '42501';
  end if;
  return query
    with latest as (
      select distinct on (f.case_brief_id, f.clinician_profile_id) f.feedback as fb, f.code as cd
        from public.case_brief_feedback f
       where f.organisation_id = private.current_org_id() and not f.is_test
       order by f.case_brief_id, f.clinician_profile_id, f.created_at desc, f.id desc
    )
    select l.fb, l.cd, count(*)::integer from latest l group by l.fb, l.cd having count(*) >= 3;
end $$;
revoke all on function public.case_brief_feedback_counts() from public, anon;
grant execute on function public.case_brief_feedback_counts() to authenticated;

create function public.task_override_reason_counts()
returns table (code public.override_reason_code, responses integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read override reason counts' using errcode = '42501';
  end if;
  return query
    select r.code, count(*)::integer from public.clinical_task_override_reasons r
     where r.organisation_id = private.current_org_id() and not r.is_test
     group by r.code having count(*) >= 3;
end $$;
revoke all on function public.task_override_reason_counts() from public, anon;
grant execute on function public.task_override_reason_counts() to authenticated;

create function public.alert_override_reason_counts()
returns table (code public.override_reason_code, responses integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read override reason counts' using errcode = '42501';
  end if;
  return query
    select e.code, count(*)::integer from public.alert_override_events e
     where e.organisation_id = private.current_org_id() and not e.is_test and e.code is not null
     group by e.code having count(*) >= 3;
end $$;
revoke all on function public.alert_override_reason_counts() from public, anon;
grant execute on function public.alert_override_reason_counts() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.override_alert_level(uuid,public.alert_level,text,public.override_reason_code)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_task_override_reason(uuid,public.override_reason_code)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_case_brief_feedback(uuid,text,public.override_reason_code)', 'EXECUTE')
     or has_function_privilege('anon', 'public.case_brief_feedback_counts()', 'EXECUTE')
     or has_function_privilege('anon', 'public.task_override_reason_counts()', 'EXECUTE')
     or has_function_privilege('anon', 'public.alert_override_reason_counts()', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-02 function';
  end if;
  if has_table_privilege('anon', 'public.case_brief_feedback', 'SELECT') or has_table_privilege('anon', 'public.clinical_task_override_reasons', 'SELECT')
     or has_table_privilege('anon', 'public.alert_override_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.case_brief_feedback', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_task_override_reasons', 'INSERT')
     or has_table_privilege('authenticated', 'public.alert_override_events', 'INSERT') then
    raise exception 'self-check: W-02 table grants are wrong';
  end if;
  -- every raw table has exactly one policy, and it is owner-only
  if exists (select 1 from pg_policies where tablename in ('case_brief_feedback', 'clinical_task_override_reasons', 'alert_override_events')
              and (cmd <> 'SELECT' or qual not ilike '%clinician_profile_id%auth.uid()%' or qual ilike '%credential_is_cmo%'
                   or qual ilike '%is_finance%' or qual ilike '%is_admin%' or qual ilike '%is_org_staff%')) then
    raise exception 'self-check: a W-02 table has a policy that is not owner-only';
  end if;
  if (select count(*) from pg_enum where enumtypid = 'public.override_reason_code'::regtype) <> 5 then
    raise exception 'self-check: override_reason_code should have 5 values';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'clinician_alerts' and column_name = 'override_reason_code') then
    raise exception 'self-check: clinician_alerts must not carry override_reason_code';
  end if;
end $$;
