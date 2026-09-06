-- Tarragon Health — Health Education: retag existing content into the new
-- exercise/sleep/vaccination categories (§79.2). Separate migration from
-- the ADD VALUE above by necessity (Postgres cannot use a brand-new enum
-- value in the same transaction that added it).
--
-- No new clinical prose is written here — every row already exists and was
-- already shipped; this only corrects which browsable bucket it sits in.
-- `category` is independent of `condition`/`drip_week` (which drive
-- personalisation and the health_education_programmes pathways), so
-- retagging here is purely additive to browsability — it does not remove
-- any row from a condition-specific feed, drip curriculum, or pathway.
--
-- Live content codes confirmed via a direct query against the shared
-- project immediately before writing this migration (several of these —
-- heart-sleep-apnoea, ob-exercise-*, mh-sleep-mental-health-link,
-- resp-asthma-exercise, screen-hpv-vaccine, gen_w2/gen_w4 — were added by a
-- concurrent session and don't exist in this worktree's local migration
-- files; retagging them here does not duplicate or conflict with that work).

update public.health_education_content
set category = 'sleep'
where code in ('heart-sleep-apnoea', 'gen_w2_sleep_is_treatment', 'htn_w10_sleep_apnoea', 'mh-sleep-mental-health-link');

update public.health_education_content
set category = 'exercise'
where code in (
  'dm_w6_exercise_timing', 'htn_w4_movement_that_counts', 'ob_w4_movement_and_muscle',
  'ob-exercise-starting-point', 'ob-exercise-without-gym', 'ob-exercise-how-much',
  'heart-exercise-with-condition', 'resp-asthma-exercise'
);

update public.health_education_content
set category = 'vaccination'
where code in ('family-childhood-vaccine-schedule', 'gen_w4_adult_vaccines', 'screen-hpv-vaccine');

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.health_education_content where category in ('exercise', 'sleep', 'vaccination');
  if v_count < 10 then
    raise exception 'expected at least 10 rows retagged into exercise/sleep/vaccination, got %', v_count;
  end if;
end $$;
