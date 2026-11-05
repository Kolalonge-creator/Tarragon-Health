-- T2-11c (founder decision 2026-11-05, the founder is also the CMO): "Some Nigerian pharmacies might not want to confirm this or scan the
-- code, so we can also have an alternative where the patient can also confirm that they have gotten the meds."
--
-- Counted before writing (local replay of main-dev; the live supply functions were compared by md5 of their bodies and differ from the
-- replay only in stripped comments): every supply counter on the platform counts pharmacy_order_dispenses rows with source 'pharmacy'
-- and no dispute. A patient's own "I picked this up" row (source 'patient', recorded_via 'app') has never counted, so a prescription the
-- patient collected from a pharmacy that did not scan the QR still showed a supply as available, and a second pharmacy could fill it.
--
-- What this adds.
--  1. A patient-reported supply: public.confirm_prescription_collected(medication, collected_on, pharmacy name, town, quantity), for the
--     patient's OWN signed clinician prescription only. It writes a pharmacy_order_dispenses row with source 'patient' and
--     recorded_via 'patient_confirmation', which COUNTS as a supply. Rows written the old way (recorded_via 'app') still do not count.
--  2. One definition of "counts as a supply": private.dispense_counts_as_supply(row). A pharmacy row that is not disputed, or a patient
--     confirmation that is not withdrawn and not matched to a pharmacy record. Used by every function that counts supplies for a clinician
--     prescription: the QR page, the phone desk, the QR and desk record paths, and the dormant partner functions.
--  3. No double count, and no second fill. A live patient report (made within report_match_days, not withdrawn, not matched) blocks every
--     pharmacy record exactly like a pharmacy supply would. The ONE way past it is the pharmacy saying, explicitly, that it is the pharmacy
--     that supplied that collection: the new p_supplied_reported_collection argument (default false, so every existing caller keeps the
--     old behaviour) on record_prescription_supply_public, desk_record_prescription_supply and pharmacist_dispense_prescription. With it, the
--     report is left out of the availability check, the pharmacy row is written, and the report is marked matched (matched_dispense_id,
--     audited) so it stops counting: one supply, not two. Without it, the answer is no_supply_available. (A first version of this file let
--     any pharmacy recording within the window absorb the report, so a patient who collected at a non-scanning pharmacy B and confirmed could
--     take the paper to pharmacy A and get a second fill; review caught it before merge.) The pharmacy's statement is self-declared, like
--     everything else on the QR record path, and stored. The other way round, a patient confirming within report_match_days of a pharmacy
--     record writes a medication_receipt_confirmations row against it (the "patient received" event) and no second supply. A patient who
--     disputes the pharmacy record that matched their report makes their own report count again.
--  4. Undo, by the patient only, within patient_undo_hours, and only while no pharmacy has matched it: public.undo_prescription_collected.
--     The row is never deleted; withdrawn_at/withdrawn_by/withdraw_reason are set and an audit_log row is written. A trigger refuses any
--     other change to a patient confirmation from a client session, by the patient or by staff, and refuses a client insert of one.
--  5. The same trigger closes a related hole: a patient session could insert a source 'pharmacy' row, or edit a pharmacy row (source,
--     medication, dispute fields) directly through the table policy, which changes the supply count without the dispute function's audit
--     row. From a client session, a patient may now only insert their own source 'patient', recorded_via 'app' row, and no client may change
--     the columns the count depends on. The SECURITY DEFINER functions (which run as their owner) are unaffected.
--  6. The QR page (verify_prescription_public) and the phone desk (desk_verify_prescription) gain self_reported_supplies,
--     last_self_report_on, last_self_report_pharmacy (the pharmacy name and town the patient typed) and self_report_awaiting_pharmacy, so a
--     pharmacist sees "collected, as reported by the patient" with the date and place, and can confirm only if it was them. Nothing that
--     identifies the patient. OUT parameters (and, for the record functions, the argument list) change, so these five functions are dropped
--     and recreated; before each drop the migration fails loudly if anything depends on the function (it never cascades), and afterwards it
--     asserts the grants are exactly what they were (checked live 2026-11-05: none had a comment, none had a dependent).
--  7. The three windows (patient undo 24 hours, report match 7 days, patient duplicate 10 minutes) are an operational setting, versioned in
--     public.prescription_supply_config and mirrored in packages/shared proposed-config `prescriptions.patient_supply_windows` (a test fails
--     if the seed and the registry drift). Functions read them through private.rx_supply_window(); a missing value fails closed.
--
-- Not changed, on purpose: the medication schedule. Dose slots run from the prescription's signing (medications.schedule_effective_from, or
-- created_at), not from collection; nothing in the schedule reads a collection date today. Starting the schedule on collection would change
-- missed-dose and adherence behaviour and is left to a CMO decision (docs/DECISIONS.md T2-14).
-- No notification is sent for a patient confirmation: it is the patient's own in-app action and works with every send failing.
-- Row counts at writing (local replay): pharmacy_order_dispenses 0. Nothing to backfill; every new column is nullable.

-- 1. Columns -----------------------------------------------------------------------------------------------------------------------
alter table public.pharmacy_order_dispenses
  add column if not exists pharmacy_town text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.profiles (id) on delete restrict,
  add column if not exists withdraw_reason text,
  add column if not exists matched_dispense_id uuid references public.pharmacy_order_dispenses (id) on delete set null,
  add column if not exists matched_at timestamptz;

alter table public.pharmacy_order_dispenses drop constraint if exists pharmacy_order_dispenses_recorded_via_values;
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_recorded_via_values
    check (recorded_via in ('app', 'partner', 'public_verification', 'desk_phone', 'patient_confirmation')),
  add constraint pharmacy_order_dispenses_pharmacy_town_length check (char_length(pharmacy_town) <= 80),
  add constraint pharmacy_order_dispenses_withdraw_reason_length check (char_length(withdraw_reason) <= 300),
  -- only a patient confirmation can be withdrawn or matched, and only a patient confirmation is source 'patient' AND counted
  add constraint pharmacy_order_dispenses_patient_confirmation_shape check (
    recorded_via <> 'patient_confirmation' or (source = 'patient' and medication_id is not null)),
  add constraint pharmacy_order_dispenses_withdraw_only_patient_confirmation check (
    (withdrawn_at is null and matched_dispense_id is null) or recorded_via = 'patient_confirmation'),
  add constraint pharmacy_order_dispenses_withdrawn_together check ((withdrawn_at is null) = (withdrawn_by is null));

comment on column public.pharmacy_order_dispenses.recorded_via is
  'How the row was created: app (patient or Tarragon staff; a patient row made this way does not count as a supply), partner (a logged-in pharmacy partner), public_verification (a pharmacy that scanned the prescription QR; pharmacy and pharmacist names are self-declared), desk_phone (Tarragon staff for a pharmacy that phoned), patient_confirmation (T2-11c: the patient says they collected it; counts as a supply, labelled patient-reported everywhere).';
comment on column public.pharmacy_order_dispenses.matched_dispense_id is
  'T2-11c: on a patient confirmation, the pharmacy record that later confirmed the same supply. A matched confirmation no longer counts (the pharmacy row does).';
comment on column public.pharmacy_order_dispenses.withdrawn_at is
  'T2-11c: the patient took back their own confirmation (within the undo window, before any pharmacy confirmed it). The row is kept; it no longer counts.';

create index if not exists pharmacy_order_dispenses_patient_confirmation_idx
  on public.pharmacy_order_dispenses (medication_id, created_at)
  where recorded_via = 'patient_confirmation' and withdrawn_at is null and matched_dispense_id is null;


-- 1b. The windows, as a versioned operational setting -------------------------------------------------------------------------------
create table if not exists public.prescription_supply_config (
  version     integer primary key,
  is_active   boolean not null default false,
  rules       jsonb not null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists prescription_supply_config_one_active on public.prescription_supply_config (is_active) where is_active;

create or replace function private.prescription_supply_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  -- every key a positive whole number; a missing or odd one would make a window null and quietly lift a limit
  foreach k in array array['patient_undo_hours', 'report_match_days', 'patient_duplicate_minutes'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,4}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'patient_undo_hours')::integer <= 168
     and (r ->> 'report_match_days')::integer <= 60
     and (r ->> 'patient_duplicate_minutes')::integer <= 1440;
exception when others then
  return false;
end;
$$;
revoke all on function private.prescription_supply_rules_valid(jsonb) from public, anon, authenticated;
alter table public.prescription_supply_config drop constraint if exists prescription_supply_config_rules_valid;
alter table public.prescription_supply_config add constraint prescription_supply_config_rules_valid check (private.prescription_supply_rules_valid(rules));

-- rx-supply-windows-begin
insert into public.prescription_supply_config (version, is_active, rules, note) values (1, true, $json$
{
  "patient_undo_hours": 24,
  "report_match_days": 7,
  "patient_duplicate_minutes": 10
}
$json$::jsonb, 'PROPOSED, T2-11c (2026-11-05). patient_undo_hours: how long the patient can take back their own confirmation. report_match_days: how long a patient report blocks a second fill and can be confirmed by the pharmacy that supplied it, and how far apart a patient confirmation and a pharmacy record may be to be the same supply. patient_duplicate_minutes: a second tap within this is a duplicate.')
on conflict (version) do nothing;
-- rx-supply-windows-end

alter table public.prescription_supply_config enable row level security;
revoke all on public.prescription_supply_config from public, anon, authenticated;
comment on table public.prescription_supply_config is
  'T2-11c: the windows for patient-reported prescription supplies. Operational setting (G-01): versioned, audited, no signature. Mirrored in packages/shared proposed-config prescriptions.patient_supply_windows.';
drop trigger if exists audit_row_change_trg on public.prescription_supply_config;
create trigger audit_row_change_trg after insert or update or delete on public.prescription_supply_config
  for each row execute function private.audit_row_change();

create or replace function private.rx_supply_window(p_key text) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v integer;
begin
  select (c.rules ->> p_key)::integer into v from public.prescription_supply_config c where c.is_active;
  if v is null then
    raise exception 'prescription_supply_config has no active value for %', p_key using errcode = '55000';
  end if;
  return v;
end;
$$;
revoke all on function private.rx_supply_window(text) from public, anon, authenticated;

-- 2. The one definition of a counted supply, and the one report a pharmacy may confirm ---------------------------------------------
create or replace function private.dispense_counts_as_supply(d public.pharmacy_order_dispenses) returns boolean
language sql immutable set search_path = '' as $$
  select (d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null)
      or (d.recorded_via = 'patient_confirmation' and d.withdrawn_at is null and d.matched_dispense_id is null)
$$;
revoke all on function private.dispense_counts_as_supply(public.pharmacy_order_dispenses) from public, anon, authenticated;
comment on function private.dispense_counts_as_supply(public.pharmacy_order_dispenses) is
  'T2-11c: a supply counts if a pharmacy recorded it (and it is not disputed), or the patient confirmed it (and has not withdrawn it, and no pharmacy has since confirmed it was theirs).';

-- The live patient report a pharmacy may say it supplied: the oldest one made within report_match_days.
create or replace function private.absorbable_patient_report(p_medication uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.pharmacy_order_dispenses d
   where d.medication_id = p_medication and d.recorded_via = 'patient_confirmation'
     and d.withdrawn_at is null and d.matched_dispense_id is null
     and d.created_at > now() - make_interval(days => private.rx_supply_window('report_match_days'))
   order by d.created_at, d.id
   limit 1
$$;
revoke all on function private.absorbable_patient_report(uuid) from public, anon, authenticated;

-- A pharmacy said it supplied the collection the patient reported: the report stops counting (the pharmacy row counts), audited.
create or replace function private.match_patient_report(p_report uuid, p_dispense uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.pharmacy_order_dispenses%rowtype;
begin
  if p_report is null or p_dispense is null then return; end if;
  update public.pharmacy_order_dispenses set matched_dispense_id = p_dispense, matched_at = now()
   where id = p_report and recorded_via = 'patient_confirmation' and matched_dispense_id is null and withdrawn_at is null
  returning * into v_row;
  if v_row.id is null then return; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_row.organisation_id, (select auth.uid()), 'prescription.patient_report_matched', 'pharmacy_order_dispenses', v_row.id,
          v_row.patient_id, 'success', jsonb_build_object('medication_id', v_row.medication_id, 'pharmacy_dispense_id', p_dispense));
end;
$$;
revoke all on function private.match_patient_report(uuid, uuid) from public, anon, authenticated;

-- 3. Counters that only read: patched in place from the live body (one occurrence each, or the migration fails) ----------------------
do $patch$
declare
  v_old constant text := $o$d.source = 'pharmacy' and d.disputed_at is null$o$;
  v_new constant text := $n$private.dispense_counts_as_supply(d)$n$;
  v_fn text;
  v_def text;
  v_hits integer;
begin
  foreach v_fn in array array['public.pharmacist_verify_collection(uuid,text)', 'public.pharmacist_verify_visit(uuid,text)',
                              'private.supplies_remaining(uuid)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if v_def like '%dispense_counts_as_supply%' then continue; end if;
    v_hits := (char_length(v_def) - char_length(replace(v_def, v_old, ''))) / char_length(v_old);
    if v_hits <> 1 then
      raise exception 'T2-11c: % has % occurrences of the supply count, expected 1; patch it by hand', v_fn, v_hits using errcode = '55000';
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $patch$;

-- 4. Functions whose shape changes: dropped and recreated, never cascading -------------------------------------------------------------
create or replace function pg_temp.t211c_no_dependents(p_fn text) returns void language plpgsql as $$
declare v_n integer;
begin
  select count(*) into v_n from pg_depend d
   where d.refclassid = 'pg_proc'::regclass and d.refobjid = p_fn::regprocedure and d.deptype in ('n', 'a');
  if v_n > 0 then
    raise exception 'T2-11c: % has % dependent object(s); refusing to drop it (no cascade). Recreate them with it by hand.', p_fn, v_n
      using errcode = '2BP01';
  end if;
end $$;

-- 4a. The QR page ------------------------------------------------------------------------------------------------------------------
select pg_temp.t211c_no_dependents('public.verify_prescription_public(text)');
drop function public.verify_prescription_public(text);
create function public.verify_prescription_public(p_token text)
returns table(status text, rx_number text, drug_name text, dose text, frequency text, quantity text, duration_days integer, repeats_allowed integer, repeats_used integer,
              repeats_remaining integer, supplies_dispensed integer, supplies_permitted integer, supply_available boolean, last_supplied_on date, signed_at timestamp with time zone,
              expires_at timestamp with time zone, version integer, prescriber_name text, prescriber_credential text,
              self_reported_supplies integer, last_self_report_on date, last_self_report_pharmacy text, self_report_awaiting_pharmacy boolean)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_med public.medications%rowtype;
  v_approved integer;
  v_dispensed integer;
  v_last date;
  v_permitted integer;
  v_status text;
  v_name text;
  v_cred text;
  v_self integer;
  v_report public.pharmacy_order_dispenses%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select * into v_med from public.medications m
   where m.public_token = p_token and m.source = 'clinician';
  if v_med.id is null then
    return;
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*), max(d.dispensed_on), count(*) filter (where d.recorded_via = 'patient_confirmation')
    into v_dispensed, v_last, v_self
    from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d);
  -- the report to show: the one a pharmacy may still confirm, else the latest counted one
  select * into v_report from public.pharmacy_order_dispenses d
   where d.id = coalesce(private.absorbable_patient_report(v_med.id),
                         (select d2.id from public.pharmacy_order_dispenses d2
                           where d2.medication_id = v_med.id and d2.recorded_via = 'patient_confirmation' and private.dispense_counts_as_supply(d2)
                           order by d2.created_at desc limit 1));

  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));
  v_status := case
    when private.is_controlled_medicine(v_med.drug_name) then 'controlled_medicine'
    when v_med.superseded_at is not null then 'superseded'
    when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
    when not v_med.is_active then 'cancelled'
    else 'active'
  end;

  select p.full_name into v_name from public.profiles p where p.id = v_med.added_by;
  select cs.credential_type || ' ' || cs.credential_number into v_cred
    from public.clinical_staff cs
   where cs.profile_id = v_med.added_by
     and cs.license_verified_at is not null
     and (cs.license_expires_at is null or cs.license_expires_at > now())
     and cs.credential_type is not null and cs.credential_number is not null
     and cs.credential_number !~* '(pending|placeholder|tbc|tbd)'
   limit 1;

  return query select
    v_status,
    v_med.rx_number, v_med.drug_name, v_med.dose, v_med.frequency, v_med.quantity, v_med.duration_days,
    coalesce(v_med.repeats_allowed, 0),
    greatest(coalesce(v_dispensed, 0) - 1, 0),
    greatest(coalesce(v_med.repeats_allowed, 0) - greatest(coalesce(v_dispensed, 0) - 1, 0), 0),
    coalesce(v_dispensed, 0),
    v_permitted,
    (v_status = 'active' and coalesce(v_dispensed, 0) < v_permitted),
    v_last,
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_name, 'Tarragon care team'), v_cred,
    coalesce(v_self, 0),
    v_report.dispensed_on,
    nullif(concat_ws(', ', nullif(btrim(v_report.pharmacy_name), ''), nullif(btrim(v_report.pharmacy_town), '')), ''),
    (v_status = 'active' and private.absorbable_patient_report(v_med.id) is not null);
end;
$function$;
revoke all on function public.verify_prescription_public(text) from public;
grant execute on function public.verify_prescription_public(text) to anon, authenticated, service_role;
comment on function public.verify_prescription_public(text) is
  'The no-login prescription check behind /verify-rx/[token]: proof only, never a patient identifier. T2-11c: supplies count patient-reported collections, shown with their date and the pharmacy the patient named.';

-- 4b. The phone desk's view -------------------------------------------------------------------------------------------------------
select pg_temp.t211c_no_dependents('public.desk_verify_prescription(text,text,text)');
drop function public.desk_verify_prescription(text, text, text);
create function public.desk_verify_prescription(p_rx_number text, p_verification_code text, p_name_on_paper text default null::text)
returns table(found boolean, status text, rx_number text, drug_name text, dose text, frequency text, quantity text, duration_days integer, repeats_allowed integer,
              supplies_dispensed integer, supplies_permitted integer, supply_available boolean, last_supplied_on date, signed_at timestamp with time zone,
              expires_at timestamp with time zone, version integer, prescriber_name text, prescriber_credential text, name_checked boolean, name_matches boolean,
              self_reported_supplies integer, last_self_report_on date, last_self_report_pharmacy text, self_report_awaiting_pharmacy boolean)
language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_med public.medications%rowtype;
  v_org uuid;
  v_approved integer;
  v_dispensed integer;
  v_last date;
  v_permitted integer;
  v_status text;
  v_name text;
  v_cred text;
  v_checked boolean := nullif(btrim(coalesce(p_name_on_paper, '')), '') is not null;
  v_matches boolean := false;
  v_self integer;
  v_report public.pharmacy_order_dispenses%rowtype;
begin
  if not private.desk_staff_member() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = v_caller;

  select * into v_med from public.medications m
   where m.rx_number = btrim(coalesce(p_rx_number, ''))
     and m.verification_code = upper(btrim(coalesce(p_verification_code, '')))
     and m.source = 'clinician';

  if v_med.id is null then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, result, event)
    values (v_org, v_caller, 'prescription.desk_lookup', 'medications', 'denied',
            jsonb_build_object('rx_number', left(btrim(coalesce(p_rx_number, '')), 40), 'found', false));
    return query select false, null::text, null::text, null::text, null::text, null::text, null::text, null::integer, null::integer,
                        null::integer, null::integer, null::boolean, null::date, null::timestamptz, null::timestamptz, null::integer,
                        null::text, null::text, v_checked, false, null::integer, null::date, null::text, null::boolean;
    return;
  end if;

  if v_checked then
    v_matches := private.person_names_match(p_name_on_paper, (select p.full_name from public.profiles p where p.id = v_med.patient_id));
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*), max(d.dispensed_on), count(*) filter (where d.recorded_via = 'patient_confirmation')
    into v_dispensed, v_last, v_self
    from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d);
  select * into v_report from public.pharmacy_order_dispenses d
   where d.id = coalesce(private.absorbable_patient_report(v_med.id),
                         (select d2.id from public.pharmacy_order_dispenses d2
                           where d2.medication_id = v_med.id and d2.recorded_via = 'patient_confirmation' and private.dispense_counts_as_supply(d2)
                           order by d2.created_at desc limit 1));
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));
  v_status := case
    when private.is_controlled_medicine(v_med.drug_name) then 'controlled_medicine'
    when v_med.superseded_at is not null then 'superseded'
    when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
    when not v_med.is_active then 'cancelled'
    else 'active' end;

  select p.full_name into v_name from public.profiles p where p.id = v_med.added_by;
  select cs.credential_type || ' ' || cs.credential_number into v_cred
    from public.clinical_staff cs
   where cs.profile_id = v_med.added_by and cs.license_verified_at is not null
     and (cs.license_expires_at is null or cs.license_expires_at > now())
     and cs.credential_type is not null and cs.credential_number is not null
     and cs.credential_number !~* '(pending|placeholder|tbc|tbd)'
   limit 1;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_org, v_caller, 'prescription.desk_lookup', 'medications', v_med.id, v_med.patient_id, 'success',
          jsonb_build_object('rx_number', v_med.rx_number, 'found', true, 'name_checked', v_checked, 'name_matches', v_matches, 'status', v_status));

  return query select true, v_status, v_med.rx_number, v_med.drug_name, v_med.dose, v_med.frequency, v_med.quantity, v_med.duration_days,
                      coalesce(v_med.repeats_allowed, 0), coalesce(v_dispensed, 0), v_permitted,
                      (v_status = 'active' and coalesce(v_dispensed, 0) < v_permitted), v_last,
                      v_med.created_at, v_med.expires_at, v_med.version,
                      coalesce(v_name, 'Tarragon care team'), v_cred, v_checked, v_matches,
                      coalesce(v_self, 0), v_report.dispensed_on,
                      nullif(concat_ws(', ', nullif(btrim(v_report.pharmacy_name), ''), nullif(btrim(v_report.pharmacy_town), '')), ''),
                      (v_status = 'active' and private.absorbable_patient_report(v_med.id) is not null);
end;
$function$;
revoke all on function public.desk_verify_prescription(text, text, text) from public, anon;
grant execute on function public.desk_verify_prescription(text, text, text) to authenticated, service_role;
comment on function public.desk_verify_prescription(text, text, text) is
  'The prescription desk: a staff member checks a prescription for a pharmacist who phoned. Never returns the patient''s name. T2-11c: also says whether the patient reported a collection, when and where.';

-- 4c. The QR record path ----------------------------------------------------------------------------------------------------------
select pg_temp.t211c_no_dependents('public.record_prescription_supply_public(text,text,text,text,text)');
drop function public.record_prescription_supply_public(text, text, text, text, text);
create function public.record_prescription_supply_public(
  p_token text,
  p_pharmacy_name text,
  p_pharmacist_name text,
  p_pharmacist_registration text default null,
  p_quantity_supplied text default null,
  p_supplied_reported_collection boolean default false
)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_med public.medications%rowtype;
  v_approved integer;
  v_dispensed integer;
  v_permitted integer;
  v_dispense_id uuid;
  v_recent integer;
  v_pharmacy text := btrim(coalesce(p_pharmacy_name, ''));
  v_pharmacist text := btrim(coalesce(p_pharmacist_name, ''));
  v_reg text := nullif(btrim(coalesce(p_pharmacist_registration, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity_supplied, '')), '');
  v_hash text;
  v_outcome text;
  v_report uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;

  -- Lock the prescription row so two counters recording at once cannot both take the last supply.
  select * into v_med from public.medications m
   where m.public_token = p_token and m.source = 'clinician'
   for update;
  if v_med.id is null then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  -- T2-11c: a live patient report counts like a supply, unless THIS pharmacy says it supplied that collection.
  v_report := case when coalesce(p_supplied_reported_collection, false) then private.absorbable_patient_report(v_med.id) end;

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*) into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d) and d.id is distinct from v_report;
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));

  v_outcome := case
    when private.is_controlled_medicine(v_med.drug_name) then 'controlled_medicine'
    when char_length(v_pharmacy) not between 2 and 120
      or char_length(v_pharmacist) not between 2 and 120
      or v_reg is null
      or v_reg !~ '^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,38}[A-Za-z0-9]$'
      or char_length(coalesce(v_qty, '')) > 100 then 'invalid'
    when v_med.superseded_at is not null or not v_med.is_active
      or (v_med.expires_at is not null and v_med.expires_at < now()) then 'not_active'
    when exists (select 1 from public.pharmacy_order_dispenses d
                  where d.medication_id = v_med.id and d.source = 'pharmacy'
                    and d.created_at > now() - interval '10 minutes') then 'duplicate'
    when v_dispensed >= v_permitted then 'no_supply_available'
    else 'recorded'
  end;

  if v_outcome <> 'recorded' then
    select count(*) into v_recent from public.prescription_supply_attempts a
     where a.medication_id = v_med.id and a.created_at > now() - interval '1 hour';
    -- the hourly cap keeps the anonymous door from filling the table; a controlled refusal is always logged (it is the audit row, OQ-276)
    if v_recent < 20 or v_outcome = 'controlled_medicine' then
      insert into public.prescription_supply_attempts (organisation_id, patient_id, medication_id, outcome, token_hash, pharmacy_name, pharmacist_name)
      values (v_med.organisation_id, v_med.patient_id, v_med.id, v_outcome, v_hash,
              left(nullif(v_pharmacy, ''), 120), left(nullif(v_pharmacist, ''), 120));
    end if;
    return query select v_outcome, v_dispensed, v_permitted;
    return;
  end if;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed,
    dispensed_on, source, recorded_by, pharmacy_name, pharmacist_name, pharmacist_registration,
    pharmacist_registration_verified, recorded_via
  ) values (
    v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose,
    coalesce(v_qty, v_med.quantity), v_med.quantity,
    (now() at time zone 'Africa/Lagos')::date, 'pharmacy', null, v_pharmacy, v_pharmacist, v_reg,
    false, 'public_verification'
  ) returning id into v_dispense_id;
  perform private.match_patient_report(v_report, v_dispense_id);

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_med.organisation_id, v_med.patient_id, 'in_app', 'pending', 'prescription_supply_recorded',
          jsonb_build_object(
            'drug_name', v_med.drug_name,
            'rx_number', v_med.rx_number,
            'pharmacy_name', v_pharmacy,
            'pharmacist_name', v_pharmacist,
            'pharmacist_registration', v_reg,
            'dispense_id', v_dispense_id,
            'confirmed_your_reported_collection', v_report is not null,
            'supplies_dispensed', v_dispensed + 1,
            'supplies_permitted', v_permitted));

  return query select 'recorded'::text, v_dispensed + 1, v_permitted;
end;
$function$;
revoke all on function public.record_prescription_supply_public(text, text, text, text, text, boolean) from public;
grant execute on function public.record_prescription_supply_public(text, text, text, text, text, boolean) to anon, authenticated, service_role;
comment on function public.record_prescription_supply_public(text, text, text, text, text, boolean) is
  'A pharmacy that scanned the prescription QR records its supply (no login; names self-declared). T2-11c: a live patient-reported collection blocks it like a supply unless the pharmacy states it supplied that collection (p_supplied_reported_collection), which then confirms the report instead of adding a second supply.';

-- 4d. The phone desk's record path -------------------------------------------------------------------------------------------------
select pg_temp.t211c_no_dependents('public.desk_record_prescription_supply(text,text,text,text,text)');
drop function public.desk_record_prescription_supply(text, text, text, text, text);
create function public.desk_record_prescription_supply(
  p_rx_number text,
  p_verification_code text,
  p_pharmacy_name text,
  p_pharmacist_name text,
  p_pharmacist_registration text,
  p_supplied_reported_collection boolean default false
)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_med public.medications%rowtype;
  v_org uuid;
  v_out record;
begin
  if not private.desk_staff_member() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = v_caller;

  select * into v_med from public.medications m
   where m.rx_number = btrim(coalesce(p_rx_number, ''))
     and m.verification_code = upper(btrim(coalesce(p_verification_code, '')))
     and m.source = 'clinician';
  if v_med.id is null or v_med.public_token is null then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;

  select * into v_out from public.record_prescription_supply_public(v_med.public_token, p_pharmacy_name, p_pharmacist_name,
                                                                     p_pharmacist_registration, null, coalesce(p_supplied_reported_collection, false));

  if v_out.outcome = 'recorded' then
    update public.pharmacy_order_dispenses
       set recorded_via = 'desk_phone', recorded_by = v_caller
     where id = (select d.id from public.pharmacy_order_dispenses d
                  where d.medication_id = v_med.id and d.source = 'pharmacy' and d.recorded_via = 'public_verification'
                  order by d.created_at desc limit 1);
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
    values (v_org, v_caller, 'prescription.desk_supply_recorded', 'medications', v_med.id, v_med.patient_id, 'success',
            jsonb_build_object('rx_number', v_med.rx_number, 'pharmacy_name', left(btrim(p_pharmacy_name), 120),
                               'pharmacist_registration', left(btrim(p_pharmacist_registration), 40),
                               'supplied_reported_collection', coalesce(p_supplied_reported_collection, false)));
  end if;

  return query select v_out.outcome, v_out.supplies_dispensed, v_out.supplies_permitted;
end;
$function$;
revoke all on function public.desk_record_prescription_supply(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.desk_record_prescription_supply(text, text, text, text, text, boolean) to authenticated, service_role;
comment on function public.desk_record_prescription_supply(text, text, text, text, text, boolean) is
  'The prescription desk records a supply for a pharmacy that phoned, through the same rules as the QR path. T2-11c: p_supplied_reported_collection as there.';

-- 4e. The partner counter (dormant, behind private.pharmacy_collection_on): patched from the live body ----------------------------
do $patch$
declare
  v_fn constant text := 'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)';
  v_def text;
  v_old_count constant text := $o$d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);$o$;
  v_new_count constant text := $n$private.dispense_counts_as_supply(d) and not coalesce(d.is_partial, false) and d.id is distinct from v_report;$n$;
  v_old_sig constant text := 'p_pharmacist_name text)';
  v_new_sig constant text := 'p_pharmacist_name text, p_supplied_reported_collection boolean DEFAULT false)';
  v_old_decl constant text := E'v_batch text := nullif(btrim(coalesce(p_batch, \'\')), \'\');';
  v_new_decl constant text := E'v_batch text := nullif(btrim(coalesce(p_batch, \'\')), \'\');\n  v_report uuid;';
  v_old_lock constant text := $o$  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';$o$;
  v_new_lock constant text := $n$  -- T2-11c: a live patient report counts like a supply unless this pharmacy states it supplied that collection (a full supply only).
  v_report := case when coalesce(p_supplied_reported_collection, false) and not v_partial then private.absorbable_patient_report(v_med.id) end;
  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';$n$;
  v_old_ins constant text := E'  returning id into v_dispense;\n';
  v_new_ins constant text := E'  returning id into v_dispense;\n  perform private.match_patient_report(v_report, v_dispense);\n';
  v_pair text[];
begin
  v_def := pg_get_functiondef(v_fn::regprocedure);
  foreach v_pair slice 1 in array array[[v_old_count, v_new_count], [v_old_sig, v_new_sig], [v_old_decl, v_new_decl],
                                        [v_old_lock, v_new_lock], [v_old_ins, v_new_ins]] loop
    if (char_length(v_def) - char_length(replace(v_def, v_pair[1], ''))) / char_length(v_pair[1]) <> 1 then
      raise exception 'T2-11c: pharmacist_dispense_prescription no longer has exactly one "%"; patch it by hand', left(v_pair[1], 60) using errcode = '55000';
    end if;
    v_def := replace(v_def, v_pair[1], v_pair[2]);
  end loop;
  perform pg_temp.t211c_no_dependents(v_fn);
  execute 'drop function ' || v_fn;
  execute v_def;
end $patch$;
revoke all on function public.pharmacist_dispense_prescription(uuid, text, text, boolean, text, text, date, text, text, boolean) from public, anon;
grant execute on function public.pharmacist_dispense_prescription(uuid, text, text, boolean, text, text, date, text, text, boolean) to authenticated, service_role;
comment on function public.pharmacist_dispense_prescription(uuid, text, text, boolean, text, text, date, text, text, boolean) is
  'S28 partner pharmacy records a supply against a prescription sent to it. T2-11c: p_supplied_reported_collection as on the QR path.';

-- 5. Guard: history the clients cannot rewrite -------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function current_user is the function's owner, so the writes the RPCs make
-- pass, and only a client session writing through the table policy (current_user authenticated or anon) is checked. The 'role' setting
-- would not do: it still says authenticated inside a definer function.
create or replace function private.guard_dispense_history() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_staff boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_staff := private.is_org_staff(new.organisation_id);
    if new.recorded_via = 'patient_confirmation' or new.withdrawn_at is not null or new.matched_dispense_id is not null then
      raise exception 'A patient confirmation is recorded with confirm_prescription_collected' using errcode = '42501';
    end if;
    if not v_staff and (new.source <> 'patient'::public.dispense_source or new.recorded_via <> 'app' or new.disputed_at is not null) then
      raise exception 'A patient can only record their own collection here' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.recorded_via = 'patient_confirmation' or old.source = 'pharmacy'::public.dispense_source then
      raise exception 'A supply record cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.recorded_via = 'patient_confirmation' then
    raise exception 'A patient confirmation can only be taken back with undo_prescription_collected' using errcode = '42501';
  end if;
  if new.source is distinct from old.source or new.medication_id is distinct from old.medication_id
     or new.recorded_via is distinct from old.recorded_via
     or new.disputed_at is distinct from old.disputed_at or new.disputed_by is distinct from old.disputed_by
     or new.withdrawn_at is distinct from old.withdrawn_at or new.withdrawn_by is distinct from old.withdrawn_by
     or new.matched_dispense_id is distinct from old.matched_dispense_id or new.matched_at is distinct from old.matched_at then
    raise exception 'These supply fields cannot be changed directly' using errcode = '42501';
  end if;
  if old.source = 'pharmacy'::public.dispense_source and not private.is_org_staff(old.organisation_id) then
    raise exception 'A pharmacy supply record cannot be edited by the patient; use This wasn''t me' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_dispense_history() from public, anon, authenticated;

drop trigger if exists pharmacy_order_dispenses_guard_history on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_guard_history
  before insert or update or delete on public.pharmacy_order_dispenses
  for each row execute function private.guard_dispense_history();

-- 6. A dispute of the pharmacy record that confirmed a patient report makes the report count again ---------------------------------
create or replace function private.unmatch_patient_report_on_dispute() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.disputed_at is null and new.disputed_at is not null then
    update public.pharmacy_order_dispenses set matched_dispense_id = null, matched_at = null
     where matched_dispense_id = new.id and recorded_via = 'patient_confirmation';
  end if;
  return new;
end;
$$;
revoke all on function private.unmatch_patient_report_on_dispute() from public, anon, authenticated;

drop trigger if exists pharmacy_order_dispenses_unmatch_on_dispute on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_unmatch_on_dispute
  after update of disputed_at on public.pharmacy_order_dispenses
  for each row execute function private.unmatch_patient_report_on_dispute();

-- 7. The patient's two actions ----------------------------------------------------------------------------------------------------
create or replace function public.confirm_prescription_collected(
  p_medication_id uuid,
  p_collected_on date default null,
  p_pharmacy_name text default null,
  p_pharmacy_town text default null,
  p_quantity text default null
)
returns table (outcome text, dispense_id uuid, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_med public.medications%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_on date := coalesce(p_collected_on, (now() at time zone 'Africa/Lagos')::date);
  v_pharmacy text := nullif(btrim(coalesce(p_pharmacy_name, '')), '');
  v_town text := nullif(btrim(coalesce(p_pharmacy_town, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), '');
  v_approved integer;
  v_dispensed integer;
  v_permitted integer;
  v_pharmacy_row uuid;
  v_new uuid;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Only the patient's own signed clinician prescription. Locked, the same row every supply path locks.
  select * into v_med from public.medications m
   where m.id = p_medication_id and m.patient_id = v_caller and m.source = 'clinician' and m.rx_number is not null
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

  -- A pharmacy already recorded this supply (within report_match_days either side): the patient is confirming receipt, not a second supply.
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
    values (v_med.organisation_id, v_caller, v_med.id, v_pharmacy_row, (v_on::timestamp + interval '12 hours') at time zone 'Africa/Lagos',
            'patient_self_report', v_caller, null);
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
    dispensed_on, source, recorded_by, pharmacy_name, pharmacy_town, recorded_via
  ) values (
    v_med.organisation_id, v_caller, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
    v_on, 'patient', v_caller, v_pharmacy, v_town, 'patient_confirmation'
  ) returning id into v_new;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_med.organisation_id, v_caller, 'prescription.patient_reported_supply', 'pharmacy_order_dispenses', v_new, v_caller, 'success',
          jsonb_build_object('medication_id', v_med.id, 'rx_number', v_med.rx_number, 'collected_on', v_on,
                             'supplies_dispensed', v_dispensed + 1, 'supplies_permitted', v_permitted));

  return query select 'recorded'::text, v_new, v_dispensed + 1, v_permitted;
end;
$$;
revoke all on function public.confirm_prescription_collected(uuid, date, text, text, text) from public, anon;
grant execute on function public.confirm_prescription_collected(uuid, date, text, text, text) to authenticated;
comment on function public.confirm_prescription_collected(uuid, date, text, text, text) is
  'T2-11c: the patient says they collected their own signed prescription. Counts as a supply (labelled patient-reported), so the QR page shows it used. Matches a pharmacy record within report_match_days instead of counting twice.';

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
  select * into v_row from public.pharmacy_order_dispenses d
   where d.id = p_dispense_id and d.patient_id = v_caller and d.recorded_via = 'patient_confirmation' and d.recorded_by = v_caller
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
  values (v_row.organisation_id, v_caller, 'prescription.patient_reported_supply_withdrawn', 'pharmacy_order_dispenses', v_row.id, v_caller,
          'success', jsonb_build_object('medication_id', v_row.medication_id, 'collected_on', v_row.dispensed_on,
                                        'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 300)));
  return 'undone';
end;
$$;
revoke all on function public.undo_prescription_collected(uuid, text) from public, anon;
grant execute on function public.undo_prescription_collected(uuid, text) to authenticated;
comment on function public.undo_prescription_collected(uuid, text) is
  'T2-11c: the patient takes back their own confirmation within patient_undo_hours, before any pharmacy matched it. The row is kept and audited.';


-- 8. The migration proves what it claims ------------------------------------------------------------------------------------------
do $$
declare
  v_fn text;
  r record;
begin
  -- every counter uses the shared count
  foreach v_fn in array array['public.desk_verify_prescription(text,text,text)', 'public.pharmacist_verify_collection(uuid,text)',
    'public.pharmacist_verify_visit(uuid,text)', 'private.supplies_remaining(uuid)', 'public.verify_prescription_public(text)',
    'public.record_prescription_supply_public(text,text,text,text,text,boolean)',
    'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text,boolean)'] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%dispense_counts_as_supply%' then
      raise exception 'T2-11c: % does not use the shared supply count', v_fn;
    end if;
  end loop;
  -- the record paths leave a report out ONLY when the pharmacy says it supplied it
  foreach v_fn in array array['public.record_prescription_supply_public(text,text,text,text,text,boolean)',
    'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text,boolean)'] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%coalesce(p_supplied_reported_collection, false)%then private.absorbable_patient_report(v_med.id)%' then
      raise exception 'T2-11c: % does not gate the patient report on the pharmacy''s statement', v_fn;
    end if;
  end loop;
  -- the old argument lists are gone (no ambiguous overloads left behind)
  if to_regprocedure('public.record_prescription_supply_public(text,text,text,text,text)') is not null
     or to_regprocedure('public.desk_record_prescription_supply(text,text,text,text,text)') is not null
     or to_regprocedure('public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)') is not null then
    raise exception 'T2-11c: an old supply function signature is still present';
  end if;

  -- grants exactly as before the drop (checked live 2026-11-05): PUBLIC never; anon only on the two QR functions
  for r in select * from (values
      ('public.verify_prescription_public(text)', true),
      ('public.record_prescription_supply_public(text,text,text,text,text,boolean)', true),
      ('public.desk_verify_prescription(text,text,text)', false),
      ('public.desk_record_prescription_supply(text,text,text,text,text,boolean)', false),
      ('public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text,boolean)', false)) as t(fn, anon_ok)
  loop
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = r.fn::regprocedure and a.grantee = 0) then
      raise exception 'T2-11c: PUBLIC can execute %', r.fn;
    end if;
    if has_function_privilege('anon', r.fn, 'EXECUTE') is distinct from r.anon_ok then
      raise exception 'T2-11c: anon EXECUTE on % is %, expected %', r.fn, has_function_privilege('anon', r.fn, 'EXECUTE'), r.anon_ok;
    end if;
    if not has_function_privilege('authenticated', r.fn, 'EXECUTE') then
      raise exception 'T2-11c: authenticated lost EXECUTE on %', r.fn;
    end if;
    if obj_description(r.fn::regprocedure, 'pg_proc') is null then
      raise exception 'T2-11c: % has no comment', r.fn;
    end if;
  end loop;

  foreach v_fn in array array['public.confirm_prescription_collected(uuid,date,text,text,text)', 'public.undo_prescription_collected(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'anon can call %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'authenticated cannot call %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.dispense_counts_as_supply(public.pharmacy_order_dispenses)', 'private.absorbable_patient_report(uuid)',
    'private.guard_dispense_history()', 'private.unmatch_patient_report_on_dispute()', 'private.match_patient_report(uuid,uuid)',
    'private.rx_supply_window(text)', 'private.prescription_supply_rules_valid(jsonb)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'T2-11c: % is callable by a client role', v_fn;
    end if;
  end loop;

  -- the windows are read from the active config, and the seed is valid
  if private.rx_supply_window('patient_undo_hours') <> 24 or private.rx_supply_window('report_match_days') <> 7
     or private.rx_supply_window('patient_duplicate_minutes') <> 10 then
    raise exception 'T2-11c: prescription_supply_config seed is not 24 / 7 / 10';
  end if;
  if has_table_privilege('anon', 'public.prescription_supply_config', 'SELECT') or has_table_privilege('authenticated', 'public.prescription_supply_config', 'SELECT') then
    raise exception 'T2-11c: prescription_supply_config is readable by a client role';
  end if;
end $$;
