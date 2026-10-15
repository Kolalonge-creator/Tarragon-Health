-- S75-80 independent review fixes (2026-10-07). Nothing here has shipped, so these are corrections to the S75 to S80 migrations
-- rather than new features. Each change is a text patch of the CURRENT definition, with the anchor asserted, so it fails loudly
-- instead of silently doing nothing if a neighbour changed the function.
--
--  1. (HIGH) A Care Coordinator (doctor_tier = 'care_coordinator') could read a patient's PHQ-9 and GAD-7 outcomes through
--     clinician_mental_health_outcomes, and could read clinical_follow_ups rows directly. Coordinators are non-clinical logistics
--     staff. Both doors now require a clinical tier, matching private.follow_up_actor_is_clinician.
--  2. (MEDIUM) The automations registry paused anything not on a name denylist. A job added later, or one the denylist forgot
--     (for example the licence re-verification sweep), could be paused by an admin. It is now default-deny: only jobs explicitly
--     marked pausable can be paused, and none are until a person marks them.
--  3. (MEDIUM) The paging watchdog wrote its audit row and opened the sev1 "outbox stalled" incident whenever create_red_page
--     returned a page id, but create_red_page also returns the existing page when the outbox subscriber won the race. That gave a
--     false incident and an inflated count. The watchdog now records only a page created by its own transaction.
--  4. (MEDIUM) response_time_breaches carries patient_id and kind (an amber review reveals clinical status). Direct admin reads were
--     unaudited (INV-10). The table is now closed to direct reads; the summary function remains the only way in.

-- ---------------------------------------------------------------------------
-- 1. Care Coordinator: no PHQ-9/GAD-7 outcomes, no direct follow-up rows
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'clinician_mental_health_outcomes';
  if v_def is null then raise exception 'review fixes: clinician_mental_health_outcomes not found'; end if;
  v_new := replace(v_def,
    'cs.profile_id = v_uid and cs.active)',
    'cs.profile_id = v_uid and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> ''care_coordinator'')');
  if v_new = v_def then raise exception 'review fixes: anchor not found in clinician_mental_health_outcomes'; end if;
  execute v_new;
end $$;

drop policy if exists clinical_follow_ups_read on public.clinical_follow_ups;
create policy clinical_follow_ups_read on public.clinical_follow_ups for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    and private.follow_up_actor_is_clinician(organisation_id)
    and (owner_id = (select auth.uid()) or private.clinician_has_patient_access(patient_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Automations: default-deny pause
-- ---------------------------------------------------------------------------
alter table public.automations add column if not exists pausable boolean not null default false;
comment on column public.automations.pausable is
  'Default false. A job can be paused from the console only when a person has marked it pausable (a reversible, low-risk job). Safety critical jobs are never pausable.';

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_automation_paused';
  if v_def is null then raise exception 'review fixes: set_automation_paused not found'; end if;
  v_new := replace(v_def,
    $a$  if p_paused and v_row.safety_critical then
    raise exception '% is safety critical and cannot be paused here', p_job_name using errcode = '23514';
  end if;$a$,
    $b$  if p_paused and (v_row.safety_critical or not v_row.pausable) then
    raise exception '% cannot be paused here: it is safety critical or has not been marked pausable', p_job_name using errcode = '23514';
  end if;$b$);
  if v_new = v_def then raise exception 'review fixes: anchor not found in set_automation_paused'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Paging watchdog: record only a page this transaction created
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'sweep_unpaged_red_events';
  if v_def is null then raise exception 'review fixes: sweep_unpaged_red_events not found'; end if;
  v_new := replace(v_def,
    $a$      if v_page is not null then
        v_created := v_created + 1;$a$,
    $b$      -- create_red_page also returns the existing page when the outbox subscriber won the race. Only a page inserted by THIS
      -- transaction means the outbox path really was stalled, so only that earns an audit row and an incident.
      if v_page is not null and exists (
           select 1 from public.pages pg
            where pg.id = v_page and pg.xmin::text::bigint = (txid_current() % 4294967296)
         ) then
        v_created := v_created + 1;$b$);
  if v_new = v_def then raise exception 'review fixes: anchor not found in sweep_unpaged_red_events'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. response_time_breaches: no direct reads (the summary function is the door)
-- ---------------------------------------------------------------------------
drop policy if exists response_time_breaches_read on public.response_time_breaches;
revoke select on public.response_time_breaches from authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('public.clinician_mental_health_outcomes(uuid,text)'::regprocedure) not like '%care_coordinator%' then
    raise exception 'FAIL: mental health outcomes still open to a Care Coordinator';
  end if;
  if (select qual from pg_policies where tablename = 'clinical_follow_ups' and policyname = 'clinical_follow_ups_read') not like '%follow_up_actor_is_clinician%' then
    raise exception 'FAIL: follow-up read policy does not require a clinician';
  end if;
  if exists (select 1 from public.automations where pausable) then
    raise exception 'FAIL: no automation may be pausable until a person marks it';
  end if;
  if exists (select 1 from pg_policies where tablename = 'response_time_breaches') then
    raise exception 'FAIL: response_time_breaches still has a read policy';
  end if;
  if has_table_privilege('authenticated', 'public.response_time_breaches', 'SELECT') then
    raise exception 'FAIL: authenticated can still select response_time_breaches';
  end if;
  raise notice 'PASS: S75-80 review fixes in place';
end $$;
