-- Patient Health Record architecture review — platform-wide correction trail
-- (spec §1.18: "Original entry -> Correction -> Reason -> Author ->
-- Timestamp. Historical information remains auditable.")
--
-- WHERE THIS SITS RELATIVE TO audit_row_change (20260812030853)
-- That migration deliberately stores changed COLUMN NAMES plus a sha256 hash
-- of the row, never old/new values, for a real reason stated in its own
-- header: audit_log's read policy is is_org_staff(organisation_id), and a
-- FEW of the 21 source tables' own real policies differ from plain
-- is_org_staff in ways that matter (checked live against pg_policies on the
-- production project, not reconstructed from migration history — see
-- below). Writing full row values into that one uniformly-read table would
-- have been a PHI exposure created by the audit feature itself for those
-- few tables — so it wasn't done, on purpose, and that reasoning still
-- holds for audit_log itself. It does NOT mean every table needs the same
-- ultra-narrow bar; see the visibility function below for what the live
-- data actually supports.
--
-- This migration delivers the "preserve the original value + reason +
-- author" half of §1.18 in a SEPARATE table, record_corrections, holding
-- the actual old/new values for whatever columns changed (not the whole
-- row — only what a corrector could plausibly need to see).
--
-- READ ACCESS — checked against the LIVE policies on every one of the 21
-- tables (pg_policies on the production project), not assumed:
--   * 19 of the 21 already grant blanket same-org-staff SELECT on the
--     CURRENT row (is_org_staff(organisation_id), no per-patient-assignment
--     narrowing) — often unioned with private.can_read_clinical(patient_id)
--     (a profile_access grantee with clinical_access, or an eldercare
--     "manage" grantee for a dependent account) as a further real reader.
--     Letting that SAME set of people see that a value used to be
--     different is not a new category of exposure — it's the existing
--     exposure model, applied to one more fact about a row they can already
--     read in full today.
--   * lab_result_documents ADDS private.is_lab_liaison() (in-org) on top of
--     is_org_staff — narrower roles get MORE access here, not less.
--   * clinical_staff is wider still: readable by anyone in the same
--     organisation_id, patient or staff — HR-adjacent but not actually
--     access-restricted today.
--   * profiles is the one genuinely different shape (patient self, admin,
--     org-staff, a lab_liaison-for-a-patient-role carve-out, and
--     profile_access grantees) — reproduced explicitly below.
-- private.can_read_record_correction() mirrors this directly rather than
-- inventing a new, blunter bar: private.is_admin(), OR the actor who made
-- THIS correction (corrected_by = auth.uid(), the same self-visibility
-- audit_log itself already grants via actor_id), OR the record's own
-- patient, OR private.can_read_clinical(patient_id), OR private.is_org_
-- staff(organisation_id), OR the two named table-specific carve-outs
-- (lab_result_documents' and profiles' lab_liaison access, clinical_staff's
-- org-wide read). A new table joining this audit later that needs a
-- different real policy extends this one function, not 25 copies of it.
--
-- WHY A SEPARATE TABLE AND TRIGGER, NOT ONE MORE COLUMN ON audit_log
-- audit_row_change fires for INSERT/UPDATE/DELETE and audit_log is read via
-- one uniform is_org_staff() policy by design (business-event visibility —
-- "who touched this patient" is legitimately staff-visible even on the
-- couple of tables where "what exactly did the value used to say" needs the
-- extra table-specific handling above). Splitting them keeps audit_log
-- completely untouched (enhance, don't replace) and lets this more
-- sensitive artifact carry its own access logic, expressed once in a named
-- function instead of retrofitted onto a table with existing consumers.
--
-- WHAT'S CAPTURED: UPDATE and DELETE, not INSERT. An inserted row's
-- "original entry" is simply whatever is currently live in the base table —
-- nothing is at risk of being lost until the FIRST correction, which is
-- exactly what this captures. DELETE is included (unlike audit_row_change's
-- hash-only DELETE record) because a removed clinical row is the most
-- extreme correction there is and deserves the same recoverable old_values,
-- not just a hash proving something existed.
--
-- REASON: mandatory (raises, not just recorded as null) for the two tables
-- this review's own audit called out as the spec's clearest "never let this
-- be silently changed" cases — patient_conditions (diagnoses) and
-- patient_allergies (safety-critical, feeds drug-interaction checking).
-- Confirmed safe to enforce immediately: patient_conditions has no existing
-- writer anywhere in apps/web/src (built in this same review), and grepping
-- apps/web/src for patient_allergies turns up only read-only consumers
-- (drug-safety.ts, emergency/dataset.ts, patient-clinical-context.ts) — no
-- UPDATE/DELETE call site exists to break. Every other table keeps the
-- optional app.change_reason GUC (same idiom as audit_row_change's app.
-- audit_actor_id fallback) — mandating it everywhere would break live
-- UPDATE call sites this review did not audit one-by-one.
--
-- SCOPE: the same 21-table clinical core audit_row_change already covers,
-- plus every new table this review added attaches both triggers directly in
-- their own migrations. patient_allergies — a real, glaring omission from
-- the original 21 given it's this platform's own reference-quality pattern
-- for a safety-critical field — is added in a following migration rather
-- than by editing 20260812030853 (already-applied history).

create table public.record_corrections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete set null,
  table_name       text not null,
  entity_id        uuid not null,
  patient_id       uuid references public.profiles (id) on delete set null,
  changed_columns  text[] not null,
  old_values       jsonb not null,
  new_values       jsonb,
  reason           text,
  corrected_by     uuid references public.profiles (id) on delete set null,
  corrected_at     timestamptz not null default now()
);

comment on column public.record_corrections.new_values is
  'Null specifically means the row was DELETED (nothing to show as "new") -- distinct from an empty object, which would mean the changed columns'' new values were all null.';

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

-- ---------------------------------------------------------------------------
-- Visibility function — see header for how each disjunct was verified
-- against the live pg_policies on every one of the 25 tables this trail
-- ultimately covers (21 original + patient_allergies + the 4 new tables).
-- ---------------------------------------------------------------------------
create or replace function private.can_read_record_correction(
  p_table_name      text,
  p_organisation_id uuid,
  p_patient_id      uuid,
  p_corrected_by    uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_admin()
    -- The actor who made this correction can always see it -- same
    -- self-visibility audit_log itself grants via actor_id = auth.uid().
    or (p_corrected_by is not null and p_corrected_by = (select auth.uid()))
    -- The record's own patient, and anyone who can read that patient's
    -- clinical data via an explicit profile_access grant (next-of-kin
    -- clinical_access, or eldercare "manage" of a dependent account) --
    -- matches every one of the 21 tables' own patient-facing clause.
    or (p_patient_id is not null and (
      p_patient_id = (select auth.uid())
      or private.can_read_clinical(p_patient_id)
    ))
    -- profiles and lab_result_documents both additionally admit an in-org
    -- lab_liaison on top of is_org_staff (verified live: lab_result_
    -- documents_select and profiles_select both carry this exact clause).
    -- p_patient_id is only ever non-null here for a profiles row when
    -- role = 'patient' (see capture_record_correction()), matching the
    -- live profiles_select clause's own "role = 'patient'" condition.
    or (p_table_name in ('profiles', 'lab_result_documents')
        and p_patient_id is not null
        and private.is_lab_liaison()
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    -- clinical_staff is readable by anyone in the same organisation today
    -- (clinical_staff_select: organisation_id = current_org_id() OR
    -- is_org_staff(organisation_id)) -- reproduced as-is, not narrowed.
    or (p_table_name = 'clinical_staff'
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    -- The blanket case covering 19 of the 21 original tables plus every
    -- table this review added: same-org staff who can already read the
    -- CURRENT row can read that a value used to be different.
    or (p_organisation_id is not null and private.is_org_staff(p_organisation_id));
$$;

comment on function private.can_read_record_correction(text, uuid, uuid, uuid) is
  'Read-access predicate for record_corrections, verified against the LIVE pg_policies of every covered table rather than assumed. See 20260827195333_record_corrections_platform_wide.sql for the per-clause justification.';

create policy record_corrections_select on public.record_corrections
  for select to authenticated
  using (private.can_read_record_correction(table_name, organisation_id, patient_id, corrected_by));

-- No insert/update/delete grant to authenticated at all: this table is
-- populated exclusively by the SECURITY DEFINER trigger below, which writes
-- as its owner regardless of grants — never by a hand-authored client
-- insert (unlike audit_log, which intentionally also accepts direct
-- app-authored entries). Nothing here for a compromised client session to
-- forge.
--
-- The explicit revoke below is not redundant: this project auto-grants
-- select/insert/update/delete to `authenticated` on every newly created
-- public-schema table via an `alter default privileges` rule, so a bare
-- `grant select` here would have left insert/update/delete silently
-- present anyway (confirmed live via information_schema.role_table_grants
-- after this migration first ran without the revoke). RLS's default-deny
-- already made that safe in practice (no INSERT/UPDATE/DELETE policy
-- exists, so those commands are denied/filtered regardless of the grant),
-- but relying solely on "no policy happens to exist" is fragile -- the
-- revoke is a second, independent layer that doesn't depend on nobody ever
-- adding a policy here by mistake.
grant select on public.record_corrections to authenticated;
revoke insert, update, delete on public.record_corrections from authenticated;
revoke all on public.record_corrections from anon;

-- ---------------------------------------------------------------------------
-- Trigger function — fires on UPDATE and DELETE (see header for why not
-- INSERT).
-- ---------------------------------------------------------------------------
create or replace function private.capture_record_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        jsonb;
  v_old        jsonb;
  v_new        jsonb;
  v_changed    text[];
  v_patient_id uuid;
  v_actor      uuid;
  v_old_slice  jsonb;
  v_new_slice  jsonb;
  v_reason     text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_row := v_old;
    -- Same shape as audit_row_change's DELETE handling: every populated
    -- column is "changed" (it existed, now it doesn't).
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    if v_changed is null then
      return OLD; -- nothing was ever populated on this row; nothing to record
    end if;
    select jsonb_object_agg(t.k, v_old -> t.k) into v_old_slice from unnest(v_changed) as t(k);
    v_new_slice := null; -- deleted: there is no "new" state
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
    -- Same no-op suppression as audit_row_change: a bare updated_at bump is
    -- a touch, not a correction.
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return NEW;
    end if;
    select jsonb_object_agg(t.k, v_old -> t.k) into v_old_slice from unnest(v_changed) as t(k);
    select jsonb_object_agg(t.k, v_new -> t.k) into v_new_slice from unnest(v_changed) as t(k);
  end if;

  v_reason := nullif(current_setting('app.change_reason', true), '');
  if tg_table_name in ('patient_conditions', 'patient_allergies') and v_reason is null then
    raise exception
      'a correction reason is required when changing %.% -- set app.change_reason before this statement (select set_config(''app.change_reason'', ''...'', true))',
      tg_table_name, coalesce(v_row ->> 'id', 'unknown');
  end if;

  v_patient_id := nullif(v_row ->> 'patient_id', '')::uuid;
  -- profiles has no separate patient_id column -- the row IS the patient
  -- when role = 'patient'. Every other audited table with no patient_id
  -- concept (clinical_staff) correctly gets patient_id = null.
  if v_patient_id is null and tg_table_name = 'profiles' and (v_row ->> 'role') = 'patient' then
    v_patient_id := (v_row ->> 'id')::uuid;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  insert into public.record_corrections
    (organisation_id, table_name, entity_id, patient_id, changed_columns,
     old_values, new_values, reason, corrected_by)
  values (
    nullif(v_row ->> 'organisation_id', '')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_patient_id,
    v_changed,
    v_old_slice,
    v_new_slice,
    v_reason,
    v_actor
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.capture_record_correction() is
  'AFTER UPDATE OR DELETE trigger: records the OLD/(NEW or null-if-deleted) values of exactly the columns that changed (never the whole row) into public.record_corrections. Read access is private.can_read_record_correction(), mirroring each covered table''s real live policy -- see migration header. Reason is mandatory (raises) for patient_conditions/patient_allergies, optional elsewhere via the app.change_reason GUC.';

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
      'after update or delete on public.%I '
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

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'record_corrections'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: authenticated still has INSERT/UPDATE/DELETE on record_corrections';
  end if;

  raise notice 'PASS: record_corrections_platform_wide -- table, trigger, 21 attachments, and grant revoke installed';
end $$;
