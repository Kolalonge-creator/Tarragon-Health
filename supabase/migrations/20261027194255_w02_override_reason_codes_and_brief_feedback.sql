-- W-02 override reason codes and case brief feedback (INNOVATION-BUILD-GAP.md W-02, Prompt 5).
--
-- When a clinician disagrees with the system, a free-text reason is hard to learn from. This adds a short fixed code list so that, later and
-- only after the CMO approves the list, our own rules can be checked against what doctors actually changed. Until then the codes are
-- recorded and NOTHING reads them: no ranker, queue order, alert level or score uses them (W-08 would, and is not built).
--
--   1. enum public.override_reason_code: system_too_high, system_too_low, context_known, data_error, other.
--      CODE LIST AWAITS CMO APPROVAL. The list is data in an enum so a rename is a migration the CMO can see.
--   2. clinician_alerts.override_reason_code: nullable. Nullable on purpose: the existing app writes overrides without it, and a hard
--      requirement would break any session not yet on the new page. The override control now asks for it.
--   3. public.clinical_task_override_reasons: one row per task the clinician says they changed the system's mind on when finishing it.
--      Written by record_task_override_reason (the clinician who holds the task). Append-only; own read plus CMO read.
--   4. public.case_brief_feedback: useful / unsafe / missing, with an optional reason code, on an AI-drafted case brief. Written by
--      record_case_brief_feedback (org clinicians, not coordinators). Append-only; own read plus CMO read. The CMO sees counts through
--      case_brief_feedback_counts (no clinician identity).
--      Note: case briefs cannot be edited today (they are regenerated), so "brief edits" is covered by this feedback row.
--
-- Counts before: 0 rows in the new tables; one nullable column added. ROLLBACK: drop the two tables, the column, then the enum.

create type public.override_reason_code as enum ('system_too_high', 'system_too_low', 'context_known', 'data_error', 'other');
comment on type public.override_reason_code is
  'W-02: why a clinician changed the system''s answer. The code list awaits CMO approval. Recorded for checking our own rules; not used by any ranking, queue order or score.';

alter table public.clinician_alerts add column override_reason_code public.override_reason_code;
comment on column public.clinician_alerts.override_reason_code is
  'W-02: the clinician''s coded reason for the override. Nullable (older overrides and older clients have none). Not read by any ranking.';

create function private.worg_append_only() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.worg_append_only() from public, anon, authenticated;

-- Task completion reasons ------------------------------------------------------------------------------------------------
create table public.clinical_task_override_reasons (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  task_id              uuid not null references public.clinical_tasks (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  code                 public.override_reason_code not null,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint clinical_task_override_reasons_one_per_task unique (task_id)
);
comment on table public.clinical_task_override_reasons is
  'W-02: coded reason recorded when a clinician finishes a task differently from what the system suggested. Append-only. Not used for ranking.';
alter table public.clinical_task_override_reasons enable row level security;
create policy clinical_task_override_reasons_read on public.clinical_task_override_reasons for select to authenticated
  using (clinician_profile_id = (select auth.uid()) or (private.credential_is_cmo() and organisation_id = private.current_org_id()));
grant select on public.clinical_task_override_reasons to authenticated;
revoke insert, update, delete, truncate on public.clinical_task_override_reasons from authenticated, anon;
create trigger clinical_task_override_reasons_no_change before update or delete on public.clinical_task_override_reasons
  for each row execute function private.worg_append_only();

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
  if t.id is null or t.claimed_by is distinct from v_uid then
    raise exception 'you do not hold this task' using errcode = '42501';
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;
  insert into public.clinical_task_override_reasons (organisation_id, task_id, clinician_profile_id, code, is_test)
  values (t.organisation_id, t.id, v_uid, p_code, v_test or coalesce(t.is_test, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_task_override_reason(uuid, public.override_reason_code) from public, anon;
grant execute on function public.record_task_override_reason(uuid, public.override_reason_code) to authenticated;

-- Case brief feedback ----------------------------------------------------------------------------------------------------
create table public.case_brief_feedback (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  case_brief_id        uuid not null references public.case_briefs (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  feedback             text not null check (feedback in ('useful', 'unsafe', 'missing')),
  code                 public.override_reason_code,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint case_brief_feedback_one_per_clinician unique (case_brief_id, clinician_profile_id)
);
comment on table public.case_brief_feedback is
  'W-02: a clinician''s one-tap view of an AI-drafted case brief (useful, unsafe, missing something). Append-only. Not used for ranking.';
alter table public.case_brief_feedback enable row level security;
create policy case_brief_feedback_read on public.case_brief_feedback for select to authenticated
  using (clinician_profile_id = (select auth.uid()) or (private.credential_is_cmo() and organisation_id = private.current_org_id()));
grant select on public.case_brief_feedback to authenticated;
revoke insert, update, delete, truncate on public.case_brief_feedback from authenticated, anon;
create trigger case_brief_feedback_no_change before update or delete on public.case_brief_feedback
  for each row execute function private.worg_append_only();

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
  select id, organisation_id into b from public.case_briefs where id = p_brief;
  if b.id is null or b.organisation_id is distinct from private.current_org_id() then
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

-- CMO counts: no clinician identity, no ordering by a person.
create function public.case_brief_feedback_counts()
returns table (feedback text, responses integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read brief feedback counts' using errcode = '42501';
  end if;
  return query
    select f.feedback, count(*)::integer from public.case_brief_feedback f
     where f.organisation_id = private.current_org_id() and not f.is_test
     group by f.feedback;
end $$;
revoke all on function public.case_brief_feedback_counts() from public, anon;
grant execute on function public.case_brief_feedback_counts() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_task_override_reason(uuid,public.override_reason_code)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_case_brief_feedback(uuid,text,public.override_reason_code)', 'EXECUTE')
     or has_function_privilege('anon', 'public.case_brief_feedback_counts()', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-02 function';
  end if;
  if has_table_privilege('anon', 'public.case_brief_feedback', 'SELECT') or has_table_privilege('anon', 'public.clinical_task_override_reasons', 'SELECT')
     or has_table_privilege('authenticated', 'public.case_brief_feedback', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_task_override_reasons', 'INSERT') then
    raise exception 'self-check: W-02 table grants are wrong';
  end if;
  if (select count(*) from pg_enum where enumtypid = 'public.override_reason_code'::regtype) <> 5 then
    raise exception 'self-check: override_reason_code should have 5 values';
  end if;
end $$;
