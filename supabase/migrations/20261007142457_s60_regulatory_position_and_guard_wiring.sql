-- ORDER NOTE (integration, 2026-10-07): this file was 20261007131744. It patches private.go_live_conditions (and two other live bodies) by
-- text, and S28c (20261007141623, already live) replaces go_live_conditions as a whole, which on a fresh replay would drop what this file
-- inserts. It now sorts after S28c and after F1's guard migration (20261007142011) so a replay and the live project patch the same text.
-- Nothing was applied under the old version.
-- S60 part 3 of 3: the recorded regulatory position (spec 12.13) and the wiring of the symptom_checker_enabled attestations (F1)
-- to real records.
--
-- WHY. F1 seeded go-live guard symptom_checker_enabled with four ATTESTED conditions that a person ticks on the S37 dashboard: a NAFDAC
-- and counsel position recorded, an engine licence or validation recorded, localisation sign-off recorded, an accuracy baseline
-- recorded. An attestation with nothing behind it is a tick-box. Two of them now have a record behind them:
--   * nafdac_position_recorded   needs a row in public.regulatory_positions (position text, counsel name, date, who attached it)
--   * accuracy_baseline_recorded needs a baseline row in public.symptom_accuracy_reports (part 2)
-- The other two (engine licence or validation, localisation sign-off) stay plain attestations: nothing in the system holds a record
-- for them yet, and inventing one would be exactly the false comfort this change removes. The CMO or admin still presses the button
-- on /clinician/go-live or /admin/go-live; the database refuses the attestation while the record is missing, and the dashboard row
-- shows what the record says.
--
-- THE POSITION IS A RECORD, NOT CODE. This migration records no position and no classification: the table is empty. The NAFDAC
-- position request, Nigerian counsel's view, and the decision that follows are the founder's (docs/OPEN-QUESTIONS.md OQ-S60-01).
-- Append-only: a changed view is a new row that supersedes the old; nothing is edited or deleted.
--
-- This replaces two live function bodies by string replacement, exactly as F1 did, and FAILS LOUDLY if a marker is not found
-- (a drifted definition). Re-read both definitions with pg_get_functiondef before applying.
--
-- A position that clears the checker (decision support, or a registered device) must carry the reference of the written opinion it rests on
-- (a CHECK constraint and the recording function both enforce it); an unsupported claim of clearance cannot be recorded.
--
-- ROWS AFFECTED: one go_live_guards row (symptom_checker_enabled) gains one entry in enforced_in. New table (empty). Two function definitions patched.

create table public.regulatory_positions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  topic           text not null check (topic in ('symptom_checker')),
  -- what the position says, in the person's own words: the classification reasoning and any conditions (for example a labelling duty)
  position_text   text not null check (char_length(btrim(position_text)) >= 40),
  -- Only the first two can satisfy the go-live condition. Counsel finding that the checker IS a regulated device, with no registration
  -- yet, is a recorded and important position but is not clearance to launch.
  classification  text not null check (classification in ('decision_support_not_a_device', 'regulated_medical_device_registered', 'regulated_medical_device_not_registered', 'not_yet_determined')),
  counsel_name    text not null check (char_length(btrim(counsel_name)) >= 3),
  counsel_firm    text check (counsel_firm is null or char_length(btrim(counsel_firm)) >= 2),
  position_date   date not null check (position_date <= current_date),
  -- where the written opinion is filed (a document reference, never the document itself)
  document_ref    text check (document_ref is null or char_length(btrim(document_ref)) >= 3),
  attached_by     uuid not null references public.profiles (id) on delete restrict,
  attached_at     timestamptz not null default clock_timestamp(),
  supersedes_id   uuid references public.regulatory_positions (id) on delete restrict,
  is_test         boolean not null default false,
  -- A position that clears the checker to launch must point at the written opinion it rests on. Without it the guard condition
  -- would read met on the strength of a typed sentence alone.
  constraint regulatory_positions_clearing_needs_document
    check (classification not in ('decision_support_not_a_device', 'regulated_medical_device_registered') or document_ref is not null)
);
create index regulatory_positions_topic_idx on public.regulatory_positions (organisation_id, topic, attached_at desc);
alter table public.regulatory_positions enable row level security;
revoke all on public.regulatory_positions from public, anon, authenticated;
create policy regulatory_positions_read on public.regulatory_positions
  for select to authenticated
  using ((private.is_admin() or private.credential_is_cmo()) and organisation_id = private.caller_org());
grant select on public.regulatory_positions to authenticated;

create or replace function private.regulatory_positions_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'a recorded regulatory position is permanent; record a new one that supersedes it' using errcode = '42501';
end $$;
create trigger regulatory_positions_00_immutable
  before update or delete on public.regulatory_positions
  for each row execute function private.regulatory_positions_immutable();

create or replace function public.record_regulatory_position(
  p_topic text, p_position_text text, p_classification text, p_counsel_name text, p_counsel_firm text, p_position_date date, p_document_ref text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_prev uuid;
  v_id uuid;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only an admin or the Chief Medical Officer can record a regulatory position' using errcode = '42501';
  end if;
  if p_topic is null or p_position_text is null or p_classification is null or p_counsel_name is null or p_position_date is null then
    raise exception 'the position text, its classification, the counsel and the date are all needed' using errcode = '22023';
  end if;
  if p_classification in ('decision_support_not_a_device', 'regulated_medical_device_registered') and char_length(btrim(coalesce(p_document_ref, ''))) < 3 then
    raise exception 'a position that clears the checker needs the reference of the written opinion it rests on' using errcode = '22023';
  end if;
  select id into v_prev from public.regulatory_positions where organisation_id = v_org and topic = p_topic order by attached_at desc, id desc limit 1;
  insert into public.regulatory_positions
    (organisation_id, topic, position_text, classification, counsel_name, counsel_firm, position_date, document_ref, attached_by, supersedes_id, is_test)
  values
    (v_org, p_topic, btrim(p_position_text), p_classification, btrim(p_counsel_name), nullif(btrim(p_counsel_firm), ''), p_position_date,
     nullif(btrim(p_document_ref), ''), v_uid, v_prev, coalesce((select is_test from public.profiles where id = v_uid), false))
  returning id into v_id;
  perform private.log_audit('regulatory_position.recorded', 'regulatory_position', v_id, jsonb_build_object('topic', p_topic, 'classification', p_classification));
  return v_id;
end $$;
revoke all on function public.record_regulatory_position(text, text, text, text, text, date, text) from public;
grant execute on function public.record_regulatory_position(text, text, text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Wiring. Patch the two live definitions; fail loudly if drifted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  -- 1. attest_go_live_condition: the two attestations that have a record behind them cannot be ticked without it
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  v_new := replace(v_def,
    E'  if p_met is null or length(btrim(coalesce(p_note, ''''))) < 10 then',
    E'  if p_met is true and p_key = ''symptom_checker_enabled'' and p_code = ''nafdac_position_recorded'' and coalesce((\n' ||
    E'       select rp.classification in (''decision_support_not_a_device'', ''regulated_medical_device_registered'') and rp.document_ref is not null from public.regulatory_positions rp\n' ||
    E'        where rp.topic = ''symptom_checker'' and rp.organisation_id = private.caller_org() order by rp.attached_at desc, rp.id desc limit 1), false) is not true then\n' ||
    E'    raise exception ''record the regulatory position first (the position, its classification, the counsel, the date and, for a clearing position, the opinion reference; a position that is not yet determined, or a regulated device that is not registered, does not count), then attest'' using errcode = ''22023'';\n' ||
    E'  end if;\n' ||
    E'  if p_met is true and p_key = ''symptom_checker_enabled'' and p_code = ''accuracy_baseline_recorded'' and not exists (\n' ||
    E'       select 1 from public.symptom_accuracy_reports r where r.is_baseline and r.organisation_id = private.caller_org()) then\n' ||
    E'    raise exception ''run the accuracy audit first so a baseline report exists, then attest'' using errcode = ''22023'';\n' ||
    E'  end if;\n' ||
    E'  if p_met is null or length(btrim(coalesce(p_note, ''''))) < 10 then');
  if v_new = v_def then
    raise exception 'S60: attest_go_live_condition marker not found (definition drifted)';
  end if;
  execute v_new;

  -- 2. go_live_conditions: the two conditions read as met only with the record, and show what the record says
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  v_new := replace(v_def,
    'private.go_live_attested(p_key, ''nafdac_position_recorded''), ''attestation'', null)',
    '(private.go_live_attested(p_key, ''nafdac_position_recorded'') and coalesce((select rp.classification in (''decision_support_not_a_device'', ''regulated_medical_device_registered'') and rp.document_ref is not null from public.regulatory_positions rp where rp.topic = ''symptom_checker'' and (p_org is null or rp.organisation_id = p_org) order by rp.attached_at desc, rp.id desc limit 1), false)), ''attestation'',' ||
    E'\n        (select ''Latest record: '' || rp.position_date || '', counsel '' || rp.counsel_name || '', '' || replace(rp.classification, ''_'', '' '') from public.regulatory_positions rp where rp.topic = ''symptom_checker'' and (p_org is null or rp.organisation_id = p_org) order by rp.attached_at desc, rp.id desc limit 1))');
  if v_new = v_def then
    raise exception 'S60: go_live_conditions nafdac marker not found (definition drifted)';
  end if;
  v_def := v_new;
  v_new := replace(v_def,
    'private.go_live_attested(p_key, ''accuracy_baseline_recorded''), ''attestation'', null)',
    '(private.go_live_attested(p_key, ''accuracy_baseline_recorded'') and exists (select 1 from public.symptom_accuracy_reports r where r.is_baseline and (p_org is null or r.organisation_id = p_org))), ''attestation'',' ||
    E'\n        (select ''Baseline for '' || r.period_start || '' from '' || r.reviewed_total || '' reviewed checks'' || case when r.includes_test_accounts then '' (includes test accounts)'' else '''' end from public.symptom_accuracy_reports r where r.is_baseline and (p_org is null or r.organisation_id = p_org) order by r.generated_at limit 1))');
  if v_new = v_def then
    raise exception 'S60: go_live_conditions accuracy marker not found (definition drifted)';
  end if;
  execute v_new;
end $$;

-- The dashboard lists where each guard is enforced; the review request is one more place for this one (migration 20261007130417).
update public.go_live_guards
   set enforced_in = enforced_in || array['request_symptom_review (public function, refuses with 42501 while closed)']
 where key = 'symptom_checker_enabled'
   and not (enforced_in @> array['request_symptom_review (public function, refuses with 42501 while closed)']);

do $$
begin
  if jsonb_array_length(private.go_live_conditions('symptom_checker_enabled', null)) <> 6 then
    raise exception 'S60 assertion: the guard should still have six conditions';
  end if;
  if exists (select 1 from jsonb_array_elements(private.go_live_conditions('symptom_checker_enabled', null)) c
              where c ->> 'code' in ('nafdac_position_recorded', 'accuracy_baseline_recorded') and (c ->> 'met')::boolean) then
    raise exception 'S60 assertion: a record-backed condition reads met with no record';
  end if;
  if (select count(*) from public.regulatory_positions) <> 0 then raise exception 'S60 assertion: a position was recorded by this migration'; end if;
  if has_function_privilege('anon', 'public.record_regulatory_position(text,text,text,text,text,date,text)', 'EXECUTE') then
    raise exception 'S60 assertion: anon can record a regulatory position';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.regulatory_positions'::regclass) then raise exception 'S60 assertion: RLS is off on regulatory_positions'; end if;
end $$;
