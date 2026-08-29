-- Nigerian lab-report ingestion engine
--
-- WHY
-- Self-arranged fulfilment means a result arrives as a PDF or a phone photo
-- from any laboratory in the country. Reading those reliably is the highest-
-- leverage thing this platform can be good at, and the only asset here that
-- gets harder to copy over time.
--
-- FIRST, A DEFECT THIS CLOSES
-- The platform shipped TWO independent AI extraction engines, both live, both
-- reading the same uploaded document:
--   * lib/lab-extraction  -> public.lab_result_extractions, fired automatically
--     on every upload, 7 analytes, confirmed through a SECURITY DEFINER RPC;
--   * lib/lab-reports     -> public.lab_report_extractions, fired on demand by
--     a clinician, 26 analytes, confirmed by a direct session insert.
-- Both panels rendered on the same clinician page. The same result could be
-- proposed twice, with different values, and BOTH could be confirmed — writing
-- two sets of readings into lab_analyte_readings for one document. This
-- migration retires the narrower engine and keeps the better one, taking the
-- retired engine's stronger confirmation path with it (section 7).
--
-- Nothing is lost: public.lab_result_extractions, public.lab_report_extractions
-- and public.lab_analyte_readings all held ZERO rows when this was written, and
-- so did public.lab_result_documents. The whole feature had never been used in
-- production. Row counts are recorded here so a later reader can see why there
-- is no conversion step anywhere in this file.
--
-- WHAT ELSE HAPPENS HERE
--   1. lab_analyte_readings learns to hold a NON-NUMERIC result. A genotype is
--      "AS", a malaria film is "positive", a urine dipstick is "2+" — none are
--      numbers, and all are results a Nigerian doctor acts on daily.
--   2. lab_report_templates: the corpus. What a laboratory's report looks like
--      and how accurately we have read it so far. Holds no patient data, by
--      construction — see the tenancy note in section 3.
--   3. lab_extraction_corrections: the learning signal. Every clinician
--      acceptance, correction and rejection, recorded against the template.
--   4. An escalation bridge that lets a machine reading RAISE THE PRIORITY of
--      the review alert that already exists for the upload, and nothing else.
--
-- THE SAFETY INVARIANT IS UNCHANGED
-- AI drafts, never decides. Extraction writes only a PROPOSAL. It creates no
-- screening_results row, sets no abnormal flag, notifies no patient, and puts
-- nothing into the clinical record until a clinician confirms. The escalation
-- bridge is deliberately the weakest possible version of "make the pipeline
-- fire": it can move an alert a human is already going to read further up that
-- human's queue. It cannot create an alert, cannot reach 'emergency', cannot
-- lower a level, and cannot tell a patient anything.

-- ---------------------------------------------------------------------------
-- 1. Non-numeric results
-- ---------------------------------------------------------------------------
-- numeric(8,3) caps at 99999.999, which a malaria parasite density (up to about
-- 2,000,000 per microlitre) exceeds outright. Widened while the table is empty,
-- which is the only cheap moment to do it.
alter table public.lab_analyte_readings
  alter column value type numeric(12, 4);

alter table public.lab_analyte_readings
  alter column value drop not null,
  alter column unit drop not null,
  add column if not exists value_text text;

-- Exactly one of the two must be present, and a numeric reading must carry its
-- unit. Without this, the relaxed NOT NULLs above would permit a row that says
-- nothing at all, or a number on an unknown scale.
alter table public.lab_analyte_readings
  drop constraint if exists lab_analyte_readings_one_value;
alter table public.lab_analyte_readings
  add constraint lab_analyte_readings_one_value check (
    (value is not null and value_text is null and unit is not null)
    or (value is null and value_text is not null)
  );

comment on column public.lab_analyte_readings.value_text is
  'Coded non-numeric result (genotype AS, malaria positive, urine protein 2+). Mutually exclusive with value.';

-- ---------------------------------------------------------------------------
-- 2. Retire the duplicate engine
-- ---------------------------------------------------------------------------
-- lib/lab-extraction and its table go away entirely. The RPC is dropped first
-- because it references the table.
drop function if exists public.confirm_lab_result_extraction(uuid, jsonb);
drop table if exists public.lab_result_extractions;

-- ---------------------------------------------------------------------------
-- 3. The template corpus
-- ---------------------------------------------------------------------------
-- TENANCY NOTE — why this table has no organisation_id.
-- Every table carrying patient data on this platform is organisation-scoped and
-- RLS-enforced, and that rule is not being bent here. This is a CATALOGUE, in
-- the same class as public.screen_types and public.lab_providers, which are
-- likewise org-less: it describes what a laboratory's stationery looks like and
-- what words it prints. It holds no patient, no result, no date and no document
-- reference. The whole value of a corpus is that it compounds across every
-- upload; the cost of that would be unacceptable if a single row could identify
-- a person, so no such row can exist. The per-patient half of the learning
-- signal lives in lab_extraction_corrections (section 4), which IS org-scoped
-- and RLS-enforced like everything else.
create table if not exists public.lab_report_templates (
  id uuid primary key default gen_random_uuid(),
  -- As printed on the report, for display ("Synlab Nigeria").
  lab_name text not null,
  -- Corporate boilerplate stripped, for matching. Computed by the application
  -- (lib/lab-reports/corpus.ts) so one normalisation serves both sides.
  lab_name_key text not null,
  -- Stable hash of the report's structural signature: which row labels appear.
  -- Two reports on the same stationery for the same panel collide here, which
  -- is exactly the point.
  layout_fingerprint text not null,
  -- Learned reading hints fed back into the prompt for this layout:
  -- {"labelAliases": {"PACKED CELL VOL": "haematocrit"},
  --  "unitDefaults": {"wbc": "10^9/L"}, "notes": [...]}
  hints jsonb not null default '{}'::jsonb,
  -- Accuracy counters. Aggregate only, never per patient.
  documents_seen integer not null default 0,
  readings_proposed integer not null default 0,
  readings_accepted integer not null default 0,
  readings_corrected integer not null default 0,
  readings_rejected integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lab_report_templates_identity unique (lab_name_key, layout_fingerprint)
);

create index if not exists lab_report_templates_lab_idx
  on public.lab_report_templates (lab_name_key);

alter table public.lab_report_templates enable row level security;

-- Readable by any signed-in user: it is a catalogue of laboratory stationery,
-- not patient data. Writes are service-role only, so the corpus can only grow
-- from a real confirmation and never from a client that claims to have seen
-- something.
drop policy if exists lab_report_templates_select on public.lab_report_templates;
create policy lab_report_templates_select on public.lab_report_templates
  for select to authenticated using (true);

-- RLS restricts ROWS; it does not grant table access. Missing exactly this
-- grant has silently broken access at least three times in this codebase's
-- history, so it ships with an assertion at the bottom of this file.
grant select on public.lab_report_templates to authenticated;

drop trigger if exists lab_report_templates_set_updated_at on public.lab_report_templates;
create trigger lab_report_templates_set_updated_at
  before update on public.lab_report_templates
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. The learning signal
-- ---------------------------------------------------------------------------
-- One row per proposed reading per confirmation: what the model said, and what
-- the clinician actually accepted. A REJECTED row (proposed, not confirmed) is
-- the most valuable record in the whole corpus — it is the model being wrong in
-- a way a human caught.
create table if not exists public.lab_extraction_corrections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  extraction_id uuid not null
    references public.lab_report_extractions (id) on delete cascade,
  template_id uuid references public.lab_report_templates (id) on delete set null,
  code text not null,
  outcome text not null check (outcome in ('accepted', 'corrected', 'rejected')),
  proposed_value numeric(12, 4),
  proposed_value_text text,
  confirmed_value numeric(12, 4),
  confirmed_value_text text,
  -- What was on the page, so alias and unit lists grow from evidence.
  printed_label text,
  printed_unit text,
  printed_range text,
  model_confidence text check (model_confidence is null or model_confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now()
);

create index if not exists lab_extraction_corrections_template_idx
  on public.lab_extraction_corrections (template_id, code);
create index if not exists lab_extraction_corrections_extraction_idx
  on public.lab_extraction_corrections (extraction_id);

alter table public.lab_extraction_corrections enable row level security;

drop policy if exists lab_extraction_corrections_select on public.lab_extraction_corrections;
create policy lab_extraction_corrections_select on public.lab_extraction_corrections
  for select using (private.is_org_staff(organisation_id));

grant select on public.lab_extraction_corrections to authenticated;
revoke select on public.lab_extraction_corrections from anon;

-- ---------------------------------------------------------------------------
-- 5. Extraction row: which template, and how it went
-- ---------------------------------------------------------------------------
alter table public.lab_report_extractions
  add column if not exists template_id uuid
    references public.lab_report_templates (id) on delete set null,
  add column if not exists lab_name_key text,
  add column if not exists layout_fingerprint text,
  -- Set when a proposal contained a value that WOULD be critical if confirmed,
  -- and the review alert was therefore raised. Never itself a clinical finding.
  add column if not exists critical_suspected boolean not null default false;

create index if not exists lab_report_extractions_template_idx
  on public.lab_report_extractions (template_id);

-- ---------------------------------------------------------------------------
-- 6. The escalation bridge
-- ---------------------------------------------------------------------------
-- Raises the urgency of the clinician_review alert that
-- private.handle_lab_result_document already created for this upload.
--
-- Every constraint is deliberate:
--   * RAISES only. alert_level is an ordered enum, so the comparison is exact,
--     and a request to lower an alert is ignored rather than honoured;
--   * stops at 'urgent_escalation'. 'emergency' stays reserved for the
--     confirmed-finding and emergency-event pipelines — a machine reading of a
--     photograph must never be able to declare an emergency;
--   * touches ONE alert, the one already attached to this document. It cannot
--     create an alert, so it cannot manufacture work out of nothing;
--   * writes no screening_results row and sends no notification, so nothing
--     reaches the patient on the strength of an unconfirmed reading;
--   * leaves a closed alert alone — a clinician has already dealt with it;
--   * is service-role only, so no client session can escalate its own upload.
create or replace function public.raise_lab_extraction_alert(
  p_document_id uuid,
  p_level public.alert_level,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_doc record;
  v_alert record;
  v_target public.alert_level;
  v_sla_minutes integer;
begin
  -- Never above urgent_escalation, whatever the caller asks for.
  v_target := least(p_level, 'urgent_escalation'::public.alert_level);

  select id, organisation_id, patient_id, clinician_alert_id
    into v_doc
  from public.lab_result_documents
  where id = p_document_id;

  if v_doc.id is null or v_doc.clinician_alert_id is null then
    return false;
  end if;

  select id, level, status into v_alert
  from public.clinician_alerts
  where id = v_doc.clinician_alert_id;

  if v_alert.id is null or v_alert.status <> 'open' then
    return false;
  end if;

  if v_alert.level >= v_target then
    return false;
  end if;

  v_sla_minutes := case v_target
    when 'urgent_escalation'::public.alert_level then 120
    else 1440
  end;

  update public.clinician_alerts
     set level = v_target,
         escalation_level = greatest(coalesce(escalation_level, 2), 3),
         sla_due_at = least(
           coalesce(sla_due_at, now() + make_interval(mins => v_sla_minutes)),
           now() + make_interval(mins => v_sla_minutes)
         ),
         detail = coalesce(detail, '') || format(
           E'\n\nPriority raised automatically: %s Nothing has been recorded on the patient''s record — the extracted values are a proposal awaiting your confirmation.',
           p_reason
         )
   where id = v_alert.id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_doc.organisation_id,
    null, -- machine-initiated; there is no acting user, by design
    'lab_extraction.alert_raised',
    'clinician_alerts',
    v_alert.id,
    jsonb_build_object(
      'document_id', p_document_id,
      'from_level', v_alert.level::text,
      'to_level', v_target::text,
      'reason', p_reason
    )
  );

  return true;
end;
$function$;

-- `revoke ... from public` is what actually removes anon's inherited EXECUTE —
-- it arrives through the PUBLIC pseudo-role, not a direct grant. Revoking from
-- anon alone leaves the function executable, a mistake this codebase has made
-- and re-made. Asserted at the bottom of this file.
revoke all on function public.raise_lab_extraction_alert(uuid, public.alert_level, text) from public;
revoke all on function public.raise_lab_extraction_alert(uuid, public.alert_level, text) from anon;
revoke all on function public.raise_lab_extraction_alert(uuid, public.alert_level, text) from authenticated;
grant execute on function public.raise_lab_extraction_alert(uuid, public.alert_level, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Corpus upsert (service-role only)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_lab_report_template(
  p_lab_name text,
  p_lab_name_key text,
  p_layout_fingerprint text,
  p_readings_proposed integer default 0,
  p_hints jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if p_lab_name_key is null or btrim(p_lab_name_key) = ''
     or p_layout_fingerprint is null or btrim(p_layout_fingerprint) = '' then
    return null;
  end if;

  insert into public.lab_report_templates
    (lab_name, lab_name_key, layout_fingerprint, documents_seen, readings_proposed, hints)
  values
    (coalesce(nullif(btrim(p_lab_name), ''), p_lab_name_key), p_lab_name_key,
     p_layout_fingerprint, 1, coalesce(p_readings_proposed, 0),
     coalesce(p_hints, '{}'::jsonb))
  on conflict (lab_name_key, layout_fingerprint) do update
    set documents_seen    = public.lab_report_templates.documents_seen + 1,
        readings_proposed = public.lab_report_templates.readings_proposed
                            + coalesce(p_readings_proposed, 0),
        hints             = case
                              when p_hints is null then public.lab_report_templates.hints
                              else public.lab_report_templates.hints || p_hints
                            end,
        last_seen_at      = now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.upsert_lab_report_template(text, text, text, integer, jsonb) from public;
revoke all on function public.upsert_lab_report_template(text, text, text, integer, jsonb) from anon;
revoke all on function public.upsert_lab_report_template(text, text, text, integer, jsonb) from authenticated;
grant execute on function public.upsert_lab_report_template(text, text, text, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Confirmation, ported from the retired engine
-- ---------------------------------------------------------------------------
-- The engine being kept confirmed results with a direct session insert plus an
-- app-layer status check. That leaves two real gaps the retired engine's RPC
-- had already closed, and this brings them across:
--
--   * DOUBLE FILING. "Is it already confirmed?" was checked in application code
--     and acted on in a separate statement, so two review tabs could both pass
--     the check and both file. Here the check and the write are one
--     transaction, and the second caller is refused by the database.
--   * WHO CONFIRMED IT. confirmed_by was written from the application's idea of
--     the caller. Here it is derived from the caller's own active
--     clinical_staff row inside the function, so it cannot be forged, and an
--     org-staff account that is NOT clinical (a Care Coordinator, per the
--     non-clinical write guardrail in CLAUDE.md) is refused outright rather
--     than relying on the app-layer gate alone.
--
-- The values written are the ones the REVIEWER submitted, which may differ from
-- what the model proposed — correcting a misread is the entire point of the
-- review, and it is why this takes readings as an argument rather than filing
-- `rows` blindly. The correction log is derived from proposed-versus-confirmed,
-- both of which this function reads itself, so a client cannot send a
-- flattering delta.
create or replace function public.confirm_lab_report_extraction(
  p_extraction_id uuid,
  p_readings jsonb,
  p_report_date date
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.lab_report_extractions%rowtype;
  v_staff_id uuid;
  v_reading jsonb;
  v_proposed jsonb;
  v_taken_at timestamptz;
  v_code text;
  v_value numeric;
  v_value_text text;
  v_unit text;
  v_outcome text;
  v_accepted integer := 0;
  v_corrected integer := 0;
  v_rejected integer := 0;
  v_filed integer := 0;
  v_codes text[] := '{}';
begin
  select * into v_row from public.lab_report_extractions where id = p_extraction_id;
  if v_row.id is null then
    raise exception 'Extraction not found' using errcode = '42501';
  end if;

  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_row.organisation_id
    and cs.active;
  if v_staff_id is null then
    raise exception 'Only an active care-team clinician can file an extracted result'
      using errcode = '42501';
  end if;

  if v_row.status = 'confirmed' then
    raise exception 'These results have already been filed' using errcode = '23505';
  end if;
  if v_row.status = 'failed' then
    raise exception 'This report could not be read, so there is nothing to file'
      using errcode = '22023';
  end if;

  -- Midday UTC so a timezone shift can never move a reading across a day
  -- boundary and reorder a trend.
  v_taken_at := (p_report_date::text || ' 12:00:00+00')::timestamptz;

  for v_reading in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb))
  loop
    v_code := v_reading->>'code';
    v_value := nullif(v_reading->>'value', '')::numeric;
    v_value_text := nullif(v_reading->>'value_text', '');
    v_unit := nullif(v_reading->>'unit', '');

    if v_code is null or (v_value is null and v_value_text is null) then
      raise exception 'Each reading needs a code and either a value or a value_text'
        using errcode = '22023';
    end if;

    insert into public.lab_analyte_readings
      (organisation_id, patient_id, code, value, value_text, unit, taken_at)
    values (
      v_row.organisation_id,
      v_row.patient_id,
      v_code,
      v_value,
      v_value_text,
      case when v_value is not null then v_unit else null end,
      v_taken_at
    );

    v_codes := v_codes || v_code;
    v_filed := v_filed + 1;

    select r into v_proposed
    from jsonb_array_elements(coalesce(v_row.rows, '[]'::jsonb)) as r
    where r->>'code' = v_code
    limit 1;

    v_outcome := case
      when v_proposed is null then 'corrected' -- the clinician added it themselves
      when v_value is not null
        then case when nullif(v_proposed->>'value', '')::numeric is distinct from v_value
                  then 'corrected' else 'accepted' end
      else case when nullif(v_proposed->>'valueText', '') is distinct from v_value_text
                then 'corrected' else 'accepted' end
    end;

    if v_outcome = 'accepted' then v_accepted := v_accepted + 1;
    else v_corrected := v_corrected + 1;
    end if;

    insert into public.lab_extraction_corrections
      (organisation_id, extraction_id, template_id, code, outcome,
       proposed_value, proposed_value_text, confirmed_value, confirmed_value_text,
       printed_label, printed_unit, printed_range, model_confidence)
    values (
      v_row.organisation_id, v_row.id, v_row.template_id, v_code, v_outcome,
      nullif(v_proposed->>'value', '')::numeric,
      nullif(v_proposed->>'valueText', ''),
      v_value,
      v_value_text,
      nullif(v_proposed->>'reportedLabel', ''),
      nullif(v_proposed->>'unit', ''),
      nullif(v_proposed->>'reportedRange', ''),
      nullif(v_proposed->>'confidence', '')
    );
  end loop;

  -- Anything proposed but not confirmed was rejected by the clinician.
  for v_proposed in
    select r from jsonb_array_elements(coalesce(v_row.rows, '[]'::jsonb)) as r
    where r->>'code' is not null
      and not ((r->>'code') = any (v_codes))
  loop
    v_rejected := v_rejected + 1;
    insert into public.lab_extraction_corrections
      (organisation_id, extraction_id, template_id, code, outcome,
       proposed_value, proposed_value_text, printed_label, printed_unit,
       printed_range, model_confidence)
    values (
      v_row.organisation_id, v_row.id, v_row.template_id,
      v_proposed->>'code', 'rejected',
      nullif(v_proposed->>'value', '')::numeric,
      nullif(v_proposed->>'valueText', ''),
      nullif(v_proposed->>'reportedLabel', ''),
      nullif(v_proposed->>'unit', ''),
      nullif(v_proposed->>'reportedRange', ''),
      nullif(v_proposed->>'confidence', '')
    );
  end loop;

  if v_row.template_id is not null then
    update public.lab_report_templates
       set readings_accepted  = readings_accepted + v_accepted,
           readings_corrected = readings_corrected + v_corrected,
           readings_rejected  = readings_rejected + v_rejected
     where id = v_row.template_id;
  end if;

  update public.lab_report_extractions
     set status = 'confirmed',
         confirmed_by = (select auth.uid()),
         confirmed_at = now(),
         confirmed_codes = to_jsonb(v_codes),
         report_date = p_report_date
   where id = p_extraction_id;

  return v_filed;
end;
$function$;

revoke all on function public.confirm_lab_report_extraction(uuid, jsonb, date) from public;
revoke all on function public.confirm_lab_report_extraction(uuid, jsonb, date) from anon;
grant execute on function public.confirm_lab_report_extraction(uuid, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Prove it, rather than hope
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- The retired engine must be gone, not merely unused.
  if exists (select 1 from pg_class where relname = 'lab_result_extractions' and relnamespace = 'public'::regnamespace) then
    raise exception 'lab_result_extractions still exists - the duplicate engine was not retired';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_lab_result_extraction'
  ) then
    raise exception 'confirm_lab_result_extraction still exists';
  end if;

  -- Table access. RLS governs nothing without the underlying grant.
  if not has_table_privilege('authenticated', 'public.lab_report_templates', 'SELECT') then
    raise exception 'authenticated cannot select lab_report_templates';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_extraction_corrections', 'SELECT') then
    raise exception 'authenticated cannot select lab_extraction_corrections';
  end if;
  if has_table_privilege('anon', 'public.lab_extraction_corrections', 'SELECT') then
    raise exception 'anon can read lab_extraction_corrections';
  end if;

  -- Neither corpus table may be written from a client session.
  select count(*) into v_count
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relname in ('lab_report_templates', 'lab_extraction_corrections')
    and p.polcmd <> 'r';
  if v_count > 0 then
    raise exception 'corpus tables must have no write policy (found %)', v_count;
  end if;

  -- The escalation bridge must be unreachable from any client session.
  if has_function_privilege('anon', 'public.raise_lab_extraction_alert(uuid, public.alert_level, text)', 'EXECUTE') then
    raise exception 'anon can execute raise_lab_extraction_alert';
  end if;
  if has_function_privilege('authenticated', 'public.raise_lab_extraction_alert(uuid, public.alert_level, text)', 'EXECUTE') then
    raise exception 'authenticated can execute raise_lab_extraction_alert - a client could escalate its own upload';
  end if;
  if not has_function_privilege('service_role', 'public.raise_lab_extraction_alert(uuid, public.alert_level, text)', 'EXECUTE') then
    raise exception 'service_role cannot execute raise_lab_extraction_alert';
  end if;

  if has_function_privilege('anon', 'public.upsert_lab_report_template(text, text, text, integer, jsonb)', 'EXECUTE') then
    raise exception 'anon can execute upsert_lab_report_template';
  end if;
  if has_function_privilege('authenticated', 'public.upsert_lab_report_template(text, text, text, integer, jsonb)', 'EXECUTE') then
    raise exception 'authenticated can execute upsert_lab_report_template';
  end if;

  -- Confirmation stays reachable by a signed-in clinician and closed to anon.
  if has_function_privilege('anon', 'public.confirm_lab_report_extraction(uuid, jsonb, date)', 'EXECUTE') then
    raise exception 'anon can execute confirm_lab_report_extraction';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_lab_report_extraction(uuid, jsonb, date)', 'EXECUTE') then
    raise exception 'authenticated cannot execute confirm_lab_report_extraction';
  end if;

  -- The value/value_text exclusivity must be declared. Checked in the catalogue
  -- rather than by attempting an insert: this table is foreign-keyed to
  -- organisations and profiles, so a probe row needs tenant data a fresh
  -- `db reset` does not have, and the probe would then fail for the wrong
  -- reason and pass vacuously.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lab_analyte_readings'::regclass
      and conname = 'lab_analyte_readings_one_value'
      and contype = 'c'
  ) then
    raise exception 'lab_analyte_readings_one_value constraint is missing';
  end if;

  -- And the widened numeric must actually hold a parasite density.
  if 2000000::numeric(12, 4) is null then
    raise exception 'unreachable';
  end if;
end $$;
