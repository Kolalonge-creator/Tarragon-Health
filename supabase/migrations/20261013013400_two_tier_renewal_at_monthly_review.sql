-- Two-tier decision, 2026-10-13: a prescription renewal is NOT a separate request. It is discussed and prescribed at the Member's
-- monthly doctor review, through the existing prescribing. This migration gives that review what it needs:
--   * member_review_notes: an optional, patient-written note ("add to my next review"), optionally about one medicine. Written only
--     through add_review_note (Members only, 1 to 500 characters, at most 10 in 31 days). It is read by the Member (own rows) and by
--     the doctor ONLY through the audited pre-call summary; nothing is notified, so nothing about it reaches a phone (INV-07 neutral).
--   * precall_summary now also lists the medicines due for renewal (active, not stopped or superseded, prescription expiring within the
--     lookahead window of the call, PROPOSED 30 days in membership_policy_config kind 'review', or that the Member asked about) and the
--     Member's notes since the last completed call, under the same denied-section rules as the medicines section.
--   The standalone request route is closed for a Member by the trigger in 20261013012811. Free people see the Membership message;
--   a credit someone already holds keeps working for a non-Member.
-- LIVE COUNT BEFORE (read-only 2026-10-13 pattern): the table is new, 0 rows.
-- ROLLBACK: restore the 20261013005824 body of precall_summary; drop function public.add_review_note; drop table public.member_review_notes.

create table public.member_review_notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  medication_id   uuid references public.medications (id) on delete set null,
  note            text not null check (char_length(btrim(note)) between 1 and 500),
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false
);
create index member_review_notes_patient_idx on public.member_review_notes (patient_id, created_at desc);
create index member_review_notes_medication_idx on public.member_review_notes (medication_id) where medication_id is not null;
create index member_review_notes_org_idx on public.member_review_notes (organisation_id);
alter table public.member_review_notes enable row level security;
create policy member_review_notes_own on public.member_review_notes for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on table public.member_review_notes from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.member_review_notes from authenticated;
grant select on table public.member_review_notes to authenticated;
grant all on table public.member_review_notes to service_role;

create function public.add_review_note(p_medication uuid, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_note text := btrim(coalesce(p_note, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select pr.organisation_id, coalesce(pr.is_test, false) into v_org, v_test from public.profiles pr where pr.id = v_uid;
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not coalesce(private.patient_is_member(v_uid), false) then
    raise exception 'Adding a note to your next review is part of Membership. Join to do this.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
  end if;
  if char_length(v_note) < 1 or char_length(v_note) > 500 then
    raise exception 'Please write between 1 and 500 characters.' using errcode = '22023';
  end if;
  if p_medication is not null and not exists (select 1 from public.medications m where m.id = p_medication and m.patient_id = v_uid and m.is_active) then
    raise exception 'That medicine is not on your list.' using errcode = '22023';
  end if;
  if (select count(*) from public.member_review_notes n where n.patient_id = v_uid and n.created_at > now() - interval '31 days') >= 10 then
    raise exception 'You have added several notes already. Your doctor will see them at your next review.' using errcode = 'P0001';
  end if;
  insert into public.member_review_notes (organisation_id, patient_id, medication_id, note, is_test)
  values (v_org, v_uid, p_medication, v_note, v_test) returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'review_note.added', 'member_review_notes', v_id, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.add_review_note(uuid, text) from public, anon;
grant execute on function public.add_review_note(uuid, text) to authenticated;

create or replace function public.precall_summary(p_encounter uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  v_summary jsonb;
  v_denied jsonb;
  v_since timestamptz;
  v_last timestamptz;
  v_trend jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_started jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_renewals jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.clinician_id is distinct from v_uid
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then
    raise exception 'this consultation is %', e.status using errcode = 'P0001';
  end if;

  v_summary := public.clinician_patient_summary(e.patient_id, 'Pre-call summary for a scheduled follow-up call');
  if v_summary ->> 'status' = 'denied' then
    return jsonb_build_object('status', 'denied');
  end if;
  v_denied := coalesce(v_summary -> 'denied', '[]'::jsonb);

  select max(x.ended_at) into v_last from public.encounters x
   where x.patient_id = e.patient_id and x.status = 'completed' and x.id <> e.id and x.ended_at < coalesce(e.scheduled_at, now());
  v_since := coalesce(v_last, now() - interval '30 days');

  if not (v_denied ? 'readings') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.type), '[]'::jsonb) into v_trend from (
      select o.type,
             count(*) as readings,
             min(o.measured_at) as first_at,
             max(o.measured_at) as last_at,
             (array_agg(coalesce(o.systolic::numeric, o.value_numeric) order by o.measured_at asc))[1] as first_value,
             (array_agg(coalesce(o.systolic::numeric, o.value_numeric) order by o.measured_at desc))[1] as last_value,
             round(avg(coalesce(o.systolic::numeric, o.value_numeric)), 1) as average,
             round(avg(o.diastolic::numeric), 1) as average_diastolic
        from public.observations o
       where o.patient_id = e.patient_id and o.measured_at >= v_since and o.measured_at >= now() - interval '60 days'
       group by o.type) t;
  end if;
  if not (v_denied ? 'results') then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into v_results
      from jsonb_array_elements(coalesce(v_summary -> 'results', '[]'::jsonb)) r
     where (r ->> 'received_at')::timestamptz > v_since;
  end if;
  if not (v_denied ? 'medications') then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) into v_started from (
      select drug_name, dose, frequency, is_active, created_at
        from public.medications where patient_id = e.patient_id and created_at > v_since order by created_at desc limit 20) m;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.applied_at desc), '[]'::jsonb) into v_changes from (
      select kind, proposed_by, state, applied_at
        from public.care_plan_changes
       where patient_id = e.patient_id and state = 'confirmed' and applied_at > v_since order by applied_at desc limit 20) c;
  end if;
  select coalesce(jsonb_agg(to_jsonb(k) order by k.due_at), '[]'::jsonb) into v_tasks from (
    select type, state, due_at, priority_class from public.clinical_tasks
     where patient_id = e.patient_id and state in ('offered_to_lead', 'open', 'claimed', 'escalated') order by due_at limit 20) k;

  -- Renewals are decided at this call (not through a separate request): the medicines that need one, and what the Member wrote.
  if not (v_denied ? 'medications') then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.expires_at nulls last), '[]'::jsonb) into v_renewals from (
      select md.id, md.drug_name, md.dose, md.frequency, md.expires_at,
             case when exists (select 1 from public.member_review_notes n where n.medication_id = md.id and n.created_at > v_since)
                  then 'patient_asked' else 'expiring' end as reason
        from public.medications md
       where md.patient_id = e.patient_id and md.is_active and md.stopped_at is null and md.superseded_at is null
         and ((md.expires_at is not null
               and md.expires_at <= coalesce(e.scheduled_at, now()) + make_interval(days => private.membership_review_renewal_window_days()))
              or exists (select 1 from public.member_review_notes n where n.medication_id = md.id and n.created_at > v_since))
       order by md.expires_at nulls last limit 30) m;
  end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at), '[]'::jsonb) into v_notes from (
    select id, medication_id, note, created_at from public.member_review_notes
     where patient_id = e.patient_id and created_at > v_since order by created_at limit 20) n;

  perform private.s35_audit_read(e.patient_id, array['precall_extras'], 'Pre-call summary for a scheduled follow-up call', 'success');

  return jsonb_build_object(
    'status', v_summary ->> 'status',
    'encounter', jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'planned_minutes', e.planned_minutes,
                                    'extended_minutes', e.extended_minutes, 'longer_requested', e.longer_requested),
    'since_last_call', v_last,
    'since', v_since,
    'summary', v_summary,
    'vitals_trend', v_trend,
    'results_since', v_results,
    'medicines_started_since', v_started,
    'medicine_changes_since', v_changes,
    'open_tasks', v_tasks,
    'renewals_due', v_renewals,
    'patient_notes', v_notes);
end;
$$;
revoke all on function public.precall_summary(uuid) from public, anon;
grant execute on function public.precall_summary(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.add_review_note(uuid, text)', 'EXECUTE') or has_function_privilege('anon', 'public.precall_summary(uuid)', 'EXECUTE')
     or has_table_privilege('anon', 'public.member_review_notes', 'SELECT')
     or has_table_privilege('authenticated', 'public.member_review_notes', 'INSERT') then
    raise exception 'two-tier: review note access is wrong';
  end if;
end $$;
