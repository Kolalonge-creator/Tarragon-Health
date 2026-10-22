-- S54d: a private reason for a missed dose ("I ran out, or cannot afford it this month"), and the NAFDAC helper's go-live guard.
--
-- NOT APPLIED to any database by the session that wrote it. The proof (packages/db/tests/s54d_private_dose_reasons.sql) has NOT been run:
-- Docker was not usable in that session. The CI replay is its first run.
--
-- Counted first: no table named medication_dose_reasons or dose_reason_sharing exists, so nothing is converted. Reasons already stored in
-- medication_logs.reason (the phone has written 'ran_out' there since S08) stay where they are; only NEW private reasons are diverted.
--
-- What it does
--   1. private.is_private_dose_reason(text): the private codes. Mirrors the PROPOSED config medicines.dose_reasons (a Jest test fails on drift).
--   2. public.medication_dose_reasons: one row per dose event (FK to medication_logs) holding a private reason, apart from the dose log. The dose
--      log is readable by a supporter who holds the medicines category; this table is not, unless the person opted in for that exact reason.
--   3. A BEFORE INSERT trigger on medication_logs moves a private code out of medication_logs.reason (so the supporter-readable row never carries
--      it) and an AFTER INSERT trigger writes it to medication_dose_reasons with source and recorded_by from the dose event. Works for the phone,
--      the web and an acting supporter alike, and is idempotent with the client-id retry (no AFTER trigger fires for a row that was not inserted).
--   4. public.dose_reason_sharing + public.set_dose_reason_sharing: the person's opt-in, per reason, for supporters. Off by default.
--   5. public.read_dose_reasons_audited: the tied care team's read, audited (INV-10) like read_medication_dose_log_audited.
--   6. The go-live guard nafdac_verify_helper_enabled, born OFF.
-- It raises no clinician alert and changes no notification: the supporter missed-dose notice (S53) fires only on status = 'missed' and carries
-- no reason, and still does.

-- 1. The private codes ------------------------------------------------------------------------------------------------------------------
create or replace function private.is_private_dose_reason(p_code text)
returns boolean language sql immutable set search_path = '' as $$
  select p_code in ('ran_out', 'cannot_afford')
$$;
revoke all on function private.is_private_dose_reason(text) from public, anon;
grant execute on function private.is_private_dose_reason(text) to authenticated;

-- 2. The reasons, apart from the dose log -----------------------------------------------------------------------------------------------
create table public.medication_dose_reasons (
  medication_log_id uuid primary key references public.medication_logs (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  reason_code       text not null check (reason_code ~ '^[a-z][a-z_]{1,39}$'),
  source            public.record_source not null default 'patient',
  recorded_by       uuid references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now()
);
comment on table public.medication_dose_reasons is
  'S54d. A private reason for a dose event (for example ran out or cannot afford it). Read by the person, someone acting for them, a supporter only after an opt-in for that exact reason (dose_reason_sharing), and the tied care team through read_dose_reasons_audited. Written only by the trigger on medication_logs.';
create index medication_dose_reasons_patient_idx on public.medication_dose_reasons (patient_id, created_at desc);
create index medication_dose_reasons_org_idx on public.medication_dose_reasons (organisation_id);

-- 4. The opt-in, per reason ---------------------------------------------------------------------------------------------------------------
create table public.dose_reason_sharing (
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  reason_code          text not null check (reason_code ~ '^[a-z][a-z_]{1,39}$'),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  share_with_supporters boolean not null default false,
  updated_at           timestamptz not null default now(),
  primary key (patient_id, reason_code)
);
comment on table public.dose_reason_sharing is
  'S54d. The person''s choice, per private reason, to let supporters who hold the medicines category see it. No row means no.';
create index dose_reason_sharing_org_idx on public.dose_reason_sharing (organisation_id);

-- Does the person allow supporters to see this reason? A definer function, because the supporter cannot read the person''s choice directly.
create or replace function private.supporter_may_see_dose_reason(p_patient uuid, p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dose_reason_sharing s
                  where s.patient_id = p_patient and s.reason_code = p_code and s.share_with_supporters)
$$;
revoke all on function private.supporter_may_see_dose_reason(uuid, text) from public, anon;
grant execute on function private.supporter_may_see_dose_reason(uuid, text) to authenticated;

alter table public.medication_dose_reasons enable row level security;
alter table public.dose_reason_sharing enable row level security;

create policy medication_dose_reasons_select on public.medication_dose_reasons for select to authenticated using (
  patient_id = (select auth.uid())
  or private.can_act_for(patient_id)
  or (private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
      and private.supporter_may_see_dose_reason(patient_id, reason_code))
);
-- No staff policy: the tied care team reads through read_dose_reasons_audited, which applies the tie and writes the audit row.
create policy dose_reason_sharing_select on public.dose_reason_sharing for select to authenticated using (patient_id = (select auth.uid()));

revoke all on public.medication_dose_reasons from public, anon, authenticated;
revoke all on public.dose_reason_sharing from public, anon, authenticated;
grant select on public.medication_dose_reasons to authenticated;
grant select on public.dose_reason_sharing to authenticated;

create or replace function public.set_dose_reason_sharing(p_code text, p_share boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_share is null then raise exception 'say yes or no' using errcode = '22023'; end if;
  if not private.is_private_dose_reason(p_code) then raise exception 'not a private reason' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  insert into public.dose_reason_sharing (patient_id, reason_code, organisation_id, share_with_supporters, updated_at)
  values (v_uid, p_code, v_org, p_share, now())
  on conflict (patient_id, reason_code) do update set share_with_supporters = excluded.share_with_supporters, updated_at = now();
  perform private.log_audit('dose_reason_sharing.set', 'profile', v_uid, jsonb_build_object('reason_code', p_code, 'share', p_share));
end $$;
revoke all on function public.set_dose_reason_sharing(text, boolean) from public, anon;
grant execute on function public.set_dose_reason_sharing(text, boolean) to authenticated;

-- 3. Divert a private code out of the supporter-readable dose row ------------------------------------------------------------------------
create or replace function private.divert_private_dose_reason() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reason is not null and private.is_private_dose_reason(btrim(new.reason)) then
    -- A custom setting names the pending code for this row; settings cannot hold a hyphen, so the id is written with underscores.
    perform set_config('tarragon.dose_reason.r' || replace(new.id::text, '-', '_'), btrim(new.reason), true);
    new.reason := null;
  end if;
  return new;
end $$;
revoke all on function private.divert_private_dose_reason() from public, anon, authenticated;
create trigger medication_logs_divert_private_reason before insert on public.medication_logs
  for each row execute function private.divert_private_dose_reason();

create or replace function private.record_private_dose_reason() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := 'tarragon.dose_reason.r' || replace(new.id::text, '-', '_');
  v_code text := nullif(current_setting(v_name, true), '');
begin
  if v_code is null then return new; end if;
  insert into public.medication_dose_reasons (medication_log_id, organisation_id, patient_id, reason_code, source, recorded_by)
  values (new.id, new.organisation_id, new.patient_id, v_code, new.source, coalesce(new.logged_by_profile_id, new.patient_id))
  on conflict (medication_log_id) do nothing;
  perform set_config(v_name, '', true);
  return new;
end $$;
revoke all on function private.record_private_dose_reason() from public, anon, authenticated;
create trigger medication_logs_record_private_reason after insert on public.medication_logs
  for each row execute function private.record_private_dose_reason();

-- 5. The tied care team's audited read ----------------------------------------------------------------------------------------------------
create or replace function public.read_dose_reasons_audited(p_patient uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'rows', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.logged_at desc), '[]'::jsonb) into v_rows from (
    select r.medication_log_id, r.reason_code, l.status, l.logged_at, l.scheduled_for_date, l.scheduled_time
      from public.medication_dose_reasons r
      join public.medication_logs l on l.id = r.medication_log_id
     where r.patient_id = p_patient
     order by l.logged_at desc
     limit 100) x;
  perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end $$;
revoke all on function public.read_dose_reasons_audited(uuid, text) from public, anon;
grant execute on function public.read_dose_reasons_audited(uuid, text) to authenticated;

-- 6. The NAFDAC helper's guard, born OFF ---------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('nafdac_verify_helper_enabled', 'NAFDAC check helper (registration link and message-app link)',
   'The "check this pack with NAFDAC" block that links to the Greenbook and opens the person''s own messages app with the scratch code filled in',
   'The founder has confirmed that a patient-sent text fits INV-08, and NAFDAC has confirmed in writing the number to text and how the service works', 'admin',
   array['the NAFDAC check block on the phone and the web read public.go_live_guard_is_open before showing the message-app link'],
   'The existing how-to card (Greenbook address and the printed instructions) is not behind this guard. Tarragon sends and receives no message either way.')
on conflict (key) do nothing;

-- 7. The patient-data registry (S39d), left unreviewed for the CMO and DPO ----------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values
  ('medication_dose_reasons', 'patient_id', private.retention_class_for('medication_dose_reasons'), 'review', true, false,
   'Added in S54d (2026-10-22). Class proposed by the standing name rule; awaiting the next CMO and DPO class review. Tied staff read it only through read_dose_reasons_audited, so there is no staff_read_scope row.'),
  ('dose_reason_sharing', 'patient_id', private.retention_class_for('dose_reason_sharing'), 'review', true, false,
   'Added in S54d (2026-10-22). The person''s own sharing choice. Awaiting the next CMO and DPO class review.')
on conflict (table_name) do nothing;

-- The migration proves what it claims -------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.medication_dose_reasons', 'SELECT') or has_table_privilege('anon', 'public.dose_reason_sharing', 'SELECT') then
    raise exception 'S54d: anon can read a new table';
  end if;
  if has_table_privilege('authenticated', 'public.medication_dose_reasons', 'INSERT') or has_table_privilege('authenticated', 'public.dose_reason_sharing', 'INSERT')
     or has_table_privilege('authenticated', 'public.dose_reason_sharing', 'UPDATE') then
    raise exception 'S54d: a client can write a new table directly';
  end if;
  if has_function_privilege('anon', 'public.read_dose_reasons_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_dose_reason_sharing(text,boolean)', 'EXECUTE') then
    raise exception 'S54d: anon can execute a new function';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'medication_logs_divert_private_reason' and tgrelid = 'public.medication_logs'::regclass and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'medication_logs_record_private_reason' and tgrelid = 'public.medication_logs'::regclass and not tgisinternal) then
    raise exception 'S54d: a dose-reason trigger is missing';
  end if;
  if not exists (select 1 from public.go_live_guards where key = 'nafdac_verify_helper_enabled' and not is_on) then
    raise exception 'S54d: the NAFDAC helper guard is missing or on';
  end if;
end $$;
