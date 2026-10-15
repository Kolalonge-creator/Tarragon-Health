-- OQ-276 follow-ups (CMO answers 2026-10-12): (1) the read-only QR views say a controlled medicine is not suppliable, (2) the patient is told plainly before choosing
-- a pharmacy for a prescription that holds one. Brand names stay out: the list is generic names only, as decided.
--
-- Rows affected live (checked 2026-10-12): 0 clinician medications match the controlled list, so no view or row changes meaning today; this is structural.
--
--  1. verify_prescription_public (anonymous QR page) and desk_verify_prescription (phone desk): status becomes 'controlled_medicine' (the first branch, ahead of
--     superseded/expired/cancelled/active). supply_available is already `status = 'active' and ...`, so it is false for a controlled medicine without another change.
--     Same columns, same grants, nothing recorded or logged differently.
--  2. private.patient_prescription_has_controlled_item + public.patient_prescription_has_controlled_item: true when the patient's own prescription (or the one a
--     caregiver with the pharmacy permission acts for, through private.rx_patient) names a controlled medicine on the medicine row or in a signed item. It is a
--     plain yes/no read for the owner only: another person's prescription answers false, so the answer reveals nothing about someone else.
--  Word boundaries elsewhere in this file use \y (never \b).

create or replace function public.verify_prescription_public(p_token text)
returns table(status text, rx_number text, drug_name text, dose text, frequency text, quantity text, duration_days integer, repeats_allowed integer, repeats_used integer,
              repeats_remaining integer, supplies_dispensed integer, supplies_permitted integer, supply_available boolean, last_supplied_on date, signed_at timestamp with time zone,
              expires_at timestamp with time zone, version integer, prescriber_name text, prescriber_credential text)
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
  select count(*), max(d.dispensed_on) into v_dispensed, v_last from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null;

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
    coalesce(v_name, 'Tarragon care team'), v_cred;
end;
$function$;

create or replace function public.desk_verify_prescription(p_rx_number text, p_verification_code text, p_name_on_paper text default null::text)
returns table(found boolean, status text, rx_number text, drug_name text, dose text, frequency text, quantity text, duration_days integer, repeats_allowed integer,
              supplies_dispensed integer, supplies_permitted integer, supply_available boolean, last_supplied_on date, signed_at timestamp with time zone,
              expires_at timestamp with time zone, version integer, prescriber_name text, prescriber_credential text, name_checked boolean, name_matches boolean)
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
                      coalesce(v_name, 'Tarragon care team'), v_cred, v_checked, v_matches;
end;
$function$;

-- 2. the patient's own yes/no
create or replace function public.patient_prescription_has_controlled_item(p_prescription uuid, p_beneficiary uuid default null)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_pat uuid := private.rx_patient(p_beneficiary);
begin
  return exists (
    select 1 from public.prescriptions rx
      left join public.medications m on m.prescription_id = rx.id and m.source = 'clinician'
     where rx.id = p_prescription and rx.patient_id = v_pat and rx.state <> 'draft'
       and private.prescription_has_controlled_item(m.drug_name, rx.items));
end $$;
revoke all on function public.patient_prescription_has_controlled_item(uuid, uuid) from public, anon;
grant execute on function public.patient_prescription_has_controlled_item(uuid, uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.patient_prescription_has_controlled_item(uuid,uuid)', 'EXECUTE') then
    raise exception 'OQ-276b: anon can execute patient_prescription_has_controlled_item';
  end if;
  if not has_function_privilege('authenticated', 'public.patient_prescription_has_controlled_item(uuid,uuid)', 'EXECUTE') then
    raise exception 'OQ-276b: authenticated cannot execute patient_prescription_has_controlled_item';
  end if;
  if not has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.desk_verify_prescription(text,text,text)', 'EXECUTE') then
    raise exception 'OQ-276b: a QR view lost its grant';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.proname <> 'is_controlled_medicine' and p.prosrc ~* '\ytramadol\y') then
    raise exception 'OQ-276b: a second copy of the controlled list appeared';
  end if;
end $$;
