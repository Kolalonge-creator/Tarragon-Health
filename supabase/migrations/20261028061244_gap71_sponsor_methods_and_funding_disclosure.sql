-- GAP-71 (S71-S75 gap closure, D5-lite): a "Methods and funding" disclosure for the sponsor pack and the sponsor programme-figures pages.
-- Reasoning: this header and docs/BUILD-PROGRESS.md. Builds on S75, S75a and WP3 (docs/design/S75-outcome-measures.md, docs/design/WP3.md).
--
-- WHAT THIS ADDS (nothing here changes a stored patient row, and nothing changes any aggregation or suppression):
--   1. go-live guard `sponsor_methods_disclosure_enabled`, seeded OFF (INV-14). With it off the pack carries a `methods_and_funding` key that says
--      "withheld" and the disclosure function says the same; nothing else about the pack changes. Switching it on is the CMO's call (switch_role cmo).
--   2. private.sponsor_methods_wording(): the PROPOSED plain-words wording (funding line, minimum-cell rule, exclusion rules, review status lines).
--      Mirrored in the code registry as `sponsor.methods_disclosure_wording` (drift test). PROPOSED: not signed by this build.
--   3. public.sponsor_independent_reviews: a small, OPTIONAL record (reviewer name, organisation, date, scope) that ONLY a platform admin or the Chief
--      Medical Officer can write, through public.record_sponsor_independent_review(). Nothing is seeded; absent by default; a programme with no record
--      is shown as "not independently reviewed". Append-only; a wrong entry is withdrawn (retracted_at), never edited or deleted.
--   4. private.sponsor_methods_block(cohort, minimum): who sponsors and who produced the figures, which definition versions were used (the outcome
--      measure config and the cascade config, with their sign status), the minimum-cell rule in plain words, the exclusion rules in plain words, and
--      the review status. It holds no person, no count of any person, and nothing about mental health, pregnancy or reproductive health beyond the
--      plain statement of who is NOT counted.
--   5. private.sponsor_pack_build() is replaced with create or replace, copying the WP3 body (20261024201705) and adding ONE key, `methods_and_funding`.
--      The CSV and PDF flatten every leaf of the pack, so the block reaches both files with no change to the route. DRIFT RISK: any later change to the
--      WP3 body in another migration must be merged into this one, or this one will silently undo it.
--   6. public.sponsor_methods_disclosure(cohort): the same block for the sponsor's own staff (their own programmes only) and for admin / CMO.
--
-- Counts before this migration (live): no sponsor_independent_reviews table, no guard; nothing to convert.
-- Rollback: restore private.sponsor_pack_build() from 20261024201705, drop the functions and the table, delete the guard row.

-- ---------------------------------------------------------------------------
-- 1. The guard, seeded OFF
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('sponsor_methods_disclosure_enabled', 'Sponsor methods and funding disclosure',
   'The "Methods and funding" block in the sponsor pilot / renewal pack, its CSV and PDF, and on the sponsor programme-figures pages',
   'CMO has read the PROPOSED disclosure wording and agrees it states the definitions, the minimum cell and the exclusions correctly', 'cmo',
   array['sponsor_methods_block', 'sponsor_methods_disclosure', 'sponsor_pilot_pack'],
   'The pack figures, the suppression and the sponsor monthly figures are unchanged with the guard on or off. Recording an independent review works with it off but shows nothing until it is on.');

-- ---------------------------------------------------------------------------
-- 2. The PROPOSED wording (plain words; a constant, mirrored in the code registry)
-- ---------------------------------------------------------------------------
-- methods-wording-v1-begin
create function private.sponsor_methods_wording() returns jsonb
language sql immutable set search_path = ''
as $f$ select $json$
{
  "version": 1,
  "title": "Methods and funding",
  "funding": "{sponsor} sponsors this programme and this report. Tarragon Health produced the figures from its own records. {sponsor} did not choose which members, readings or results are included.",
  "minimum_cell": "A group smaller than {minimum} people is never shown, and neither is a small group beside it that would let the hidden number be worked out. A figure that is hidden says so; it is never shown as zero.",
  "definitions": "The figures use the definition versions listed here. A definition marked proposed has not been signed by Tarragon's Chief Medical Officer, and the figures that depend on it are held back until it is.",
  "exclusions_in_force": "Not counted in any outcome measure: people under 18, or with no date of birth on record; test accounts; people who are pregnant (for HbA1c, weight and the cascade of care); and people whose PHQ-9 total reached the safeguarding line (for PHQ-9 and GAD-7). They are followed up through the usual clinical routes, never through a report. Only members who agreed to share are included.",
  "exclusions_not_in_force": "No signed definition version yet lists who is left out of the measures, so the exclusion rules are not yet applied to them. Only members who agreed to share are included, and test accounts are never included.",
  "review_none": "These figures have not been independently reviewed.",
  "review_done": "Independently reviewed by {reviewer} ({organisation}) on {date}. Scope of the review: {scope}.",
  "descriptive": "These are descriptions of a group of members. They do not show that the programme caused any change."
}
$json$::jsonb $f$;
-- methods-wording-v1-end
revoke all on function private.sponsor_methods_wording() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The optional independent-review record (admin or CMO writes; never seeded)
-- ---------------------------------------------------------------------------
create table public.sponsor_independent_reviews (
  id                    uuid primary key default gen_random_uuid(),
  cohort_id             uuid not null references public.sponsor_cohorts (id) on delete restrict,
  reviewer_name         text not null check (char_length(btrim(reviewer_name)) between 2 and 120),
  reviewer_organisation text not null check (char_length(btrim(reviewer_organisation)) between 2 and 160),
  reviewed_on           date not null check (reviewed_on <= date '2100-01-01'),
  scope                 text not null check (char_length(btrim(scope)) between 10 and 600),
  recorded_by           uuid not null references public.profiles (id) on delete restrict,
  recorded_at           timestamptz not null default now(),
  retracted_at          timestamptz,
  retracted_by          uuid references public.profiles (id) on delete restrict,
  retraction_note       text,
  constraint sponsor_independent_reviews_retraction_whole check ((retracted_at is null) = (retracted_by is null) and (retracted_at is null) = (retraction_note is null))
);
create index sponsor_independent_reviews_cohort_idx on public.sponsor_independent_reviews (cohort_id, reviewed_on desc, recorded_at desc);
create index sponsor_independent_reviews_recorded_by_idx on public.sponsor_independent_reviews (recorded_by);
create index sponsor_independent_reviews_retracted_by_idx on public.sponsor_independent_reviews (retracted_by) where retracted_by is not null;
alter table public.sponsor_independent_reviews enable row level security;
revoke all on public.sponsor_independent_reviews from public, anon, authenticated;
grant select on public.sponsor_independent_reviews to authenticated;
-- Sponsor staff, clinicians and patients read nothing here directly: a sponsor sees the review only through the disclosure block.
create policy sponsor_independent_reviews_read on public.sponsor_independent_reviews for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());

create function private.sponsor_independent_reviews_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'an independent review record is never deleted: withdraw it' using errcode = '23514'; end if;
  if new.id is distinct from old.id or new.cohort_id is distinct from old.cohort_id or new.reviewer_name is distinct from old.reviewer_name
     or new.reviewer_organisation is distinct from old.reviewer_organisation or new.reviewed_on is distinct from old.reviewed_on
     or new.scope is distinct from old.scope or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at then
    raise exception 'an independent review record is never edited: withdraw it and record a new one' using errcode = '23514';
  end if;
  if old.retracted_at is not null then raise exception 'a withdrawn review stays withdrawn' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.sponsor_independent_reviews_guard() from public, anon, authenticated;
create trigger sponsor_independent_reviews_guard before update or delete on public.sponsor_independent_reviews
  for each row execute function private.sponsor_independent_reviews_guard();

create function public.record_sponsor_independent_review(p_cohort uuid, p_reviewer_name text, p_reviewer_organisation text, p_reviewed_on date, p_scope text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'only a platform admin or the chief medical officer can record an independent review' using errcode = '42501'; end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort) then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  if p_reviewed_on is null or p_reviewed_on > (now() at time zone 'Africa/Lagos')::date then raise exception 'the review date cannot be in the future' using errcode = '22023'; end if;
  -- The text is printed in a sponsor's file: it may not carry a causal claim (the same word list the pack runs).
  if cardinality(private.causal_wording_hits(coalesce(p_reviewer_name, '') || '. ' || coalesce(p_reviewer_organisation, '') || '. ' || coalesce(p_scope, ''))) > 0 then
    raise exception 'the review text may not claim that the programme caused a change' using errcode = '22023';
  end if;
  insert into public.sponsor_independent_reviews (cohort_id, reviewer_name, reviewer_organisation, reviewed_on, scope, recorded_by)
    values (p_cohort, btrim(p_reviewer_name), btrim(p_reviewer_organisation), p_reviewed_on, btrim(p_scope), v_uid) returning id into v_id;
  perform private.log_audit('sponsor.independent_review_recorded', 'sponsor_cohort', p_cohort, jsonb_build_object('review_id', v_id));
  return v_id;
end $$;
revoke all on function public.record_sponsor_independent_review(uuid, text, text, date, text) from public, anon;
grant execute on function public.record_sponsor_independent_review(uuid, text, text, date, text) to authenticated;

create function public.withdraw_sponsor_independent_review(p_review uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_cohort uuid;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'only a platform admin or the chief medical officer can withdraw an independent review' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say why the review is withdrawn (10 characters or more)' using errcode = '22023'; end if;
  update public.sponsor_independent_reviews set retracted_at = now(), retracted_by = v_uid, retraction_note = btrim(p_note)
   where id = p_review and retracted_at is null returning cohort_id into v_cohort;
  if not found then raise exception 'no open review with that id' using errcode = 'P0002'; end if;
  perform private.log_audit('sponsor.independent_review_withdrawn', 'sponsor_cohort', v_cohort, jsonb_build_object('review_id', p_review));
end $$;
revoke all on function public.withdraw_sponsor_independent_review(uuid, text) from public, anon;
grant execute on function public.withdraw_sponsor_independent_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The block
-- ---------------------------------------------------------------------------
create function private.sponsor_methods_block(p_cohort uuid, p_min integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  w jsonb := private.sponsor_methods_wording();
  c public.sponsor_cohorts%rowtype; v_sponsor text;
  v_mv integer; v_mproposed boolean := false; v_mcfg jsonb; v_msigned date; v_ex boolean;
  v_cv integer; v_cproposed boolean := false; v_csigned date;
  r public.sponsor_independent_reviews%rowtype; v_review jsonb;
begin
  if not private.go_live_guard_on('sponsor_methods_disclosure_enabled') then
    return jsonb_build_object('withheld', true, 'reason', 'not_switched_on');
  end if;
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  select name into v_sponsor from public.organisations where id = c.sponsor_org_id;

  -- the outcome measure definitions: the active signed version that lists the measures, else the newest proposed one that does
  v_mv := private.s75_measures_version();
  if v_mv is null then
    select max(version) into v_mv from public.outcome_config where config ? 'measures';
    v_mproposed := v_mv is not null;
  end if;
  select config into v_mcfg from public.outcome_config where version = v_mv;
  -- Exclusions are in force only when the definition version lists them AND the CMO has signed it (a proposed version applies nothing).
  v_ex := not v_mproposed and coalesce((v_mcfg #> '{measures,phq9}') ? 'exclusions', false);
  if not v_mproposed then
    select (max(signed_at) at time zone 'Africa/Lagos')::date into v_msigned from public.proposed_config_signoffs where config_key = 'outcomes.measure_rules' and decision = 'confirmed';
  end if;

  -- the cascade of care definitions: the active signed version, else the newest proposed one
  v_cv := (private.cascade_config() ->> '_version')::integer;
  if v_cv is null then
    select max(version) into v_cv from public.outcome_cascade_config;
    v_cproposed := v_cv is not null;
  else
    select (approved_at at time zone 'Africa/Lagos')::date into v_csigned from public.outcome_cascade_config where version = v_cv;
  end if;

  select * into r from public.sponsor_independent_reviews where cohort_id = p_cohort and retracted_at is null order by reviewed_on desc, recorded_at desc limit 1;
  v_review := case when found then
      jsonb_build_object('status', 'independently_reviewed', 'reviewer', r.reviewer_name, 'organisation', r.reviewer_organisation, 'reviewed_on', r.reviewed_on, 'scope', r.scope,
        'text', replace(replace(replace(replace(w ->> 'review_done', '{reviewer}', r.reviewer_name), '{organisation}', r.reviewer_organisation), '{date}', r.reviewed_on::text), '{scope}', r.scope))
    else jsonb_build_object('status', 'not_independently_reviewed', 'text', w ->> 'review_none') end;

  return jsonb_build_object(
    'withheld', false,
    'wording_version', (w ->> 'version')::integer,
    'funding', jsonb_build_object('sponsor', v_sponsor, 'produced_by', 'Tarragon Health', 'text', replace(w ->> 'funding', '{sponsor}', coalesce(v_sponsor, 'The sponsor'))),
    'definitions', jsonb_build_object(
      'text', w ->> 'definitions',
      'outcome_measures', case when v_mv is null then jsonb_build_object('version', null, 'status', 'none_defined')
        else jsonb_build_object('version', v_mv, 'status', case when v_mproposed then 'proposed_not_signed' else 'signed' end,
          'status_text', case when v_mproposed then 'Proposed, not signed' when v_msigned is not null then 'Signed on ' || v_msigned::text else 'Signed (the date is not recorded in this report)' end,
          'signed_on', case when v_mproposed then null else v_msigned end) end,
      'cascade_of_care', case when v_cv is null then jsonb_build_object('version', null, 'status', 'none_defined')
        else jsonb_build_object('version', v_cv, 'status', case when v_cproposed then 'proposed_not_signed' else 'signed' end,
          'status_text', case when v_cproposed then 'Proposed, not signed' else 'Signed on ' || v_csigned::text end,
          'signed_on', case when v_cproposed then null else v_csigned end) end),
    'minimum_cell', jsonb_build_object('minimum', p_min, 'text', case when p_min is null then 'A group below the minimum size is never shown.' else replace(w ->> 'minimum_cell', '{minimum}', p_min::text) end),
    'exclusions', jsonb_build_object('applied_by_the_definition_in_use', v_ex, 'text', case when v_ex then w ->> 'exclusions_in_force' else w ->> 'exclusions_not_in_force' end),
    'review', v_review,
    'descriptive_note', w ->> 'descriptive');
end $$;
revoke all on function private.sponsor_methods_block(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The pack carries it (WP3 body, one added key)
-- ---------------------------------------------------------------------------
create or replace function private.sponsor_pack_build(p_cohort uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.sponsor_cohorts%rowtype; v_members uuid[]; v_fig jsonb; v_meas jsonb := '{}'::jsonb; m text; v_signed boolean := private.outcome_measures_signed();
  v_min integer; v_doc jsonb; v_hits text[]; d integer; v_by jsonb; v_pack jsonb; v_casc jsonb;
begin
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  v_members := private.sponsor_agreed_members(p_cohort);
  v_fig := private.sponsor_report_aggregate(p_cohort, p_from, p_to);
  v_min := (v_fig ->> 'minimum_cell')::integer;
  -- All four measures. PHQ-9 and GAD-7 reach a sponsor ONLY as suppressed group figures, through private.outcome_measure_cohort (CMO decision 2026-10-14, S75-7): never a person,
  -- never below the minimum cohort size.
  foreach m in array array['hba1c', 'weight', 'phq9', 'gad7'] loop
    if not v_signed then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature'));
    elsif private.suppress_cell(cardinality(v_members), null, v_min) is not null then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min));
    else
      v_by := '{}'::jsonb;
      foreach d in array array[90, 180] loop v_by := v_by || jsonb_build_object(d::text, private.outcome_measure_cohort(m, d, p_from, p_to, v_members)); end loop;
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', false, 'by_day', v_by));
    end if;
  end loop;
  -- WP3: the cascade of care (members who agreed to share only) and the selection-bias panel (sponsor audience).
  v_casc := case when private.suppress_cell(cardinality(v_members), null, v_min) is not null then jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min)
                 else jsonb_build_object('hypertension', private.cascade_aggregate('hypertension', v_members, p_from, p_to, v_min),
                                         'diabetes', private.cascade_aggregate('diabetes', v_members, p_from, p_to, v_min)) end;
  v_pack := jsonb_build_object(
    'cover', jsonb_build_object('programme', c.name, 'sponsor', v_fig #>> '{cohort,sponsor}', 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                                'range', jsonb_build_object('from', p_from, 'to', p_to), 'generated_at', now()),
    'evaluation_design', private.outcome_measure_rule('{pack,evaluation_design}') #>> '{}',
    'caveat', private.outcome_measure_rule('{pack,caveat}') #>> '{}',
    'group_figures', v_fig,
    'retention_and_engagement', case when private.suppress_cell(cardinality(v_members), null, v_min) is null then private.retention_aggregate(p_from, p_to, v_members)
                                     else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'clinical_measures', v_meas,
    'cascade_of_care', v_casc,
    'selection_panel', case when private.suppress_cell(cardinality(v_members), null, v_min) is not null then jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min)
                            else private.selection_panel_build(p_cohort, p_from, p_to, false, v_min) end,
    -- GAP-71: who sponsors and produced the figures, the definition versions and their sign status, the minimum cell, the exclusions, the review status.
    'methods_and_funding', private.sponsor_methods_block(p_cohort, v_min),
    'not_a_causal_claim', true);
  v_hits := private.causal_wording_hits(private.json_text(v_pack));
  if cardinality(v_hits) > 0 then return jsonb_build_object('ok', false, 'reason', 'causal_wording', 'hits', to_jsonb(v_hits)); end if;
  return jsonb_build_object('ok', true, 'pack', v_pack, 'wording_check', jsonb_build_object('passed', true));
end $$;
revoke all on function private.sponsor_pack_build(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The disclosure for a sponsor's own staff (own programmes only) and for admin / CMO
-- ---------------------------------------------------------------------------
create function public.sponsor_methods_disclosure(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org(); v_privileged boolean := (private.is_admin() or private.credential_is_cmo()); v_min integer;
begin
  if (select auth.uid()) is null or (v_org is null and not v_privileged) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  -- Sponsor staff: their own sponsor's live programmes only; another sponsor's and a missing one get the same answer.
  if not v_privileged and not exists (select 1 from public.sponsor_cohorts where id = p_cohort and sponsor_org_id = v_org and not is_test) then
    perform private.log_audit('sponsor.staff_refused', 'sponsor_cohort', null, jsonb_build_object('asked_for', p_cohort));
    return jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort) then return jsonb_build_object('ok', false); end if;
  select private.min_cell_floor(o.min_cohort_size) into v_min from public.sponsor_cohorts c join public.organisations o on o.id = c.sponsor_org_id where c.id = p_cohort;
  perform private.log_audit('sponsor.methods_viewed', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'methods', private.sponsor_methods_block(p_cohort, v_min));
end $$;
revoke all on function public.sponsor_methods_disclosure(uuid) from public, anon;
grant execute on function public.sponsor_methods_disclosure(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.go_live_guards where key = 'sponsor_methods_disclosure_enabled' and is_on) then raise exception 'GAP-71: the guard must start off'; end if;
  if exists (select 1 from public.sponsor_independent_reviews) then raise exception 'GAP-71: a review must never be seeded'; end if;
  if has_table_privilege('anon', 'public.sponsor_independent_reviews', 'SELECT') or has_table_privilege('authenticated', 'public.sponsor_independent_reviews', 'INSERT,UPDATE,DELETE') then
    raise exception 'GAP-71: sponsor_independent_reviews is reachable';
  end if;
  if has_function_privilege('anon', 'public.sponsor_methods_disclosure(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.record_sponsor_independent_review(uuid,text,text,date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_sponsor_independent_review(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sponsor_methods_block(uuid,integer)', 'EXECUTE') then
    raise exception 'GAP-71: a function is reachable that should not be';
  end if;
end $$;
