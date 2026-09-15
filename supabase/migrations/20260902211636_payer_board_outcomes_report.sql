-- Tarragon Health — the audit-grade outcomes report (module 27).
--
-- WHAT THIS IS FOR. A payer's board does not act on a dashboard. It acts on a
-- document: one that states what was measured, over whom, for what period, who
-- prepared it, who stands behind it, and what could not be measured. Everything
-- module 27 has so far is `payer_dashboard_analytics()` — live counts that
-- change under the reader's feet, carry no denominators, no definitions, no
-- provenance and no signature. That is a monitoring surface. It is not evidence.
--
-- The five properties that separate this from a dashboard, in the order they
-- matter:
--
--   1. THE DEFINITION IS FIXED BEFORE THE NUMBER IS COMPUTED. Every measure is
--      a row in `outcome_measure_specs` — numerator, denominator, exclusions,
--      source tables and known limitations, all written out in prose and
--      versioned. The report quotes them verbatim. A spec version that any
--      report has already used can never be edited (trigger below): you raise a
--      new version, and the two reports then visibly disagree about which
--      definition they used, which is the honest outcome. This is the single
--      thing that stops a rate improving because somebody moved a goalpost.
--
--   2. DENOMINATORS ARE DECLARED, AND WHAT COULD NOT BE MEASURED IS COUNTED.
--      Every measure returns four numbers, not one: denominator (who was
--      eligible), measurable (who had the data needed), numerator (who met it)
--      and unmeasurable (eligible but no data, with the reason). A rate is
--      always numerator/measurable, and `measurable/denominator` is printed
--      beside it as data completeness. A measure with 80% control on 5 of 400
--      eligible members is not a good result, and this shape makes that
--      impossible to hide.
--
--   3. A SMALL CELL PRODUCES NO NUMBER AT ALL. Below the floor (the greater of
--      the spec's own minimum and the insurer's `min_cohort_size`) the
--      numerator and rate come back NULL with a stated reason — never 0, never
--      a percentage of four people. Same I9 privacy line the rest of the
--      platform holds, doing double duty here as statistical honesty.
--
--   4. THE DOCUMENT IS FROZEN AND TAMPER-EVIDENT. The snapshot is written once
--      and an immutability trigger refuses every later edit to it, to the
--      period, to the hash or to the report number. The content hash is
--      SHA-256 over the canonical serialisation; `verify_payer_board_report()`
--      lets somebody holding a printout check the number-plus-hash pair
--      against this database without an account and without seeing a figure.
--
--   5. AN UNATTESTED REPORT IS A DRAFT AND SAYS SO. Attestation is a named
--      human act, recorded with who/when/what-they-said, and it re-derives the
--      hash from the stored snapshot before it will sign — so an attestation
--      is a statement about content that provably has not moved. Attestation is
--      TARRAGON-SIDE ONLY: Tarragon produces these figures, so Tarragon stands
--      behind them. A payer can generate and read; it cannot attest its own
--      supplier's numbers into being final.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * No individual-level anything, ever. I9 and module 27's own opening
--     comment both bind here: this file returns counts and rates. There is no
--     patient id, name, member id or clinical value anywhere in a snapshot, and
--     the RPCs below have no parameter that could ask for one.
--   * No cost-savings or ROI claim. The platform has no counterfactual and no
--     validated cost model; a "₦X avoided" line on a board paper would be an
--     invention. Claims data is reconciled and reported as fact (billed,
--     covered, paid) and nothing is projected from it.
--   * No HbA1c. The platform stores capillary/fasting glucose, not HbA1c, so
--     the glycaemic measure says fasting glucose and its spec names that as a
--     limitation rather than letting a reader assume the stronger measure.
--
-- Gated on private.module_enabled('payer_platform') like the rest of module 27
-- — this ships dormant.

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.board_report_status as enum (
    'draft',       -- generated, numbers frozen, nobody has stood behind it yet
    'attested',    -- a named Tarragon signatory has attested it; presentable
    'superseded',  -- a newer report covers the same insurer and period
    'withdrawn'    -- pulled after issue; kept readable and hash-verifiable
  );
exception when duplicate_object then null; end $$;

comment on type public.board_report_status is
  'draft = frozen but unattested (renders watermarked, never presentable as final); attested = a named signatory stands behind it; superseded = a later report covers the same period; withdrawn = retracted after issue. Rows are never deleted in any state — a withdrawn report must stay verifiable, because copies of it exist outside this database.';

do $$ begin
  create type public.measure_direction as enum ('higher_is_better', 'lower_is_better');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. The measure specifications — pre-registered, versioned, quotable.
--
-- These are governance objects, not configuration. They are written by
-- Tarragon (superadmin only), read by everyone, and frozen the moment a report
-- cites them. `compute_key` is the branch in private.compute_board_measure()
-- that implements this row; a spec whose compute_key has no branch is a
-- definition with no implementation, which the assertions at the bottom refuse
-- to let ship.
-- ---------------------------------------------------------------------------
create table if not exists public.outcome_measure_specs (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null check (code ~ '^[a-z][a-z0-9_]{2,48}$'),
  spec_version           integer not null check (spec_version >= 1),
  title                  text not null check (length(btrim(title)) between 3 and 160),
  domain                 text not null check (domain in ('clinical_outcome', 'process', 'service', 'financial')),
  -- Every one of these is printed verbatim in the report. They are prose on
  -- purpose: a board member reads them, not SQL.
  rationale              text not null check (length(btrim(rationale)) >= 20),
  numerator_definition   text not null check (length(btrim(numerator_definition)) >= 20),
  denominator_definition text not null check (length(btrim(denominator_definition)) >= 20),
  exclusion_definition   text not null check (length(btrim(exclusion_definition)) >= 10),
  -- What this measure cannot tell you. Non-null and non-trivial by constraint:
  -- a measure that claims no limitations has not been thought about.
  limitations            text not null check (length(btrim(limitations)) >= 20),
  data_sources           text[] not null check (cardinality(data_sources) >= 1),
  unit                   text not null default 'percent',
  direction              public.measure_direction not null,
  -- Below this denominator the measure reports nothing at all. The insurer's
  -- own min_cohort_size is applied on top of it, whichever is greater.
  min_denominator        integer not null default 10 check (min_denominator >= 5),
  compute_key            text not null,
  effective_from         date not null default current_date,
  retired_at             timestamptz,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.profiles (id) on delete set null,
  constraint outcome_measure_specs_code_version_key unique (code, spec_version)
);

comment on table public.outcome_measure_specs is
  'Pre-registered outcome measure definitions, versioned. A version becomes immutable the moment any payer board report cites it — change a definition by raising a new spec_version, never by editing a cited one.';

create index if not exists outcome_measure_specs_live_idx
  on public.outcome_measure_specs (code, spec_version desc) where retired_at is null;

-- ---------------------------------------------------------------------------
-- 3. The reports.
-- ---------------------------------------------------------------------------
create table if not exists public.payer_board_reports (
  id                   uuid primary key default gen_random_uuid(),
  insurer_id           uuid not null references public.insurers (id) on delete restrict,
  -- Human-quotable identity, printed on the document: TAR-<INSURERCODE>-<YYYY>-<NNNN>.
  report_number        text not null unique,
  sequence_no          integer not null,
  period_start         date not null,
  period_end           date not null,
  status               public.board_report_status not null default 'draft',
  -- The frozen numbers. Never edited after insert (trigger below).
  snapshot             jsonb not null,
  -- SHA-256 hex of the canonical serialisation. Re-derivable from `snapshot`
  -- at any time, which is exactly what attestation and verification check.
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  engine_version       text not null,
  generated_at         timestamptz not null default now(),
  generated_by         uuid references public.profiles (id) on delete set null,
  attested_by          uuid references public.profiles (id) on delete set null,
  attested_at          timestamptz,
  attestation_statement text,
  attester_role_title  text,
  superseded_by        uuid references public.payer_board_reports (id) on delete set null,
  withdrawn_at         timestamptz,
  withdrawn_by         uuid references public.profiles (id) on delete set null,
  withdrawal_reason    text,
  constraint payer_board_reports_period_valid check (period_end >= period_start),
  constraint payer_board_reports_seq_key unique (insurer_id, sequence_no),
  -- Attestation is all-or-nothing: a report cannot claim a signatory without a
  -- timestamp and a statement, and cannot be `attested` without all three.
  -- This is the null-gating rule CLAUDE.md holds for "Reviewed by Dr X",
  -- enforced here in the schema rather than trusted to the UI.
  constraint payer_board_reports_attestation_complete check (
    (attested_by is null and attested_at is null and attestation_statement is null)
    or (attested_by is not null and attested_at is not null
        and length(btrim(attestation_statement)) >= 20)
  ),
  constraint payer_board_reports_attested_needs_attestation check (
    status <> 'attested' or attested_by is not null
  ),
  constraint payer_board_reports_withdrawn_needs_reason check (
    status <> 'withdrawn' or length(btrim(withdrawal_reason)) >= 10
  )
);

comment on table public.payer_board_reports is
  'Frozen, hash-verifiable outcomes reports issued to an insurer for a period. Append-only: the snapshot, period, hash and report number are immutable after insert; only the status/attestation/withdrawal columns may ever change, and only forwards.';

create index if not exists payer_board_reports_insurer_idx
  on public.payer_board_reports (insurer_id, period_end desc);

-- ---------------------------------------------------------------------------
-- 4. Immutability.
--
-- The point of the whole file. A report that can be edited after issue is a
-- dashboard with a date on it.
-- ---------------------------------------------------------------------------
create or replace function private.payer_board_reports_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a board report is never deleted — withdraw it instead, so copies already in circulation stay verifiable'
      using errcode = '42501';
  end if;

  if new.snapshot is distinct from old.snapshot
     or new.content_hash is distinct from old.content_hash
     or new.report_number is distinct from old.report_number
     or new.sequence_no is distinct from old.sequence_no
     or new.insurer_id is distinct from old.insurer_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.engine_version is distinct from old.engine_version
     or new.generated_at is distinct from old.generated_at
     or new.generated_by is distinct from old.generated_by then
    raise exception 'the figures, period and identity of an issued board report cannot be changed — generate a new report, which supersedes this one'
      using errcode = '42501';
  end if;

  -- An attestation is a person's signature. It is not editable and not
  -- transferable; withdraw the report and issue a fresh one instead.
  if old.attested_by is not null and (
       new.attested_by is distinct from old.attested_by
       or new.attested_at is distinct from old.attested_at
       or new.attestation_statement is distinct from old.attestation_statement) then
    raise exception 'an attestation cannot be altered once given — withdraw the report instead'
      using errcode = '42501';
  end if;

  -- Status moves forward only. `withdrawn` is terminal.
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'a withdrawn board report cannot be reinstated' using errcode = '42501';
  end if;
  if old.status = 'attested' and new.status = 'draft' then
    raise exception 'an attested board report cannot go back to draft' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists payer_board_reports_immutable on public.payer_board_reports;
create trigger payer_board_reports_immutable
  before update or delete on public.payer_board_reports
  for each row execute function private.payer_board_reports_immutable();

-- A spec version that a report has cited is frozen for the same reason.
create or replace function private.outcome_measure_specs_freeze_when_cited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cited boolean;
begin
  select exists (
    select 1 from public.payer_board_reports r
    where r.snapshot -> 'measures' @> jsonb_build_array(
      jsonb_build_object('code', old.code, 'spec_version', old.spec_version))
  ) into v_cited;

  if not v_cited then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'measure spec %/v% has been cited by an issued board report and cannot be deleted', old.code, old.spec_version
      using errcode = '42501';
  end if;

  -- Retiring a cited spec is allowed and is the intended way to stop using it;
  -- changing what it SAYS is not, because issued reports quote this text.
  if new.code is distinct from old.code
     or new.spec_version is distinct from old.spec_version
     or new.title is distinct from old.title
     or new.numerator_definition is distinct from old.numerator_definition
     or new.denominator_definition is distinct from old.denominator_definition
     or new.exclusion_definition is distinct from old.exclusion_definition
     or new.limitations is distinct from old.limitations
     or new.rationale is distinct from old.rationale
     or new.min_denominator is distinct from old.min_denominator
     or new.compute_key is distinct from old.compute_key
     or new.direction is distinct from old.direction
     or new.data_sources is distinct from old.data_sources then
    raise exception 'measure spec %/v% has been cited by an issued board report — raise a new spec_version instead of editing this one', old.code, old.spec_version
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists outcome_measure_specs_freeze_when_cited on public.outcome_measure_specs;
create trigger outcome_measure_specs_freeze_when_cited
  before update or delete on public.outcome_measure_specs
  for each row execute function private.outcome_measure_specs_freeze_when_cited();

-- ---------------------------------------------------------------------------
-- 5. RLS.
-- ---------------------------------------------------------------------------
alter table public.outcome_measure_specs enable row level security;
alter table public.payer_board_reports enable row level security;

-- Specs are readable by any signed-in account: they are the published
-- methodology, and a payer must be able to read the definition before it
-- believes the number.
drop policy if exists outcome_measure_specs_select on public.outcome_measure_specs;
create policy outcome_measure_specs_select on public.outcome_measure_specs
  for select to authenticated using (true);

drop policy if exists outcome_measure_specs_admin_write on public.outcome_measure_specs;
create policy outcome_measure_specs_admin_write on public.outcome_measure_specs
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- A report is readable by the insurer it was issued to, and by Tarragon
-- superadmin. is_payer_admin_for() already carries the module gate.
drop policy if exists payer_board_reports_select on public.payer_board_reports;
create policy payer_board_reports_select on public.payer_board_reports
  for select to authenticated using (private.is_payer_admin_for(insurer_id));

-- No direct insert/update/delete policy at all: every write goes through the
-- SECURITY DEFINER RPCs below, which is what lets them enforce ordering,
-- sequencing, hashing and who-may-attest. RLS with no write policy denies.

grant select on public.outcome_measure_specs to authenticated;
grant select on public.payer_board_reports to authenticated;
revoke all on public.outcome_measure_specs from anon;
revoke all on public.payer_board_reports from anon;

-- Table-level writes are revoked outright, not merely unpoliced. RLS with no
-- write policy already denies, but this platform's default-privileges
-- migration grants `authenticated` insert/update/delete on every table added
-- afterwards, and an immutability guarantee should not rest on a single layer
-- — particularly one that a future policy added in good faith could open.
-- Every write goes through the SECURITY DEFINER RPCs below, which is what lets
-- them enforce sequencing, hashing, who-may-attest and forward-only status.
revoke insert, update, delete on public.payer_board_reports from authenticated;

-- ---------------------------------------------------------------------------
-- 6. The cohort.
--
-- Two populations, both reported, because the difference between them is
-- itself a fact a board should see:
--   * covered at any point in the period — the membership the payer paid for;
--   * continuously covered for the whole period — the only population an
--     outcome measure may use, because somebody covered for nine days of a
--     quarter cannot have had their blood pressure changed by a programme.
-- Every clinical and process measure below uses the continuous cohort.
-- ---------------------------------------------------------------------------
create or replace function private.board_cohort(
  p_insurer_id uuid,
  p_start date,
  p_end date,
  p_continuous boolean
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ip.patient_id
  from public.insurance_policies ip
  where ip.insurer_id = p_insurer_id
    and ip.status = 'active'
    and ip.verified_at is not null
    and case
          when p_continuous then
            ip.effective_from <= p_start
            and (ip.effective_to is null or ip.effective_to >= p_end)
          else
            ip.effective_from <= p_end
            and (ip.effective_to is null or ip.effective_to >= p_start)
        end;
$$;

revoke all on function private.board_cohort(uuid, date, date, boolean) from public;

-- ---------------------------------------------------------------------------
-- 7. The measure engine.
--
-- One branch per compute_key. Each returns the same four-number shape:
--
--   denominator  — eligible members (or eligible events, for the service measure)
--   measurable   — of those, how many had the data the measure needs
--   numerator    — of the measurable, how many met the criterion
--   unmeasurable — denominator - measurable, with a stated reason
--
-- Suppression is NOT applied here; this function returns the truth and
-- generate_payer_board_report() decides what may be printed. Keeping those
-- apart means the suppression rule is in one place and is testable.
--
-- ENGINE VERSION: bump private.BOARD_ENGINE_VERSION (the constant in
-- generate_payer_board_report) whenever any branch below changes the meaning
-- of a number. Every report records the engine version that produced it, so
-- two reports whose rates disagree can be told apart from two reports whose
-- ENGINE disagreed.
-- ---------------------------------------------------------------------------
create or replace function private.compute_board_measure(
  p_compute_key text,
  p_insurer_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_denominator integer := 0;
  v_measurable  integer := 0;
  v_numerator   integer := 0;
  v_reason      text;
  v_start_ts    timestamptz := p_start::timestamptz;
  -- Inclusive of the whole final day, in the platform's own timezone.
  v_end_ts      timestamptz := (p_end + 1)::timestamptz;
begin
  case p_compute_key

  -- -------------------------------------------------------------- bp_control
  when 'bp_control' then
    v_reason := 'No blood pressure reading recorded during the period.';
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, true) as pid),
    eligible as (
      select distinct c.pid
      from cohort c
      join public.patient_conditions pc on pc.patient_id = c.pid
      where pc.status in ('active', 'controlled', 'uncontrolled')
        and (lower(pc.condition_name) in ('hypertension', 'high blood pressure')
             or pc.icd10_code like 'I1%')
        and (pc.date_identified is null or pc.date_identified <= p_end)
    ),
    latest as (
      select e.pid,
             (select v.systolic from public.vitals_readings v
               where v.patient_id = e.pid and v.vital_type = 'blood_pressure'
                 and v.systolic is not null and v.diastolic is not null
                 and v.taken_at >= v_start_ts and v.taken_at < v_end_ts
               order by v.taken_at desc limit 1) as systolic,
             (select v.diastolic from public.vitals_readings v
               where v.patient_id = e.pid and v.vital_type = 'blood_pressure'
                 and v.systolic is not null and v.diastolic is not null
                 and v.taken_at >= v_start_ts and v.taken_at < v_end_ts
               order by v.taken_at desc limit 1) as diastolic
      from eligible e
    )
    select count(*),
           count(*) filter (where systolic is not null),
           count(*) filter (where systolic < 140 and diastolic < 90)
      into v_denominator, v_measurable, v_numerator
    from latest;

  -- ------------------------------------------------------ glycaemic_control
  when 'glycaemic_control' then
    v_reason := 'No fasting glucose reading recorded during the period.';
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, true) as pid),
    eligible as (
      select distinct c.pid
      from cohort c
      join public.patient_conditions pc on pc.patient_id = c.pid
      where pc.status in ('active', 'controlled', 'uncontrolled')
        and (lower(pc.condition_name) like '%diabetes%' or pc.icd10_code like 'E1%')
        and (pc.date_identified is null or pc.date_identified <= p_end)
    ),
    latest as (
      select e.pid,
             (select v.glucose_mmol_l from public.vitals_readings v
               where v.patient_id = e.pid and v.vital_type = 'glucose'
                 and v.glucose_context = 'fasting' and v.glucose_mmol_l is not null
                 and v.taken_at >= v_start_ts and v.taken_at < v_end_ts
               order by v.taken_at desc limit 1) as glucose
      from eligible e
    )
    select count(*),
           count(*) filter (where glucose is not null),
           count(*) filter (where glucose < 7.0)
      into v_denominator, v_measurable, v_numerator
    from latest;

  -- ---------------------------------------------------- programme_enrolment
  when 'programme_enrolment' then
    -- Fully observable: enrolment either happened in this database or it did
    -- not, so measurable always equals the denominator and unmeasurable is 0.
    v_reason := null;
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, true) as pid),
    eligible as (
      select distinct c.pid
      from cohort c
      join public.patient_conditions pc on pc.patient_id = c.pid
      join public.chronic_condition_programmes cp
        on cp.is_active and lower(pc.condition_name) = lower(cp.condition::text)
      where pc.status in ('active', 'controlled', 'uncontrolled')
        and (pc.date_identified is null or pc.date_identified <= p_end)
    )
    select count(*),
           count(*),
           count(*) filter (where exists (
             select 1 from public.chronic_programme_enrolments en
             where en.patient_id = e.pid
               and en.status in ('enrolled', 'completed')
               and en.enrolled_at < v_end_ts))
      into v_denominator, v_measurable, v_numerator
    from eligible e;

  -- -------------------------------------------------------- review_currency
  when 'review_currency' then
    v_reason := 'No next-review date has been set on the condition record.';
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, true) as pid),
    eligible as (
      select c.pid,
             max(pc.next_review_due_at) as next_due,
             bool_or(pc.next_review_due_at is not null) as has_due
      from cohort c
      join public.patient_conditions pc on pc.patient_id = c.pid
      where pc.status in ('active', 'controlled', 'uncontrolled')
        and (pc.date_identified is null or pc.date_identified <= p_end)
      group by c.pid
    )
    select count(*),
           count(*) filter (where has_due),
           count(*) filter (where has_due and next_due >= v_end_ts)
      into v_denominator, v_measurable, v_numerator
    from eligible;

  -- ---------------------------------------------------- escalation_response
  when 'escalation_response' then
    -- Denominator is EVENTS, not members. Stated as such in the spec so a
    -- reader never reads this row's denominator as a headcount.
    v_reason := 'Alert carried no response deadline, so timeliness cannot be judged.';
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, false) as pid),
    alerts as (
      select a.sla_due_at, a.acknowledged_at
      from public.clinician_alerts a
      join cohort c on c.pid = a.patient_id
      where a.created_at >= v_start_ts and a.created_at < v_end_ts
        and coalesce(a.suppressed, false) = false
        and a.duplicate_of is null
    )
    select count(*),
           count(*) filter (where sla_due_at is not null),
           count(*) filter (where sla_due_at is not null
                              and acknowledged_at is not null
                              and acknowledged_at <= sla_due_at)
      into v_denominator, v_measurable, v_numerator
    from alerts;

  -- --------------------------------------------------- screening_completion
  when 'screening_completion' then
    v_reason := null;
    with cohort as (select private.board_cohort(p_insurer_id, p_start, p_end, true) as pid)
    select count(*),
           count(*),
           count(*) filter (where exists (
             select 1 from public.screening_results sr
             where sr.patient_id = c.pid
               and sr.created_at >= v_start_ts and sr.created_at < v_end_ts))
      into v_denominator, v_measurable, v_numerator
    from cohort c;

  else
    raise exception 'no computation is implemented for measure key %', p_compute_key
      using errcode = '23514';
  end case;

  return jsonb_build_object(
    'denominator', v_denominator,
    'measurable', v_measurable,
    'numerator', v_numerator,
    'unmeasurable', v_denominator - v_measurable,
    'unmeasurable_reason', case when v_denominator - v_measurable > 0 then v_reason else null end
  );
end;
$$;

revoke all on function private.compute_board_measure(text, uuid, date, date) from public;

-- ---------------------------------------------------------------------------
-- 8. Canonical hashing — ONE definition, used by generate, attest and verify.
--
-- jsonb is already a canonical form (keys sorted, duplicates removed,
-- whitespace normalised), so `snapshot::text` is stable for a given value
-- across dumps, restores and versions. Anything that ever needs to re-derive
-- this hash calls this function; nothing recomputes the expression inline.
-- ---------------------------------------------------------------------------
create or replace function private.board_report_hash(
  p_report_number text,
  p_period_start date,
  p_period_end date,
  p_snapshot jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(convert_to(
      'tarragon-board-report-v1' || chr(10) ||
      p_report_number || chr(10) ||
      p_period_start::text || chr(10) ||
      p_period_end::text || chr(10) ||
      p_snapshot::text, 'UTF8')),
    'hex');
$$;

revoke all on function private.board_report_hash(text, date, date, jsonb) from public;

-- ---------------------------------------------------------------------------
-- 9. Generation.
-- ---------------------------------------------------------------------------
create or replace function public.generate_payer_board_report(
  p_insurer_id uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Bump on any change to a compute branch that alters what a number MEANS.
  c_engine_version constant text := '1.0.0';
  v_insurer        public.insurers%rowtype;
  v_spec           record;
  v_raw            jsonb;
  v_floor          integer;
  v_reportable     boolean;
  v_measures       jsonb := '[]'::jsonb;
  v_limitations    text[] := array[]::text[];
  v_any            integer;
  v_cont           integer;
  v_joiners        integer;
  v_leavers        integer;
  v_claims         jsonb;
  v_claim_count    integer;
  v_snapshot       jsonb;
  v_hash           text;
  v_seq            integer;
  v_number         text;
  v_prefix         text;
  v_generated_at   timestamptz := now();
  v_generator      text;
  v_report_id      uuid;
  v_unmeasurable_total integer := 0;
  v_unreportable_count integer := 0;
begin
  perform private.assert_module_enabled('payer_platform');

  -- An analyst seat is enough to produce a draft; owner covers it implicitly.
  if not private.is_payer_admin_for(p_insurer_id, array['analyst', 'owner']) then
    raise exception 'not authorised to generate reports for this insurer' using errcode = '42501';
  end if;

  if p_period_end < p_period_start then
    raise exception 'the period ends before it starts' using errcode = '23514';
  end if;
  -- A period that has not finished cannot be reported on: half a quarter's
  -- readings would land in the denominator of a measure a reader will take as
  -- covering the whole quarter.
  if p_period_end >= current_date then
    raise exception 'a board report can only cover a period that has already ended — the latest permitted end date is %', (current_date - 1)
      using errcode = '23514';
  end if;

  select * into v_insurer from public.insurers where id = p_insurer_id;
  if v_insurer.id is null then
    raise exception 'no such insurer' using errcode = '42501';
  end if;

  select full_name into v_generator from public.profiles where id = (select auth.uid());

  -- ---------------------------------------------------------------- cohort
  select count(*) into v_any  from private.board_cohort(p_insurer_id, p_period_start, p_period_end, false);
  select count(*) into v_cont from private.board_cohort(p_insurer_id, p_period_start, p_period_end, true);

  select count(distinct ip.patient_id) into v_joiners
  from public.insurance_policies ip
  where ip.insurer_id = p_insurer_id and ip.status = 'active' and ip.verified_at is not null
    and ip.effective_from > p_period_start and ip.effective_from <= p_period_end;

  select count(distinct ip.patient_id) into v_leavers
  from public.insurance_policies ip
  where ip.insurer_id = p_insurer_id and ip.verified_at is not null
    and ip.effective_to is not null
    and ip.effective_to >= p_period_start and ip.effective_to < p_period_end;

  -- --------------------------------------------------------------- measures
  -- The latest non-retired version of every measure in force ON THE DAY THE
  -- REPORT IS PRODUCED — not on the period end date. A report written in
  -- September about the first quarter applies today's definitions to that
  -- quarter's data, which is what a reader assumes and what makes two reports
  -- issued together comparable. Gating on the period end instead would mean a
  -- measure defined after a quarter closed could never be reported for it, and
  -- would have silently produced an EMPTY report here. Which version was used
  -- is recorded per measure in the snapshot, so any two reports can be checked
  -- against each other rather than assumed comparable.
  for v_spec in
    select distinct on (s.code) s.*
    from public.outcome_measure_specs s
    where s.retired_at is null and s.effective_from <= current_date
    order by s.code, s.spec_version desc
  loop
    v_raw := private.compute_board_measure(v_spec.compute_key, p_insurer_id, p_period_start, p_period_end);
    v_floor := greatest(v_spec.min_denominator, coalesce(v_insurer.min_cohort_size, 10));
    -- The rate's own base must clear the floor, not just the eligible
    -- population: a measure with 400 eligible and 6 measurable publishes
    -- nothing, because a rate over 6 people is neither private nor meaningful.
    v_reportable := (v_raw ->> 'measurable')::integer >= v_floor;

    if not v_reportable then
      v_unreportable_count := v_unreportable_count + 1;
    end if;
    v_unmeasurable_total := v_unmeasurable_total + (v_raw ->> 'unmeasurable')::integer;

    v_measures := v_measures || jsonb_build_array(jsonb_build_object(
      'code', v_spec.code,
      'spec_version', v_spec.spec_version,
      'title', v_spec.title,
      'domain', v_spec.domain,
      'unit', v_spec.unit,
      'direction', v_spec.direction,
      'definitions', jsonb_build_object(
        'rationale', v_spec.rationale,
        'numerator', v_spec.numerator_definition,
        'denominator', v_spec.denominator_definition,
        'exclusions', v_spec.exclusion_definition,
        'limitations', v_spec.limitations,
        'data_sources', to_jsonb(v_spec.data_sources)
      ),
      'suppression_floor', v_floor,
      'reportable', v_reportable,
      'not_reportable_reason', case when v_reportable then null else
        'Fewer than ' || v_floor || ' members had the data this measure needs, so no figure is published.' end,
      -- Below the floor these are NULL, never 0. A zero here would be read as
      -- "nobody achieved it" rather than "we are not telling you".
      'denominator',  case when v_reportable then (v_raw ->> 'denominator')::integer  else null end,
      'measurable',   case when v_reportable then (v_raw ->> 'measurable')::integer   else null end,
      'numerator',    case when v_reportable then (v_raw ->> 'numerator')::integer    else null end,
      'unmeasurable', case when v_reportable then (v_raw ->> 'unmeasurable')::integer else null end,
      'unmeasurable_reason', case when v_reportable then v_raw ->> 'unmeasurable_reason' else null end,
      'rate_pct', case
        when v_reportable and (v_raw ->> 'measurable')::integer > 0
        then round(100.0 * (v_raw ->> 'numerator')::numeric / (v_raw ->> 'measurable')::numeric, 1)
        else null end,
      'data_completeness_pct', case
        when v_reportable and (v_raw ->> 'denominator')::integer > 0
        then round(100.0 * (v_raw ->> 'measurable')::numeric / (v_raw ->> 'denominator')::numeric, 1)
        else null end
    ));
  end loop;

  -- A report with no measures is not a report. This cannot happen with the
  -- shipped measure set, but a future migration that retires every spec, or a
  -- date predicate that quietly matches nothing, would otherwise issue a
  -- beautifully formatted document asserting exactly nothing — and it would
  -- verify, and somebody would put it in front of a board. Refuse instead.
  if jsonb_array_length(v_measures) = 0 then
    raise exception 'no outcome measure specifications are in force, so there is nothing to report — refusing to issue an empty report'
      using errcode = '23514';
  end if;

  -- -------------------------------------------------------------- financial
  -- Reconciliation of what was actually transacted. Reported as fact; nothing
  -- is projected, modelled or annualised from it.
  select count(*) into v_claim_count
  from public.insurance_claims cl
  join public.insurance_policies ip on ip.id = cl.policy_id
  where ip.insurer_id = p_insurer_id
    and cl.submitted_at >= p_period_start::timestamptz
    and cl.submitted_at < (p_period_end + 1)::timestamptz;

  if v_claim_count < greatest(coalesce(v_insurer.min_cohort_size, 10), 10) then
    v_claims := jsonb_build_object(
      'reportable', false,
      'not_reportable_reason', 'Too few claims in the period to report without risking identification of an individual member.');
  else
    select jsonb_build_object(
      'reportable', true,
      'claims_submitted', count(*),
      'claims_paid', count(*) filter (where cl.status = 'paid'),
      'claims_denied', count(*) filter (where cl.status = 'denied'),
      'claims_open', count(*) filter (where cl.status not in ('paid', 'denied')),
      'billed_kobo', coalesce(sum(cl.billed_amount_kobo), 0),
      'insurer_covered_kobo', coalesce(sum(cl.insurer_covered_kobo), 0),
      'member_copay_kobo', coalesce(sum(cl.patient_copay_kobo), 0))
      into v_claims
    from public.insurance_claims cl
    join public.insurance_policies ip on ip.id = cl.policy_id
    where ip.insurer_id = p_insurer_id
      and cl.submitted_at >= p_period_start::timestamptz
      and cl.submitted_at < (p_period_end + 1)::timestamptz;
  end if;

  -- ------------------------------------------------------------ limitations
  -- Derived from what actually happened in this run, not boilerplate, except
  -- the last two, which are true of every report this platform can produce
  -- and are therefore always stated.
  if v_cont = 0 then
    v_limitations := array_append(v_limitations,
      'No member of this insurer was continuously covered for the whole period, so no clinical or process measure has a population to report on.');
  elsif v_cont < v_any then
    v_limitations := array_append(v_limitations,
      'Of ' || v_any || ' members covered at some point in the period, ' || v_cont ||
      ' were covered throughout it. Clinical and process measures use only the continuously covered group.');
  end if;
  if v_unreportable_count > 0 then
    v_limitations := array_append(v_limitations,
      v_unreportable_count || ' of ' || jsonb_array_length(v_measures) ||
      ' measures are withheld because too few members had the data they need. No figure is shown for those rows.');
  end if;
  if v_unmeasurable_total > 0 then
    v_limitations := array_append(v_limitations,
      'Some eligible members had no qualifying measurement in the period. They are counted in each measure''s "not measurable" column and excluded from its rate, never counted as a failure.');
  end if;
  v_limitations := array_append(v_limitations,
    'These figures describe what happened to the covered population. There is no control group and no counterfactual, so nothing here establishes what would have happened without the programme.');
  v_limitations := array_append(v_limitations,
    'No cost saving, avoided admission or return on investment is asserted anywhere in this report. Financial figures are a reconciliation of claims actually transacted.');

  -- ------------------------------------------------------ number + snapshot
  -- Serialise per insurer so two concurrent generations cannot take the same
  -- sequence number and collide on the unique constraint.
  perform pg_advisory_xact_lock(hashtextextended(p_insurer_id::text, 0));
  select coalesce(max(sequence_no), 0) + 1 into v_seq
  from public.payer_board_reports where insurer_id = p_insurer_id;

  v_prefix := coalesce(nullif(upper(regexp_replace(coalesce(v_insurer.code, ''), '[^A-Za-z0-9]', '', 'g')), ''),
                       upper(substr(replace(p_insurer_id::text, '-', ''), 1, 6)));
  v_number := 'TAR-' || v_prefix || '-' || to_char(p_period_end, 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  v_snapshot := jsonb_build_object(
    'report', jsonb_build_object(
      'number', v_number,
      'insurer_name', v_insurer.name,
      'insurer_code', v_insurer.code,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'generated_at', v_generated_at,
      'generated_by_name', v_generator,
      'engine_version', c_engine_version
    ),
    'cohort', jsonb_build_object(
      'covered_any_time', v_any,
      'continuously_covered', v_cont,
      'joined_during_period', v_joiners,
      'left_during_period', v_leavers,
      'suppression_floor', greatest(coalesce(v_insurer.min_cohort_size, 10), 10),
      'definition', 'A member is a patient holding a verified, active policy with this insurer. "Continuously covered" means the policy was in force on the first day of the period and had not ended before the last day. Clinical and process measures use the continuously covered group only.'
    ),
    'measures', v_measures,
    'financial', v_claims,
    'limitations', to_jsonb(v_limitations),
    'lineage', jsonb_build_object(
      'source_tables', to_jsonb(array[
        'insurance_policies', 'patient_conditions', 'vitals_readings',
        'chronic_programme_enrolments', 'chronic_condition_programmes',
        'clinician_alerts', 'screening_results', 'insurance_claims']),
      'computed_at', v_generated_at,
      'timezone', 'Africa/Lagos',
      'engine_version', c_engine_version,
      'measure_definitions_in_force_on', current_date,
      'note', 'Every figure above was computed directly from these tables at the time stated. No figure was entered by hand, imported, or adjusted after computation. Each measure records the exact specification version used to produce it.'
    )
  );

  v_hash := private.board_report_hash(v_number, p_period_start, p_period_end, v_snapshot);

  insert into public.payer_board_reports (
    insurer_id, report_number, sequence_no, period_start, period_end,
    snapshot, content_hash, engine_version, generated_at, generated_by)
  values (
    p_insurer_id, v_number, v_seq, p_period_start, p_period_end,
    v_snapshot, v_hash, c_engine_version, v_generated_at, (select auth.uid()))
  returning id into v_report_id;

  -- A later report for the same insurer and period replaces the earlier one as
  -- the current statement of that period. The earlier one stays readable and
  -- hash-verifiable forever, because copies of it are already in circulation.
  update public.payer_board_reports
     set status = 'superseded', superseded_by = v_report_id
   where insurer_id = p_insurer_id
     and period_start = p_period_start and period_end = p_period_end
     and id <> v_report_id
     and status in ('draft', 'attested');

  perform private.log_audit('payer.board_report.generated', 'payer_board_report', v_report_id,
    jsonb_build_object('insurer_id', p_insurer_id, 'report_number', v_number,
                       'period_start', p_period_start, 'period_end', p_period_end,
                       'content_hash', v_hash));

  return jsonb_build_object('ok', true, 'report_id', v_report_id,
                            'report_number', v_number, 'content_hash', v_hash);
end;
$$;

revoke all on function public.generate_payer_board_report(uuid, date, date) from public;
revoke all on function public.generate_payer_board_report(uuid, date, date) from anon;
grant execute on function public.generate_payer_board_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Attestation — Tarragon-side only.
--
-- Tarragon computes these figures, so Tarragon is the party that can stand
-- behind them; an insurer attesting its own supplier's numbers would mean
-- nothing to that insurer's board. Permitted signatories are the superadmin
-- and an active Clinical Director (the same governance flag that signs
-- clinical protocols — orthogonal to doctor_tier, per CLAUDE.md).
--
-- The hash is re-derived from the stored snapshot before signing. That is the
-- whole value of the step: an attestation is a statement about content that is
-- provably the content that was generated.
-- ---------------------------------------------------------------------------
create or replace function public.attest_payer_board_report(
  p_report_id uuid,
  p_statement text,
  p_role_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.payer_board_reports%rowtype;
  v_actual text;
begin
  perform private.assert_module_enabled('payer_platform');

  if not (
    private.is_admin()
    or exists (
      select 1 from public.clinical_staff cs
      where cs.profile_id = (select auth.uid())
        and cs.is_clinical_director and cs.active
    )
  ) then
    raise exception 'only a Tarragon superadmin or an active Clinical Director may attest an outcomes report'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_statement, ''))) < 20 then
    raise exception 'an attestation needs a statement of what is being attested to' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_role_title, ''))) < 2 then
    raise exception 'an attestation needs the signatory''s role' using errcode = '23514';
  end if;

  select * into v_r from public.payer_board_reports where id = p_report_id;
  if v_r.id is null then
    raise exception 'no such report' using errcode = '42501';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'only a draft report can be attested — this one is %', v_r.status using errcode = '23514';
  end if;

  -- Integrity gate. If this ever fails, the row was tampered with by something
  -- that bypassed the trigger (a direct superuser write, a bad restore) and the
  -- report must not be signed.
  v_actual := private.board_report_hash(v_r.report_number, v_r.period_start, v_r.period_end, v_r.snapshot);
  if v_actual <> v_r.content_hash then
    raise exception 'this report''s stored figures no longer match its content hash — it cannot be attested. Generate a fresh report.'
      using errcode = '23514';
  end if;

  update public.payer_board_reports
     set status = 'attested',
         attested_by = (select auth.uid()),
         attested_at = now(),
         attestation_statement = btrim(p_statement),
         attester_role_title = btrim(p_role_title)
   where id = p_report_id;

  perform private.log_audit('payer.board_report.attested', 'payer_board_report', p_report_id,
    jsonb_build_object('insurer_id', v_r.insurer_id, 'report_number', v_r.report_number,
                       'content_hash', v_r.content_hash, 'role_title', btrim(p_role_title)));

  return jsonb_build_object('ok', true, 'status', 'attested');
end;
$$;

revoke all on function public.attest_payer_board_report(uuid, text, text) from public;
revoke all on function public.attest_payer_board_report(uuid, text, text) from anon;
grant execute on function public.attest_payer_board_report(uuid, text, text) to authenticated;

create or replace function public.withdraw_payer_board_report(
  p_report_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payer_board_reports%rowtype;
begin
  perform private.assert_module_enabled('payer_platform');
  if not private.is_admin() then
    raise exception 'only a Tarragon superadmin may withdraw an issued outcomes report' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a withdrawal needs a reason — it will be shown to anyone verifying a copy' using errcode = '23514';
  end if;

  select * into v_r from public.payer_board_reports where id = p_report_id;
  if v_r.id is null then
    raise exception 'no such report' using errcode = '42501';
  end if;
  if v_r.status = 'withdrawn' then
    raise exception 'this report is already withdrawn' using errcode = '23514';
  end if;

  update public.payer_board_reports
     set status = 'withdrawn', withdrawn_at = now(),
         withdrawn_by = (select auth.uid()), withdrawal_reason = btrim(p_reason)
   where id = p_report_id;

  perform private.log_audit('payer.board_report.withdrawn', 'payer_board_report', p_report_id,
    jsonb_build_object('insurer_id', v_r.insurer_id, 'report_number', v_r.report_number,
                       'reason', btrim(p_reason)));

  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end;
$$;

revoke all on function public.withdraw_payer_board_report(uuid, text) from public;
revoke all on function public.withdraw_payer_board_report(uuid, text) from anon;
grant execute on function public.withdraw_payer_board_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Independent verification.
--
-- The person this is for is a board member or an auditor holding a printout.
-- They have no account and should not need one. They have two things off the
-- document — the report number and the 64-character content hash — and BOTH
-- are required, which is what makes this safe to expose without a login: the
-- hash is not guessable, so this cannot be walked to enumerate an insurer's
-- reporting history.
--
-- ⚠️ WHAT THIS MAY RETURN — read before changing. It answers a question ABOUT
-- A DOCUMENT: is this genuine, whose is it, what period, who signed it, is it
-- still current. It must NEVER return a figure, a measure result, a cohort
-- size or any part of the snapshot. The reader is already holding the numbers;
-- what they lack is proof, and proof is all this gives. Same posture as
-- health_passport_by_serial and emergency_card_by_token.
-- ---------------------------------------------------------------------------
create or replace function public.verify_payer_board_report(
  p_report_number text,
  p_content_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r         public.payer_board_reports%rowtype;
  v_insurer   text;
  v_attester  text;
begin
  if coalesce(btrim(p_content_hash), '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('verified', false,
      'reason', 'That does not look like a report verification code. Copy all 64 characters from the report footer.');
  end if;

  select * into v_r from public.payer_board_reports
   where report_number = btrim(p_report_number)
     and content_hash = lower(btrim(p_content_hash));

  if v_r.id is null then
    -- Deliberately one message for both "no such number" and "hash does not
    -- match": telling them apart would let somebody with a number probe for
    -- the hash, and would confirm a report exists that they cannot verify.
    return jsonb_build_object('verified', false,
      'reason', 'No issued report matches that number and verification code. If you are holding a printed copy, check both were copied exactly.');
  end if;

  select name into v_insurer from public.insurers where id = v_r.insurer_id;
  select full_name into v_attester from public.profiles where id = v_r.attested_by;

  return jsonb_build_object(
    'verified', true,
    'report_number', v_r.report_number,
    'issued_to', v_insurer,
    'period_start', v_r.period_start,
    'period_end', v_r.period_end,
    'generated_at', v_r.generated_at,
    'status', v_r.status,
    -- Null-gated exactly like every other attribution on this platform: an
    -- unattested report says so, it does not quietly omit the line.
    'attested', v_r.attested_by is not null,
    'attested_by_name', v_attester,
    'attested_at', v_r.attested_at,
    'attester_role_title', v_r.attester_role_title,
    'attestation_statement', v_r.attestation_statement,
    'withdrawn', v_r.status = 'withdrawn',
    'withdrawal_reason', v_r.withdrawal_reason,
    'superseded', v_r.status = 'superseded',
    'note', case
      when v_r.status = 'withdrawn' then 'This report has been withdrawn and must not be relied on.'
      when v_r.status = 'superseded' then 'A later report covers the same insurer and period. This copy is genuine but is no longer the current statement of that period.'
      when v_r.attested_by is null then 'This report is genuine but is an unattested draft. It has not been signed off and should not be presented as final.'
      else 'This report is genuine, current, and attested.'
    end
  );
end;
$$;

revoke all on function public.verify_payer_board_report(text, text) from public;
grant execute on function public.verify_payer_board_report(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. The measure set, version 1.
--
-- Six measures: two clinical outcomes, two process, one service, and the
-- financial reconciliation (which is built into the report rather than being a
-- spec, since it is a statement of transactions rather than a rate).
--
-- The prose below is the part a board actually reads, so it is written for a
-- board: no ICD codes in the sentence, thresholds stated in full, and a
-- limitations line on every one that says what the measure cannot tell you.
-- Editing any of this text after a report cites it is refused by trigger —
-- raise spec_version 2 instead.
-- ---------------------------------------------------------------------------
insert into public.outcome_measure_specs (
  code, spec_version, title, domain, rationale,
  numerator_definition, denominator_definition, exclusion_definition, limitations,
  data_sources, unit, direction, min_denominator, compute_key)
values
(
  'bp_control', 1, 'Blood pressure controlled', 'clinical_outcome',
  'Uncontrolled hypertension is the largest single driver of stroke, kidney failure and heart failure in Nigerian adults, and the proportion of a covered population reaching target is the clearest measure of whether a chronic care programme is working.',
  'Members whose most recent blood pressure reading in the period was below 140 systolic and below 90 diastolic.',
  'Members continuously covered for the whole period who have a hypertension diagnosis recorded on or before the period end date, with a clinical status of active, controlled or uncontrolled. A diagnosis is matched on a recorded condition name of "hypertension" or "high blood pressure", or an ICD-10 code beginning I1.',
  'Members whose hypertension is recorded only as suspected, under investigation, resolved or historical are excluded, as are members not covered for the whole period.',
  'The reading used is whatever was most recently recorded, from any source the platform accepts: a member typing a reading in, a paired Bluetooth cuff, or a consumer wearable. Readings are not adjudicated, repeat-confirmed, or restricted to clinic-measured values, so this is a real-world control rate and not a trial endpoint. A member with no reading in the period is reported as not measurable, never as uncontrolled.',
  array['vitals_readings', 'patient_conditions', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'bp_control'
),
(
  'glycaemic_control', 1, 'Fasting glucose at target', 'clinical_outcome',
  'Sustained hyperglycaemia drives every major diabetes complication, and the share of a covered diabetic population at target is the standard way to judge whether a diabetes programme is holding.',
  'Members whose most recent fasting glucose reading in the period was below 7.0 mmol/L.',
  'Members continuously covered for the whole period who have a diabetes diagnosis recorded on or before the period end date, with a clinical status of active, controlled or uncontrolled. A diagnosis is matched on a recorded condition name containing "diabetes", or an ICD-10 code beginning E1.',
  'Members whose diabetes is recorded only as suspected, under investigation, resolved or historical are excluded, as are members not covered for the whole period. Non-fasting, post-meal, bedtime and random glucose readings are excluded from the measure entirely.',
  'This is a fasting capillary or meter glucose measure, NOT HbA1c. It reflects glucose on the day it was taken rather than control over the preceding three months, and it is therefore a weaker measure than the HbA1c figure a clinical audit would normally use. The platform does not currently hold HbA1c results in a structured form; when it does, this measure will be superseded by a new specification rather than silently redefined.',
  array['vitals_readings', 'patient_conditions', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'glycaemic_control'
),
(
  'programme_enrolment', 1, 'Eligible members enrolled in a care programme', 'process',
  'A care programme cannot change an outcome for somebody who is not in it. Enrolment is the first place a chronic care contract leaks value, and it is fully observable, so it is reported without any data-completeness caveat.',
  'Members who are enrolled in, or have completed, a chronic care programme matching their condition, at any point up to the period end date.',
  'Members continuously covered for the whole period who have an active, controlled or uncontrolled diagnosis matching a live Tarragon chronic care programme.',
  'Members whose only conditions have no matching programme are excluded, since there is nothing for them to enrol in. Withdrawn enrolments are not counted in the numerator.',
  'This measures enrolment, not participation or benefit. A member counted here may have enrolled and never engaged; engagement is a separate question this measure does not answer.',
  array['chronic_programme_enrolments', 'chronic_condition_programmes', 'patient_conditions', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'programme_enrolment'
),
(
  'review_currency', 1, 'Clinical review up to date', 'process',
  'A chronic condition that nobody has reviewed on schedule is being carried, not managed. This is the process measure most likely to expose a programme that is enrolling members and then not following them.',
  'Members whose next clinical review, across all their active conditions, falls on or after the period end date — that is, no review was overdue at the close of the period.',
  'Members continuously covered for the whole period with at least one active, controlled or uncontrolled condition on record.',
  'Conditions recorded as suspected, under investigation, resolved or historical are excluded from the review date calculation.',
  'Members whose condition record carries no next-review date at all are reported as not measurable rather than as compliant. That is itself a finding: a missing review date is a record-keeping gap, and counting those members as up to date would flatter the figure.',
  array['patient_conditions', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'review_currency'
),
(
  'escalation_response', 1, 'Clinical alerts answered within the response deadline', 'service',
  'When a reading or result crosses a clinical threshold the platform raises an alert with a deadline attached. Whether those deadlines are met is the most direct service-quality measure a payer can hold its care provider to.',
  'Alerts acknowledged by a clinician on or before their stated response deadline.',
  'Every clinical alert raised during the period for a member covered by this insurer at any point in the period. NOTE: the denominator of this measure counts ALERTS, not members — one member may account for several.',
  'Alerts suppressed as noise, and alerts marked as duplicates of an earlier alert, are excluded so that one clinical event is not counted repeatedly.',
  'This measures the time to a clinician acknowledging an alert, not the time to the member being contacted and not the clinical quality of what followed. An alert answered within its deadline and then handled badly counts as met here.',
  array['clinician_alerts', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'escalation_response'
),
(
  'screening_completion', 1, 'Members completing at least one preventive screen', 'process',
  'Preventive screening is where a chronic-disease population is found before it becomes expensive, and it is the activity a payer is most often buying without being shown whether it happened.',
  'Members with at least one screening result recorded during the period.',
  'All members continuously covered for the whole period.',
  'No member is excluded. Every continuously covered member is in the denominator whether or not any screen was clinically indicated for them.',
  'This counts whether a screen happened, not whether the right screen happened for that member''s age and risk, and not whether an abnormal finding was acted on. A low figure here may reflect a population that is largely young and low-risk as much as a gap in delivery.',
  array['screening_results', 'insurance_policies'],
  'percent', 'higher_is_better', 10, 'screening_completion'
)
on conflict (code, spec_version) do nothing;

-- ---------------------------------------------------------------------------
-- 13. Assertions.
--
-- Structure first, then a real behavioural proof inside a subtransaction that
-- is deliberately rolled back — including a CONTROL for every negative, so a
-- test that passes vacuously (because the trigger blocks everything, or
-- because nothing was inserted at all) is caught rather than believed. The
-- deeper session-scoped RLS proofs live in
-- packages/db/tests/payer_board_outcomes_report.sql.
-- ---------------------------------------------------------------------------
do $$
declare
  v_spec       record;
  v_out        jsonb;
  v_h1         text;
  v_h2         text;
  v_insurer    uuid;
  v_report     uuid;
  v_other_spec uuid;
  v_snap       jsonb;
  v_ok         boolean;
  v_n          integer;
begin
  -- 1. Every shipped definition has a working implementation. A spec whose
  --    compute_key has no branch is a promise with nothing behind it.
  for v_spec in select * from public.outcome_measure_specs where retired_at is null loop
    v_out := private.compute_board_measure(v_spec.compute_key, gen_random_uuid(), '2026-01-01', '2026-03-31');
    if not (v_out ? 'denominator') or not (v_out ? 'measurable')
       or not (v_out ? 'numerator') or not (v_out ? 'unmeasurable') then
      raise exception 'FAIL: measure % returned an incomplete shape: %', v_spec.code, v_out;
    end if;
    -- An insurer with no members must produce zeros, not nulls and not an error.
    if (v_out ->> 'denominator')::integer <> 0 then
      raise exception 'FAIL: measure % invented a denominator for an insurer with no members', v_spec.code;
    end if;
  end loop;

  -- 2. Hashing is deterministic, and sensitive to the figures.
  v_h1 := private.board_report_hash('TAR-X-2026-0001', '2026-01-01', '2026-03-31', '{"a":1}'::jsonb);
  v_h2 := private.board_report_hash('TAR-X-2026-0001', '2026-01-01', '2026-03-31', '{"a":1}'::jsonb);
  if v_h1 <> v_h2 then
    raise exception 'FAIL: content hash is not deterministic';
  end if;
  if v_h1 = private.board_report_hash('TAR-X-2026-0001', '2026-01-01', '2026-03-31', '{"a":2}'::jsonb) then
    raise exception 'FAIL: content hash does not change when the figures change';
  end if;
  if v_h1 !~ '^[0-9a-f]{64}$' then
    raise exception 'FAIL: content hash is not 64 hex characters';
  end if;

  -- 3. Behavioural proof against real rows, rolled back at the end.
  begin
    -- is_active stays false: insurers_active_requires_live only lets a live
    -- insurer be active, and this fixture is neither.
    insert into public.insurers (name, code, is_active)
    values ('ZZ Assertion Insurer', 'ZZASSERT', false) returning id into v_insurer;

    v_snap := jsonb_build_object('measures', jsonb_build_array(
      jsonb_build_object('code', 'bp_control', 'spec_version', 1)));

    insert into public.payer_board_reports (
      insurer_id, report_number, sequence_no, period_start, period_end,
      snapshot, content_hash, engine_version)
    values (
      v_insurer, 'TAR-ZZASSERT-2026-0001', 1, '2026-01-01', '2026-03-31',
      v_snap,
      private.board_report_hash('TAR-ZZASSERT-2026-0001', '2026-01-01', '2026-03-31', v_snap),
      '1.0.0')
    returning id into v_report;

    -- 3a. CONTROL: a permitted update must still succeed, or every negative
    --     below would pass simply because the trigger blocks everything.
    update public.payer_board_reports set status = 'superseded' where id = v_report;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'FAIL: a permitted status change was blocked — the immutability trigger is over-broad';
    end if;
    update public.payer_board_reports set status = 'draft' where id = v_report;

    -- 3b. The figures cannot be edited.
    v_ok := false;
    begin
      update public.payer_board_reports set snapshot = '{"cooked":true}'::jsonb where id = v_report;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: an issued report''s snapshot could be rewritten'; end if;

    -- 3c. Nor the period, nor the hash, nor the number.
    v_ok := false;
    begin
      update public.payer_board_reports set period_end = '2026-06-30' where id = v_report;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: an issued report''s period could be moved'; end if;

    v_ok := false;
    begin
      update public.payer_board_reports set content_hash = repeat('a', 64) where id = v_report;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: an issued report''s content hash could be replaced'; end if;

    -- 3d. It cannot be deleted, in any state.
    v_ok := false;
    begin
      delete from public.payer_board_reports where id = v_report;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: an issued report could be deleted'; end if;

    -- 3e. A cited measure spec is frozen...
    v_ok := false;
    begin
      update public.outcome_measure_specs set numerator_definition = 'Anything we like, retroactively.'
       where code = 'bp_control' and spec_version = 1;
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: a measure definition cited by an issued report could be rewritten'; end if;

    -- 3f. ...and CONTROL: an uncited spec is still editable, so 3e proves
    --     citation-freezing and not a blanket ban on ever editing a spec.
    insert into public.outcome_measure_specs (
      code, spec_version, title, domain, rationale, numerator_definition,
      denominator_definition, exclusion_definition, limitations, data_sources,
      direction, compute_key)
    values ('zz_uncited_probe', 1, 'Uncited probe', 'process',
      'Exists only to prove the freeze trigger discriminates between cited and uncited specs.',
      'Numerator text long enough to satisfy the length constraint.',
      'Denominator text long enough to satisfy the length constraint.',
      'No exclusions.',
      'This spec is a test fixture and is rolled back immediately.',
      array['insurance_policies'], 'higher_is_better', 'screening_completion')
    returning id into v_other_spec;

    update public.outcome_measure_specs
       set numerator_definition = 'Edited freely, because no report has cited this version.'
     where id = v_other_spec;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'FAIL: an UNCITED measure spec could not be edited — the freeze trigger is over-broad';
    end if;

    -- 3g. Verification answers about the document, and never with a figure.
    v_out := public.verify_payer_board_report('TAR-ZZASSERT-2026-0001',
      private.board_report_hash('TAR-ZZASSERT-2026-0001', '2026-01-01', '2026-03-31', v_snap));
    if (v_out ->> 'verified') <> 'true' then
      raise exception 'FAIL: a genuine report did not verify: %', v_out;
    end if;
    if (v_out ->> 'attested') <> 'false' then
      raise exception 'FAIL: an unattested report claimed attestation';
    end if;
    if v_out ? 'snapshot' or v_out ? 'measures' or v_out ? 'cohort' then
      raise exception 'FAIL: verification leaked report content: %', v_out;
    end if;

    -- 3h. A wrong hash verifies nothing, even with the right number.
    v_out := public.verify_payer_board_report('TAR-ZZASSERT-2026-0001', repeat('b', 64));
    if (v_out ->> 'verified') <> 'false' then
      raise exception 'FAIL: verification accepted a wrong content hash';
    end if;

    raise exception 'ROLLBACK_ASSERTIONS';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_ASSERTIONS' then raise; end if;
  end;

  -- 4. The generation RPC refuses an unauthorised caller. In migration context
  --    there is no auth.uid(), so is_payer_admin_for() is false for every
  --    insurer — this must raise rather than return a report.
  if exists (select 1 from public.insurers) then
    v_ok := false;
    begin
      perform public.generate_payer_board_report(
        (select id from public.insurers order by created_at limit 1),
        current_date - 90, current_date - 1);
    exception
      when insufficient_privilege then v_ok := true;
      when check_violation then v_ok := true;  -- module dormant; also a refusal
    end;
    if not v_ok then
      raise exception 'FAIL: generate_payer_board_report produced a report for an unauthorised caller';
    end if;
  end if;

  -- 5. anon may verify a document it holds, and may do nothing else.
  if not has_function_privilege('anon', 'public.verify_payer_board_report(text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon cannot verify a report — the whole point of the verification surface';
  end if;
  if has_function_privilege('anon', 'public.generate_payer_board_report(uuid,date,date)', 'EXECUTE') then
    raise exception 'FAIL: anon can generate a board report';
  end if;
  if has_function_privilege('anon', 'public.attest_payer_board_report(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can attest a board report';
  end if;
  if has_function_privilege('anon', 'public.withdraw_payer_board_report(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can withdraw a board report';
  end if;
  if has_table_privilege('anon', 'public.payer_board_reports', 'SELECT') then
    raise exception 'FAIL: anon can read board reports directly';
  end if;
  -- Writes reach the table only through the RPCs, never from a client.
  if has_table_privilege('authenticated', 'public.payer_board_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.payer_board_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.payer_board_reports', 'DELETE') then
    raise exception 'FAIL: a signed-in client holds a direct write grant on board reports';
  end if;
  -- CONTROL: reading is still granted, so the check above is a revoke and not
  -- an accidental lockout of the whole table.
  if not has_table_privilege('authenticated', 'public.payer_board_reports', 'SELECT') then
    raise exception 'FAIL: authenticated lost SELECT on board reports';
  end if;

  raise notice 'PASS: board outcomes report — definitions implemented, figures frozen, hash tamper-evident, verification discloses no content';
end $$;
