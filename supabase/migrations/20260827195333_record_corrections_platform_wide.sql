-- Patient Health Record architecture review — platform-wide correction trail
-- (spec §1.18: "Original entry -> Correction -> Reason -> Author ->
-- Timestamp. Historical information remains auditable.")
--
-- WHERE THIS SITS RELATIVE TO audit_row_change (20260812030853)
-- That migration deliberately stores changed COLUMN NAMES plus a sha256 hash
-- of the row, never old/new values, for a real reason stated in its own
-- header: audit_log's read policy is is_org_staff(organisation_id) — broad,
-- uniform, and BROADER than several of the 21 source tables' own real
-- policies (e.g. lab_result_documents is narrower than plain org-staff via
-- the lab_liaison carve-outs; clinical_staff rows are HR-adjacent, not
-- general-staff-readable). Writing full row values into that one broadly-
-- read table would have been a PHI exposure created by the audit feature
-- itself — so it wasn't done, on purpose, and that reasoning still holds.
--
-- This migration delivers the "preserve the original value + reason +
-- author" half of §1.18 WITHOUT reopening that exposure: a SEPARATE table,
-- record_corrections, holds the actual old/new values for whatever columns
-- changed (not the whole row — only what a corrector could plausibly need
-- to see), gated by a policy DELIBERATELY NARROWER than audit_log's:
-- private.is_admin() or the record's own patient. No general
-- is_org_staff() clause. A clinician who needs to see a specific
-- correction's old/new values for a legitimate clinical reason gets a
-- narrow SECURITY DEFINER RPC later (same is_admin-only-by-default,
-- widen-with-a-named-reason pattern as public.my_care_plan_clinicians()),
-- not a blanket grant added here as an afterthought.
--
-- WHY A SEPARATE TABLE AND TRIGGER, NOT ONE MORE COLUMN ON audit_log
-- audit_row_change fires for INSERT/UPDATE/DELETE and is read broadly by
-- design (business-event visibility for org staff — "who touched this
-- patient" is legitimately staff-visible even when "what exactly did the
-- diagnosis used to say" is not). Splitting them keeps that existing,
-- correctly-scoped behaviour completely untouched (enhance, don't replace)
-- and lets the new, more sensitive artifact carry its own narrower policy
-- from day one instead of retrofitting column-level security onto a table
-- that already has real consumers reading it under the old assumption.
--
-- SCOPE: the same 21-table clinical core audit_row_change already covers.
-- New tables built alongside this review (patient_conditions,
-- family_history, social_history, and the medication-received event table)
-- attach both triggers directly in their own CREATE TABLE migrations rather
-- than via this file's DO block, which only reaches tables that already
-- exist when it runs.
--
-- REASON CAPTURE: optional, via a session GUC (app.change_reason), same
-- idiom as audit_row_change's existing app.audit_actor_id fallback for
-- service-role/cron actors. No existing call site sets it, so every
-- correction recorded today will have reason = null until app-layer code
-- starts calling `select set_config('app.change_reason', '...', true)`
-- before an UPDATE on one of these tables — that wiring is a deliberate
-- follow-up, not pretended to be done here. A null reason is still a fully
-- real correction record (original value, new value, author, timestamp) —
-- just missing the human-readable "why", exactly as it would be for any
-- correction made before this migration existed.

create table public.record_corrections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete set null,
  table_name       text not null,
  entity_id        uuid not null,
  patient_id       uuid references public.profiles (id) on delete set null,
  changed_columns  text[] not null,
  old_values       jsonb not null,
  new_values       jsonb not null,
  reason           text,
  corrected_by     uuid references public.profiles (id) on delete set null,
  corrected_at     timestamptz not null default now()
);

create index record_corrections_entity_idx on public.record_corrections (table_name, entity_id, corrected_at desc);
create index record_corrections_patient_idx on public.record_corrections (patient_id, corrected_at desc);
create index record_corrections_org_idx on public.record_corrections (organisation_id);

-- Immutability guard, reusing the exact function audit_log already uses —
-- a correction record is itself never correctable in place; a wrong
-- correction gets its own new correction row, same append-only discipline
-- as protocol_versions.
create trigger record_corrections_no_update
  before update on public.record_corrections
  for each row execute function private.reject_mutation();
create trigger record_corrections_no_delete
  before delete on public.record_corrections
  for each row execute function private.reject_mutation();

alter table public.record_corrections enable row level security;

-- Deliberately narrower than audit_log_select (see header). No is_org_staff
-- clause: full old/new PHI values need a tighter default than "anyone on
-- staff", not the same bar as a hash-only change-detection log.
create policy record_corrections_select on public.record_corrections
  for select to authenticated
  using (private.is_admin() or patient_id = (select auth.uid()));

-- No insert/update/delete grant to authenticated at all: this table is
-- populated exclusively by the SECURITY DEFINER trigger below, which writes
-- as its owner regardless of grants — never by a hand-authored client
-- insert (unlike audit_log, which intentionally also accepts direct
-- app-authored entries). Nothing here for a compromised client session to
-- forge.
grant select on public.record_corrections to authenticated;
revoke all on public.record_corrections from anon;

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
create or replace function private.capture_record_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old        jsonb := to_jsonb(OLD);
  v_new        jsonb := to_jsonb(NEW);
  v_changed    text[];
  v_patient_id uuid;
  v_actor      uuid;
  v_old_slice  jsonb;
  v_new_slice  jsonb;
begin
  -- Same no-op suppression as audit_row_change: a bare updated_at bump is a
  -- touch, not a correction.
  select array_agg(key order by key) into v_changed
    from jsonb_each(v_new) n
    where key <> 'updated_at'
      and n.value is distinct from (v_old -> n.key);

  if v_changed is null then
    return NEW;
  end if;

  v_patient_id := nullif(v_new ->> 'patient_id', '')::uuid;
  -- profiles has no separate patient_id column -- the row IS the patient
  -- when role = 'patient'. Every other audited table with no patient_id
  -- (clinical_staff) correctly gets patient_id = null: those corrections
  -- are admin-visible only, not "the patient's own record".
  if v_patient_id is null and tg_table_name = 'profiles' and (v_new ->> 'role') = 'patient' then
    v_patient_id := (v_new ->> 'id')::uuid;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  select jsonb_object_agg(t.k, v_old -> t.k) into v_old_slice from unnest(v_changed) as t(k);
  select jsonb_object_agg(t.k, v_new -> t.k) into v_new_slice from unnest(v_changed) as t(k);

  insert into public.record_corrections
    (organisation_id, table_name, entity_id, patient_id, changed_columns,
     old_values, new_values, reason, corrected_by)
  values (
    nullif(v_new ->> 'organisation_id', '')::uuid,
    tg_table_name,
    (v_new ->> 'id')::uuid,
    v_patient_id,
    v_changed,
    v_old_slice,
    v_new_slice,
    nullif(current_setting('app.change_reason', true), ''),
    v_actor
  );

  return NEW;
end;
$$;

comment on function private.capture_record_correction() is
  'AFTER UPDATE trigger: records the OLD/NEW values of exactly the columns that changed (never the whole row) into public.record_corrections, which is gated far narrower than audit_log (private.is_admin() or the record''s own patient only -- see migration header for why). Reason is optional, read from the app.change_reason GUC.';

-- ---------------------------------------------------------------------------
-- Attach to the same 21 tables audit_row_change already covers.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists capture_record_correction_trg on public.%I', t);
    execute format(
      'create trigger capture_record_correction_trg '
      'after update on public.%I '
      'for each row execute function private.capture_record_correction()',
      t
    );
  end loop;
end $$;

-- Proof, not hope.
do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
  v_count int;
begin
  foreach t in array tables loop
    select count(*) into v_count
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal;
    if v_count <> 1 then
      raise exception 'capture_record_correction_trg missing or duplicated on public.%: found %', t, v_count;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'record_corrections' and policyname = 'record_corrections_select'
  ) then
    raise exception 'FAIL: record_corrections_select policy is missing';
  end if;

  raise notice 'PASS: record_corrections_platform_wide -- table, trigger, and 21 attachments installed';
end $$;
