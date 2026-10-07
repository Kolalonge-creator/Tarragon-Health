-- S39c: audited record access (INV-10, INV-12; founder direction 2026-10-07, OQ-278). The NHS model: a doctor can search for any patient in
-- the organisation and open the record, with no reason to type and nothing shown to the patient, and every opening is written to a log that
-- cannot be edited or deleted, reviewed by the CMO and an admin.
--   * staff_record_opens: the append-only log AND the grant. One row per opening: who, which patient, when, how (tied or open), after hours.
--   * public.open_patient_record(patient): the only way to open an untied patient. It writes the log row first; the window it grants
--     (security_config.record_open_window_hours) is what private.staff_may_read now also accepts. So a read of any tied table by an untied
--     clinician is impossible without a logged opening (enforced in the database, not in the app).
--   * Never through this path: a care coordinator (logistics only), a non-clinician, another organisation, reproductive_health (INV-12 and
--     CLAUDE.md: break-glass and any open path exclude it). A tied clinician is logged the same way (basis 'tied') but needs no window.
--   * Alerts: a clinician with many untied openings in an hour opens one security incident; the weekly access_review_report lists per
--     person the counts, after-hours openings and distinct patients, for the CMO. The alert never turns an opening into an error.
--   * Config: security_config v2 (PROPOSED, new version, never an edit): window 8 hours, 20 untied openings an hour, after hours 22:00 to 06:00 Lagos.
--   * Retention (PROPOSED, founder 2026-10-07, NHS Records Management Code and HIPAA as references, counsel to confirm): adult record 8 years after
--     last contact, child to 25 (26 if seen at 17), maternity 25, mental health 20, access log 8, consent relationship plus 6, payments 6, operational
--     data 90 days to 2 years. Held as config only; real_data_auto_delete is false, so nothing is deleted by it (founder: do not erase real data).
-- private.is_org_staff is NOT edited. No data is changed. Applied with the version pinned to this filename.

-- 1. Versioned config v2 -------------------------------------------------------
update public.security_config set is_active = false where is_active and version = 1;
insert into public.security_config (version, is_active, config)
-- security-rules-v2-begin
select 2, true, $json$
{"lookup_failure_alert_per_hour": 50, "record_open_window_hours": 8, "untied_open_alert_per_hour": 20, "after_hours_start": 22, "after_hours_end": 6,
 "retention": {"adult_clinical_record_years_after_last_contact": 8, "child_record_until_age": 25, "child_record_until_age_if_seen_at_17": 26,
   "maternity_record_years": 25, "mental_health_years_after_last_contact": 20, "access_audit_log_years": 8,
   "consent_years_after_relationship_end": 6, "payments_ledger_years": 6, "operational_data_days_min": 90, "operational_data_days_max": 730,
   "real_data_auto_delete": false}}
$json$::jsonb
where not exists (select 1 from public.security_config where version = 2);

-- 2. The log ---------------------------------------------------------------------
create table public.staff_record_opens (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  staff_id uuid not null,
  patient_id uuid not null,
  organisation_id uuid not null,
  basis text not null check (basis in ('tied', 'open')),
  after_hours boolean not null default false
);
-- No foreign keys on purpose: the log must outlive a deleted account.
create index staff_record_opens_staff_idx on public.staff_record_opens (staff_id, opened_at desc);
create index staff_record_opens_patient_idx on public.staff_record_opens (patient_id, opened_at desc);
create index staff_record_opens_live_idx on public.staff_record_opens (staff_id, patient_id, expires_at desc);
alter table public.staff_record_opens enable row level security;
revoke all on public.staff_record_opens from public, anon, authenticated;
grant select on public.staff_record_opens to authenticated;
comment on table public.staff_record_opens is 'S39c: append-only log of every staff opening of a patient record, and the window it grants for untied clinicians. Readable by the CMO and admins only.';

create function private.can_review_access_log() returns boolean language sql stable security definer set search_path = '' as
$$
  select coalesce(private.is_admin(), false)
      or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer')
$$;
revoke all on function private.can_review_access_log() from public, anon;
grant execute on function private.can_review_access_log() to authenticated;
create policy staff_record_opens_review on public.staff_record_opens for select to authenticated using (private.can_review_access_log());

create function private.block_record_open_change() returns trigger language plpgsql as
$$ begin raise exception 'staff_record_opens is append-only' using errcode = '42501'; end $$;
create trigger staff_record_opens_no_change before update or delete on public.staff_record_opens for each row execute function private.block_record_open_change();
create trigger staff_record_opens_no_truncate before truncate on public.staff_record_opens for each statement execute function private.block_record_open_change();

-- 3. The window check, and staff_may_read accepting it ----------------------------------
create function private.staff_has_open(p_patient uuid, p_category public.care_access_category) returns boolean
language sql stable security definer set search_path = '' as
$$
  select p_category is distinct from 'reproductive_health'::public.care_access_category
     and exists (
       select 1
         from public.staff_record_opens o
         join public.profiles me on me.id = o.staff_id
         join public.profiles pt on pt.id = o.patient_id
        where o.staff_id = (select auth.uid()) and o.patient_id = p_patient and o.expires_at > now()
          and me.role = 'clinician' and me.is_active and pt.organisation_id = me.organisation_id
          and exists (select 1 from public.clinical_staff cs where cs.profile_id = me.id and cs.active)
     )
$$;
revoke all on function private.staff_has_open(uuid, public.care_access_category) from public, anon, authenticated;

create or replace function private.staff_may_read(p_patient uuid, p_org uuid, p_category public.care_access_category) returns boolean
language sql stable security definer set search_path = '' as
$$
  select case
    when not private.tied_staff_reads_on() then private.is_org_staff(p_org)
    when exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'care_coordinator') then false
    else private.can_staff_read_clinical(p_patient, p_category) or private.staff_has_open(p_patient, p_category)
  end
$$;

-- 4. The opening --------------------------------------------------------------------------
create function public.open_patient_record(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_me uuid := (select auth.uid()); v_org uuid; v_pat_org uuid; v_cfg jsonb; v_hours integer; v_limit integer; v_hour integer;
  v_after boolean; v_basis text; v_live public.staff_record_opens%rowtype; v_n integer; v_exp timestamptz;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select organisation_id into v_org from public.profiles where id = v_me and role = 'clinician' and is_active;
  if v_org is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_me and cs.active) then
    raise exception 'only an active clinician can open a patient record' using errcode = '42501';
  end if;
  select organisation_id into v_pat_org from public.profiles where id = p_patient and role = 'patient';
  if v_pat_org is null or v_pat_org <> v_org or p_patient = v_me then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  select config into v_cfg from public.security_config where is_active;
  v_hours := coalesce((v_cfg ->> 'record_open_window_hours')::integer, 8);
  v_limit := coalesce((v_cfg ->> 'untied_open_alert_per_hour')::integer, 20);
  v_hour := extract(hour from (now() at time zone 'Africa/Lagos'))::integer;
  v_after := case when coalesce((v_cfg ->> 'after_hours_start')::integer, 22) > coalesce((v_cfg ->> 'after_hours_end')::integer, 6)
                  then v_hour >= coalesce((v_cfg ->> 'after_hours_start')::integer, 22) or v_hour < coalesce((v_cfg ->> 'after_hours_end')::integer, 6)
                  else v_hour >= coalesce((v_cfg ->> 'after_hours_start')::integer, 22) and v_hour < coalesce((v_cfg ->> 'after_hours_end')::integer, 6) end;
  v_basis := case when private.clinician_has_patient_access(p_patient) then 'tied' else 'open' end;

  -- a second opening inside a live window is the same visit: no new row
  select * into v_live from public.staff_record_opens
   where staff_id = v_me and patient_id = p_patient and expires_at > now() order by opened_at desc limit 1;
  if found then
    return jsonb_build_object('opened', true, 'basis', v_live.basis, 'expires_at', v_live.expires_at, 'new', false);
  end if;

  v_exp := now() + make_interval(hours => v_hours);
  insert into public.staff_record_opens (expires_at, staff_id, patient_id, organisation_id, basis, after_hours)
  values (v_exp, v_me, p_patient, v_org, v_basis, v_after);
  perform private.log_audit('record_open', 'patient', p_patient, jsonb_build_object('basis', v_basis, 'after_hours', v_after));

  -- the alert must never turn an opening into an error
  if v_basis = 'open' then
    begin
      select count(*) into v_n from public.staff_record_opens where staff_id = v_me and basis = 'open' and opened_at > now() - interval '1 hour';
      if v_n >= v_limit and not exists (select 1 from public.ops_incidents where external_reference = 'record-opens-' || v_me and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values (v_org, 'security', 'sev3', 'Many untied patient records opened by one clinician',
                v_n || ' patients outside this clinician''s care were opened in one hour. Review the access log for this person.',
                'record-opens-' || v_me, now() + interval '1 day', now() + interval '3 days');
      end if;
    exception when others then
      raise warning 'S39c: could not record the record-open alert: %', sqlerrm;
    end;
  end if;
  return jsonb_build_object('opened', true, 'basis', v_basis, 'expires_at', v_exp, 'new', true);
end $$;
revoke all on function public.open_patient_record(uuid) from public, anon;
grant execute on function public.open_patient_record(uuid) to authenticated;

-- 5. The review -------------------------------------------------------------------------------
create function public.access_review_report(p_days integer default 7) returns table (
  staff_id uuid, staff_name text, openings bigint, untied_openings bigint, after_hours_openings bigint, distinct_patients bigint
) language plpgsql stable security definer set search_path = '' as
$$
begin
  if not private.can_review_access_log() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select o.staff_id, coalesce(max(pr.full_name), 'unknown'), count(*), count(*) filter (where o.basis = 'open'),
           count(*) filter (where o.after_hours), count(distinct o.patient_id)
      from public.staff_record_opens o left join public.profiles pr on pr.id = o.staff_id
     where o.opened_at > now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
     group by o.staff_id
     order by count(*) filter (where o.basis = 'open') desc, count(*) desc;
end $$;
revoke all on function public.access_review_report(integer) from public, anon;
grant execute on function public.access_review_report(integer) to authenticated;

-- 6. Self-check ----------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.security_config where is_active) <> 1 or (select version from public.security_config where is_active) <> 2 then raise exception 'S39c: security_config v2 is not the one active row'; end if;
  if has_table_privilege('anon', 'public.staff_record_opens', 'SELECT') then raise exception 'S39c: anon can read the log'; end if;
  if has_table_privilege('authenticated', 'public.staff_record_opens', 'INSERT') or has_table_privilege('authenticated', 'public.staff_record_opens', 'UPDATE') or has_table_privilege('authenticated', 'public.staff_record_opens', 'DELETE') then raise exception 'S39c: the log is writable'; end if;
  if has_function_privilege('anon', 'public.open_patient_record(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.access_review_report(integer)', 'EXECUTE') then raise exception 'S39c: anon can execute'; end if;
end $$;
