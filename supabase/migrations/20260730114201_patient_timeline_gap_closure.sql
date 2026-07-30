-- Tarragon Health — proof_log-vs-patient_timeline gap closure (2 of 2)
--
-- Closes the three real gaps found comparing v3's proof_log spec against
-- the existing patient_timeline (2026-07-30 v3 port investigation):
--   1. No funder/consent-gated third-party read policy — extend RLS to
--      profile_access grantees, mirroring the exact precedent already used
--      on lab_analyte_readings/vaccination_records/booking_requests.
--   2. No enforced plain-language guarantee — move the display-time
--      humanisation (patient-timeline.tsx's humaniseSummary(), added
--      2026-07-21 for a raw analyte-key leak) into the single write
--      choke-point every trigger already goes through
--      (private.record_timeline_event), so the guarantee is structural
--      and applies to every current AND future consumer, not just the one
--      UI component that happened to add a client-side regex. Also
--      backfills existing rows so the guarantee covers history too, not
--      just new writes.
--   3. Missing dispense-event coverage — pharmacy_order_dispenses (this
--      platform's real analog of proof_log's explicitly-required
--      medication_dispenses trigger source) had zero patient_timeline
--      wiring. The enum value 'medication_dispensed' was added in the
--      prior migration (Postgres forbids using a fresh enum value in the
--      same transaction that adds it).

-- ---------------------------------------------------------------------------
-- 1. RLS: extend SELECT to profile_access grantees.
-- ---------------------------------------------------------------------------
drop policy if exists patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = patient_timeline.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Write-time plain-language guarantee, at the one choke-point every
-- current and future trigger already calls through.
-- ---------------------------------------------------------------------------
create or replace function private.record_timeline_event(
  p_org         uuid,
  p_patient     uuid,
  p_event_type  public.timeline_event_type,
  p_source_table text,
  p_source_id   uuid,
  p_title       text,
  p_summary     text,
  p_occurred_at timestamptz default null,
  p_actor       uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_patient is null or p_org is null then
    return;
  end if;
  insert into public.patient_timeline
    (organisation_id, patient_id, event_type, source_table, source_id,
     title, summary, occurred_at, actor_clinical_staff_id, metadata)
  values
    (p_org, p_patient, p_event_type, p_source_table, p_source_id,
     -- Patient-facing summary must be plain language, never a raw
     -- underscore-joined enum/column-key token (the exact bug already
     -- found and patched at display-time on 2026-07-21). No legitimate
     -- patient-facing prose in this codebase contains a literal
     -- underscore, so a blanket replace is safe and does not need the
     -- word-boundary regex the client-side patch used.
     p_title, replace(p_summary, '_', ' '), coalesce(p_occurred_at, now()), p_actor,
     coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Backfill existing rows so the guarantee covers history, not just new
-- writes. Cosmetic only (underscore → space) — never touches title,
-- metadata, or any other field, and never changes what happened, only how
-- the summary text renders.
do $$
declare
  v_count integer;
begin
  update public.patient_timeline
    set summary = replace(summary, '_', ' ')
    where summary is not null and strpos(summary, '_') > 0;
  get diagnostics v_count = row_count;
  raise notice 'Backfilled % patient_timeline row(s) with an underscore in summary', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 3. pharmacy_order_dispenses → medication_dispensed
-- ---------------------------------------------------------------------------
create or replace function private.timeline_from_pharmacy_dispense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := private.timeline_staff_from_profile(new.recorded_by, new.organisation_id);
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'medication_dispensed',
    'pharmacy_order_dispenses', new.id,
    'Medication collected',
    new.drug_name || coalesce(' · ' || nullif(new.quantity, ''), ''),
    new.dispensed_on::timestamptz,
    v_actor,
    jsonb_build_object('drug_name', new.drug_name, 'quantity', new.quantity,
                        'source', new.source, 'pharmacy_order_id', new.pharmacy_order_id)
  );
  return new;
end;
$$;

drop trigger if exists pharmacy_dispenses_timeline on public.pharmacy_order_dispenses;
create trigger pharmacy_dispenses_timeline
  after insert on public.pharmacy_order_dispenses
  for each row execute function private.timeline_from_pharmacy_dispense();

-- ---------------------------------------------------------------------------
-- Assertions — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'patient_timeline' and policyname = 'patient_timeline_select'
      and qual ilike '%profile_access%'
  ) then
    raise exception 'FAIL: patient_timeline_select does not reference profile_access';
  end if;

  if exists (select 1 from public.patient_timeline where summary like '%\_%' escape '\') then
    raise exception 'FAIL: backfill left an underscore in some summary row';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'pharmacy_dispenses_timeline'
      and tgrelid = 'public.pharmacy_order_dispenses'::regclass
  ) then
    raise exception 'FAIL: pharmacy_dispenses_timeline trigger not attached';
  end if;

  raise notice 'PASS: all three patient_timeline gap-closure changes are in place';
end $$;
