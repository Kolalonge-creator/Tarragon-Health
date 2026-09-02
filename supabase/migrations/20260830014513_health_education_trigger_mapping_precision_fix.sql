-- Tarragon Health — Health Education: tighten the event-trigger mapping
-- seeded in 20260830023309_health_education_event_triggers.sql.
--
-- Verified live in a rolled-back transaction: the category-level seed
-- ('medicines' has 14 rows, 'heart'/'diabetes'/'hypertension' each have a
-- full 12-week curriculum) recommended ALL of them for a single event — a
-- new Amlodipine prescription produced 14 recommendation rows. That is
-- noise, not a recommendation. This migration replaces every seeded row
-- with a specific `target_content_id` pointing at one well-chosen,
-- already-shipped introductory article per event, instead of an entire
-- category. Medication matching also switches from per-drug-name keys (four
-- rows, each still recommending the same generic non-drug-specific content
-- since no drug-specific articles exist yet) to a single match-any-drug
-- sentinel (match_key = '' — the trigger's `like '%' || match_key || '%'`
-- pattern makes an empty key match every drug_name), since the content
-- itself isn't drug-specific.

delete from public.health_education_trigger_mappings
where trigger_source in ('medication', 'abnormal_result');

insert into public.health_education_trigger_mappings (trigger_source, match_key, target_content_id, note)
select 'medication', '', c.id, 'New medication (any drug) -> orientation reading'
from public.health_education_content c
where c.code in ('med-understanding-prescription-label', 'med-consistency-matters', 'med-side-effects-normal-vs-report');

insert into public.health_education_trigger_mappings (trigger_source, match_key, target_content_id, note)
select 'abnormal_result', v.match_key, c.id, v.note
from public.health_education_content c
join (values
  ('cholesterol', 'heart-cholesterol-basics', 'Abnormal cholesterol -> cardiovascular education'),
  ('lipid',       'heart-cholesterol-basics', 'Abnormal lipid panel -> cardiovascular education'),
  ('ldl',         'heart-cholesterol-basics', 'Abnormal LDL -> cardiovascular education'),
  ('glucose',     'dm-understanding-sugar',   'Abnormal glucose -> diabetes education'),
  ('hba1c',       'dm-understanding-sugar',   'Abnormal HbA1c -> diabetes education'),
  ('blood_pressure', 'htn-understanding-bp',  'Abnormal BP screening -> hypertension education')
) as v(match_key, content_code, note) on c.code = v.content_code;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.health_education_trigger_mappings where trigger_source in ('medication', 'abnormal_result');
  if v_count < 6 then
    raise exception 'expected at least 6 tightened trigger mapping rows, got %', v_count;
  end if;
end $$;
