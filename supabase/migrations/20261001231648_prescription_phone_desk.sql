-- The "no smartphone" route on the prescription PDF: someone at TarragonHealth answers a pharmacy's call, looks the prescription up and can record the supply.
-- The PDF tells a pharmacy that cannot scan to phone or email "quoting the Rx number and verification code"; until now nobody could act on that.
--
--  * public.desk_verify_prescription(rx_number, verification_code, name_on_paper): TarragonHealth staff only (an admin, or an active clinical_staff member).
--    Looks up by the Rx number plus the 6-character verification code (acceptable behind a staff login and an audit row, unlike on a public page), and returns the same
--    proof the public check shows: status, drug, dose, quantity, duration, repeats, supplies, validity, prescriber. It NEVER returns the patient's name. The pharmacist
--    reads the name off the paper and the staff member types it in: the function answers only "matches" or "does not match", so a caller cannot read a patient's name
--    out of it by guessing. Matching ignores case, punctuation, titles (Dr, Mr, Mrs...) and word order, and accepts a name with a middle name left out.
--  * public.desk_record_prescription_supply(...): the same rules as the public recording (active, clinician-approved repeats, 10 minute duplicate window, required
--    pharmacist registration, patient notified), recorded as recorded_via = 'desk_phone' with the staff member as recorded_by. The pharmacy details are what the
--    pharmacist said on the phone: self-declared, as ever.
--  * Every lookup and every recording writes audit_log (prescription.desk_lookup / prescription.desk_supply_recorded). The verification code is never stored.

alter table public.pharmacy_order_dispenses drop constraint if exists pharmacy_order_dispenses_recorded_via_values;
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_recorded_via_values
  check (recorded_via in ('app', 'partner', 'public_verification', 'desk_phone'));

create or replace function private.desk_staff_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.is_admin()
    or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
  );
$$;

create or replace function private.person_name_tokens(p_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(
    select distinct t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p_name, ''), '[^[:alpha:]]+', ' ', 'g')), '\s+')) t
     where t <> '' and t not in ('dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'chief', 'alhaji', 'alhaja', 'engr', 'pastor')
     order by t
  ), '{}'::text[]);
$$;

-- True when the two names are the same person as written: same words in any order, or one a subset of the other with at least two words (a middle name left out).
create or replace function private.person_names_match(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_a text[] := private.person_name_tokens(p_a);
  v_b text[] := private.person_name_tokens(p_b);
begin
  if coalesce(array_length(v_a, 1), 0) = 0 or coalesce(array_length(v_b, 1), 0) = 0 then
    return false;
  end if;
  if v_a = v_b then
    return true;
  end if;
  if array_length(v_a, 1) >= 2 and v_a <@ v_b then
    return true;
  end if;
  if array_length(v_b, 1) >= 2 and v_b <@ v_a then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.desk_verify_prescription(p_rx_number text, p_verification_code text, p_name_on_paper text default null)
returns table (
  found boolean,
  status text,
  rx_number text,
  drug_name text,
  dose text,
  frequency text,
  quantity text,
  duration_days integer,
  repeats_allowed integer,
  supplies_dispensed integer,
  supplies_permitted integer,
  supply_available boolean,
  last_supplied_on date,
  signed_at timestamptz,
  expires_at timestamptz,
  version integer,
  prescriber_name text,
  prescriber_credential text,
  name_checked boolean,
  name_matches boolean
)
language plpgsql
security definer
set search_path = ''
as $$
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
                        null::text, null::text, v_checked, false;
    return;
  end if;

  if v_checked then
    v_matches := private.person_names_match(p_name_on_paper, (select p.full_name from public.profiles p where p.id = v_med.patient_id));
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*), max(d.dispensed_on) into v_dispensed, v_last from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null;
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));
  v_status := case
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
                      coalesce(v_name, 'Tarragon care team'), v_cred, v_checked, v_matches;
end;
$$;

create or replace function public.desk_record_prescription_supply(
  p_rx_number text,
  p_verification_code text,
  p_pharmacy_name text,
  p_pharmacist_name text,
  p_pharmacist_registration text
)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql
security definer
set search_path = ''
as $$
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

  select * into v_out from public.record_prescription_supply_public(v_med.public_token, p_pharmacy_name, p_pharmacist_name, p_pharmacist_registration, null);

  if v_out.outcome = 'recorded' then
    update public.pharmacy_order_dispenses
       set recorded_via = 'desk_phone', recorded_by = v_caller
     where id = (select d.id from public.pharmacy_order_dispenses d
                  where d.medication_id = v_med.id and d.source = 'pharmacy' and d.recorded_via = 'public_verification'
                  order by d.created_at desc limit 1);
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
    values (v_org, v_caller, 'prescription.desk_supply_recorded', 'medications', v_med.id, v_med.patient_id, 'success',
            jsonb_build_object('rx_number', v_med.rx_number, 'pharmacy_name', left(btrim(p_pharmacy_name), 120),
                               'pharmacist_registration', left(btrim(p_pharmacist_registration), 40)));
  end if;

  return query select v_out.outcome, v_out.supplies_dispensed, v_out.supplies_permitted;
end;
$$;

revoke all on function private.desk_staff_member() from public;
revoke all on function private.desk_staff_member() from anon;
revoke all on function private.person_name_tokens(text) from public;
revoke all on function private.person_name_tokens(text) from anon;
revoke all on function private.person_names_match(text, text) from public;
revoke all on function private.person_names_match(text, text) from anon;
revoke all on function public.desk_verify_prescription(text, text, text) from public;
revoke all on function public.desk_verify_prescription(text, text, text) from anon;
grant execute on function public.desk_verify_prescription(text, text, text) to authenticated;
revoke all on function public.desk_record_prescription_supply(text, text, text, text, text) from public;
revoke all on function public.desk_record_prescription_supply(text, text, text, text, text) from anon;
grant execute on function public.desk_record_prescription_supply(text, text, text, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.desk_verify_prescription(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.desk_record_prescription_supply(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'the desk functions must not be anon-executable';
  end if;
  if not private.person_names_match('Dr. First Patient', 'patient, first') then
    raise exception 'name matching self-check failed';
  end if;
end $$;
