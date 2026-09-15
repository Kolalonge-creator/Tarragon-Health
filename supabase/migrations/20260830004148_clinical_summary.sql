-- Patient Health Record architecture review, round 3 — persistent clinical
-- summary artifact (spec §1.6/§81.2 "Clinical summary"). docs/PATIENT_
-- HEALTH_RECORD_ARCHITECTURE.md §1.6 found this genuinely MISSING: three
-- unrelated, narrower composites exist (dashboard stats, a read-only
-- pre-visit summary, a referral-letter-scoped snapshot) but "no dynamically-
-- generated '52yo male with HTN and diabetes...' narrative exists anywhere,
-- and no clinician can validate/pin one."
--
-- SCOPE: this builds the DB half — the persistent artifact, a deterministic
-- draft generator, and clinician validation. It deliberately does NOT call
-- an LLM. patient_result_explanations (the platform's existing AI-drafted-
-- text pattern) is an app-layer feature that calls the Claude API from a
-- server action — that's out of scope for a migration, same reason the
-- imaging/document tables in this pass don't build OCR/extraction. What
-- private.generate_clinical_summary_draft() below produces is a real,
-- useful, fully-deterministic composition from existing structured data
-- (active conditions, current medications, allergies, latest vitals) — a
-- sound default a later app-layer pass can swap for or layer an AI narrative
-- on top of, without changing this table's shape.
--
-- ONE ROW PER PATIENT, continuously updated (same shape as social_history,
-- 20260827195802) — a summary is inherently a "current state" artifact; its
-- edit history is the platform-wide record_corrections trail (§1.18), not a
-- separate versioning mechanism here.
--
-- REGENERATION IS DELIBERATELY NOT AUTOMATIC. public.refresh_clinical_
-- summary() is a callable RPC, not a trigger cascading off every condition/
-- medication change — that would be noisy (a summary would silently reset
-- validation on every unrelated edit) and risks clobbering a clinician's own
-- authored text. Invocation cadence (a "regenerate" button, a periodic cron)
-- is an app-layer decision, out of scope here — same as this review's habit
-- of building the mechanism and leaving invocation wiring as a flagged
-- follow-up (see e.g. the medication-receipt-confirmations migration's note
-- on pharmacy_orders.delivery_confirmed_at).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'clinical_summary_source') then
    create type public.clinical_summary_source as enum (
      'system_generated', 'clinician_authored', 'clinician_edited'
    );
  end if;
end $$;

create table public.clinical_summaries (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  narrative_text         text not null,
  source                 public.clinical_summary_source not null default 'system_generated',
  generated_at           timestamptz not null default now(),
  is_clinician_validated boolean not null default false,
  validated_by           uuid references public.profiles (id) on delete set null,
  validated_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (patient_id)
);

create index clinical_summaries_org_idx on public.clinical_summaries (organisation_id);

create trigger clinical_summaries_set_updated_at
  before update on public.clinical_summaries
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — patient reads own; org staff (or an explicit clinical-access
-- grantee) read, author, and edit. No patient write — a summary is a
-- clinician-facing composite of clinical facts the patient doesn't author
-- directly anywhere else in the record either.
-- ---------------------------------------------------------------------------
alter table public.clinical_summaries enable row level security;

create policy clinical_summaries_select on public.clinical_summaries
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy clinical_summaries_insert on public.clinical_summaries
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy clinical_summaries_update on public.clinical_summaries
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.clinical_summaries to authenticated;
revoke delete on public.clinical_summaries from authenticated;
revoke all on public.clinical_summaries from anon;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE: server-derive the validation stamp; a clinician
-- directly editing narrative_text (not via refresh_clinical_summary) is
-- marked clinician_edited unless they're authoring source themselves.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_clinical_summary_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- OLD is unassigned (not merely null) during INSERT in a combined
  -- BEFORE INSERT OR UPDATE trigger — referencing old.* unconditionally
  -- would raise "record old is not assigned yet" on every insert. Capture
  -- what we need from it only inside the tg_op = 'UPDATE' branch.
  v_was_validated boolean := false;
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.patient_id       := old.patient_id;
    new.created_at        := old.created_at;

    -- A text change coming from refresh_clinical_summary() looks IDENTICAL
    -- at the row level to a clinician's own direct UPDATE (both change
    -- narrative_text while source was already 'system_generated') — there
    -- is no way to tell them apart from the statement shape alone. So
    -- refresh_clinical_summary() sets this transaction-local GUC right
    -- before its write (same idiom as capture_record_correction()'s
    -- app.change_reason), and only its ABSENCE means a real hand-edit.
    -- Without this, every second-and-later auto-refresh would mislabel
    -- itself as clinician_edited and then (via the RPC's own ON CONFLICT
    -- ... WHERE source = 'system_generated' guard) silently stop updating
    -- after the first run.
    if new.narrative_text is distinct from old.narrative_text
       and old.source = 'system_generated'
       and coalesce(current_setting('app.clinical_summary_system_write', true), '') <> 'true' then
      new.source := 'clinician_edited';
    end if;

    v_was_validated := old.is_clinician_validated;
  end if;

  if new.is_clinician_validated and not v_was_validated then
    new.validated_by := coalesce((select auth.uid()), new.validated_by);
    new.validated_at := now();
  elsif not new.is_clinician_validated then
    new.validated_by := null;
    new.validated_at := null;
  else
    -- Was already validated (tg_op = 'UPDATE' only — see v_was_validated
    -- above) and stays validated: freeze the original stamp.
    new.validated_by := old.validated_by;
    new.validated_at := old.validated_at;
  end if;

  return new;
end;
$$;

create trigger clinical_summaries_write_guard
  before insert or update on public.clinical_summaries
  for each row execute function private.enforce_clinical_summary_write();

-- ---------------------------------------------------------------------------
-- Timeline: only a clinician validation is patient-facing-worthy — routine
-- (re)generation of a draft is not (see header).
-- ---------------------------------------------------------------------------
create or replace function private.timeline_from_clinical_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_clinician_validated and (tg_op = 'INSERT' or not old.is_clinician_validated) then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'clinical_summary_validated',
      'clinical_summaries', new.id,
      'Health summary reviewed by your care team',
      null,
      new.validated_at,
      private.timeline_staff_from_profile(new.validated_by, new.organisation_id)
    );
  end if;
  return new;
end;
$$;

create trigger clinical_summaries_timeline
  after insert or update on public.clinical_summaries
  for each row execute function private.timeline_from_clinical_summary();

-- ---------------------------------------------------------------------------
-- Attach the two existing generic clinical-core triggers directly.
-- ---------------------------------------------------------------------------
create trigger audit_row_change_trg
  after insert or update or delete on public.clinical_summaries
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.clinical_summaries
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- Deterministic draft generator — pure computation from existing structured
-- data, no external calls. Composes a short narrative from age/sex, active
-- problem-list entries, current medications, known allergies, and the most
-- recent BP/glucose readings.
-- ---------------------------------------------------------------------------
create or replace function private.generate_clinical_summary_draft(p_patient uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_age            int;
  v_sex            text;
  v_conditions     text;
  v_medications    text;
  v_allergies      text;
  v_bp             text;
  v_glucose        text;
  v_parts          text[] := array[]::text[];
begin
  select
    case when date_of_birth is not null then date_part('year', age(date_of_birth))::int end,
    sex::text
  into v_age, v_sex
  from public.profiles where id = p_patient;

  select string_agg(
    condition_name || case when status is not null then ' (' || replace(status::text, '_', ' ') || ')' else '' end,
    ', ' order by coalesce(date_identified, created_at::date) desc
  )
  into v_conditions
  from public.patient_conditions
  where patient_id = p_patient and status in ('active', 'controlled', 'uncontrolled');

  select string_agg(
    drug_name || coalesce(' ' || nullif(dose, ''), ''), ', ' order by created_at desc
  )
  into v_medications
  from public.medications
  where patient_id = p_patient and is_active;

  select string_agg(allergen, ', ' order by noted_at desc)
  into v_allergies
  from public.patient_allergies
  where patient_id = p_patient;

  select 'Last BP: ' || systolic || '/' || diastolic || ' (' || to_char(taken_at, 'DD Mon YYYY') || ')'
  into v_bp
  from public.vitals_readings
  where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
  order by taken_at desc limit 1;

  select 'Last glucose: ' || glucose_mmol_l || ' mmol/L (' || to_char(taken_at, 'DD Mon YYYY') || ')'
  into v_glucose
  from public.vitals_readings
  where patient_id = p_patient and vital_type = 'glucose' and glucose_mmol_l is not null
  order by taken_at desc limit 1;

  if v_age is not null or v_sex is not null then
    -- btrim guards the case where only one of age/sex is known — without it,
    -- a sex-only patient would get a stray leading space in the narrative.
    v_parts := v_parts || btrim(
      coalesce(v_age::text || '-year-old', '') || ' ' || coalesce(v_sex, '')
    );
  end if;
  v_parts := v_parts || coalesce('Active conditions: ' || v_conditions || '.', 'No active conditions on record.');
  if v_medications is not null then
    v_parts := v_parts || ('Current medications: ' || v_medications || '.');
  end if;
  if v_allergies is not null then
    v_parts := v_parts || ('Known allergies: ' || v_allergies || '.');
  end if;
  if v_bp is not null then v_parts := v_parts || (v_bp || '.'); end if;
  if v_glucose is not null then v_parts := v_parts || (v_glucose || '.'); end if;

  return array_to_string(v_parts, ' ');
end;
$$;

-- ---------------------------------------------------------------------------
-- Callable refresh RPC — regenerates the draft and upserts it, WITHOUT
-- overwriting a clinician's own authored/edited text (the ON CONFLICT WHERE
-- clause only fires the update when the existing row is still system_
-- generated). Lives in `public` for the same PostgREST-exposure reason as
-- public.search_patient_record above.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_clinical_summary(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_draft text;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then
    raise exception 'unknown patient';
  end if;

  -- A service-role caller (auth.uid() null, e.g. a scheduled job) already
  -- bypassed RLS/grants to reach here; an authenticated caller must be org
  -- staff for this patient's organisation.
  if (select auth.uid()) is not null and not private.is_org_staff(v_org) then
    raise exception 'insufficient_privilege: only org staff may refresh a clinical summary';
  end if;

  v_draft := private.generate_clinical_summary_draft(p_patient);

  -- Transaction-local marker so the write-guard trigger can tell this write
  -- apart from a clinician's own direct UPDATE — see that trigger's comment.
  perform set_config('app.clinical_summary_system_write', 'true', true);

  insert into public.clinical_summaries
    (organisation_id, patient_id, narrative_text, source, generated_at, is_clinician_validated)
  values
    (v_org, p_patient, v_draft, 'system_generated', now(), false)
  on conflict (patient_id) do update set
    narrative_text = excluded.narrative_text,
    source = 'system_generated',
    generated_at = excluded.generated_at,
    is_clinician_validated = false
  where public.clinical_summaries.source = 'system_generated';
end;
$$;

comment on function public.refresh_clinical_summary(uuid) is
  'Regenerates a patient''s clinical_summaries.narrative_text from current structured data and upserts it. Never overwrites a clinician-authored/edited summary (ON CONFLICT ... WHERE guards that). See docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.6.';

revoke execute on function public.refresh_clinical_summary(uuid) from public, anon;
revoke execute on function public.refresh_clinical_summary(uuid) from anon;
grant execute on function public.refresh_clinical_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clinical_summaries') then
    raise exception 'FAIL: clinical_summaries table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'clinical_summaries' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: clinical_summaries is missing audit_row_change_trg';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'clinical_summaries' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: clinical_summaries is missing capture_record_correction_trg';
  end if;

  if has_function_privilege('anon', 'public.refresh_clinical_summary(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute public.refresh_clinical_summary';
  end if;

  raise notice 'PASS: clinical_summary — table, RLS, draft generator, refresh RPC, timeline, and audit wiring installed';
end $$;
