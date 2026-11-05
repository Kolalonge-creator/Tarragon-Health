-- T2-11d (founder decision 2026-11-05, the founder is also the CMO; T2-15 in docs/DECISIONS.md), a follow-up to T2-11c:
--  (1) a prescribed medicine's adherence and missed-dose tracking start on the date it was collected, as the patient (or their caregiver)
--      says, or as a pharmacy records it, whichever came first; if collection is never confirmed, the start stays the signing date, as
--      today. Existing medicines and patient-added medicines are unchanged.
--  (2) a caregiver who holds the patient's prescription permission can confirm collection, and undo it within the window, labelled as
--      reported by that caregiver (not the patient) and audited with who did it.
--
-- How the schedule start worked before this (read from the live bodies, not the migration history):
--  * medications.schedule_effective_from is stamped by private.stamp_medication_schedule_effective_from: created_at on insert, now() when
--    schedule_times or schedule_spec changes. Five functions start a medicine's slots at
--    greatest(created_at, coalesce(schedule_effective_from, created_at)): private.mark_overdue_doses_missed (the server "missed" job),
--    private.weekly_adherence, private.care_gap_scoped_adherence, public.supporter_todays_doses and private.sweep_circle_missed_doses.
--    The web adherence report and the phone (activeFromMs, offline store) use the same two columns.
--  * private.queue_medication_dose_reminders reads neither: it reminds for today's slots of every active medicine from the moment it is
--    signed. Founder/CMO answer (2026-11-05, second question): for a prescription that starts on collection, reminders WAIT for the
--    first collection too; if none is confirmed within uncollected_reminder_fallback_days of signing (3, versioned config), they start
--    from then anyway. Missed-dose counting follows the same start: the collection, or the fallback, never the signing.
--  * Why the start is NOT written into medications.schedule_effective_from: an update of a prescribed medicines row runs the patient
--    allow-list guard (refuses the patient), enforce_medication_confirm_only (stamps last_confirmed_at for anyone else, a false "refill
--    checked"), the blood-pressure prescribing safety re-check and a dose-history snapshot. A collection is none of those things.
--
-- What this adds.
--  1. medications.schedule_starts_on_collection, set true at insert for a NEW clinician prescription that is not an amendment
--     (previous_version_id is null). Every existing row and every patient-added row stays false, so nothing already running moves.
--  2. public.medication_schedule_starts: one row per such medicine once it has been collected, kept by a trigger on
--     pharmacy_order_dispenses (insert, dispute, withdrawal, match). The start is the earliest live collection: a pharmacy supply (not
--     disputed) or a patient/caregiver confirmation (not withdrawn). On the day it was recorded it is the moment of recording (no
--     morning dose is counted missed for a medicine picked up that afternoon); a collection dated earlier starts at the beginning of that
--     day in Lagos. An undo or a dispute that leaves no collection removes the row, so the start falls back to signing. Readable under
--     exactly the medications_select rule (the patient, a category-scoped clinical reader of 'medications', a caregiver with
--     view_medication), so the web and phone screens can use it; written only by the trigger.
--  3. private.medication_active_from(medication): greatest(created_at, schedule_effective_from, S) where, for a prescription that starts
--     on collection, S is its first collection or, if it has none, signing + uncollected_reminder_fallback_days; for every other medicine
--     S is signing (unchanged). Patched into the five functions above and into queue_medication_dose_reminders (which now also waits for
--     S, for these prescriptions only) from their live bodies, one occurrence each or the migration fails.
--  4. Caregiver confirmation: confirm_prescription_collected gains p_for_patient (default null = the caller). A caregiver may act only
--     with a live profile_access 'manage' grant carrying the 'manage_pharmacy' permission (private.can_act_for), the same gate as choosing
--     a pharmacy for that person's prescription (private.rx_patient). Care Circle membership alone is not enough: its permissions are
--     read-only summaries (adherence_summary and the like), never an action on a prescription. No reproductive-health category is read or
--     granted anywhere here. The row stores who recorded it (recorded_by) and the relationship (reported_by_relationship: the Care Circle
--     relationship if there is one, else 'caregiver'). undo_prescription_collected accepts the patient, or the caregiver who recorded it
--     while they still hold that permission; no one else.
-- Row counts at writing (local replay): medications with a collection 0, pharmacy_order_dispenses 0. Nothing to backfill.

-- 1. Which medicines start on collection --------------------------------------------------------------------------------------------
alter table public.medications add column if not exists schedule_starts_on_collection boolean not null default false;
comment on column public.medications.schedule_starts_on_collection is
  'T2-11d: true for a clinician prescription signed after 2026-11-05 that is not an amendment. Its adherence and missed-dose tracking start at its first collection (public.medication_schedule_starts) instead of at signing; until it is collected, at signing as before.';

create or replace function private.stamp_medication_starts_on_collection() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.schedule_starts_on_collection := (new.source = 'clinician' and new.previous_version_id is null);
  return new;
end;
$$;
revoke all on function private.stamp_medication_starts_on_collection() from public, anon, authenticated;
drop trigger if exists medications_stamp_starts_on_collection on public.medications;
create trigger medications_stamp_starts_on_collection before insert on public.medications
  for each row execute function private.stamp_medication_starts_on_collection();

-- 2. The collection start ----------------------------------------------------------------------------------------------------------
create table if not exists public.medication_schedule_starts (
  medication_id    uuid primary key references public.medications (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  starts_at        timestamptz not null,
  collected_on     date not null,
  from_dispense_id uuid references public.pharmacy_order_dispenses (id) on delete set null,
  source           text not null check (source in ('patient', 'caregiver', 'pharmacy')),
  updated_at       timestamptz not null default now()
);
create index if not exists medication_schedule_starts_patient_idx on public.medication_schedule_starts (patient_id);
comment on table public.medication_schedule_starts is
  'T2-11d: when a prescribed medicine was first collected, so its adherence and missed-dose tracking start then. Kept by a trigger on pharmacy_order_dispenses; never written by a client.';

alter table public.medication_schedule_starts enable row level security;
-- the default privileges give authenticated everything on a new table; this one is read-only to clients
revoke all on public.medication_schedule_starts from public, anon, authenticated;
grant select on public.medication_schedule_starts to authenticated;
drop policy if exists medication_schedule_starts_select on public.medication_schedule_starts;
-- the exact rule medications_select uses today (live pg_policies, 2026-11-05), with its explicit casts
create policy medication_schedule_starts_select on public.medication_schedule_starts for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
         or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission));

create trigger audit_row_change_trg after insert or update or delete on public.medication_schedule_starts
  for each row execute function private.audit_row_change();

create or replace function private.recompute_medication_schedule_start(p_medication uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_med public.medications%rowtype;
  d public.pharmacy_order_dispenses%rowtype;
  v_start timestamptz;
begin
  if p_medication is null then return; end if;
  select * into v_med from public.medications where id = p_medication;
  if v_med.id is null or not v_med.schedule_starts_on_collection then
    delete from public.medication_schedule_starts where medication_id = p_medication;
    return;
  end if;
  select x.* into d from public.pharmacy_order_dispenses x
   where x.medication_id = p_medication
     and ((x.source = 'pharmacy'::public.dispense_source and x.disputed_at is null)
          or (x.recorded_via = 'patient_confirmation' and x.withdrawn_at is null))
   order by x.dispensed_on, x.created_at, x.id
   limit 1;
  if d.id is null then
    delete from public.medication_schedule_starts where medication_id = p_medication;
    return;
  end if;
  v_start := case when d.dispensed_on = (d.created_at at time zone 'Africa/Lagos')::date then d.created_at
                  else (d.dispensed_on::timestamp at time zone 'Africa/Lagos') end;
  insert into public.medication_schedule_starts (medication_id, organisation_id, patient_id, starts_at, collected_on, from_dispense_id, source, updated_at)
  values (v_med.id, v_med.organisation_id, v_med.patient_id, v_start, d.dispensed_on, d.id,
          case when d.source = 'pharmacy'::public.dispense_source then 'pharmacy'
               when d.recorded_by is distinct from d.patient_id then 'caregiver' else 'patient' end, now())
  on conflict (medication_id) do update
     set starts_at = excluded.starts_at, collected_on = excluded.collected_on, from_dispense_id = excluded.from_dispense_id,
         source = excluded.source, updated_at = now()
   where (medication_schedule_starts.starts_at, medication_schedule_starts.from_dispense_id, medication_schedule_starts.source)
         is distinct from (excluded.starts_at, excluded.from_dispense_id, excluded.source);
end;
$$;
revoke all on function private.recompute_medication_schedule_start(uuid) from public, anon, authenticated;

create or replace function private.dispense_recompute_schedule_start() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.recompute_medication_schedule_start(new.medication_id);
  if tg_op = 'UPDATE' and old.medication_id is distinct from new.medication_id then
    perform private.recompute_medication_schedule_start(old.medication_id);
  end if;
  return new;
end;
$$;
revoke all on function private.dispense_recompute_schedule_start() from public, anon, authenticated;
drop trigger if exists pharmacy_order_dispenses_schedule_start on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_schedule_start
  after insert or update of source, medication_id, dispensed_on, disputed_at, withdrawn_at, matched_dispense_id on public.pharmacy_order_dispenses
  for each row execute function private.dispense_recompute_schedule_start();

-- 2b. The fallback window, a versioned operational setting (prescription_supply_config v2) ----------------------------------------
-- The T2-11c validator requires its three keys; it now also checks the new one when present (a v1 row has none, and must stay valid
-- so it can be deactivated). private.rx_supply_window raises if the ACTIVE row lacks a key, so v2 must carry it.
create or replace function private.prescription_supply_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  foreach k in array array['patient_undo_hours', 'report_match_days', 'patient_duplicate_minutes'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,4}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  if r ? 'uncollected_reminder_fallback_days'
     and ((r ->> 'uncollected_reminder_fallback_days') !~ '^[0-9]{1,2}$' or (r ->> 'uncollected_reminder_fallback_days')::integer not between 1 and 30) then
    return false;
  end if;
  return (r ->> 'patient_undo_hours')::integer <= 168
     and (r ->> 'report_match_days')::integer <= 60
     and (r ->> 'patient_duplicate_minutes')::integer <= 1440;
exception when others then
  return false;
end;
$$;
revoke all on function private.prescription_supply_rules_valid(jsonb) from public, anon, authenticated;

update public.prescription_supply_config set is_active = false where is_active and version < 2;
-- rx-supply-windows-v2-begin
insert into public.prescription_supply_config (version, is_active, rules, note) values (2, true, $json$
{
  "patient_undo_hours": 24,
  "report_match_days": 7,
  "patient_duplicate_minutes": 10,
  "uncollected_reminder_fallback_days": 3
}
$json$::jsonb, 'PROPOSED, T2-11d (2026-11-05, founder/CMO answer). v1 plus uncollected_reminder_fallback_days: a prescription that starts on collection gets no dose reminders and no missed-dose counting until it is collected, or until this many days after signing if no collection is confirmed.')
on conflict (version) do nothing;
-- rx-supply-windows-v2-end

-- 3. The one start used by every slot-counting function -----------------------------------------------------------------------------
create or replace function private.medication_active_from(p_medication uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at),
                  case when m.schedule_starts_on_collection
                       then coalesce(s.starts_at, m.created_at + make_interval(days => private.rx_supply_window('uncollected_reminder_fallback_days')))
                       else m.created_at end)
    from public.medications m
    left join public.medication_schedule_starts s on s.medication_id = m.id
   where m.id = p_medication
$$;
revoke all on function private.medication_active_from(uuid) from public, anon, authenticated;
comment on function private.medication_active_from(uuid) is
  'T2-11d: when a medicine''s dose slots start (reminders and missed-dose counting): signing or a later schedule edit; for a prescription that starts on collection, its first collection, or signing + uncollected_reminder_fallback_days if it has none.';

do $patch$
declare
  v_old_m constant text := 'greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at))';
  v_new_m constant text := 'private.medication_active_from(m.id)';
  v_old_med constant text := 'greatest(med.created_at, coalesce(med.schedule_effective_from, med.created_at))';
  v_new_med constant text := 'private.medication_active_from(med.id)';
  r record;
  v_def text;
  v_hits integer;
begin
  for r in select * from (values
      ('private.weekly_adherence(uuid,timestamp with time zone)', v_old_m, v_new_m),
      ('private.mark_overdue_doses_missed(timestamp with time zone)', v_old_m, v_new_m),
      ('public.supporter_todays_doses(uuid)', v_old_m, v_new_m),
      ('private.care_gap_scoped_adherence(uuid,timestamp with time zone,jsonb)', v_old_m, v_new_m),
      ('private.sweep_circle_missed_doses(timestamp without time zone)', v_old_med, v_new_med)) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if v_def like '%medication_active_from%' then continue; end if;
    v_hits := (char_length(v_def) - char_length(replace(v_def, r.old_text, ''))) / char_length(r.old_text);
    if v_hits <> 1 then
      raise exception 'T2-11d: % has % occurrences of the schedule start, expected 1; patch it by hand', r.fn, v_hits using errcode = '55000';
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $patch$;

-- 3b. Dose reminders wait for the same start, for prescriptions that start on collection only (patched from the live body) ------------
do $patch$
declare
  v_fn constant text := 'private.queue_medication_dose_reminders()';
  v_old constant text := E'     where m.is_active\n  ),';
  v_new constant text := E'     where m.is_active\n       -- T2-11d: a prescription that starts on collection is not reminded before it is collected (or the fallback day)\n       and (not m.schedule_starts_on_collection or private.medication_active_from(m.id) <= now())\n  ),';
  v_def text;
begin
  v_def := pg_get_functiondef(v_fn::regprocedure);
  if v_def like '%schedule_starts_on_collection%' then return; end if;
  if (char_length(v_def) - char_length(replace(v_def, v_old, ''))) / char_length(v_old) <> 1 then
    raise exception 'T2-11d: queue_medication_dose_reminders no longer has exactly one "where m.is_active" candidate filter; patch it by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

-- 4. A caregiver can confirm and undo ------------------------------------------------------------------------------------------------
alter table public.pharmacy_order_dispenses
  add column if not exists reported_by_relationship text;
alter table public.pharmacy_order_dispenses drop constraint if exists pharmacy_order_dispenses_reported_by_relationship_length;
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_reported_by_relationship_length check (char_length(reported_by_relationship) between 1 and 40);
comment on column public.pharmacy_order_dispenses.reported_by_relationship is
  'T2-11d: on a patient confirmation recorded by a caregiver, how they relate to the patient (the Care Circle relationship, else ''caregiver''). Null when the patient recorded it.';

-- The caregiver gate, in one place: the caller is the patient, or holds a live manage grant with manage_pharmacy for them.
create or replace function private.may_confirm_collection_for(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and (p_patient = (select auth.uid()) or private.can_act_for(p_patient, 'manage_pharmacy'::public.caregiver_permission))
$$;
revoke all on function private.may_confirm_collection_for(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.deptype in ('n', 'a')
              and d.refobjid = 'public.confirm_prescription_collected(uuid,date,text,text,text)'::regprocedure) then
    raise exception 'T2-11d: confirm_prescription_collected has dependents; refusing to drop it' using errcode = '2BP01';
  end if;
end $$;
drop function public.confirm_prescription_collected(uuid, date, text, text, text);

create function public.confirm_prescription_collected(
  p_medication_id uuid,
  p_collected_on date default null,
  p_pharmacy_name text default null,
  p_pharmacy_town text default null,
  p_quantity text default null,
  p_for_patient uuid default null
)
returns table (outcome text, dispense_id uuid, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_patient uuid := coalesce(p_for_patient, (select auth.uid()));
  v_med public.medications%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_on date := coalesce(p_collected_on, (now() at time zone 'Africa/Lagos')::date);
  v_pharmacy text := nullif(btrim(coalesce(p_pharmacy_name, '')), '');
  v_town text := nullif(btrim(coalesce(p_pharmacy_town, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), '');
  v_relationship text;
  v_approved integer;
  v_dispensed integer;
  v_permitted integer;
  v_pharmacy_row uuid;
  v_new uuid;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- the patient, or a caregiver with the prescription permission for them; anyone else learns nothing (same answer as no such medicine)
  if not private.may_confirm_collection_for(v_patient) then
    return query select 'not_found'::text, null::uuid, 0, 0;
    return;
  end if;
  if v_patient <> v_caller then
    select left(btrim(cm.relationship), 40) into v_relationship from public.care_circle_members cm
     where cm.patient_id = v_patient and cm.supporter_id = v_caller and cm.state = 'active'
     order by cm.created_at desc limit 1;
    v_relationship := coalesce(nullif(v_relationship, ''), 'caregiver');
  end if;

  -- Only a signed clinician prescription of that patient. Locked, the same row every supply path locks.
  select * into v_med from public.medications m
   where m.id = p_medication_id and m.patient_id = v_patient and m.source = 'clinician' and m.rx_number is not null
   for update;
  if v_med.id is null then
    return query select 'not_found'::text, null::uuid, 0, 0;
    return;
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*) into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d);
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));

  if v_on > v_today or v_on < (v_med.created_at at time zone 'Africa/Lagos')::date
     or char_length(coalesce(v_pharmacy, '')) > 120 or char_length(coalesce(v_town, '')) > 80 or char_length(coalesce(v_qty, '')) > 100 then
    return query select 'invalid'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;
  if v_med.superseded_at is not null or not v_med.is_active
     or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return query select 'not_active'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  -- A pharmacy already recorded this supply (within report_match_days either side): this is a receipt, not a second supply.
  select d.id into v_pharmacy_row from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null
     and not coalesce(d.is_partial, false)
     and abs(d.dispensed_on - v_on) <= private.rx_supply_window('report_match_days')
     and not exists (select 1 from public.medication_receipt_confirmations c where c.pharmacy_order_dispense_id = d.id)
   order by abs(d.dispensed_on - v_on), d.created_at desc
   limit 1;
  if v_pharmacy_row is not null then
    insert into public.medication_receipt_confirmations
      (organisation_id, patient_id, medication_id, pharmacy_order_dispense_id, received_at, confirmation_source, confirmed_by, notes)
    values (v_med.organisation_id, v_patient, v_med.id, v_pharmacy_row, (v_on::timestamp + interval '12 hours') at time zone 'Africa/Lagos',
            'patient_self_report', v_caller, case when v_relationship is not null then 'Confirmed by the patient''s ' || v_relationship end);
    return query select 'matched_pharmacy_record'::text, v_pharmacy_row, v_dispensed, v_permitted;
    return;
  end if;
  if exists (select 1 from public.pharmacy_order_dispenses d
              where d.medication_id = v_med.id and d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null
                and abs(d.dispensed_on - v_on) <= private.rx_supply_window('report_match_days')) then
    return query select 'already_recorded'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  if exists (select 1 from public.pharmacy_order_dispenses d
              where d.medication_id = v_med.id and d.recorded_via = 'patient_confirmation' and d.withdrawn_at is null
                and d.created_at > now() - make_interval(mins => private.rx_supply_window('patient_duplicate_minutes'))) then
    return query select 'duplicate'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  if v_dispensed >= v_permitted then
    return query select 'no_supply_available'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed,
    dispensed_on, source, recorded_by, pharmacy_name, pharmacy_town, recorded_via, reported_by_relationship
  ) values (
    v_med.organisation_id, v_patient, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
    v_on, 'patient', v_caller, v_pharmacy, v_town, 'patient_confirmation', v_relationship
  ) returning id into v_new;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_med.organisation_id, v_caller, 'prescription.patient_reported_supply', 'pharmacy_order_dispenses', v_new, v_patient, 'success',
          jsonb_build_object('medication_id', v_med.id, 'rx_number', v_med.rx_number, 'collected_on', v_on,
                             'reported_by', case when v_relationship is null then 'patient' else 'caregiver' end,
                             'relationship', v_relationship,
                             'supplies_dispensed', v_dispensed + 1, 'supplies_permitted', v_permitted));

  return query select 'recorded'::text, v_new, v_dispensed + 1, v_permitted;
end;
$$;
revoke all on function public.confirm_prescription_collected(uuid, date, text, text, text, uuid) from public, anon;
grant execute on function public.confirm_prescription_collected(uuid, date, text, text, text, uuid) to authenticated, service_role;
comment on function public.confirm_prescription_collected(uuid, date, text, text, text, uuid) is
  'T2-11c/d: the patient, or a caregiver holding the manage_pharmacy permission for them (p_for_patient), says a signed prescription was collected. Counts as a supply, labelled as reported by whoever did it, and starts the medicine''s adherence tracking.';

create or replace function public.undo_prescription_collected(p_dispense_id uuid, p_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := (select auth.uid());
  v_row public.pharmacy_order_dispenses%rowtype;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- the patient, or the caregiver who recorded it while they still hold the prescription permission; no one else
  select * into v_row from public.pharmacy_order_dispenses d
   where d.id = p_dispense_id and d.recorded_via = 'patient_confirmation'
     and (d.patient_id = v_caller or (d.recorded_by = v_caller and private.may_confirm_collection_for(d.patient_id)))
   for update;
  if v_row.id is null or v_row.withdrawn_at is not null then
    return 'not_found';
  end if;
  if v_row.matched_dispense_id is not null then
    return 'confirmed_by_pharmacy';
  end if;
  if v_row.created_at < now() - make_interval(hours => private.rx_supply_window('patient_undo_hours')) then
    return 'window_passed';
  end if;
  update public.pharmacy_order_dispenses
     set withdrawn_at = now(), withdrawn_by = v_caller, withdraw_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300)
   where id = v_row.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_row.organisation_id, v_caller, 'prescription.patient_reported_supply_withdrawn', 'pharmacy_order_dispenses', v_row.id, v_row.patient_id,
          'success', jsonb_build_object('medication_id', v_row.medication_id, 'collected_on', v_row.dispensed_on,
                                        'withdrawn_by', case when v_caller = v_row.patient_id then 'patient' else 'caregiver' end,
                                        'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 300)));
  return 'undone';
end;
$$;
revoke all on function public.undo_prescription_collected(uuid, text) from public, anon;
grant execute on function public.undo_prescription_collected(uuid, text) to authenticated, service_role;
comment on function public.undo_prescription_collected(uuid, text) is
  'T2-11c/d: the patient, or the caregiver who recorded it (still holding the permission), takes back a collection confirmation within patient_undo_hours, before any pharmacy confirmed it. The row is kept and audited.';

-- 4b. Bookkeeping: the patient-data registry (S39d) and the analytics_clean views (a new medications column) ---------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('medication_schedule_starts', 'patient_id', 'clinical_record', 'review', true,
   'T2-11d: when a prescription that starts on collection was first collected (date, source, and the supply row it came from). Derived from pharmacy_order_dispenses. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;
select private.rebuild_analytics_clean_views();

-- 5. The migration proves what it claims ------------------------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['private.weekly_adherence(uuid,timestamp with time zone)', 'private.mark_overdue_doses_missed(timestamp with time zone)',
    'public.supporter_todays_doses(uuid)', 'private.care_gap_scoped_adherence(uuid,timestamp with time zone,jsonb)',
    'private.sweep_circle_missed_doses(timestamp without time zone)'] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%private.medication_active_from(%' then
      raise exception 'T2-11d: % does not use the shared schedule start', v_fn;
    end if;
  end loop;
  if pg_get_functiondef('private.queue_medication_dose_reminders()'::regprocedure) not like '%not m.schedule_starts_on_collection or private.medication_active_from(m.id) <= now()%' then
    raise exception 'T2-11d: dose reminders do not wait for collection';
  end if;
  if private.rx_supply_window('uncollected_reminder_fallback_days') <> 3 then
    raise exception 'T2-11d: the reminder fallback is not 3 days';
  end if;
  if exists (select 1 from public.medications where schedule_starts_on_collection) then
    raise exception 'T2-11d: an existing medicine was switched to start on collection';
  end if;
  if to_regprocedure('public.confirm_prescription_collected(uuid,date,text,text,text)') is not null then
    raise exception 'T2-11d: the old confirm_prescription_collected signature is still present';
  end if;
  foreach v_fn in array array['public.confirm_prescription_collected(uuid,date,text,text,text,uuid)', 'public.undo_prescription_collected(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'anon can call %', v_fn; end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = v_fn::regprocedure and a.grantee = 0) then raise exception 'PUBLIC can call %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'authenticated cannot call %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.medication_active_from(uuid)', 'private.recompute_medication_schedule_start(uuid)',
    'private.dispense_recompute_schedule_start()', 'private.may_confirm_collection_for(uuid)', 'private.stamp_medication_starts_on_collection()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'T2-11d: % is callable by a client role', v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.medication_schedule_starts', 'INSERT')
     or has_table_privilege('authenticated', 'public.medication_schedule_starts', 'UPDATE')
     or has_table_privilege('anon', 'public.medication_schedule_starts', 'SELECT') then
    raise exception 'T2-11d: medication_schedule_starts is writable by a client, or readable by anon';
  end if;
end $$;
