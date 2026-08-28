-- Tarragon Health — clinician-raised medication safety alert (13.9 generator gap)
--
-- lib/rules/drug-safety.ts (assessMedicationSafety) is a mature, well-tested
-- advisory engine — interactions, duplicate therapy, renal dosing, allergy
-- cross-reactivity — already surfaced in the clinician's medication-safety
-- panel and at prescribe time. What it has never had is a way to PERSIST a
-- finding as a real clinical task: alert_rules' own governance record for
-- both `medication_safety` and `potential_interaction` (20260828013011)
-- states in its evidence_basis field "no automated interaction-detection
-- engine exists yet; clinician-raised only, taxonomy reserved for when one
-- is built" — and the generator migration that followed it explicitly left
-- both unbuilt for the same reason. Porting drug-safety.ts's regex/INN-stem
-- drug classification into PL/pgSQL to auto-fire on every insert would
-- duplicate a mature TypeScript engine in a second language and risk the two
-- drifting apart — the safer, additive move is a client-callable action a
-- clinician takes deliberately after reading a finding the existing engine
-- already surfaced, matching 13.9's own instruction that a safety check
-- "should support clinician decision-making, not blindly block every
-- prescription": persisting a flagged concern is decision support; auto-
-- generating one on every keystroke would not be.
--
-- SECURITY DEFINER wrapper (public, not private — private-schema functions
-- are never exposed over PostgREST; public.sign_alert_rules is the direct
-- precedent for a client-callable governed action living in public): org
-- staff only, restricted to exactly the two type_codes this was reserved
-- for, medication ownership checked server-side so a client can't attribute
-- a concern to a medication that isn't the named patient's.

create or replace function public.raise_medication_safety_alert(
  p_patient_id    uuid,
  p_medication_id uuid,
  p_type_code     public.alert_type_code,
  p_severity      text,
  p_message       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_drug     text;
  v_level    public.alert_level;
  v_category public.alert_category;
begin
  if p_type_code not in ('medication_safety', 'potential_interaction') then
    raise exception 'raise_medication_safety_alert only supports medication_safety or potential_interaction, got %', p_type_code;
  end if;
  if p_severity not in ('contraindicated', 'caution') then
    raise exception 'p_severity must be contraindicated or caution, got %', p_severity;
  end if;
  if p_message is null or char_length(trim(p_message)) = 0 then
    raise exception 'p_message is required';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient has no organisation on file';
  end if;

  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: only org clinical staff may raise a medication safety alert' using errcode = '42501';
  end if;

  select drug_name into v_drug
  from public.medications
  where id = p_medication_id and patient_id = p_patient_id;

  if v_drug is null then
    raise exception 'medication does not belong to this patient';
  end if;

  v_category := case p_type_code when 'medication_safety' then 'clinical' else 'medication' end;
  v_level := case p_severity when 'contraindicated' then 'urgent_escalation' else 'clinician_review' end;

  return private.raise_clinician_alert(
    v_org, p_patient_id, v_level,
    'Medication safety concern flagged by clinician',
    format('%s (%s): %s', v_drug, p_severity, trim(p_message)),
    v_category, p_type_code
  );
end;
$$;

comment on function public.raise_medication_safety_alert(uuid, uuid, public.alert_type_code, text, text) is
  'Client-callable action letting org clinical staff persist a drug-safety finding (from lib/rules/drug-safety.ts, computed client/server-side) as a real clinician_alerts row. Restricted to medication_safety/potential_interaction — the two type_codes alert_rules'' own governance record (20260828013011) flagged as "clinician-raised only, no mechanism yet". Advisory-raise only: never blocks or reverses a prescription.';

revoke all on function public.raise_medication_safety_alert(uuid, uuid, public.alert_type_code, text, text) from public, anon;
grant execute on function public.raise_medication_safety_alert(uuid, uuid, public.alert_type_code, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'raise_medication_safety_alert' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'public.raise_medication_safety_alert was not created';
  end if;
  if has_function_privilege('anon', 'public.raise_medication_safety_alert(uuid, uuid, public.alert_type_code, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.raise_medication_safety_alert';
  end if;
  if not has_function_privilege('authenticated', 'public.raise_medication_safety_alert(uuid, uuid, public.alert_type_code, text, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.raise_medication_safety_alert';
  end if;
  raise notice 'PASS: public.raise_medication_safety_alert installed, anon denied, authenticated granted';
end $$;
