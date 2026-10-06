-- S24: care plan changes, signed prescribing, titration protocols, referral consent (INV-02, INV-10, INV-12, INV-16; OQ-11 option a).
-- Design: docs/design/S24.md. Research: docs/research/S24.md.
--
-- Counted first (live, 2026-10-06): prescriptions 0, care_plans 0, specialist_referrals 0, medications 4 (all clinician-source, none edited by this
-- migration), no care_plan_changes, no protocols table. No conversion step is needed anywhere.
--
--  1. protocols: versioned titration step tables, draft until the CMO approves, immutable once approved (the triage_rule_sets pattern).
--  2. care_change_config: PROPOSED values (CMO), mirrored in packages/shared as `care_change.behaviour`.
--  3. prescriptions grows (amendment, supersession, safety_checks, source_change_id); prescribe_medication and amend_medication now write a
--     SIGNED prescription and project it into medications; a trigger refuses any user-session clinician medicine row without one.
--  4. private.check_prescription_safety: controlled medicine (hard stop), allergy match, allergies unrecorded, duplicate active drug.
--  5. care_plans: reading_schedule, and a guard so targets and schedule change only through an applied, signed change.
--  6. care_plan_changes: the signature-gated change record. Closed to the API; every transition is a function.
--  7. Referrals: recorded patient consent before a clinician-initiated referral leaves draft; a chase date.
--  8. Templates, events, sweep.

-- ---------------------------------------------------------------------------
-- 1. protocols
-- ---------------------------------------------------------------------------
create table public.protocols (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  version     integer not null check (version >= 1),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  definition  jsonb not null check (jsonb_typeof(definition) = 'object'),
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  unique (code, version),
  check (definition -> 'code' = to_jsonb(code) and definition -> 'version' = to_jsonb(version)),
  check (status = 'draft' or (approved_by is not null and approved_at is not null))
);
create unique index protocols_one_approved on public.protocols (code) where status = 'approved';
comment on table public.protocols is
  'S24 (spec 4.5, 6.3): versioned pathway protocols whose definition holds the titration step table. Draft until the CMO approves; approved rows are immutable (INV-16). '
  'No row is seeded: the step table content is the CMO''s. The placeholder used by tests lives in packages/clinical fixtures and is never inserted here.';

create or replace function private.protocols_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'an approved or retired protocol cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if old.status = 'approved' and new.status = 'retired'
       and (new.id, new.code, new.version, new.definition, new.approved_by, new.approved_at, new.created_at)
           is not distinct from (old.id, old.code, old.version, old.definition, old.approved_by, old.approved_at, old.created_at) then
      return new;
    end if;
    raise exception 'an approved or retired protocol is immutable (only approved -> retired is allowed)' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.protocols_guard() from public, anon, authenticated;
create trigger protocols_guard before update or delete on public.protocols
  for each row execute function private.protocols_guard();

alter table public.protocols enable row level security;
create policy protocols_review_read on public.protocols for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.protocols from public, anon, authenticated;
grant select on public.protocols to authenticated;

create or replace function public.get_approved_protocol(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'code', code, 'version', version, 'definition', definition)
  from public.protocols where code = p_code and status = 'approved';
$$;
revoke all on function public.get_approved_protocol(text) from public, anon;
grant execute on function public.get_approved_protocol(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Config (PROPOSED, owner CMO; mirrored as `care_change.behaviour`, a test fails on drift)
-- ---------------------------------------------------------------------------
create table public.care_change_config (
  version        integer primary key,
  is_active      boolean not null default false,
  effective_from date not null default current_date,
  rules          jsonb not null,
  note           text,
  created_at     timestamptz not null default now()
);
create unique index care_change_config_one_active on public.care_change_config (is_active) where is_active;
alter table public.care_change_config enable row level security;
revoke all on public.care_change_config from public, anon, authenticated;

-- care-change-config-begin
insert into public.care_change_config (version, is_active, effective_from, rules, note) values
  (1, true, '2026-10-06',
   $json${"confirmWindowDays":7,"referralChaseDays":7,"minPatientSummaryChars":10,"minRationaleChars":10}$json$::jsonb,
   'S24 PROPOSED. A signed change waits 7 days for the patient before it lapses and the signer is told; a referral is chased after 7 days.');
-- care-change-config-end

create or replace function private.care_change_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.care_change_config where is_active; $$;
revoke all on function private.care_change_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prescriptions grow; signed prescribing
-- ---------------------------------------------------------------------------
alter table public.prescriptions
  add column if not exists amendment_reason text,
  add column if not exists supersedes_prescription_id uuid references public.prescriptions (id) on delete restrict,
  add column if not exists safety_checks jsonb,
  add column if not exists source_change_id uuid,
  add column if not exists is_test boolean not null default false;
comment on column public.prescriptions.safety_checks is 'S24: what the signing checks found and any override reason the signer gave (INV-10). Null only on rows from before S24.';
comment on column public.prescriptions.source_change_id is 'S24: the signed care_plan_changes row this prescription was issued from, when it came from a titration or plan change.';

-- ---------------------------------------------------------------------------
-- 4. Safety checks at signing
-- ---------------------------------------------------------------------------
create or replace function private.prescription_safety_findings(p_patient uuid, p_drug text, p_replacing uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_f jsonb := '[]'::jsonb;
  v_name text := lower(btrim(coalesce(p_drug, '')));
  r record;
begin
  -- Mirrors apps/web/src/lib/rules/controlled-substances.ts. TarragonHealth does not prescribe these (the prescription PDF says so);
  -- until now nothing enforced it. A hard stop: no override.
  if v_name ~* '\m(morphine|pethidine|meperidine|fentanyl|oxycodone|hydrocodone|methadone|diamorphine|codeine|tramadol|dihydrocodeine|diazepam|lorazepam|alprazolam|midazolam|clonazepam|chlordiazepoxide|methylphenidate|amphetamine|dexamfetamine|dextroamphetamine|lisdexamfetamine|phenobarbital|phenobarbitone|ketamine)\M' then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'controlled_medicine', 'blocking', true));
  end if;
  for r in select allergen from public.patient_allergies
            where patient_id = p_patient and length(btrim(allergen)) >= 3 and strpos(v_name, lower(btrim(allergen))) > 0 loop
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergy_match', 'allergen', r.allergen));
  end loop;
  if not exists (select 1 from public.patient_allergies where patient_id = p_patient) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergies_unrecorded'));
  end if;
  if exists (select 1 from public.medications m
              where m.patient_id = p_patient and m.is_active and m.superseded_at is null
                and lower(btrim(m.drug_name)) = v_name and m.id is distinct from p_replacing) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'duplicate_active'));
  end if;
  return v_f;
end;
$$;
revoke all on function private.prescription_safety_findings(uuid, text, uuid) from public, anon, authenticated;

-- Enforcement. Returns the record stored on the prescription. A blocking finding refuses outright. Any other finding needs the signer's
-- stated reason; "allergies unrecorded" is cleared by confirming the allergy list was checked. Never fails open.
create or replace function private.check_prescription_safety(
  p_patient uuid, p_drug text, p_replacing uuid, p_allergies_confirmed boolean, p_override text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_findings jsonb := private.prescription_safety_findings(p_patient, p_drug, p_replacing);
  v_open jsonb;
begin
  if exists (select 1 from jsonb_array_elements(v_findings) e where (e ->> 'blocking')::boolean is true) then
    raise exception 'TarragonHealth does not prescribe controlled medicines, so this cannot be signed here.'
      using errcode = 'P0001', detail = 'SAFETY_BLOCKED', hint = v_findings::text;
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_open
    from jsonb_array_elements(v_findings) e
   where not (e ->> 'code' = 'allergies_unrecorded' and coalesce(p_allergies_confirmed, false));
  if jsonb_array_length(v_open) > 0 and coalesce(btrim(p_override), '') = '' then
    raise exception 'A safety check needs your attention before this can be signed.'
      using errcode = 'P0001', detail = 'SAFETY_FINDINGS', hint = v_open::text;
  end if;
  return jsonb_build_object('findings', v_findings, 'allergies_confirmed', coalesce(p_allergies_confirmed, false),
                            'override_reason', nullif(btrim(coalesce(p_override, '')), ''), 'checked_at', now());
end;
$$;
revoke all on function private.check_prescription_safety(uuid, text, uuid, boolean, text) from public, anon, authenticated;

-- Writes a prescription as a draft and signs it as the acting prescriber (the stamp trigger sets signed_by and signed_at from auth.uid()).
create or replace function private.issue_signed_prescription(
  p_org uuid, p_patient uuid, p_item jsonb, p_checks jsonb, p_supersedes uuid, p_reason text, p_change uuid, p_is_test boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, safety_checks, supersedes_prescription_id, amendment_reason, source_change_id, is_test)
  values (p_org, p_patient, jsonb_build_array(p_item), 'draft', p_checks, p_supersedes, p_reason, p_change, p_is_test)
  returning id into v_id;
  update public.prescriptions set state = 'signed' where id = v_id;
  return v_id;
end;
$$;
revoke all on function private.issue_signed_prescription(uuid, uuid, jsonb, jsonb, uuid, text, uuid, boolean) from public, anon, authenticated;

drop function if exists public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text);
drop function if exists public.amend_medication(uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date);

create or replace function public.prescribe_medication(
  p_patient uuid, p_drug_name text,
  p_dose text default null, p_frequency text default null, p_refill_date date default null,
  p_schedule_times jsonb default null, p_care_plan_id uuid default null, p_route text default null,
  p_duration_days integer default null, p_quantity text default null, p_repeats_allowed integer default null,
  p_indication text default null, p_instructions text default null,
  p_allergies_confirmed boolean default false, p_safety_override_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_rx uuid;
  v_checks jsonb;
  v_item jsonb;
begin
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drug_name), '') = '' then
    raise exception 'A drug name is required' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then
    raise exception 'This patient has no organisation on file' using errcode = '22023';
  end if;
  if not private.is_org_staff(v_org) or not private.has_prescribing_authority(v_org)
     or not private.clinician_has_patient_access(p_patient) then
    raise exception 'Not authorised to prescribe for this patient' using errcode = '42501';
  end if;
  if p_care_plan_id is not null and not exists (select 1 from public.care_plans where id = p_care_plan_id and patient_id = p_patient) then
    raise exception 'That care plan does not belong to this patient' using errcode = '22023';
  end if;
  if coalesce(btrim(p_quantity), '') = '' then
    raise exception 'A quantity is required (for example 30 tablets): the pharmacy needs to know how much to dispense' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'A duration in days is required: how many days this supply covers' using errcode = '22023';
  end if;

  v_checks := private.check_prescription_safety(p_patient, p_drug_name, null, p_allergies_confirmed, p_safety_override_reason);
  v_item := jsonb_strip_nulls(jsonb_build_object(
    'drug_name', btrim(p_drug_name), 'dose', p_dose, 'frequency', p_frequency, 'route', p_route, 'duration_days', p_duration_days,
    'quantity', btrim(p_quantity), 'repeats_allowed', coalesce(p_repeats_allowed, 0), 'indication', p_indication, 'instructions', p_instructions));
  v_rx := private.issue_signed_prescription(v_org, p_patient, v_item, v_checks, null, null, null,
                                            coalesce((select is_test from public.profiles where id = p_patient), false));

  insert into public.medications (
    organisation_id, patient_id, source, drug_name, dose, frequency, refill_date, schedule_times, care_plan_id,
    route, duration_days, quantity, repeats_allowed, indication, instructions, prescription_id)
  values (
    v_org, p_patient, 'clinician', btrim(p_drug_name), p_dose, p_frequency, p_refill_date, coalesce(p_schedule_times, '[]'::jsonb), p_care_plan_id,
    p_route, p_duration_days, btrim(p_quantity), coalesce(p_repeats_allowed, 0), p_indication, p_instructions, v_rx)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.amend_medication(
  p_medication_id uuid, p_amendment_reason text,
  p_drug_name text default null, p_dose text default null, p_frequency text default null, p_route text default null,
  p_duration_days integer default null, p_quantity text default null, p_repeats_allowed integer default null,
  p_indication text default null, p_instructions text default null, p_schedule_times jsonb default null, p_refill_date date default null,
  p_allergies_confirmed boolean default false, p_safety_override_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.medications%rowtype;
  v_new_id uuid;
  v_rx uuid;
  v_checks jsonb;
  v_drug text;
  v_dose text; v_freq text; v_route text; v_dur integer; v_qty text; v_rep integer; v_ind text; v_ins text;
begin
  if coalesce(btrim(p_amendment_reason), '') = '' then
    raise exception 'A reason for the amendment is required' using errcode = '22023';
  end if;

  select * into v_old from public.medications where id = p_medication_id;
  if v_old.id is not null and (select auth.uid()) = v_old.patient_id then
    raise exception 'A prescription can only be amended by clinical staff, not the patient' using errcode = '42501';
  end if;
  if v_old.id is null
     or (select auth.uid()) is null
     or not private.is_org_staff(v_old.organisation_id)
     or not private.has_prescribing_authority(v_old.organisation_id)
     or not private.clinician_has_patient_access(v_old.patient_id) then
    raise exception 'Not authorised to amend this prescription' using errcode = '42501';
  end if;
  if v_old.source <> 'clinician' then
    raise exception 'Only a clinician-issued prescription can be amended' using errcode = '42501';
  end if;
  if v_old.superseded_at is not null then
    raise exception 'This prescription has already been amended: amend its current version instead' using errcode = '22023';
  end if;

  v_drug := coalesce(p_drug_name, v_old.drug_name);
  v_dose := coalesce(p_dose, v_old.dose);
  v_freq := coalesce(p_frequency, v_old.frequency);
  v_route := coalesce(p_route, v_old.route);
  v_dur := coalesce(p_duration_days, v_old.duration_days);
  v_qty := coalesce(nullif(btrim(p_quantity), ''), nullif(btrim(v_old.quantity), ''));
  v_rep := coalesce(p_repeats_allowed, v_old.repeats_allowed);
  v_ind := coalesce(p_indication, v_old.indication);
  v_ins := coalesce(p_instructions, v_old.instructions);
  if v_qty is null then
    raise exception 'A quantity is required (for example 30 tablets): the pharmacy needs to know how much to dispense' using errcode = '22023';
  end if;
  if v_dur is null or v_dur <= 0 then
    raise exception 'A duration in days is required: how many days this supply covers' using errcode = '22023';
  end if;

  v_checks := private.check_prescription_safety(v_old.patient_id, v_drug, v_old.id, p_allergies_confirmed, p_safety_override_reason);
  v_rx := private.issue_signed_prescription(
    v_old.organisation_id, v_old.patient_id,
    jsonb_strip_nulls(jsonb_build_object('drug_name', v_drug, 'dose', v_dose, 'frequency', v_freq, 'route', v_route, 'duration_days', v_dur,
                                         'quantity', v_qty, 'repeats_allowed', v_rep, 'indication', v_ind, 'instructions', v_ins)),
    v_checks, v_old.prescription_id, btrim(p_amendment_reason), null,
    coalesce((select is_test from public.profiles where id = v_old.patient_id), false));

  update public.medications set is_active = false, superseded_at = now() where id = p_medication_id;

  insert into public.medications (
    organisation_id, patient_id, care_plan_id, drug_name, dose, frequency,
    refill_date, schedule_times, source, route, duration_days, quantity,
    repeats_allowed, indication, instructions,
    version, previous_version_id, amendment_reason, prescription_id
  ) values (
    v_old.organisation_id, v_old.patient_id, v_old.care_plan_id,
    v_drug, v_dose, v_freq,
    coalesce(p_refill_date, v_old.refill_date),
    coalesce(p_schedule_times, v_old.schedule_times),
    'clinician', v_route, v_dur, v_qty, v_rep, v_ind, v_ins,
    v_old.version + 1, v_old.id, btrim(p_amendment_reason), v_rx
  )
  returning id into v_new_id;
  return v_new_id;
end;
$$;

revoke all on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text, boolean, text) from public, anon;
revoke all on function public.amend_medication(uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date, boolean, text) from public, anon;
grant execute on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text, boolean, text) to authenticated;
grant execute on function public.amend_medication(uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date, boolean, text) to authenticated;

-- INV-02 on the projection: no user session can write a clinician-issued medicine, or change its content, without a signed prescription.
-- Owner, migration and seed sessions are not user sessions. A patient cannot make a row clinician-source to dodge this.
create or replace function private.enforce_medication_signed_prescription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- An API session (PostgREST sets the role to authenticated). Owner, migration, seed and service-role sessions are trusted code, not a user.
  if (select auth.uid()) is null or coalesce(current_setting('role', true), '') <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source = 'clinician' and not exists (
         select 1 from public.prescriptions p
          where p.id = new.prescription_id and p.patient_id = new.patient_id
            and p.signed_by is not null and p.signed_at is not null and p.state in ('signed', 'sent', 'dispensed')) then
      raise exception 'A medicine written by your care team must be signed before it is saved' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.source = 'clinician' and old.source is distinct from 'clinician' then
    raise exception 'A medicine cannot be turned into a care-team prescription without a signature' using errcode = '42501';
  end if;
  if old.source = 'clinician' and (
       new.drug_name is distinct from old.drug_name or new.dose is distinct from old.dose or new.frequency is distinct from old.frequency
    or new.route is distinct from old.route or new.duration_days is distinct from old.duration_days or new.quantity is distinct from old.quantity
    or new.repeats_allowed is distinct from old.repeats_allowed or new.indication is distinct from old.indication
    or new.instructions is distinct from old.instructions or new.prescription_id is distinct from old.prescription_id) then
    raise exception 'A signed prescription cannot be edited: a change needs a new, newly signed prescription' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_medication_signed_prescription() from public, anon, authenticated;
drop trigger if exists medications_b_require_signed_prescription on public.medications;
create trigger medications_b_require_signed_prescription
  before insert or update on public.medications
  for each row execute function private.enforce_medication_signed_prescription();

-- ---------------------------------------------------------------------------
-- 5. care_plans: reading schedule, and targets change only through an applied signed change
-- ---------------------------------------------------------------------------
alter table public.care_plans add column if not exists reading_schedule jsonb not null default '{}'::jsonb;

create or replace function private.enforce_care_plan_signed_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_chg uuid := nullif(current_setting('tarragon.change_apply', true), '')::uuid;
begin
  if (select auth.uid()) is null or coalesce(current_setting('role', true), '') <> 'authenticated' then
    return new;
  end if;
  if new.target_ranges is distinct from old.target_ranges or new.reading_schedule is distinct from old.reading_schedule then
    if v_chg is null or not exists (
         select 1 from public.care_plan_changes c
          where c.id = v_chg and c.care_plan_id = new.id and c.state = 'signed' and c.signed_by is not null and c.signed_at is not null) then
      raise exception 'A care plan''s targets and reading schedule change only through a signed change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_care_plan_signed_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. care_plan_changes
-- ---------------------------------------------------------------------------
create table public.care_plan_changes (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete restrict,
  care_plan_id           uuid references public.care_plans (id) on delete restrict,
  kind                   text not null check (kind in ('medication', 'target', 'reading_schedule')),
  proposed_by            text not null check (proposed_by in ('engine', 'clinician')),
  proposed_by_user       uuid references public.profiles (id) on delete restrict,
  proposal               jsonb not null check (jsonb_typeof(proposal) = 'object'),
  before                 jsonb,
  rationale              text not null check (length(btrim(rationale)) > 0),
  patient_summary        text,
  protocol_id            uuid references public.protocols (id) on delete restrict,
  protocol_version       integer,
  engine_inputs          jsonb,
  state                  text not null default 'proposed' check (state in ('proposed', 'signed', 'rejected', 'confirmed', 'declined', 'expired')),
  signed_by              uuid references public.profiles (id) on delete restrict,
  signed_at              timestamptz,
  safety_checks          jsonb,
  expires_at             timestamptz,
  rejected_by            uuid references public.profiles (id) on delete restrict,
  rejected_at            timestamptz,
  rejection_reason       text,
  patient_confirmed_at   timestamptz,
  patient_declined_at    timestamptz,
  decline_reason         text,
  expired_at             timestamptz,
  applied_at             timestamptz,
  applied_prescription_id uuid references public.prescriptions (id) on delete restrict,
  is_test                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  -- INV-02: nothing past "proposed" or "rejected" exists without a clinician's signature.
  constraint care_plan_changes_signed_by_signed_at check (
    state in ('proposed', 'rejected') or (signed_by is not null and signed_at is not null)),
  constraint care_plan_changes_unsigned_has_no_signature check (
    state not in ('proposed', 'rejected') or (signed_by is null and signed_at is null)),
  constraint care_plan_changes_signed_needs_summary check (
    state in ('proposed', 'rejected') or length(btrim(coalesce(patient_summary, ''))) > 0),
  constraint care_plan_changes_rejected_needs_reason check (
    state <> 'rejected' or (rejected_by is not null and rejected_at is not null and length(btrim(coalesce(rejection_reason, ''))) > 0)),
  constraint care_plan_changes_confirmed_is_applied check (
    state <> 'confirmed' or (patient_confirmed_at is not null and applied_at is not null)),
  constraint care_plan_changes_declined_stamped check (state <> 'declined' or patient_declined_at is not null),
  constraint care_plan_changes_engine_has_provenance check (
    proposed_by <> 'engine' or (protocol_id is not null and protocol_version is not null and engine_inputs is not null)),
  constraint care_plan_changes_proposal_shape check (
    (kind = 'medication' and proposal ->> 'action' in ('start', 'change', 'stop'))
    or (kind = 'target' and jsonb_typeof(proposal -> 'target_ranges') = 'object')
    or (kind = 'reading_schedule' and jsonb_typeof(proposal -> 'reading_schedule') = 'object'))
);
create index care_plan_changes_patient_idx on public.care_plan_changes (patient_id, created_at desc);
create index care_plan_changes_open_idx on public.care_plan_changes (state, expires_at) where state in ('proposed', 'signed');

comment on table public.care_plan_changes is
  'S24 (spec 4.5, INV-02): a proposed change to a medicine, a care plan target or a reading schedule. It exists as a draft until a prescriber signs; the patient sees it only after '
  'signing and applies it by confirming; nothing is applied before both. The table is closed to the API: every transition is a SECURITY DEFINER function, and a trigger allows only legal moves.';

-- Legal moves only, signature stamped from the acting session, signed content frozen. The only writers are the functions below.
create or replace function private.care_plan_changes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'DELETE' then
    raise exception 'a care plan change is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'proposed' then
      raise exception 'a care plan change is created as a proposal' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'proposed' and new.state in ('signed', 'rejected'))
    or (old.state = 'signed' and new.state in ('confirmed', 'declined', 'expired'))) then
    raise exception 'invalid care plan change state move % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.state <> 'proposed' and (
       new.proposal is distinct from old.proposal or new.kind is distinct from old.kind or new.patient_id is distinct from old.patient_id
    or new.before is distinct from old.before or new.rationale is distinct from old.rationale
    or new.protocol_id is distinct from old.protocol_id or new.engine_inputs is distinct from old.engine_inputs
    or new.proposed_by is distinct from old.proposed_by or new.patient_summary is distinct from old.patient_summary
    or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at) then
    raise exception 'a signed or closed care plan change cannot be altered' using errcode = '42501';
  end if;
  -- Signing is the prescriber's own act, stamped as themselves. Anyone else leaves the columns empty and the CHECK refuses the row.
  if new.state = 'signed' and old.state = 'proposed' then
    if v_uid is not null then
      if not private.has_prescribing_authority(new.organisation_id) then
        raise exception 'only a prescriber can sign a care plan change' using errcode = '42501';
      end if;
      new.signed_by := v_uid;
      new.signed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.care_plan_changes_guard() from public, anon, authenticated;
create trigger care_plan_changes_guard before insert or update or delete on public.care_plan_changes
  for each row execute function private.care_plan_changes_guard();

drop trigger if exists care_plans_a_signed_change_only on public.care_plans;
create trigger care_plans_a_signed_change_only before update on public.care_plans
  for each row execute function private.enforce_care_plan_signed_change();

alter table public.care_plan_changes enable row level security;
revoke all on public.care_plan_changes from public, anon, authenticated;
-- No policy and no grant: nobody reads or writes this table directly. Staff use list_care_plan_changes (tied, audited); the patient uses my_care_plan_changes.

-- Shared helpers ------------------------------------------------------------
create or replace function private.s24_audit(p_action text, p_org uuid, p_patient uuid, p_entity uuid, p_event jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (p_org, (select auth.uid()), p_action, 'care_plan_change', p_entity, coalesce(p_event, '{}'::jsonb), p_patient);
$$;
revoke all on function private.s24_audit(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function private.s24_can_act(p_org uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and not exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient')
     and private.is_org_staff(p_org) and private.has_prescribing_authority(p_org)
     and private.clinician_has_patient_access(p_patient);
$$;
revoke all on function private.s24_can_act(uuid, uuid) from public, anon, authenticated;

-- 6a. propose ---------------------------------------------------------------
create or replace function public.propose_care_plan_change(
  p_patient uuid, p_kind text, p_proposal jsonb, p_rationale text,
  p_care_plan_id uuid default null, p_proposed_by text default 'clinician',
  p_protocol_id uuid default null, p_engine_inputs jsonb default null, p_patient_summary text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_test boolean;
  v_before jsonb;
  v_med public.medications%rowtype;
  v_proto public.protocols%rowtype;
  v_id uuid;
  v_min integer := coalesce((private.care_change_setting('minRationaleChars') #>> '{}')::integer, 10);
begin
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = p_patient and role = 'patient';
  if v_org is null or not private.s24_can_act(v_org, p_patient) then
    raise exception 'Not authorised to propose a change for this patient' using errcode = '42501';
  end if;
  if p_kind not in ('medication', 'target', 'reading_schedule') then
    raise exception 'unknown change kind' using errcode = '22023';
  end if;
  if p_proposed_by not in ('engine', 'clinician') then
    raise exception 'unknown proposer' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_rationale, ''))) < v_min then
    raise exception 'A rationale is required: say why this change is proposed' using errcode = '22023';
  end if;
  if p_care_plan_id is not null and not exists (select 1 from public.care_plans where id = p_care_plan_id and patient_id = p_patient) then
    raise exception 'That care plan does not belong to this patient' using errcode = '22023';
  end if;

  if p_kind = 'medication' then
    if p_proposal ->> 'action' not in ('start', 'change', 'stop') then
      raise exception 'a medicine change is start, change or stop' using errcode = '22023';
    end if;
    if p_proposal ->> 'action' in ('start', 'change') then
      if coalesce(btrim(p_proposal #>> '{item,drug_name}'), '') = '' or coalesce(btrim(p_proposal #>> '{item,quantity}'), '') = ''
         or coalesce((p_proposal #>> '{item,duration_days}')::integer, 0) <= 0 then
        raise exception 'A medicine needs a name, a quantity and a duration in days' using errcode = '22023';
      end if;
    end if;
    if p_proposal ->> 'action' in ('change', 'stop') then
      select * into v_med from public.medications where id = (p_proposal ->> 'medication_id')::uuid and patient_id = p_patient;
      if v_med.id is null or v_med.source <> 'clinician' or not v_med.is_active or v_med.superseded_at is not null then
        raise exception 'That is not a current prescription for this patient' using errcode = '22023';
      end if;
      v_before := jsonb_strip_nulls(jsonb_build_object('medication_id', v_med.id, 'drug_name', v_med.drug_name, 'dose', v_med.dose,
        'frequency', v_med.frequency, 'route', v_med.route, 'duration_days', v_med.duration_days, 'quantity', v_med.quantity));
    end if;
  elsif p_kind = 'target' then
    if p_care_plan_id is null then raise exception 'A target change needs a care plan' using errcode = '22023'; end if;
    select jsonb_build_object('target_ranges', target_ranges) into v_before from public.care_plans where id = p_care_plan_id;
  else
    if p_care_plan_id is null then raise exception 'A reading schedule change needs a care plan' using errcode = '22023'; end if;
    select jsonb_build_object('reading_schedule', reading_schedule) into v_before from public.care_plans where id = p_care_plan_id;
  end if;

  if p_proposed_by = 'engine' then
    select * into v_proto from public.protocols where id = p_protocol_id;
    -- Only a CMO-approved step table may drive a real patient's proposal; a draft works for test patients only (spec 6.3).
    if v_proto.id is null or p_engine_inputs is null or not (v_proto.status = 'approved' or (v_proto.status = 'draft' and v_test)) then
      raise exception 'An engine proposal needs an approved protocol and its inputs' using errcode = '22023';
    end if;
  end if;

  insert into public.care_plan_changes (organisation_id, patient_id, care_plan_id, kind, proposed_by, proposed_by_user, proposal, before, rationale,
                                       patient_summary, protocol_id, protocol_version, engine_inputs, is_test)
  values (v_org, p_patient, p_care_plan_id, p_kind, p_proposed_by, (select auth.uid()), p_proposal, v_before, btrim(p_rationale),
          nullif(btrim(coalesce(p_patient_summary, '')), ''), v_proto.id, v_proto.version, p_engine_inputs, v_test)
  returning id into v_id;

  perform private.s24_audit('care_plan_change.proposed', v_org, p_patient, v_id, jsonb_build_object('kind', p_kind, 'proposed_by', p_proposed_by));
  perform private.emit_domain_event('care_plan_change.proposed', v_org, jsonb_build_object('care_plan_change_id', v_id), 'care_plan_change.proposed:' || v_id,
                                    p_patient, 'care_plan_change', v_id);
  return v_id;
end;
$$;

-- 6b. sign -------------------------------------------------------------------
create or replace function public.sign_care_plan_change(
  p_change uuid, p_patient_summary text default null, p_allergies_confirmed boolean default false, p_safety_override_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.care_plan_changes%rowtype;
  v_checks jsonb;
  v_days integer := coalesce((private.care_change_setting('confirmWindowDays') #>> '{}')::integer, 7);
  v_min integer := coalesce((private.care_change_setting('minPatientSummaryChars') #>> '{}')::integer, 10);
  v_summary text;
begin
  select * into c from public.care_plan_changes where id = p_change for update;
  if c.id is null or not private.s24_can_act(c.organisation_id, c.patient_id) then
    raise exception 'Not authorised to sign this change' using errcode = '42501';
  end if;
  if c.state <> 'proposed' then
    raise exception 'Only a proposed change can be signed' using errcode = '22023';
  end if;
  v_summary := coalesce(nullif(btrim(coalesce(p_patient_summary, '')), ''), c.patient_summary);
  if length(coalesce(v_summary, '')) < v_min then
    raise exception 'Write what this change means for the patient in plain words before signing' using errcode = '22023';
  end if;
  if c.kind = 'medication' and c.proposal ->> 'action' in ('start', 'change') then
    v_checks := private.check_prescription_safety(c.patient_id, c.proposal #>> '{item,drug_name}',
                  nullif(c.proposal ->> 'medication_id', '')::uuid, p_allergies_confirmed, p_safety_override_reason);
  end if;
  update public.care_plan_changes
     set state = 'signed', patient_summary = v_summary, safety_checks = v_checks, expires_at = now() + make_interval(days => v_days)
   where id = p_change;   -- the guard stamps signed_by and signed_at from this session
  perform private.written_care_notify(c.patient_id, c.organisation_id, 'care_change_ready_patient', jsonb_build_object('care_plan_change_id', p_change));
  perform private.s24_audit('care_plan_change.signed', c.organisation_id, c.patient_id, p_change, jsonb_build_object('kind', c.kind));
  perform private.emit_domain_event('care_plan_change.signed', c.organisation_id, jsonb_build_object('care_plan_change_id', p_change), 'care_plan_change.signed:' || p_change,
                                    c.patient_id, 'care_plan_change', p_change);
end;
$$;

-- 6c. reject -----------------------------------------------------------------
create or replace function public.reject_care_plan_change(p_change uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.care_plan_changes%rowtype;
begin
  select * into c from public.care_plan_changes where id = p_change for update;
  if c.id is null or not private.s24_can_act(c.organisation_id, c.patient_id) then
    raise exception 'Not authorised to reject this change' using errcode = '42501';
  end if;
  if c.state <> 'proposed' then
    raise exception 'Only a proposed change can be rejected' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  update public.care_plan_changes set state = 'rejected', rejected_by = (select auth.uid()), rejected_at = now(), rejection_reason = btrim(p_reason) where id = p_change;
  perform private.s24_audit('care_plan_change.rejected', c.organisation_id, c.patient_id, p_change, jsonb_build_object('kind', c.kind));
end;
$$;

-- 6d. patient confirms and the change is applied ------------------------------
-- The patient's session confirms; the application of a medicine change must look exactly like the signer's own act to every existing medication trigger
-- (attribution, the clinician allow-list, the confirm-only and prescribing-safety rules), so for the duration of the apply the transaction-local session
-- claims are the signer's, and are put back before the function returns. This runs only after every check below, and only inside this function.
create or replace function public.confirm_care_plan_change(p_change uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.care_plan_changes%rowtype;
  v_uid uuid := (select auth.uid());
  v_old public.medications%rowtype;
  v_item jsonb;
  v_rx uuid;
  v_now_findings jsonb;
  v_known jsonb;
  v_new_codes text[];
  v_save_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_save_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
begin
  select * into c from public.care_plan_changes where id = p_change for update;
  if c.id is null or v_uid is null or c.patient_id <> v_uid then
    raise exception 'Not authorised to confirm this change' using errcode = '42501';
  end if;
  if c.state <> 'signed' then
    return jsonb_build_object('outcome', 'not_available');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
    perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change));
    return jsonb_build_object('outcome', 'expired');
  end if;

  -- Re-check at the moment of applying: something new since signing (a newly recorded allergy, a duplicate) sends it back to the care team.
  if c.kind = 'medication' and c.proposal ->> 'action' in ('start', 'change') then
    v_now_findings := private.prescription_safety_findings(c.patient_id, c.proposal #>> '{item,drug_name}', nullif(c.proposal ->> 'medication_id', '')::uuid);
    v_known := coalesce(c.safety_checks -> 'findings', '[]'::jsonb);
    select array_agg(distinct e ->> 'code') into v_new_codes
      from jsonb_array_elements(v_now_findings) e
     where not exists (select 1 from jsonb_array_elements(v_known) k where k ->> 'code' = e ->> 'code' and coalesce(k ->> 'allergen', '') = coalesce(e ->> 'allergen', ''))
       and e ->> 'code' <> 'allergies_unrecorded';
    if v_new_codes is not null then
      update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
      perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'recheck'));
      return jsonb_build_object('outcome', 'needs_review');
    end if;
  end if;

  v_claims := coalesce(nullif(v_save_claims, '')::jsonb, '{}'::jsonb) || jsonb_build_object('sub', c.signed_by::text);
  perform set_config('request.jwt.claim.sub', c.signed_by::text, true);
  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config('tarragon.change_apply', p_change::text, true);

  if not private.has_prescribing_authority(c.organisation_id) then
    -- The signer has since lost authority: fail closed.
    perform set_config('request.jwt.claim.sub', v_save_sub, true);
    perform set_config('request.jwt.claims', v_save_claims, true);
    perform set_config('tarragon.change_apply', '', true);
    update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
    perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'authority'));
    return jsonb_build_object('outcome', 'needs_review');
  end if;

  if c.kind = 'medication' then
    v_item := c.proposal -> 'item';
    if c.proposal ->> 'action' = 'stop' then
      update public.medications set is_active = false, stopped_at = now(),
             stopped_reason = coalesce(nullif(btrim(c.proposal ->> 'reason'), ''), c.rationale)
       where id = (c.proposal ->> 'medication_id')::uuid and patient_id = c.patient_id and is_active;
    else
      if c.proposal ->> 'action' = 'change' then
        select * into v_old from public.medications where id = (c.proposal ->> 'medication_id')::uuid and patient_id = c.patient_id for update;
        if v_old.id is null or not v_old.is_active or v_old.superseded_at is not null then
          perform set_config('request.jwt.claim.sub', v_save_sub, true);
          perform set_config('request.jwt.claims', v_save_claims, true);
          perform set_config('tarragon.change_apply', '', true);
          update public.care_plan_changes set state = 'expired', expired_at = now() where id = p_change;
          perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', p_change, 'reason', 'stale'));
          return jsonb_build_object('outcome', 'needs_review');
        end if;
      end if;
      v_rx := private.issue_signed_prescription(c.organisation_id, c.patient_id, v_item, c.safety_checks,
                                                v_old.prescription_id, case when c.proposal ->> 'action' = 'change' then c.rationale end, c.id, c.is_test);
      if c.proposal ->> 'action' = 'change' then
        update public.medications set is_active = false, superseded_at = now() where id = v_old.id;
        insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, dose, frequency, refill_date, schedule_times, source, route,
                                        duration_days, quantity, repeats_allowed, indication, instructions, version, previous_version_id, amendment_reason, prescription_id)
        values (v_old.organisation_id, v_old.patient_id, v_old.care_plan_id, v_item ->> 'drug_name', v_item ->> 'dose', v_item ->> 'frequency', v_old.refill_date,
                coalesce(v_item -> 'schedule_times', v_old.schedule_times), 'clinician', v_item ->> 'route', (v_item ->> 'duration_days')::integer,
                v_item ->> 'quantity', coalesce((v_item ->> 'repeats_allowed')::integer, v_old.repeats_allowed), v_item ->> 'indication', v_item ->> 'instructions',
                v_old.version + 1, v_old.id, c.rationale, v_rx);
      else
        insert into public.medications (organisation_id, patient_id, care_plan_id, drug_name, dose, frequency, schedule_times, source, route,
                                        duration_days, quantity, repeats_allowed, indication, instructions, prescription_id)
        values (c.organisation_id, c.patient_id, c.care_plan_id, v_item ->> 'drug_name', v_item ->> 'dose', v_item ->> 'frequency',
                coalesce(v_item -> 'schedule_times', '[]'::jsonb), 'clinician', v_item ->> 'route', (v_item ->> 'duration_days')::integer,
                v_item ->> 'quantity', coalesce((v_item ->> 'repeats_allowed')::integer, 0), v_item ->> 'indication', v_item ->> 'instructions', v_rx);
      end if;
    end if;
  elsif c.kind = 'target' then
    update public.care_plans set target_ranges = target_ranges || (c.proposal -> 'target_ranges') where id = c.care_plan_id;
  else
    update public.care_plans set reading_schedule = c.proposal -> 'reading_schedule' where id = c.care_plan_id;
  end if;

  perform set_config('request.jwt.claim.sub', v_save_sub, true);
  perform set_config('request.jwt.claims', v_save_claims, true);
  perform set_config('tarragon.change_apply', '', true);

  update public.care_plan_changes
     set state = 'confirmed', patient_confirmed_at = now(), applied_at = now(), applied_prescription_id = v_rx
   where id = p_change;
  perform private.s24_audit('care_plan_change.confirmed', c.organisation_id, c.patient_id, p_change, jsonb_build_object('kind', c.kind));
  perform private.emit_domain_event('care_plan_change.confirmed', c.organisation_id, jsonb_build_object('care_plan_change_id', p_change), 'care_plan_change.confirmed:' || p_change,
                                    c.patient_id, 'care_plan_change', p_change);
  return jsonb_build_object('outcome', 'applied');
end;
$$;

-- 6e. patient declines ---------------------------------------------------------
create or replace function public.decline_care_plan_change(p_change uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.care_plan_changes%rowtype;
begin
  select * into c from public.care_plan_changes where id = p_change for update;
  if c.id is null or (select auth.uid()) is null or c.patient_id <> (select auth.uid()) then
    raise exception 'Not authorised to answer this change' using errcode = '42501';
  end if;
  if c.state <> 'signed' then
    raise exception 'This change is no longer waiting for your answer' using errcode = '22023';
  end if;
  update public.care_plan_changes set state = 'declined', patient_declined_at = now(), decline_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_change;
  perform private.written_care_notify(c.signed_by, c.organisation_id, 'care_change_declined_staff', jsonb_build_object('care_plan_change_id', p_change));
  perform private.s24_audit('care_plan_change.declined', c.organisation_id, c.patient_id, p_change, jsonb_build_object('kind', c.kind));
  perform private.emit_domain_event('care_plan_change.declined', c.organisation_id, jsonb_build_object('care_plan_change_id', p_change), 'care_plan_change.declined:' || p_change,
                                    c.patient_id, 'care_plan_change', p_change);
end;
$$;

-- 6f. reads --------------------------------------------------------------------
-- The patient never sees a proposed or rejected row. The reason shown is the plain-language summary the signer wrote, never the clinical rationale.
create or replace function public.my_care_plan_changes()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'state', c.state, 'summary', c.patient_summary, 'proposal', c.proposal, 'before', c.before,
           'signed_at', c.signed_at, 'expires_at', c.expires_at, 'signed_by_name', d.full_name,
           'confirmed_at', c.patient_confirmed_at, 'declined_at', c.patient_declined_at) order by c.signed_at desc), '[]'::jsonb)
  from public.care_plan_changes c
  left join public.clinical_staff_directory d on d.profile_id = c.signed_by
  where c.patient_id = (select auth.uid()) and c.state in ('signed', 'confirmed', 'declined', 'expired');
$$;

create or replace function public.list_care_plan_changes(p_patient uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null or (select auth.uid()) is null or not private.is_org_staff(v_org)
     or not (private.has_prescribing_authority(v_org) or private.can_confirm_medication_refill(v_org))
     or not private.clinician_has_patient_access(p_patient) then
    raise exception 'Not authorised to see these changes' using errcode = '42501';
  end if;
  perform private.audit_chart_read(p_patient, array['care_plan_changes'], coalesce(nullif(btrim(p_reason), ''), 'care plan changes'), 'success');
  return (select coalesce(jsonb_agg(to_jsonb(c) - 'organisation_id' order by c.created_at desc), '[]'::jsonb)
            from public.care_plan_changes c where c.patient_id = p_patient);
end;
$$;

-- 6g. sweep: a signed change nobody answered lapses, and the signer is told ---------
create or replace function private.sweep_care_plan_changes()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select id, organisation_id, patient_id, signed_by from public.care_plan_changes where state = 'signed' and expires_at < now() for update skip locked loop
    begin
      update public.care_plan_changes set state = 'expired', expired_at = now() where id = r.id;
      perform private.written_care_notify(r.signed_by, r.organisation_id, 'care_change_expired_staff', jsonb_build_object('care_plan_change_id', r.id));
      perform private.emit_domain_event('care_plan_change.expired', r.organisation_id, jsonb_build_object('care_plan_change_id', r.id), 'care_plan_change.expired:' || r.id,
                                        r.patient_id, 'care_plan_change', r.id);
      n := n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, result)
      values (r.organisation_id, 'care_plan_change.sweep_failed', 'care_plan_change', r.id, jsonb_build_object('error', sqlerrm), 'error');
    end;
  end loop;
  return n;
end;
$$;
revoke all on function private.sweep_care_plan_changes() from public, anon, authenticated;
select cron.schedule('care-plan-change-sweep', '17 * * * *', $c$select private.sweep_care_plan_changes()$c$);

revoke all on function public.propose_care_plan_change(uuid, text, jsonb, text, uuid, text, uuid, jsonb, text) from public, anon;
revoke all on function public.sign_care_plan_change(uuid, text, boolean, text) from public, anon;
revoke all on function public.reject_care_plan_change(uuid, text) from public, anon;
revoke all on function public.confirm_care_plan_change(uuid) from public, anon;
revoke all on function public.decline_care_plan_change(uuid, text) from public, anon;
revoke all on function public.my_care_plan_changes() from public, anon;
revoke all on function public.list_care_plan_changes(uuid, text) from public, anon;
grant execute on function public.propose_care_plan_change(uuid, text, jsonb, text, uuid, text, uuid, jsonb, text) to authenticated;
grant execute on function public.sign_care_plan_change(uuid, text, boolean, text) to authenticated;
grant execute on function public.reject_care_plan_change(uuid, text) to authenticated;
grant execute on function public.confirm_care_plan_change(uuid) to authenticated;
grant execute on function public.decline_care_plan_change(uuid, text) to authenticated;
grant execute on function public.my_care_plan_changes() to authenticated;
grant execute on function public.list_care_plan_changes(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Referrals: patient consent before a clinician-initiated referral leaves draft, and a chase date
-- ---------------------------------------------------------------------------
alter table public.specialist_referrals
  add column if not exists patient_consent_at timestamptz,
  add column if not exists consent_note text,
  add column if not exists chase_due_at timestamptz,
  add column if not exists chase_notified_at timestamptz;
comment on column public.specialist_referrals.patient_consent_at is
  'S24: when the patient agreed to share the relevant part of their record with the receiving specialist. A clinician-initiated referral cannot leave draft without it (user sessions); one the patient creates themselves is stamped at creation because the patient asked for it.';

create or replace function private.enforce_referral_consent_and_chase()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_days integer := coalesce((private.care_change_setting('referralChaseDays') #>> '{}')::integer, 7);
begin
  -- The patient asking for it is consent. (`origin` defaults to patient_initiated even on a clinician's insert, so it cannot be the test.)
  if new.patient_consent_at is null and new.status <> 'draft' and (select auth.uid()) = new.patient_id then
    new.patient_consent_at := now();
  end if;
  if (select auth.uid()) is not null and coalesce(current_setting('role', true), '') = 'authenticated'
     and new.status not in ('draft', 'declined') and new.patient_consent_at is null
     and (tg_op = 'INSERT' or old.status = 'draft') then   -- consent is asked when a referral is created or leaves draft, not on every later update of an older row
    raise exception 'The patient must agree to share their record before this referral is sent' using errcode = '23514';
  end if;
  if new.status not in ('draft', 'declined', 'closed', 'completed') and new.chase_due_at is null then
    new.chase_due_at := now() + make_interval(days => v_days);
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_referral_consent_and_chase() from public, anon, authenticated;
drop trigger if exists specialist_referrals_consent_and_chase on public.specialist_referrals;
create trigger specialist_referrals_consent_and_chase before insert or update on public.specialist_referrals
  for each row execute function private.enforce_referral_consent_and_chase();

create or replace function private.sweep_referral_chasers()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select id, organisation_id, patient_id, referred_by from public.specialist_referrals
            where chase_due_at < now() and chase_notified_at is null and status not in ('draft', 'declined', 'closed', 'completed') for update skip locked loop
    begin
      update public.specialist_referrals set chase_notified_at = now() where id = r.id;
      perform private.notify_clinical_leads(r.organisation_id, coalesce((select is_test from public.profiles where id = r.patient_id), false),
        'A referral needs a follow-up', 'A referral is still open past its follow-up date. Open your referrals list.',
        jsonb_build_object('referral_id', r.id), null, false);
      n := n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, result)
      values (r.organisation_id, 'referral.chase_failed', 'specialist_referral', r.id, jsonb_build_object('error', sqlerrm), 'error');
    end;
  end loop;
  return n;
end;
$$;
revoke all on function private.sweep_referral_chasers() from public, anon, authenticated;
select cron.schedule('referral-chase-sweep', '23 * * * *', $c$select private.sweep_referral_chasers()$c$);


-- The two RPCs every clinician referral goes through take the consent as an argument. Same bodies as S05e otherwise.
drop function if exists public.create_specialist_referral(uuid, public.specialist_type, public.referral_source, public.referral_urgency, text, text, jsonb, boolean);
drop function if exists public.submit_draft_referral(uuid);

create or replace function public.create_specialist_referral(
  p_patient uuid, p_specialist_type public.specialist_type, p_referral_source public.referral_source, p_urgency public.referral_urgency,
  p_reason text, p_requested_service text, p_flags jsonb, p_as_draft boolean, p_patient_consent_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'appointments_care_plan') then
    raise exception 'not authorised for this patient' using errcode = '42501';
  end if;
  -- private.enforce_specialist_referral_create still requires a clinical-tier member and re-derives the organisation.
  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_source, urgency, referral_reason, requested_service, appropriateness_flags, status, patient_consent_at)
  values
    (v_org, p_patient, p_specialist_type, p_referral_source, p_urgency, nullif(btrim(p_reason), ''), nullif(btrim(p_requested_service), ''),
     coalesce(p_flags, '[]'::jsonb), case when p_as_draft then 'draft'::public.referral_status else 'pending'::public.referral_status end,
     case when p_patient_consent_at is null then null else least(p_patient_consent_at, now()) end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_draft_referral(p_referral uuid, p_patient_consent_at timestamptz default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals
     set status = 'pending', patient_consent_at = coalesce(patient_consent_at, case when p_patient_consent_at is null then null else least(p_patient_consent_at, now()) end)
   where id = p_referral;
end; $$;

revoke all on function public.create_specialist_referral(uuid, public.specialist_type, public.referral_source, public.referral_urgency, text, text, jsonb, boolean, timestamptz) from public, anon;
revoke all on function public.submit_draft_referral(uuid, timestamptz) from public, anon;
grant execute on function public.create_specialist_referral(uuid, public.specialist_type, public.referral_source, public.referral_urgency, text, text, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.submit_draft_referral(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Events and notification templates (neutral, INV-07; in-app and push, never SMS, INV-08)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('care_plan_change.proposed', 'A change to a medicine or care plan was proposed (draft, clinician only)', 'S24', false),
  ('care_plan_change.confirmed', 'The patient confirmed a signed change and it was applied', 'S24', false),
  ('care_plan_change.declined', 'The patient declined a signed change; nothing changed', 'S24', false),
  ('care_plan_change.expired', 'A signed change was not answered in time and lapsed', 'S24', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('care_plan_change.proposed', 1, array['care_plan_change_id']),
  ('care_plan_change.confirmed', 1, array['care_plan_change_id']),
  ('care_plan_change.declined', 1, array['care_plan_change_id']),
  ('care_plan_change.expired', 1, array['care_plan_change_id']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('care_change_ready_patient', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your care team has a change for you to look at.'),
  ('care_change_declined_staff', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'A patient answered a signed change; names nothing about the patient.'),
  ('care_change_expired_staff', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate', 'A signed change lapsed; names nothing about the patient.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('care_change_ready_patient', 'en', 'in_app', 'Your care team has a change for you', 'Open the app to read it. Nothing changes until you say yes.'),
  ('care_change_ready_patient', 'en', 'push', 'Your care team has a change for you', 'Open the app to read it.'),
  ('care_change_declined_staff', 'en', 'in_app', 'A patient answered a change', 'A patient did not accept a signed change. Nothing was changed. Open the patient list.'),
  ('care_change_expired_staff', 'en', 'in_app', 'A signed change lapsed', 'A signed change was not answered in time or needs a fresh look. Nothing was changed. Open the patient list.')
on conflict (template_key, locale, channel) do nothing;
