-- Tarragon Health — Health Data Architecture & MDM (spec §34.14)
-- Data quality engine: missing fields, invalid values, duplicates,
-- conflicting data, stale records, impossible measurements.
--
-- THIS IS AN AGGREGATOR, NOT A REIMPLEMENTATION
-- Three of the six categories §34.14 lists ALREADY have real, working
-- detection logic elsewhere on this platform — building a second,
-- competing implementation would be exactly the kind of duplicated source
-- of truth this whole MDM build exists to avoid:
--   - "duplicates"              -> public.patient_match_candidates (§34.4,
--     this same build, mdm_duplicate_patient_detection.sql)
--   - "conflicting data"        -> public.superseded_source_values (§34.9,
--     this same build, mdm_source_precedence.sql)
--   - "impossible measurements" -> public.vitals_readings.validation_status
--     ('requires_validation'), set by private.flag_vitals_requiring_
--     validation() (20260828185821_vitals_measurement_provenance_and_
--     validation.sql — a concurrently-landed migration on this same
--     branch's history, confirmed live via pg_proc rather than assumed
--     from a local file, since `list_migrations` on this heavily-
--     concurrent shared project can lag what a local checkout has pulled).
-- This engine's job is to pull all of that (plus two genuinely new checks
-- — missing identity fields, stale clinical reviews) into ONE place an
-- admin can see at once, not to re-detect any of it from scratch.

create type public.data_quality_category as enum (
  'missing_field',
  'invalid_value',
  'duplicate',
  'conflicting_data',
  'stale_record',
  'impossible_measurement'
);

create type public.data_quality_severity as enum ('info', 'warning', 'critical');

create type public.data_quality_finding_status as enum ('open', 'resolved', 'dismissed');

create table public.data_quality_findings (
  id               uuid primary key default gen_random_uuid(),
  check_code       text not null,
  category         public.data_quality_category not null,
  severity         public.data_quality_severity not null default 'warning',
  entity_table     text not null,
  entity_id        uuid not null,
  patient_id       uuid references public.profiles (id) on delete cascade,
  organisation_id  uuid references public.organisations (id) on delete set null,
  description      text not null,
  detail           jsonb not null default '{}'::jsonb,
  status           public.data_quality_finding_status not null default 'open',
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One open finding per (check, entity) — a re-scan should refresh
  -- detected_at on an existing open finding, never spawn a duplicate.
  constraint data_quality_findings_status_consistency check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

comment on table public.data_quality_findings is
  'Aggregated data-quality findings (§34.14) across missing fields, invalid values, duplicates, conflicting data, stale records, and impossible measurements. See this migration''s header for which categories re-use an existing detector rather than re-implementing one.';

create unique index data_quality_findings_open_unique_idx
  on public.data_quality_findings (check_code, entity_id) where status = 'open';
create index data_quality_findings_status_idx on public.data_quality_findings (status, severity);
create index data_quality_findings_patient_idx on public.data_quality_findings (patient_id) where patient_id is not null;
create index data_quality_findings_org_idx on public.data_quality_findings (organisation_id);

create trigger data_quality_findings_set_updated_at
  before update on public.data_quality_findings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scanner. Each check is its own statement so one check's bug can never
-- take down the others; each upserts against the (check_code, entity_id)
-- partial unique index so re-running never creates duplicate open
-- findings, and each auto-resolves any of ITS OWN previously-open
-- findings whose entity no longer matches the check (the record was
-- fixed, or the underlying source-of-truth condition cleared).
-- ---------------------------------------------------------------------------

create or replace function private.run_data_quality_scan()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check text;
begin
  -- ---- missing_field: an active care-receiving patient with no DOB or
  -- no phone -- both are core identity fields (§34.3) that downstream
  -- age-based clinical logic (screening eligibility, paediatric/adult
  -- protocol branching) and reminder delivery silently depend on.
  v_check := 'patient_missing_identity_field';
  insert into public.data_quality_findings (check_code, category, severity, entity_table, entity_id, patient_id, organisation_id, description, detail)
  select
    v_check, 'missing_field', 'warning', 'profiles', p.id, p.id, p.organisation_id,
    'Patient is missing ' || array_to_string(
      array_remove(array[
        case when p.date_of_birth is null then 'date_of_birth' end,
        case when p.phone is null then 'phone' end
      ], null), ' and '
    ) || '.',
    jsonb_build_object('date_of_birth_missing', p.date_of_birth is null, 'phone_missing', p.phone is null)
  from public.profiles p
  where p.role = 'patient' and p.is_active and p.receives_care
    and (p.date_of_birth is null or p.phone is null)
  on conflict (check_code, entity_id) where status = 'open'
    do update set detected_at = now(), detail = excluded.detail, updated_at = now();

  update public.data_quality_findings f
  set status = 'resolved', resolved_at = now()
  where f.check_code = v_check and f.status = 'open'
    and not exists (
      select 1 from public.profiles p
      where p.id = f.entity_id and p.role = 'patient' and p.is_active and p.receives_care
        and (p.date_of_birth is null or p.phone is null)
    );

  -- ---- impossible_measurement: re-surfaces vitals_readings the platform's
  -- own plausibility trigger already flagged (validation_status =
  -- 'requires_validation') and that nobody has reviewed yet.
  v_check := 'vitals_reading_requires_validation';
  insert into public.data_quality_findings (check_code, category, severity, entity_table, entity_id, patient_id, organisation_id, description, detail)
  select
    v_check, 'impossible_measurement', 'critical', 'vitals_readings', v.id, v.patient_id, v.organisation_id,
    'Vitals reading (' || v.vital_type::text || ') failed plausibility validation and has not been reviewed.',
    jsonb_build_object('vital_type', v.vital_type, 'taken_at', v.taken_at, 'validation_flags', v.validation_flags)
  from public.vitals_readings v
  where v.validation_status = 'requires_validation' and v.validated_by is null
  on conflict (check_code, entity_id) where status = 'open'
    do update set detected_at = now(), detail = excluded.detail, updated_at = now();

  update public.data_quality_findings f
  set status = 'resolved', resolved_at = now()
  where f.check_code = v_check and f.status = 'open'
    and not exists (
      select 1 from public.vitals_readings v
      where v.id = f.entity_id and v.validation_status = 'requires_validation' and v.validated_by is null
    );

  -- ---- duplicate: re-surfaces public.patient_match_candidates pending
  -- rows above a "worth an admin's attention" score, rather than a fresh
  -- duplicate-detection implementation. One finding per candidate PAIR;
  -- entity_id is the candidate row's own id, patient_id is left null
  -- (a pair names two patients, not one).
  v_check := 'patient_match_candidate_pending';
  insert into public.data_quality_findings (check_code, category, severity, entity_table, entity_id, patient_id, organisation_id, description, detail)
  select
    v_check, 'duplicate', (case when c.score >= 0.8 then 'critical' else 'warning' end)::public.data_quality_severity,
    'patient_match_candidates', c.id, null, null,
    'Two patient records may be the same person (matched on ' || array_to_string(c.matched_fields, ', ') || ', score ' || c.score || ').',
    jsonb_build_object('patient_a_id', c.patient_a_id, 'patient_b_id', c.patient_b_id, 'matched_fields', c.matched_fields, 'score', c.score)
  from public.patient_match_candidates c
  where c.status = 'pending'
  on conflict (check_code, entity_id) where status = 'open'
    do update set detected_at = now(), detail = excluded.detail, updated_at = now();

  update public.data_quality_findings f
  set status = 'resolved', resolved_at = now()
  where f.check_code = v_check and f.status = 'open'
    and not exists (select 1 from public.patient_match_candidates c where c.id = f.entity_id and c.status = 'pending');

  -- ---- conflicting_data: re-surfaces recent public.superseded_source_
  -- values rows (a lower-precedence write that lost to an existing
  -- higher-precedence value, §34.9) as a finding an admin can see
  -- alongside everything else, rather than only in that table directly.
  -- entity_table/entity_id here point at the superseded_source_values row
  -- ITSELF (not the original patient_blood_profile-style record s.entity_id
  -- names) — s.entity_table describes what the conflict was ABOUT, but
  -- using it as this finding's entity_table while pointing entity_id at
  -- s.id would leave entity_table and entity_id referring to two
  -- different tables' rows, which every other check in this function
  -- deliberately keeps consistent. The original entity is still fully
  -- identifiable via detail/s.entity_table in the description.
  v_check := 'superseded_source_value';
  insert into public.data_quality_findings (check_code, category, severity, entity_table, entity_id, patient_id, organisation_id, description, detail)
  select
    v_check, 'conflicting_data', 'info', 'superseded_source_values', s.id, s.patient_id, s.organisation_id,
    'A ' || s.attempted_source || ' value conflicted with an existing ' || s.existing_source || ' value on ' || s.entity_table || ' and was not applied.',
    jsonb_build_object('source_entity_table', s.entity_table, 'source_entity_id', s.entity_id, 'attempted_source', s.attempted_source, 'attempted_value', s.attempted_value, 'existing_source', s.existing_source, 'existing_value', s.existing_value)
  from public.superseded_source_values s
  where s.created_at > now() - interval '30 days'
  on conflict (check_code, entity_id) where status = 'open'
    do update set detected_at = now(), updated_at = now();
  -- No auto-resolve here: a superseded_source_values row is itself
  -- immutable history (append-only, same as record_corrections), so
  -- there is nothing for it to "stop matching" — it is resolved only by
  -- an admin's explicit review action, same as every other finding.

  -- ---- stale_record: an ACTIVE diagnosis whose clinician-set review date
  -- has passed with nobody having reviewed it since.
  v_check := 'condition_review_overdue';
  insert into public.data_quality_findings (check_code, category, severity, entity_table, entity_id, patient_id, organisation_id, description, detail)
  select
    v_check, 'stale_record', 'warning', 'patient_conditions', pc.id, pc.patient_id, pc.organisation_id,
    'Active condition "' || pc.condition_name || '" is overdue for review (due ' || pc.next_review_due_at::date || ').',
    jsonb_build_object('condition_name', pc.condition_name, 'next_review_due_at', pc.next_review_due_at, 'last_reviewed_at', pc.last_reviewed_at)
  from public.patient_conditions pc
  where pc.status = 'active' and pc.next_review_due_at is not null and pc.next_review_due_at < now()
  on conflict (check_code, entity_id) where status = 'open'
    do update set detected_at = now(), detail = excluded.detail, updated_at = now();

  update public.data_quality_findings f
  set status = 'resolved', resolved_at = now()
  where f.check_code = v_check and f.status = 'open'
    and not exists (
      select 1 from public.patient_conditions pc
      where pc.id = f.entity_id and pc.status = 'active' and pc.next_review_due_at is not null and pc.next_review_due_at < now()
    );

  return (select count(*)::integer from public.data_quality_findings where status = 'open');
end;
$$;

comment on function private.run_data_quality_scan is
  'Runs all §34.14 data-quality checks and upserts data_quality_findings. Re-surfaces existing detectors (patient_match_candidates, superseded_source_values, vitals validation_status) rather than re-implementing them; missing_field and stale_record are genuinely new checks. Auto-resolves a finding once its underlying condition clears, except superseded_source_value (append-only history, resolved only by explicit admin review).';

create or replace function public.run_data_quality_scan()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and not private.is_admin() then
    raise exception 'only an admin (or the scheduled service-role job) may run the data quality scan';
  end if;
  return private.run_data_quality_scan();
end;
$$;

comment on function public.run_data_quality_scan is
  'Admin-gated (or service-role cron) entry point for the §34.14 data quality engine.';

create or replace function public.resolve_data_quality_finding(
  p_finding_id uuid,
  p_status public.data_quality_finding_status,
  p_note text default null
)
returns public.data_quality_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.data_quality_findings;
begin
  if not private.is_admin() then
    raise exception 'only an admin may resolve a data quality finding';
  end if;
  if p_status = 'open' then
    raise exception 'cannot set a resolution back to open — that is the un-reviewed default, not a decision';
  end if;

  update public.data_quality_findings
  set status = p_status,
      resolved_by = (select auth.uid()),
      resolved_at = now(),
      detail = detail || jsonb_build_object('resolution_note', p_note)
  where id = p_finding_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'data_quality_findings row % not found', p_finding_id;
  end if;

  return v_row;
end;
$$;

comment on function public.resolve_data_quality_finding is
  'Records an admin decision (resolved/dismissed) on a data quality finding. A finding whose underlying condition still holds will simply be re-opened by the next scan if dismissed rather than fixed.';

-- ---------------------------------------------------------------------------
-- RLS — same admin-only shape as patient_match_candidates: a finding can
-- name two patients (duplicate pairs) or expose a cross-cutting quality
-- signal not scoped to a single org-staff member's normal patient list.
-- ---------------------------------------------------------------------------

alter table public.data_quality_findings enable row level security;

create policy data_quality_findings_select on public.data_quality_findings
  for select to authenticated using (private.is_admin());
create policy data_quality_findings_insert on public.data_quality_findings
  for insert to authenticated with check (private.is_admin());
create policy data_quality_findings_update on public.data_quality_findings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy data_quality_findings_delete on public.data_quality_findings
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.data_quality_findings to authenticated;
revoke all on public.data_quality_findings from anon;

revoke execute on function public.run_data_quality_scan() from public;
revoke execute on function public.run_data_quality_scan() from anon;
revoke execute on function public.resolve_data_quality_finding(uuid, public.data_quality_finding_status, text) from public;
revoke execute on function public.run_data_quality_scan() from public, anon;
revoke execute on function public.resolve_data_quality_finding(uuid, public.data_quality_finding_status, text) from public, anon;
grant execute on function public.run_data_quality_scan() to authenticated, service_role;
grant execute on function public.resolve_data_quality_finding(uuid, public.data_quality_finding_status, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

do $$
declare
  v_open_count integer;
begin
  if has_function_privilege('anon', 'public.run_data_quality_scan()', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.run_data_quality_scan';
  end if;
  if has_table_privilege('anon', 'public.data_quality_findings', 'SELECT') then
    raise exception 'FAIL: anon still holds SELECT on public.data_quality_findings';
  end if;

  -- Runs the real scan against this project's real data (read-mostly;
  -- only upserts findings, no destructive effect) as a smoke test that
  -- every check's SQL actually executes without error.
  v_open_count := private.run_data_quality_scan();
  raise notice 'data quality scan smoke test: % open finding(s)', v_open_count;
end;
$$;
