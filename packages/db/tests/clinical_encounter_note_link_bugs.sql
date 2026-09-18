-- ===========================================================================
-- Verification: 20260918100746_clinical_encounter_notes_link_unified_encounter
--                + 20260918101643_fix_clinical_encounter_note_link_bugs
--                + 20260918103547_clinical_encounter_note_link_fixup_never_blocks_source_write
--
--   * BUG 1 (CRITICAL): inserting/updating a clinical_encounter_notes row
--     with escalation_id/video_consultation_id/async_consult_id set no
--     longer raises "cannot compare dissimilar column types text and
--     unknown at record column 1" — reproduced live against the real
--     database before this fix, so this is a real regression test, not a
--     defensive one.
--   * BUG 2: an async_consult transitioning to 'answered' fires TWO AFTER
--     UPDATE triggers whose relative order is alphabetical-by-name, not
--     coordinated — the auto-draft-note trigger creates the note BEFORE the
--     clinical_encounters row it needs to link against exists. This proves
--     the note ends up correctly linked anyway (the clinical_encounters
--     sync trigger fixes it up after its own upsert).
--   * BUG 3: clinical_encounter_id cannot be set by a direct client UPDATE —
--     it is unconditionally re-derived server-side on every write to the
--     row, discarding whatever value was supplied.
--   * BUG 4 (found by a SECOND /code-review high pass on the BUG 2 fix,
--     before this even reached a PR): the BUG 2 fix-up UPDATE reintroduced
--     the exact failure mode 20260917031004's own header describes fixing
--     for INSERT — a session-less caller (that migration's own example: "a
--     Zoom webhook" completing a video consultation) hitting the fix-up
--     UPDATE would have the ENTIRE source-table write aborted by
--     clinical_encounter_notes_enforce_attribution's UPDATE branch, which
--     has no trusted-system escape hatch. Proves a session-less update to
--     video_consultations that needs to fix up a note's link succeeds
--     (status actually changes) instead of being aborted, with the fix-up
--     itself best-effort-skipped rather than blocking anything.
--
-- Sabotage step included for BUG 1 only (the most severe of the three): the
-- pre-fix trigger body is temporarily restored, the same operation that
-- crashed live before the fix is proven to crash again, then the real fix
-- is restored. BUG 2/BUG 3 are proven positively (the fix works) but not
-- sabotage-tested in this pass — reverting either one safely mid-script
-- would mean re-deriving a second, materially different buggy function body
-- for each and restoring three functions afterward; the BUG 1 sabotage
-- already demonstrates this suite is not vacuous.
--
-- clinical_encounter_notes_enforce_attribution (a different, pre-existing
-- trigger from 20260827201621) requires a real auth.uid()-resolved active
-- clinical-tier staff member for any UPDATE, and this script runs with no
-- session context — disabled for the setup/assertion steps that need to
-- UPDATE this table directly, same "system bookkeeping, not a clinical act"
-- carve-out the introducing migration itself uses for its backfill. Its own
-- INSERT path is exercised for real (not bypassed) via the trusted-system
-- auto-draft flow, which is what actually creates the note under test.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table cenlb_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  -- Fixed, not gen_random_uuid()'d: this tool's live-DO-block execution path
  -- has a documented double-execution gotcha (memory:
  -- reference_supabase_db_query_double_execution_gotcha) where a freshly
  -- random UUID from one nominal call can collide with itself. Deterministic
  -- IDs + ON CONFLICT DO NOTHING make this idempotent and safe to re-run.
  v_org     uuid;
  v_patient uuid := 'ce0b0000-0000-4000-8000-000000000001'::uuid;
  v_staff   uuid;
  v_consult uuid;
  v_note    uuid;
  v_encounter uuid;
  v_linked  uuid;
  v_bogus   uuid := gen_random_uuid();
  v_after_bogus uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cenlb-test-patient@example.invalid', 'x', now(), '{}', '{}')
  on conflict (id) do nothing;
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'CENLB Test Patient')
  on conflict (id) do nothing;

  select id into v_staff from public.clinical_staff where full_name = 'CENLB Test Doctor' and organisation_id = v_org limit 1;
  if v_staff is null then
    insert into public.clinical_staff (organisation_id, full_name, active, doctor_tier, employment_type, license_verified_at)
    values (v_org, 'CENLB Test Doctor', true, 'medical_officer', 'employed', now())
    returning id into v_staff;
  end if;

  -- ------------------------------------------------------------------------
  -- BUG 2 + BUG 1 (combined, end to end): answer an async consult. This
  -- fires async_consults_auto_draft_encounter_note (creates the note via
  -- the trusted-system path, requiring a real answered_by clinical_staff)
  -- and clinical_encounters_sync_async_consult (upserts clinical_encounters)
  -- in alphabetical trigger-name order — the exact ordering that exposed
  -- BUG 2 pre-fix — and the note insert exercises BUG 1's crashing code
  -- path for real. A fresh async_consult every run (not idempotent) since
  -- the auto-draft trigger only fires once per consult's first 'answered'
  -- transition and re-running the check should always exercise it live.
  -- ------------------------------------------------------------------------
  -- async_consults_enforce_entitlement_or_credit requires a real patient
  -- session (auth.uid()) to redeem a purchase/credit — an unrelated business
  -- rule this test has no reason to also stand up a purchase fixture for.
  -- Disabled only for this insert, same "system bookkeeping" carve-out as
  -- the attribution trigger elsewhere in this file.
  alter table public.async_consults disable trigger async_consults_enforce_entitlement_or_credit;
  insert into public.async_consults (organisation_id, patient_id, category, question, status)
  values (v_org, v_patient, 'general', 'CENLB test question', 'submitted')
  returning id into v_consult;
  alter table public.async_consults enable trigger async_consults_enforce_entitlement_or_credit;

  -- async_consults_stamp_answer also requires a real patient/doctor session
  -- (auth.uid()) and forcibly re-derives answered_by/answered_at itself —
  -- same unrelated-business-rule carve-out as the entitlement trigger above.
  alter table public.async_consults disable trigger async_consults_stamp_answer;
  update public.async_consults
  set status = 'answered', answer = 'CENLB test answer', answered_by = v_staff, answered_at = now()
  where id = v_consult;
  alter table public.async_consults enable trigger async_consults_stamp_answer;

  select id into v_note from public.clinical_encounter_notes where async_consult_id = v_consult limit 1;
  insert into cenlb_result values (
    'BUG 1/2: answering an async consult does not crash and auto-drafts a note',
    coalesce(v_note::text, 'no note created'),
    'a note row exists',
    case when v_note is not null then 'PASS' else 'FAIL' end
  );

  if v_note is not null then
    select id into v_encounter from public.clinical_encounters where source_table = 'async_consults' and source_id = v_consult;
    select clinical_encounter_id into v_linked from public.clinical_encounter_notes where id = v_note;
    insert into cenlb_result values (
      'BUG 2: the auto-drafted note is linked to the right clinical_encounters row despite trigger-name ordering',
      coalesce(v_linked::text, 'null'),
      coalesce(v_encounter::text, 'null'),
      case when v_linked is not null and v_linked = v_encounter then 'PASS' else 'FAIL' end
    );

    -- ----------------------------------------------------------------------
    -- BUG 3: a direct client UPDATE setting only clinical_encounter_id must
    -- not stick — it is always re-derived server-side. Disabled only for
    -- this UPDATE (see header) — the attribution trigger's UPDATE branch
    -- has no trusted-system escape hatch, unlike INSERT.
    -- ----------------------------------------------------------------------
    alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_enforce_attribution;
    update public.clinical_encounter_notes set clinical_encounter_id = v_bogus where id = v_note;
    alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;

    select clinical_encounter_id into v_after_bogus from public.clinical_encounter_notes where id = v_note;
    insert into cenlb_result values (
      'BUG 3: a client-supplied clinical_encounter_id is discarded and re-derived',
      coalesce(v_after_bogus::text, 'null'),
      coalesce(v_encounter::text, 'null') || ' (never ' || v_bogus::text || ')',
      case when v_after_bogus = v_encounter and v_after_bogus is distinct from v_bogus then 'PASS' else 'FAIL' end
    );
  end if;
end $$;

-- --------------------------------------------------------------------------
-- BUG 4: a session-less write to a source table (the "Zoom webhook" case)
-- must never be aborted by the note-link fix-up. Builds an unlinked note
-- (simulating one created before its clinical_encounters row existed) and
-- then updates video_consultations with no auth.uid() session at all.
-- --------------------------------------------------------------------------
do $$
declare
  v_org     uuid;
  v_patient uuid := 'ce0b0000-0000-4000-8000-000000000001'::uuid;
  v_staff   uuid;
  v_vc      uuid;
  v_note    uuid;
  v_raised  boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_staff from public.clinical_staff where full_name = 'CENLB Test Doctor' and organisation_id = v_org limit 1;

  insert into public.video_consultations (organisation_id, patient_id, context, status, initiated_by)
  values (v_org, v_patient, 'general_checkin', 'scheduled', v_patient)
  returning id into v_vc;

  perform set_config('app.trusted_clinical_staff_author', v_staff::text, true);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, video_consultation_id, encounter_type, reason_for_encounter)
  values (v_org, v_patient, v_vc, 'video_consult', 'CENLB regression note')
  returning id into v_note;
  perform set_config('app.trusted_clinical_staff_author', '', true);

  -- Force it unlinked, simulating "the note was created before the
  -- clinical_encounters row existed" without relying on real trigger-name
  -- ordering (which for video_consultations doesn't actually race — see
  -- BUG 2's own header — this check is specifically about the fix-up path
  -- itself, however it comes to be needed).
  alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_enforce_attribution;
  alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_sync_encounter_link;
  update public.clinical_encounter_notes set clinical_encounter_id = null where id = v_note;
  alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_sync_encounter_link;
  alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;

  -- The regression: this UPDATE runs with NO session context (auth.uid() is
  -- null), exactly like a webhook. Before the BUG 4 fix, the fix-up UPDATE's
  -- attribution-trigger failure would propagate and abort this statement.
  begin
    update public.video_consultations set status = 'completed' where id = v_vc;
  exception when others then
    v_raised := true;
  end;

  insert into cenlb_result values (
    'BUG 4: a session-less source-table write is never aborted by the note-link fix-up',
    case when v_raised then 'the UPDATE raised and was aborted' else 'the UPDATE succeeded' end,
    'the UPDATE succeeds',
    case when not v_raised and (select status from public.video_consultations where id = v_vc) = 'completed' then 'PASS' else 'FAIL' end
  );
end $$;

-- --------------------------------------------------------------------------
-- Sabotage: restore the pre-fix trigger body (missing the ::text casts) and
-- prove the exact operation that crashed live before the fix crashes again
-- — confirms this suite would have caught BUG 1, not merely that today's
-- code happens to pass it.
-- --------------------------------------------------------------------------
do $$
declare
  v_note_id uuid;
  v_raised boolean := false;
begin
  select id into v_note_id from public.clinical_encounter_notes where async_consult_id is not null order by created_at desc limit 1;

  create or replace function private.sync_clinical_encounter_note_link()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $sabotage$
  begin
    new.clinical_encounter_id := (
      select id from public.clinical_encounters
      where (source_table, source_id) = (
        case
          when new.video_consultation_id is not null then row('video_consultations', new.video_consultation_id)
          when new.escalation_id is not null then row('escalations', new.escalation_id)
          when new.async_consult_id is not null then row('async_consults', new.async_consult_id)
          else null
        end
      )
      limit 1
    );
    return new;
  end;
  $sabotage$;

  alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_enforce_attribution;
  begin
    update public.clinical_encounter_notes set async_consult_id = async_consult_id where id = v_note_id;
  exception when others then
    v_raised := true;
  end;
  alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;

  insert into cenlb_result values (
    'Sabotage control: the pre-fix (uncast row()) trigger body really does crash on this exact operation',
    case when v_raised then 'raised an error, as expected' else 'did NOT raise — sabotage failed to reproduce the bug' end,
    'raises an error',
    case when v_raised then 'PASS' else 'FAIL' end
  );

  -- Restore the real fix.
  create or replace function private.sync_clinical_encounter_note_link()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $restore$
  begin
    new.clinical_encounter_id := (
      select id from public.clinical_encounters
      where (source_table, source_id) = (
        case
          when new.video_consultation_id is not null then row('video_consultations'::text, new.video_consultation_id)
          when new.escalation_id is not null then row('escalations'::text, new.escalation_id)
          when new.async_consult_id is not null then row('async_consults'::text, new.async_consult_id)
          else null
        end
      )
      limit 1
    );
    return new;
  end;
  $restore$;
end $$;

select * from cenlb_result order by check_name;

do $$
begin
  if not exists (select 1 from cenlb_result) then
    raise exception 'clinical_encounter_note_link_bugs: no checks ran at all — the async-consult fixture setup failed silently before producing any result rows';
  end if;
  if exists (select 1 from cenlb_result where verdict = 'FAIL') then
    raise exception 'clinical_encounter_note_link_bugs: one or more checks FAILED — see the result rows above';
  end if;
  raise notice 'PASS: all clinical_encounter_notes link-bug checks passed, including the BUG 1 sabotage control';
end $$;

rollback;
