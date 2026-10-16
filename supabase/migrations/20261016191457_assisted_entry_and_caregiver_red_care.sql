-- Follow-up N: (1) a caregiver can answer the red-alert care question for the person they support; (2) caregiver ASSISTED ENTRY of
-- readings, governed. Written 2026-10-16. Spends the `log_readings` capability added by the migration just before this one.
--
-- WHAT THE LIVE DATABASE ALREADY DID (read before changing anything here)
--   * A caregiver holding a live `manage` grant could already INSERT a vitals_readings row for the person (policy
--     vitals_readings_insert_acting_supporter, 20260801110000) and private.stamp_acting_supporter already stamps logged_by_profile_id
--     from auth.uid(), unforgeable. What was missing: no capability of its own (any manage grant could write readings, even a grant
--     the person had deliberately narrowed), no rate limit, no consent record, no way to say "entered on behalf" in a clinician view,
--     and no governed seam for a partner pharmacy.
--
-- WHY source STAYS 'manual' (a deliberate deviation from the brief's "source = 'assisted'")
--   A new vital_source value would silently fall outside every trigger and view that keys on the existing values, found by reading them:
--   r2_glucose_triage_wiring fires only for source in ('manual','device') (a new value would SKIP glucose triage, the exact failure this
--   feature exists to avoid), stamp_manual_vitals_timestamp clamps taken_at only for 'manual' (a new value would allow backdating),
--   i14_vitals_reading_source_lock keys on source <> 'manual', and the S46/S47 report source counts list the three values. So an
--   assisted reading is a 'manual' (or 'device') reading whose logged_by_profile_id is the helper, plus a row in assisted_entry_log.
--   "Assisted" is therefore a fact about WHO entered it, which is what it is, and the whole existing triage path applies unchanged.
--
-- WHAT THIS ADDS
--   1. record_red_care_response_for(patient, ...): the answer for a person you support. record_red_care_response (own account only) is
--      left exactly as it is, so its proofs and every older phone that calls it keep working.
--   2. assisted_entry_config (versioned, PROPOSED) and assisted_entry_log (one append-only row per assisted reading: who, for whom, on
--      what basis the person had consented, which reading).
--   3. A BEFORE INSERT guard on vitals_readings for any API-path write made by someone other than the patient: needs the log_readings
--      capability on an unexpired manage grant, refuses a wearable-sourced or deviceless device-sourced row (no way around the no-backdating
--      rule), rate limits per helper per person per hour and per helper per day. An AFTER INSERT trigger writes the ledger row and the
--      delegated-access log line the person reads in "People who help you".
--   4. The vitals insert policy for helpers now needs log_readings. Grants made before this value existed have permissions NULL
--      (unrestricted) and are unaffected.
--   5. assisted_entry_attribution(): names for the "Entered by X for you" label, for the person, the helper and a tied clinician.
--   6. The partner-pharmacy seam: go-live guard assisted_entry_pharmacy_enabled (born off), one policy and one function
--      (private.pharmacy_assisted_entry_allowed) that returns false until the open question is answered. No pharmacy can write a reading.
--
-- COUNTS (live, 2026-10-16, read-only): profile_access has 0 manage grants and 0 with a narrowed permissions array, so no existing helper
-- loses anything and no data conversion step exists.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Caregiver answers the red-care question
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.red_care_responses add column answered_by uuid;
comment on column public.red_care_responses.answered_by is
  'NULL = the patient answered. Set = a caregiver acting for the patient answered (their profile id). No foreign key on purpose: the table is append only, so an ON DELETE SET NULL action would be refused.';

create function public.record_red_care_response_for(
  p_patient uuid, p_client_id uuid, p_response text, p_emergency_event uuid default null, p_triage_event uuid default null,
  p_client_recorded_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_id uuid; v_patient uuid; v_org uuid; v_test boolean; v_shown boolean;
  v_ee uuid := p_emergency_event; v_te uuid := p_triage_event; w record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- Your own account: the one existing implementation answers, so there is exactly one place where a patient's own answer is decided.
  if p_patient is null or p_patient = v_uid then
    return public.record_red_care_response(p_client_id, p_response, p_emergency_event, p_triage_event, p_client_recorded_at);
  end if;
  -- A helper may answer for the person if they hold a live manage grant that names either capability that puts them at the scene of a
  -- red alert: being told about alerts, or entering readings (the helper who typed in the dangerous reading is the one who sees the guidance).
  if not (private.can_act_for(p_patient, 'receive_alerts'::public.caregiver_permission)
          or private.can_act_for(p_patient, 'log_readings'::public.caregiver_permission)) then
    raise exception 'you are not allowed to answer for this person' using errcode = '42501';
  end if;
  if p_client_id is null then raise exception 'a client id is needed' using errcode = '22023'; end if;
  if p_response is null or p_response not in ('sought_care', 'could_not_get_care') then raise exception 'unknown response' using errcode = '22023'; end if;
  if p_emergency_event is not null and p_triage_event is not null then raise exception 'name one red event, not two' using errcode = '22023'; end if;
  select id into v_id from public.red_care_responses where client_id = p_client_id and patient_id = p_patient;
  if found then return v_id; end if;
  if v_ee is null and v_te is null then
    -- The phone answers without knowing the server's event id: take the PERSON'S latest red alert of the last day (not the helper's own).
    select x.kind_ee, x.kind_te into v_ee, v_te from (
      select case when src = 'e' then id end as kind_ee, case when src = 't' then id end as kind_te
        from (select id, created_at, 'e' as src from public.emergency_events where patient_id = p_patient and created_at > now() - interval '24 hours'
              union all
              select id, created_at, 't' from public.triage_events where patient_id = p_patient and grade = 'red' and not shadow and rule_set_code is distinct from 'unified_red_paging' and created_at > now() - interval '24 hours') u
       order by created_at desc limit 1) x;
    if v_ee is null and v_te is null then
      raise exception 'no red alert to answer yet' using errcode = 'P0002';
    end if;
  end if;
  if v_ee is not null then
    select patient_id, organisation_id into v_patient, v_org from public.emergency_events where id = v_ee;
  else
    select patient_id, organisation_id into v_patient, v_org from public.triage_events where id = v_te;
  end if;
  if v_patient is distinct from p_patient then raise exception 'this red event is not for that person' using errcode = '42501'; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = p_patient;
  v_shown := private.patient_may_page_doctor(p_patient);
  insert into public.red_care_responses (organisation_id, patient_id, client_id, response, emergency_event_id, triage_event_id, client_recorded_at, shown_to_clinician, is_test, answered_by)
  values (v_org, p_patient, p_client_id, p_response, v_ee, v_te, p_client_recorded_at, v_shown, coalesce(v_test, false), v_uid)
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.red_care_responses where client_id = p_client_id and patient_id = p_patient;
    return v_id;
  end if;
  -- Audited with the helper as the actor, and written to the delegated-access log the person reads.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'red_care_response.recorded', 'red_care_responses', v_id,
          jsonb_build_object('response', p_response, 'shown_to_clinician', v_shown, 'acted_for', p_patient));
  perform private.log_care_access(p_patient, 'acted_for', 'care_status', jsonb_build_object('what', 'red_care_answer'));

  -- Information for the responder, never a way to stop paging (CMO Q13). Only a clinician acknowledgement stops it.
  if v_shown and p_response = 'could_not_get_care' and coalesce(private.red_rule('couldNotGetCareOutreachNow'), 'false')::boolean then
    for w in select id from public.red_alert_watch
              where patient_id = p_patient and state in ('watching', 'confirmed')
                and source_kind = case when v_ee is not null then 'emergency_event' else 'triage_event' end
                and source_id = coalesce(v_ee, v_te) loop
      perform private.create_red_outreach(w.id);
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_red_care_response_for(uuid, uuid, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.record_red_care_response_for(uuid, uuid, text, uuid, uuid, timestamptz) to authenticated;

-- The responder is told when the answer came from the person's helper rather than the person. Patched in place on the live definition
-- (anchored replace, fails loudly if the text moved) so nothing that was layered on this function since is lost.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.latest_red_patient_response(uuid,uuid)'::regprocedure);
  if v_def like '%answered_by_caregiver%' then return; end if;
  v_new := replace(v_def, 'select response, responded_at into r from public.red_care_responses', 'select response, responded_at, answered_by into r from public.red_care_responses');
  v_new := replace(v_new, '''responded_at'', r.responded_at)', '''responded_at'', r.responded_at, ''answered_by_caregiver'', r.answered_by is not null)');
  if v_new = v_def or position('answered_by into r' in v_new) = 0 or position('answered_by_caregiver' in v_new) = 0 then
    raise exception 'assisted entry: latest_red_patient_response text anchors not found (definition drifted)';
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Versioned limits and the ledger
-- ---------------------------------------------------------------------------------------------------------------------
create table public.assisted_entry_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index assisted_entry_config_one_active on public.assisted_entry_config (is_active) where is_active;
create function private.assisted_entry_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['max_per_helper_per_person_per_hour', 'max_per_helper_per_day'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,4}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'max_per_helper_per_person_per_hour')::integer <= (r ->> 'max_per_helper_per_day')::integer;
exception when others then
  return false;
end;
$$;
revoke all on function private.assisted_entry_rules_valid(jsonb) from public, anon, authenticated;
alter table public.assisted_entry_config add constraint assisted_entry_config_rules_valid check (private.assisted_entry_rules_valid(rules));

-- assisted-entry-config-begin
insert into public.assisted_entry_config (version, is_active, effective_from, rules) values (1, true, '2026-10-16', $json$
{
  "max_per_helper_per_person_per_hour": 6,
  "max_per_helper_per_day": 30
}
$json$::jsonb);
-- assisted-entry-config-end

alter table public.assisted_entry_config enable row level security;
create policy assisted_entry_config_read on public.assisted_entry_config for select to authenticated using (true);
revoke all on public.assisted_entry_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.assisted_entry_config from authenticated;
grant select on public.assisted_entry_config to authenticated;

create function private.assisted_entry_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.assisted_entry_config where is_active $$;
revoke all on function private.assisted_entry_rules() from public, anon, authenticated;

create table public.assisted_entry_log (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  actor_id         uuid not null,
  actor_kind       text not null check (actor_kind in ('caregiver', 'pharmacy')),
  vital_reading_id uuid not null,
  vital_type       public.vital_type not null,
  grant_id         uuid,
  consent_basis    text not null check (consent_basis in ('explicit_permission', 'full_manage_grant', 'counter_consent')),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index assisted_entry_log_actor_idx on public.assisted_entry_log (actor_id, created_at desc);
create index assisted_entry_log_patient_idx on public.assisted_entry_log (patient_id, created_at desc);
create unique index assisted_entry_log_reading_once on public.assisted_entry_log (vital_reading_id);
alter table public.assisted_entry_log enable row level security;
revoke all on public.assisted_entry_log from public, anon, authenticated;
grant select on public.assisted_entry_log to authenticated;
-- The person reads every reading entered for them; a helper reads their own entries. Nobody writes directly (the AFTER INSERT trigger below
-- is the only writer). actor_id and grant_id carry no foreign key because the ledger is append only.
create policy assisted_entry_log_own on public.assisted_entry_log for select to authenticated
  using (patient_id = (select auth.uid()) or actor_id = (select auth.uid()));
create function private.assisted_entry_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'assisted_entry_log is append only' using errcode = '42501';
end;
$$;
create trigger assisted_entry_log_no_update before update on public.assisted_entry_log
  for each row execute function private.assisted_entry_log_append_only();
comment on table public.assisted_entry_log is 'One row per reading a helper entered on behalf of a person: who, for whom, what the person had consented to (consent_basis), which reading. Append only. Source of the rate limit.';

-- The data registry and the under-18 scope: the ledger follows vitals_readings (guarded for under-18 dependants).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'assisted_entry_log', 'patient_id', private.retention_class_for('assisted_entry_log'), 'review', true,
       'Registered with the default S39d classification when assisted entry was added; awaiting review.'
on conflict (table_name) do nothing;
select private.guard_minor_dependant_table('assisted_entry_log', 'patient_id');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The seam for a partner pharmacy (no pharmacy can write a reading today)
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('assisted_entry_pharmacy_enabled', 'Pharmacy assisted entry', 'A verified partner-pharmacy staff member entering a blood pressure or glucose reading for a person at the counter',
   'Open question OQ-ASSIST-1 answered: how a pharmacy staff member is verified for one branch, how the person consents at the counter, and whether the reading is the person''s own record or the pharmacy''s', 'admin',
   array['private.pharmacy_assisted_entry_allowed (vitals_readings_insert_pharmacy_assisted, private.assisted_entry_guard)'],
   'Caregiver assisted entry (a person''s own helper) never reads this guard.')
on conflict (key) do nothing;

-- Returns false until the open question is answered and this body is written. The insert policy calls private.pharmacy_assisted_entry_open,
-- which ANDs this with the go-live guard (a policy runs as the caller, and the guard reader is not granted to authenticated).
create function private.pharmacy_assisted_entry_allowed(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select false $$;
revoke all on function private.pharmacy_assisted_entry_allowed(uuid) from public, anon, authenticated;
-- What the insert policy calls: the guard AND the rule, so implementing the rule alone can never open the path.
create function private.pharmacy_assisted_entry_open(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.go_live_guard_on('assisted_entry_pharmacy_enabled') and private.pharmacy_assisted_entry_allowed(p_patient) $$;
revoke all on function private.pharmacy_assisted_entry_open(uuid) from public, anon;
grant execute on function private.pharmacy_assisted_entry_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The row flag, then who may enter and on what basis
-- ---------------------------------------------------------------------------------------------------------------------
-- A flag on the reading itself, set only by the guard below (any client value is overwritten), so every view and every audited read can say
-- "a helper entered this" without joining the ledger, and so the rate limit does not depend on the ledger write succeeding. It is NOT the same
-- as logged_by_profile_id being set: staff-measured testing-day and imported rows carry a staff id there too.
alter table public.vitals_readings add column assisted_entry boolean not null default false;
comment on column public.vitals_readings.assisted_entry is 'True when a helper (family caregiver, later a verified pharmacy) entered this reading for the person. Set by private.assisted_entry_guard only.';
create index vitals_readings_assisted_idx on public.vitals_readings (logged_by_profile_id, received_at) where assisted_entry;

-- The guard and the ledger use assisted_entry_basis. The insert policy is the coarser first gate (capability only); the guard is the stricter one.
create function private.assisted_entry_basis(p_patient uuid, p_actor uuid)
returns table (kind text, grant_id uuid, basis text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select 'caregiver'::text, pa.id,
           case when pa.permissions is null then 'full_manage_grant' else 'explicit_permission' end
      from public.profile_access pa
     where pa.profile_id = p_patient and pa.grantee_user_id = p_actor and pa.permission_level = 'manage'
       and (pa.expires_at is null or pa.expires_at > now())
       and (
         'log_readings'::public.caregiver_permission = any (pa.permissions)
         -- An unrestricted (NULL) grant is the legacy "everything a manage grant implies". It does not by itself say the person agreed to a helper
         -- writing readings, so it also needs the same vitals category the person gives for reading them (writes are never looser than reads).
         or (pa.permissions is null and private.can_read_clinical(p_patient, 'vitals_readings'::public.care_access_category))
       )
     limit 1;
  if found then return; end if;
  if private.go_live_guard_on('assisted_entry_pharmacy_enabled')
     and private.pharmacy_assisted_entry_allowed(p_patient) then
    return query select 'pharmacy'::text, null::uuid, 'counter_consent'::text;
  end if;
end;
$$;
revoke all on function private.assisted_entry_basis(uuid, uuid) from public, anon, authenticated;

create function private.assisted_entry_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_rules jsonb; v_hour integer; v_day integer; v_n integer;
begin
  -- Only an API-path write by someone other than the patient. Definer code, the service role and migrations are not helpers.
  -- The flag is ours alone: a client value is always overwritten.
  new.assisted_entry := false;
  if new.logged_by_profile_id is null or v_uid is null or current_setting('role', true) is distinct from 'authenticated' then
    return new;
  end if;
  -- Staff writes (a testing-day nurse, a clinician confirming an imported record) have their own governed paths and are not helpers.
  if private.is_org_staff(new.organisation_id) then
    return new;
  end if;
  if new.logged_by_profile_id is distinct from v_uid then
    raise exception 'assisted_entry_attribution: the entry must be attributed to the person making it' using errcode = '42501';
  end if;
  if not exists (select 1 from private.assisted_entry_basis(new.patient_id, v_uid)) then
    raise exception 'assisted_entry_not_permitted: you have not been allowed to enter readings for this person' using errcode = '42501';
  end if;
  -- No way around the no-backdating rule. A typed ('manual') row has its time set by the database. A wearable, sensor or imported row is
  -- written only by the sync and the import, never by a helper; a device row must name a device and a photo-confirmed row must be recent.
  if new.source in ('wearable', 'cgm', 'fhir_import') or (new.source = 'device' and new.device_id is null) then
    raise exception 'assisted_entry_source: a reading entered for someone else is typed in or comes from a paired device' using errcode = '42501';
  end if;
  if new.source in ('device', 'photo_confirmed') and (new.taken_at < now() - interval '7 days' or new.taken_at > now() + interval '10 minutes') then
    raise exception 'assisted_entry_time: that reading is too old to enter for someone else. Please take it again.' using errcode = '22023';
  end if;
  v_rules := private.assisted_entry_rules();
  if v_rules is null then
    raise exception 'assisted_entry_unavailable: assisted entry is not available just now' using errcode = '53400';
  end if;
  v_hour := (v_rules ->> 'max_per_helper_per_person_per_hour')::integer;
  v_day := (v_rules ->> 'max_per_helper_per_day')::integer;
  -- A retry of a reading that already landed (same client reading id) is a duplicate, not a new entry: let the unique index answer it.
  if new.client_reading_id is not null and exists (select 1 from public.vitals_readings v where v.patient_id = new.patient_id and v.client_reading_id = new.client_reading_id) then
    new.assisted_entry := true;
    return new;
  end if;
  select count(*) into v_n from public.vitals_readings
   where logged_by_profile_id = v_uid and assisted_entry and patient_id = new.patient_id and received_at > now() - interval '1 hour';
  if v_n >= v_hour then
    raise exception 'assisted_entry_rate_limited: too many readings have been entered for this person in the last hour. Please try again later.' using errcode = '53400';
  end if;
  select count(*) into v_n from public.vitals_readings
   where logged_by_profile_id = v_uid and assisted_entry and received_at > now() - interval '24 hours';
  if v_n >= v_day then
    raise exception 'assisted_entry_rate_limited: too many readings have been entered today. Please try again tomorrow.' using errcode = '53400';
  end if;
  new.assisted_entry := true;
  return new;
end;
$$;
revoke all on function private.assisted_entry_guard() from public, anon, authenticated;
-- Sorts after stamp_acting_supporter, which sets logged_by_profile_id from auth.uid() first.
create trigger vitals_readings_assisted_entry_guard before insert on public.vitals_readings
  for each row execute function private.assisted_entry_guard();

create function private.assisted_entry_record() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare b record; v_test boolean;
begin
  if not new.assisted_entry then
    return new;
  end if;
  -- A governance record must never be the reason a possibly dangerous reading is lost: a failure here is a warning, not an abort.
  begin
    select * into b from private.assisted_entry_basis(new.patient_id, new.logged_by_profile_id);
    if b.kind is null then return new; end if;
    select coalesce(is_test, false) into v_test from public.profiles where id = new.patient_id;
    insert into public.assisted_entry_log (organisation_id, patient_id, actor_id, actor_kind, vital_reading_id, vital_type, grant_id, consent_basis, is_test)
    values (new.organisation_id, new.patient_id, new.logged_by_profile_id, b.kind, new.id, new.vital_type, b.grant_id, b.basis, coalesce(v_test, false));
    perform private.log_care_access(new.patient_id, 'acted_for', 'care_status', jsonb_build_object('what', 'reading_entered'), new.logged_by_profile_id);
  exception when others then
    raise warning 'assisted entry ledger failed for reading %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.assisted_entry_record() from public, anon, authenticated;
create trigger vitals_readings_assisted_entry_record after insert on public.vitals_readings
  for each row execute function private.assisted_entry_record();

-- The helper's insert right now needs the capability; the pharmacy seam adds its own (always false today) policy.
drop policy if exists vitals_readings_insert_acting_supporter on public.vitals_readings;
create policy vitals_readings_insert_acting_supporter on public.vitals_readings
  for insert to authenticated
  with check (private.can_act_for(patient_id, 'log_readings'::public.caregiver_permission));
drop policy if exists vitals_readings_insert_pharmacy_assisted on public.vitals_readings;
create policy vitals_readings_insert_pharmacy_assisted on public.vitals_readings
  for insert to authenticated
  with check (private.pharmacy_assisted_entry_open(patient_id));
-- A helper reads back what they wrote: the existing vitals_readings_select_own_entry policy (logged_by_profile_id = auth.uid()) already does.

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Names for the "Entered by X for you" label
-- ---------------------------------------------------------------------------------------------------------------------
create function public.assisted_entry_attribution(p_patient uuid, p_reading_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_ok boolean; v_ids uuid[] := p_reading_ids;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_ids is null or cardinality(v_ids) = 0 then return '[]'::jsonb; end if;
  if cardinality(v_ids) > 500 then v_ids := v_ids[1:500]; end if;
  -- Names of helpers go to the person and to staff tied to the person's care. A read-only supporter does not get other helpers' names.
  v_ok := p_patient = v_uid
       or private.can_staff_read_clinical(p_patient, 'vitals_readings'::public.care_access_category);
  if not v_ok then
    -- A helper sees only their own entries.
    return coalesce((select jsonb_agg(jsonb_build_object('reading_id', l.vital_reading_id, 'actor_id', l.actor_id, 'actor_name', p.full_name, 'actor_kind', l.actor_kind))
                       from public.assisted_entry_log l join public.profiles p on p.id = l.actor_id
                      where l.patient_id = p_patient and l.actor_id = v_uid and l.vital_reading_id = any (v_ids)), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('reading_id', l.vital_reading_id, 'actor_id', l.actor_id, 'actor_name', p.full_name, 'actor_kind', l.actor_kind))
                     from public.assisted_entry_log l join public.profiles p on p.id = l.actor_id
                    where l.patient_id = p_patient and l.vital_reading_id = any (v_ids)), '[]'::jsonb);
end;
$$;
revoke all on function public.assisted_entry_attribution(uuid, uuid[]) from public, anon;
grant execute on function public.assisted_entry_attribution(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Self-checks
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.record_red_care_response_for(uuid,uuid,text,uuid,uuid,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.assisted_entry_attribution(uuid,uuid[])', 'EXECUTE') then
    raise exception 'assisted entry: anon can execute a new function';
  end if;
  if exists (select 1 from public.go_live_guards where key = 'assisted_entry_pharmacy_enabled' and is_on) or private.go_live_guard_on('assisted_entry_pharmacy_enabled') then
    raise exception 'assisted entry: the pharmacy guard must be born off';
  end if;
  if private.pharmacy_assisted_entry_allowed(gen_random_uuid()) then
    raise exception 'assisted entry: the pharmacy seam must return false until the open question is answered';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitals_readings' and policyname = 'vitals_readings_insert_acting_supporter' and with_check like '%log_readings%') then
    raise exception 'assisted entry: the helper insert policy does not name log_readings';
  end if;
  if (select count(*) from public.assisted_entry_config where is_active) <> 1 then
    raise exception 'assisted entry: exactly one active config row expected';
  end if;
  if has_table_privilege('authenticated', 'public.assisted_entry_log', 'INSERT') or has_table_privilege('authenticated', 'public.assisted_entry_log', 'DELETE')
     or has_table_privilege('anon', 'public.assisted_entry_log', 'SELECT') then
    raise exception 'assisted entry: the ledger is writable by authenticated or readable by anon';
  end if;
end $$;
