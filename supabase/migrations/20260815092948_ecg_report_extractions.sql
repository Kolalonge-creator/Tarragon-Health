-- Tarragon Health — ECG parameter extractions + confirmed readings
--
-- WHY: the ECG analogue of lab_report_extractions (20260803144056). A row
-- here is an AI-DRAFTED TRANSCRIPTION of the parameter block a 12-lead ECG
-- cart already prints on its own output (heart rate, PR/QRS/QT/QTc, cardiac
-- axis, and — kept separately labelled, see below — the machine's own printed
-- rhythm statement if any). It transcribes; it never interprets, and it never
-- decides anything is clinically critical (contrast with the lab pipeline's
-- raise_lab_extraction_alert, deliberately NOT mirrored here — see
-- CLAUDE.md's ECG-feature notes / the plan this shipped from).
--
-- AI DRAFTS, NEVER DECIDES. Identical discipline to lab_report_extractions: a
-- row here is a DRAFT shown to a clinician side by side with the original
-- tracing. Confirming it is a deliberate human act that writes
-- ecg_parameter_readings; nothing in this table is a clinical record on its
-- own, and the clinician's separate procedural_status judgement on the
-- screening_results row (unchanged by this migration) remains the actual
-- clinical read.
--
-- DELIBERATELY NOT PATIENT-READABLE, same reasoning as lab_report_extractions:
-- an unconfirmed machine transcription of someone's own ECG must not reach
-- them before a clinician has looked at it.
--
-- No insert/update/delete policy on ecg_report_extractions at all, same as
-- lab_report_extractions — every write goes through the service-role
-- generator (lib/ecg-reports/extraction-actions.ts) or the confirm RPC
-- (next migration).

-- ---------------------------------------------------------------------------
-- 1. Draft extraction (one live row per document)
-- ---------------------------------------------------------------------------
create table if not exists public.ecg_report_extractions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  -- One live extraction per document. Re-running replaces it rather than
  -- accumulating drafts a reviewer would have to choose between.
  document_id             uuid not null unique
                            references public.ecg_report_documents (id) on delete cascade,
  status                  text not null
                            check (status in ('extracted', 'failed', 'confirmed', 'discarded')),
  model_id                text,
  -- Date as printed on the tracing, normalised. This — not the upload time —
  -- is what ecg_parameter_readings.taken_at gets on confirm, so an ECG
  -- uploaded weeks late still lands in the right place on the trend line.
  report_date             date,
  -- Facility/device name as printed, if any. Purely informational.
  facility_name           text,
  -- Name printed on the tracing, kept ONLY to warn a reviewer when it does not
  -- look like the patient whose record this is being filed into. Never shown
  -- to the patient, never used as identity.
  patient_name_on_report  text,
  -- The full ExtractedParameter[] from lib/ecg-reports/extract.ts, including
  -- anything unmapped/low-confidence. Kept verbatim so the review screen can
  -- show everything the model saw, not just what was understood.
  parameters              jsonb not null default '[]'::jsonb,
  -- Whether the model could see genuine 12-lead labelling anywhere on the
  -- page (lead names I/II/III/aVR/aVL/aVF/V1-V6, or 12 distinct strips).
  -- False surfaces a prominent warning on the review panel (qc.ts's
  -- not_twelve_lead_suspected) rather than blocking the draft outright — a
  -- badly cropped photo of a genuine 12-lead printout is a real, recoverable
  -- case, and the reviewing clinician is in a better position than a heuristic
  -- to tell the two apart. Null only when extraction itself failed (status =
  -- 'failed'), where no judgement was made at all.
  looks_twelve_lead       boolean,
  -- Set when the model could not read the document at all (too blurred,
  -- cropped, or not an ECG). This is a separate, stronger signal than
  -- looks_twelve_lead above — "unreadable" means nothing could be
  -- transcribed; a false looks_twelve_lead can still carry real parameters.
  unreadable_reason       text,
  error_message           text,
  -- Which parameter codes the reviewer actually accepted. Kept for audit: the
  -- difference between what the machine proposed and what a human filed.
  confirmed_codes         jsonb not null default '[]'::jsonb,
  confirmed_by            uuid references public.profiles (id) on delete restrict,
  confirmed_at            timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists ecg_report_extractions_patient_idx
  on public.ecg_report_extractions (patient_id, created_at desc);
create index if not exists ecg_report_extractions_org_idx
  on public.ecg_report_extractions (organisation_id);
create index if not exists ecg_report_extractions_pending_idx
  on public.ecg_report_extractions (organisation_id, status)
  where status = 'extracted';

alter table public.ecg_report_extractions enable row level security;

create policy ecg_report_extractions_select on public.ecg_report_extractions
  for select using (private.is_org_staff(organisation_id));

-- Deliberately no insert/update/delete policy — service-role/RPC only.

grant select on public.ecg_report_extractions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Confirmed readings (final, patient-readable once filed)
-- ---------------------------------------------------------------------------
-- Mirrors lab_analyte_readings, incl. its numeric-or-text shape: every
-- parameter here is numeric (rate/intervals/axis) EXCEPT one deliberate
-- exception — code 'machine_rhythm_statement' — which carries the ECG
-- machine's own printed rhythm line (e.g. "Normal sinus rhythm") verbatim in
-- value_text. That is the machine's transcribed output, not a Tarragon- or
-- AI-generated read, and lib/ecg-reports/ecg-parameter-catalogue.ts +
-- every UI surface that renders it must label it "as printed by the ECG
-- machine" — never presented as if a clinician or Tarragon concluded it.
create table if not exists public.ecg_parameter_readings (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  ecg_report_document_id uuid references public.ecg_report_documents (id) on delete set null,
  code                   text not null,
  value                  numeric(10, 3),
  value_text             text,
  unit                   text,
  taken_at               timestamptz not null default now(),
  confirmed_by           uuid not null references public.profiles (id) on delete restrict,
  confirmed_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  constraint ecg_parameter_readings_one_value check (
    (value is not null and value_text is null and unit is not null)
    or (value is null and value_text is not null)
  )
);

create index if not exists ecg_parameter_readings_patient_code_idx
  on public.ecg_parameter_readings (patient_id, code, taken_at desc);
create index if not exists ecg_parameter_readings_org_idx
  on public.ecg_parameter_readings (organisation_id);
create index if not exists ecg_parameter_readings_document_idx
  on public.ecg_parameter_readings (ecg_report_document_id);

alter table public.ecg_parameter_readings enable row level security;

-- Same clinician-authored pattern as lab_analyte_readings: patient reads own
-- rows; writes are staff-only (via the confirm RPC in practice, but the RLS
-- itself stays org-staff-broad like the lab table, not RPC-only, since a
-- clinician correcting a filed reading by hand is a legitimate direct edit).
create policy ecg_parameter_readings_select on public.ecg_parameter_readings
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy ecg_parameter_readings_insert on public.ecg_parameter_readings
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy ecg_parameter_readings_update on public.ecg_parameter_readings
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy ecg_parameter_readings_delete on public.ecg_parameter_readings
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.ecg_parameter_readings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.ecg_report_extractions', 'SELECT') then
    raise exception 'ecg_report_extractions: authenticated SELECT grant did not take';
  end if;

  -- The real write boundary is RLS POLICY presence, not the table-level
  -- GRANT: this project's default-privileges setup auto-provisions INSERT/
  -- UPDATE/DELETE to `authenticated` on every new table (confirmed live —
  -- lab_report_extractions carries the identical unused grants despite its
  -- own migration only ever granting SELECT), and RLS denies by default when
  -- no policy matches the command regardless of the table-level grant. So the
  -- assertion that matters is "no insert/update/delete POLICY exists", not
  -- "no insert/update/delete GRANT exists" — asserting the grant is absent
  -- would fail on this database's real, harmless default-privileges behaviour.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ecg_report_extractions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'ecg_report_extractions: must have no insert/update/delete policy — service-role/RPC only';
  end if;

  -- A patient must NOT be able to read an unconfirmed transcription of their
  -- own ECG. Assert the select policy really is org-staff-only.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ecg_report_extractions'
      and qual like '%auth.uid()%'
  ) then
    raise exception 'ecg_report_extractions: select policy must not admit the patient directly';
  end if;

  if not has_table_privilege('authenticated', 'public.ecg_parameter_readings', 'SELECT') then
    raise exception 'ecg_parameter_readings: authenticated SELECT grant did not take';
  end if;
end $$;
