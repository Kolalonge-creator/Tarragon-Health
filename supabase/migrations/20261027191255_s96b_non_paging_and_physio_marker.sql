-- S96 follow-up (founder decisions 2026-10-27), on top of 20261027184235_s96_msk_programmes.sql. NOT APPLIED TO PRODUCTION. Nothing is signed,
-- approved, confirmed or switched on.
--
-- 1. WARNING SIGNS THAT STOP THE PROGRAMME BUT DO NOT PAGE. Possible heart or stroke warning signs (chest or arm pain, sudden worst headache, trouble
--    speaking or swallowing or a drooping face, breathless with leg pain) must still show "go to the nearest hospital now" and stop the programme, but must
--    NOT page the on-call clinician. A normal same-day clinician task is raised instead. The engine's `crisis` route pages (therapy_raise_crisis:
--    urgent event, class 1 task, on-call page), so this adds the smallest change: a per-rule flag `non_paging` (only valid on a `crisis` rule), carried in
--    the screen result and read by private.therapy_route_stop. The crisis path used by the mental-health items is untouched: their rules have non_paging
--    false, which is the default, so they page exactly as before.
--    Functions patched by exact-match anchor (each fails loudly if the live definition has drifted): private.therapy_evaluate_screen (carry the flag in
--    each stop), private.therapy_route_stop (a crisis whose stops are all non-paging raises the same-day symptom_review task, no page), and
--    public.save_therapy_exclusion_list (so a list the CMO saves keeps the flag).
--    Data: the six pain crisis items in list version 2 (still a DRAFT, unconfirmed: a confirmed list is frozen and would make this migration fail loudly)
--    get the flag. TS twin: packages/shared (TherapyExclusionRule.nonPaging, stopPagesOnCall).
-- 2. NOT PHYSIOTHERAPIST-REVIEWED MARKER. therapy_programme_versions.not_physiotherapist_reviewed (internal; never patient-visible) is true for the four
--    pain versions. Only the CMO approves; when a physiotherapist is hired, a review can be recorded by setting physio_review_recorded_at (and an optional
--    physio_review_ref pointing at the future review record), which clears the marker. No physiotherapist role is built; the two nullable columns are the hook.
--
-- ROWS AFFECTED. 6 exclusion rules updated (list version 2 pain crisis items), 4 programme version rows updated. 0 enrolments are affected.

-- ---------------------------------------------------------------------------
-- 1. non_paging
-- ---------------------------------------------------------------------------
alter table public.therapy_exclusion_rules add column if not exists non_paging boolean not null default false;
alter table public.therapy_exclusion_rules drop constraint if exists therapy_rules_non_paging_only_crisis;
alter table public.therapy_exclusion_rules add constraint therapy_rules_non_paging_only_crisis check (non_paging = false or route = 'crisis');
comment on column public.therapy_exclusion_rules.non_paging is 'S96: a crisis rule that stops the programme and shows hospital-now guidance but raises a normal same-day clinician task and does NOT page the on-call clinician. Default false: every mental-health crisis rule pages.';

do $$
declare v_def text; v_new text;
begin
  -- the screen carries the flag in each stop
  v_def := pg_get_functiondef('private.therapy_evaluate_screen(text, jsonb, integer)'::regprocedure);
  if v_def not like '%non_paging%' then
    v_new := replace(v_def, $q$'unverified', r.unverified, 'unanswered', v_unans)$q$, $q$'unverified', r.unverified, 'unanswered', v_unans, 'non_paging', r.non_paging)$q$);
    if v_new = v_def then raise exception 'S96b: therapy_evaluate_screen marker not found (definition drifted)'; end if;
    execute v_new;
  end if;

  -- routing: a crisis with only non-paging stops raises the normal same-day task and never pages
  v_def := pg_get_functiondef('private.therapy_route_stop(uuid, jsonb)'::regprocedure);
  if v_def not like '%non_paging%' then
    v_new := replace(v_def,
      $q$  if v_route = 'crisis' then
    v_task_failed := not private.therapy_raise_crisis(e.id);
  elsif v_route in ('same_day_clinician', 'medical_review_first') then$q$,
      $q$  if v_route = 'crisis' and exists (select 1 from jsonb_array_elements(coalesce(p_screen -> 'stops', '[]'::jsonb)) st
                                         where st ->> 'route' = 'crisis' and not coalesce((st ->> 'non_paging')::boolean, false)) then
    v_task_failed := not private.therapy_raise_crisis(e.id);
  elsif v_route in ('crisis', 'same_day_clinician', 'medical_review_first') then$q$);
    if v_new = v_def then raise exception 'S96b: therapy_route_stop branch marker not found (definition drifted)'; end if;
    v_def := v_new;
    v_new := replace(v_def, $q$(v_cfg -> 'route_due_minutes' ->> v_route)::integer$q$, $q$(v_cfg -> 'route_due_minutes' ->> case when v_route = 'crisis' then 'same_day_clinician' else v_route end)::integer$q$);
    if v_new = v_def then raise exception 'S96b: therapy_route_stop due-minutes marker not found (definition drifted)'; end if;
    execute v_new;
  end if;

  -- a list the CMO saves keeps the flag
  v_def := pg_get_functiondef('public.save_therapy_exclusion_list(text, jsonb, text)'::regprocedure);
  if v_def not like '%non_paging%' then
    v_new := replace(v_def, $q$route, unverified)$q$, $q$route, unverified, non_paging)$q$);
    if v_new = v_def then raise exception 'S96b: save_therapy_exclusion_list column marker not found (definition drifted)'; end if;
    v_def := v_new;
    v_new := replace(v_def, $q$coalesce((x ->> 'unverified')::boolean, false));$q$, $q$coalesce((x ->> 'unverified')::boolean, false), coalesce((x ->> 'non_paging')::boolean, false));$q$);
    if v_new = v_def then raise exception 'S96b: save_therapy_exclusion_list values marker not found (definition drifted)'; end if;
    execute v_new;
  end if;
end $$;

-- msk-non-paging-begin (packages/shared/src/proposed-config/msk-config-data.ts mirrors it, a test fails on drift)
update public.therapy_exclusion_rules r
   set non_paging = true
  from jsonb_each($json${"pain_back":["chest_pain_now"],"pain_neck":["chest_or_arm_pain_now","sudden_severe_headache","speech_swallow_vision_face"],"pain_knee":["breathless_with_leg_pain"],"pain_hip":["breathless_with_leg_pain"]}$json$::jsonb) l
 where r.programme_code = l.key and r.list_version = 2 and r.item_code in (select jsonb_array_elements_text(l.value));
-- msk-non-paging-end

-- ---------------------------------------------------------------------------
-- 2. The not-physiotherapist-reviewed marker (internal)
-- ---------------------------------------------------------------------------
alter table public.therapy_programme_versions add column if not exists not_physiotherapist_reviewed boolean not null default false;
alter table public.therapy_programme_versions add column if not exists physio_review_recorded_at timestamptz;
alter table public.therapy_programme_versions add column if not exists physio_review_ref text;
alter table public.therapy_programme_versions drop constraint if exists therapy_versions_physio_marker_shape;
alter table public.therapy_programme_versions add constraint therapy_versions_physio_marker_shape
  check (not (not_physiotherapist_reviewed and physio_review_recorded_at is not null));
comment on column public.therapy_programme_versions.not_physiotherapist_reviewed is 'S96: INTERNAL marker, never patient-visible. True while exercise doses and progressions have been approved by the CMO only. Cleared (set false, with physio_review_recorded_at) when a physiotherapist review is recorded. No physiotherapist role exists yet; the two nullable columns are the hook.';

update public.therapy_programme_versions v
   set not_physiotherapist_reviewed = true
  from public.therapy_programmes p
 where p.id = v.programme_id and p.code in ('pain_back', 'pain_neck', 'pain_knee', 'pain_hip') and v.physio_review_recorded_at is null;

-- ---------------------------------------------------------------------------
-- 3. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.therapy_exclusion_rules where non_paging) <> 6 then raise exception 'FAIL: expected 6 non-paging rules'; end if;
  if exists (select 1 from public.therapy_exclusion_rules where non_paging and (route <> 'crisis' or programme_code not like 'pain\_%' or list_version <> 2)) then
    raise exception 'FAIL: a non-paging rule outside the pain crisis items of list version 2';
  end if;
  if exists (select 1 from public.therapy_exclusion_rules where route = 'crisis' and programme_code like 'pain\_%' and list_version = 2 and not non_paging) then
    raise exception 'FAIL: a pain crisis item still pages';
  end if;
  if exists (select 1 from public.therapy_exclusion_rules where non_paging is distinct from false and programme_code in ('low_mood', 'stress', 'anxiety', 'panic_breathing')) then
    raise exception 'FAIL: a mental-health rule is non-paging';
  end if;
  if exists (select 1 from public.therapy_exclusion_list_versions where programme_code like 'pain\_%' and version = 2 and status <> 'draft') then raise exception 'FAIL: a pain list is not a draft'; end if;
  if (select count(*) from public.therapy_programme_versions v join public.therapy_programmes p on p.id = v.programme_id
       where p.code like 'pain\_%' and v.not_physiotherapist_reviewed) <> 4 then raise exception 'FAIL: the four pain versions must carry the marker'; end if;
  if pg_get_functiondef('private.therapy_route_stop(uuid, jsonb)'::regprocedure) not like '%non_paging%' then raise exception 'FAIL: route_stop does not read the flag'; end if;
  if pg_get_functiondef('private.therapy_route_stop(uuid, jsonb)'::regprocedure) not like '%therapy_raise_crisis%' then raise exception 'FAIL: the crisis path was lost'; end if;
  if exists (select 1 from public.go_live_guards where key like 'therapy\_%\_enabled' and is_on) then raise exception 'FAIL: a therapy guard is on'; end if;
end $$;
