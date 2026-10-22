-- Record-triggered lessons (item 7) and the local food portion guide (item 8). Part 2 of 2; part 1 is 20261022093519_learning_quality_gates.sql.
--
-- NOTHING IS SWITCHED ON AND NOTHING IS APPROVED.
--   * Item 7. A guard, record_triggered_lessons_enabled, is created OFF and with no defined condition (so it cannot be switched on until the CMO's
--     conditions are added to private.go_live_conditions: OQ-S55-QG-02). The six lessons it points at are DRAFT placeholder rows that cannot be
--     published until a named clinical author, a named reviewer, a source, a future review date and a self-care step exist (the S55 publish gate).
--     The database only LOGS a show (record_lesson_shown, which answers 'shown', 'already_shown' (logged earlier today) or 'refused'); it decides no band. The bands come from the platform's own classifiers, applied by the
--     app (BP: private.classify_bp_level and its web/phone mirror; glucose: lib/vitals/glucose-red-flags.ts; labs: the stored flag), and the database
--     re-checks what it can before it records anything: the guard, the config mapping, the lesson's publication state, that the cited readings are the
--     caller's own, the BP band (it re-runs private.classify_bp_level), lab release state and INV-04, and an urgent-reading suppression window.
--   * Item 8. Two DRAFT portion-guide articles are seeded (diabetes, blood pressure). Each is is_placeholder = true, status draft, no reviewer, no
--     source, no review date, so the publish gate refuses it; and a second trigger refuses any portion guide while the learning_config row
--     `portion_guide` is still 'proposed'. Every amount lives in that row (PROPOSED placeholders), never in a component.
-- Rows affected: learning_config +2 rows; health_education_content +8 DRAFT rows (6 record lessons, 2 portion guides); 1 new table (patient shows);
-- 1 guard row; 1 event type. 0 existing rows change.

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration (PROPOSED; mirrored in packages/shared proposed-config, with a drift test)
-- ---------------------------------------------------------------------------
-- learning-record-lessons-begin
insert into public.learning_config (key, version, value, status, note) values
('record_lessons', 1, $json${"suppress_hours_after_urgent":72,"vitals":{"sustained_readings":3,"window_days":14},"lab":{"sustained_results":2},"lessons":{"blood_pressure":{"in_target":"record-bp-in-target","above_target":"record-bp-above-target"},"glucose":{"in_target":"record-glucose-in-target","above_target":"record-glucose-above-target"},"lab":{"hba1c":{"normal":"record-lab-hba1c-normal","high":"record-lab-hba1c-high"}}}}$json$::jsonb, 'proposed',
 'Item 7: which published lesson goes with which band, and how much of a pattern is needed before a band above the lowest may show a lesson. No threshold lives here: the bands come from the platform classifiers. PROPOSED: the CMO chooses the lessons, the pattern sizes and the window (OQ-S55-QG-02).')
on conflict (key, version) do nothing;
-- learning-record-lessons-end

-- learning-portion-guide-begin
insert into public.learning_config (key, version, value, status, note) values
('portion_guide', 1, $json${"portions":{"swallow":{"diabetes":{"amount":1,"unit":"fist","per":"meal"},"blood_pressure":{"amount":1,"unit":"fist","per":"meal"}},"rice_jollof":{"diabetes":{"amount":1,"unit":"fist","per":"meal"},"blood_pressure":{"amount":1,"unit":"fist","per":"meal"}},"beans":{"diabetes":{"amount":1,"unit":"cupped_hand","per":"meal"},"blood_pressure":{"amount":1,"unit":"cupped_hand","per":"meal"}},"soup":{"diabetes":{"amount":2,"unit":"cupped_hand","per":"meal"},"blood_pressure":{"amount":1,"unit":"cupped_hand","per":"meal"}},"plantain":{"diabetes":{"amount":1,"unit":"palm","per":"meal"},"blood_pressure":{"amount":1,"unit":"palm","per":"meal"}},"yam":{"diabetes":{"amount":1,"unit":"fist","per":"meal"},"blood_pressure":{"amount":1,"unit":"fist","per":"meal"}},"bread":{"diabetes":{"amount":2,"unit":"slice","per":"meal"},"blood_pressure":{"amount":2,"unit":"slice","per":"meal"}},"drinks":{"diabetes":{"amount":0,"unit":"cupped_hand","per":"day"}},"fruit":{"diabetes":{"amount":1,"unit":"fist","per":"meal"},"blood_pressure":{"amount":2,"unit":"fist","per":"day"}},"protein":{"diabetes":{"amount":1,"unit":"palm","per":"meal"},"blood_pressure":{"amount":1,"unit":"palm","per":"meal"}},"fried_food":{"diabetes":{"amount":1,"unit":"fist","per":"week"},"blood_pressure":{"amount":1,"unit":"fist","per":"week"}},"seasoning_cube":{"blood_pressure":{"amount":1,"unit":"cube","per":"pot"}},"table_salt":{"blood_pressure":{"amount":1,"unit":"pinch","per":"pot"}}}}$json$::jsonb, 'proposed',
 'Item 8: hand-measure amounts for the local food portion guide. EVERY NUMBER IS A PLACEHOLDER, not clinical advice. A guide cannot be published while this row is proposed; a clinician or dietitian sets the amounts and the row is replaced by a confirmed version (OQ-S55-QG-03).')
on conflict (key, version) do nothing;
-- learning-portion-guide-end

-- ---------------------------------------------------------------------------
-- 2. A portion guide cannot be published while its amounts are still proposed
-- ---------------------------------------------------------------------------
create or replace function private.health_education_portion_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.content_status = 'published'
     and (tg_op = 'INSERT' or old.content_status is distinct from 'published')
     and new.body ~ '(^|\n)\s*\[portion [a-z0-9_]+ [a-z_]+\]' then
    select c.status into v_status from public.learning_config c where c.key = 'portion_guide' and c.is_active order by c.version desc limit 1;
    if v_status is distinct from 'confirmed' then
      raise exception 'A food portion guide cannot be published while its amounts are still proposed: a clinician or dietitian must set them and the configuration must be confirmed'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_portion_gate() from public, anon, authenticated;
drop trigger if exists health_education_portion_gate on public.health_education_content;
create trigger health_education_portion_gate
  before insert or update on public.health_education_content
  for each row execute function private.health_education_portion_gate();

-- ---------------------------------------------------------------------------
-- 3. Record-triggered lessons: event, shows table, guard, logging function
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('learning.record_lesson_shown', 'A record-triggered lesson was shown to a person (ids only)', 'S55', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('learning.record_lesson_shown', 1, array['show_id', 'content_id'])
on conflict (event_type, version) do nothing;

create table if not exists public.learning_record_lesson_shows (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  content_id      uuid not null references public.health_education_content(id) on delete cascade,
  source_kind     text not null check (source_kind in ('blood_pressure', 'glucose', 'lab')),
  band            text not null check (band in ('in_target', 'above_target', 'normal', 'high', 'low')),
  -- the readings or lab items that led to the lesson; ids only, not foreign keys (a reading may later be corrected)
  source_ids      uuid[] not null check (cardinality(source_ids) between 1 and 10),
  shown_on        date not null default ((now() at time zone 'Africa/Lagos')::date),
  shown_at        timestamptz not null default now(),
  is_test         boolean not null default false,
  unique (patient_id, content_id, shown_on)
);
create index if not exists learning_record_lesson_shows_patient_idx on public.learning_record_lesson_shows (patient_id, shown_at desc);
alter table public.learning_record_lesson_shows enable row level security;
revoke all on public.learning_record_lesson_shows from anon, authenticated;
grant select on public.learning_record_lesson_shows to authenticated;
drop policy if exists learning_record_shows_own_read on public.learning_record_lesson_shows;
create policy learning_record_shows_own_read on public.learning_record_lesson_shows for select to authenticated
  using (patient_id = (select auth.uid()));
comment on table public.learning_record_lesson_shows is
  'Item 7. One row per person, lesson and Lagos day when a record-triggered lesson was shown. Written only by record_lesson_shown(). No staff read path exists.';

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'record_triggered_lessons_enabled', 'Record-triggered lessons',
       'Showing a "what this reading means" lesson after a blood pressure, glucose or lab result lands in a band',
       'The CMO has published the lessons the bands point at, signed the band-to-lesson mapping and pattern sizes, and confirmed the wording reviewed against NG-2023', 'cmo',
       array['record_lesson_shown (recording that a lesson was shown)'],
       'Urgent-help guidance for a red or emergency reading is never behind this guard. Switching it on needs its conditions added to private.go_live_conditions first; until then it reports "no defined condition" and cannot be switched on.'
where not exists (select 1 from public.go_live_guards where key = 'record_triggered_lessons_enabled');

create or replace function public.record_lesson_shown(p_source text, p_band text, p_lesson_code text, p_source_ids uuid[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_cfg jsonb;
  v_ids uuid[];
  v_n integer;
  v_expected text;
  v_analyte text;
  v_suppress integer;
  v_window integer;
  v_needed integer;
  v_ok integer;
  v_distinct integer;
  c public.health_education_content%rowtype;
  v_show uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  -- Guard (INV-14). Off means a quiet 'refused', never an error the screen has to explain.
  if not private.go_live_open_patient('record_triggered_lessons_enabled', v_me) then return 'refused'; end if;

  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_me;
  if v_org is null then return 'refused'; end if;
  v_cfg := private.learning_config('record_lessons');
  if v_cfg is null then return 'refused'; end if;
  if p_source not in ('blood_pressure', 'glucose', 'lab') then return 'refused'; end if;
  if (p_source <> 'lab' and p_band not in ('in_target', 'above_target')) or (p_source = 'lab' and p_band not in ('normal', 'high', 'low')) then return 'refused'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_source_ids, '{}'::uuid[])) as x;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n < 1 or v_n > 10 then return 'refused'; end if;

  v_suppress := (v_cfg #>> '{suppress_hours_after_urgent}')::integer;
  v_window := (v_cfg #>> '{vitals,window_days}')::integer;

  -- 1. The cited readings are this person's own, and the band holds.
  if p_source = 'lab' then
    -- Released only (INV-03); a result holding a sensitive positive is dropped whole (INV-04); the stored flag must be the band; one analyte only.
    select min(i.analyte_code), count(distinct i.analyte_code),
           count(*) filter (where i.flag = p_band and not i.sensitive_positive and r.release_state = 'released' and r.superseded_by is null
                              and not exists (select 1 from public.lab_result_items s where s.lab_result_id = r.id and s.sensitive_positive))
      into v_analyte, v_distinct, v_ok
      from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
     where i.id = any(v_ids) and i.patient_id = v_me;
    if v_distinct is distinct from 1 or v_ok <> v_n then return 'refused'; end if;
    v_needed := case when p_band = 'normal' then 1 else (v_cfg #>> '{lab,sustained_results}')::integer end;
    if (p_band = 'normal' and v_n <> 1) or (p_band <> 'normal' and v_n < v_needed) then return 'refused'; end if;
    v_expected := v_cfg #>> array['lessons', 'lab', v_analyte, p_band];
  else
    if p_source = 'blood_pressure' then
      select count(*) filter (where v.patient_id = v_me and v.correction_status is null and v.vital_type = 'blood_pressure'
                                and private.classify_bp_level(v.systolic, v.diastolic) = case when p_band = 'in_target' then 'green' else 'amber' end
                                and (p_band = 'in_target' or v.taken_at >= now() - make_interval(days => v_window)))
        into v_ok from public.vitals_readings v where v.id = any(v_ids);
    else
      select count(*) filter (where v.patient_id = v_me and v.correction_status is null and v.glucose_mmol_l is not null
                                and (p_band = 'in_target' or v.taken_at >= now() - make_interval(days => v_window)))
        into v_ok from public.vitals_readings v where v.id = any(v_ids);
    end if;
    if v_ok <> v_n then return 'refused'; end if;
    v_needed := (v_cfg #>> '{vitals,sustained_readings}')::integer;
    -- never an above-target lesson from a single reading
    if (p_band = 'in_target' and v_n <> 1) or (p_band = 'above_target' and v_n < v_needed) then return 'refused'; end if;
    v_expected := v_cfg #>> array['lessons', p_source, p_band];
  end if;

  -- 2. The lesson is the one the configuration names for this band.
  if v_expected is null or v_expected <> p_lesson_code then return 'refused'; end if;

  -- 3. Urgent-help outranks a lesson: a red or emergency blood pressure, or an emergency event, inside the window blocks it (the app re-checks glucose and labs).
  if exists (select 1 from public.vitals_readings v
              where v.patient_id = v_me and v.correction_status is null and v.vital_type = 'blood_pressure'
                and v.taken_at >= now() - make_interval(hours => v_suppress)
                and private.classify_bp_level(v.systolic, v.diastolic) in ('red', 'emergency'))
     or exists (select 1 from public.emergency_events e where e.patient_id = v_me and e.created_at >= now() - make_interval(hours => v_suppress)) then
    return 'refused';
  end if;

  -- 4. Only a published, reviewed, in-date lesson.
  select * into c from public.health_education_content x
   where x.code = p_lesson_code and not x.is_placeholder and x.content_status = 'published'
     and x.clinician_reviewed and x.reviewed_by_name is not null and x.reviewed_at is not null
     and private.learning_age_ok(x.min_age, x.max_age)
     and not private.learning_creator_locked(x.creator_id)
     and private.health_education_is_servable(x.is_active, x.content_status, x.next_review_due);
  if not found then return 'refused'; end if;

  insert into public.learning_record_lesson_shows (organisation_id, patient_id, content_id, source_kind, band, source_ids, is_test)
  values (v_org, v_me, c.id, p_source, p_band, v_ids, v_test)
  on conflict (patient_id, content_id, shown_on) do nothing
  returning id into v_show;
  if v_show is null then return 'already_shown'; end if;

  -- ids only (INV-07): no reading, no condition, no band in the payload.
  perform private.emit_domain_event('learning.record_lesson_shown', v_org,
    jsonb_build_object('show_id', v_show, 'content_id', c.id),
    'learning.record_lesson_shown:' || v_show::text, v_me, 'learning_record_lesson_show', v_show);
  return 'shown';
end;
$$;
revoke execute on function public.record_lesson_shown(text, text, text, uuid[]) from public, anon;
grant execute on function public.record_lesson_shown(text, text, text, uuid[]) to authenticated;

-- The person's own released lab items for the analytes the configuration has a lesson for, and nothing else: released (INV-03), not superseded, and a
-- result that holds a sensitive positive (INV-04) is left out whole, so a sensitive item can never reach the lesson logic, however it is read.
create or replace function public.record_lesson_lab_items()
returns table (id uuid, result_id uuid, analyte_code text, flag text, sensitive_positive boolean, release_state text, received_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.lab_result_id, i.analyte_code, i.flag, i.sensitive_positive, r.release_state, r.received_at
    from public.lab_result_items i
    join public.lab_results r on r.id = i.lab_result_id
   where (select auth.uid()) is not null
     and i.patient_id = (select auth.uid())
     and r.release_state = 'released' and r.superseded_by is null
     and not exists (select 1 from public.lab_result_items s where s.lab_result_id = r.id and s.sensitive_positive)
     and i.analyte_code in (select jsonb_object_keys(coalesce(private.learning_config('record_lessons') #> '{lessons,lab}', '{}'::jsonb)))
   order by r.received_at desc
   limit 40;
$$;
revoke execute on function public.record_lesson_lab_items() from public, anon;
grant execute on function public.record_lesson_lab_items() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. DRAFT content (nothing here can reach a person)
-- ---------------------------------------------------------------------------
-- Why none of these can be served: content_status is 'draft' and is_placeholder is TRUE, so the S55 publish gate refuses them; clearing the flag
-- needs a named clinical author and the gate then needs a named reviewer, a source, a future review date and a self-care step. reviewed_by_name is
-- null and clinician_reviewed is false on every row. The words below are a first draft for a clinical author to rewrite, not clinical advice.
do $$
declare
  r record;
  v_new integer := 0;
begin
  for r in select * from (values
    ('record-bp-in-target', 'hypertension'::public.health_education_category, 'Your blood pressure reading is in a good range',
$q$Your latest reading is in the range we hope for. That is good news.
It does not mean you can stop your tablets or skip your checks. Blood pressure goes up and down through the day, so one reading is only one small picture.
Keep taking your medicines the way you were told. Check at the same time each day. Sit down and rest for five minutes before you check.
If you feel unwell, even when the reading looks good, tell your care team.$q$),
    ('record-bp-above-target', 'hypertension', 'Your readings have been above target for a while',
$q$Your last few readings have been higher than the range we hope for. This does not mean something terrible is happening. It does mean your care team should look at your numbers.
Some things can help. Take your medicines at the same time each day. Use less salt and fewer seasoning cubes. Walk a little each day if you can.
Do not change or stop your medicines on your own. Your care team can see your readings in the app. You can send them a message or ask for a visit.$q$),
    ('record-glucose-in-target', 'diabetes', 'Your sugar reading is in a good range',
$q$Your latest sugar reading is in the range we hope for. That is good news.
One good reading does not mean you can stop your medicines or your checks. Your sugar changes with food, rest, stress and sickness.
Keep to your meals and your medicines. Keep checking the way your care team showed you.
If you feel unwell, even when the reading looks good, tell your care team.$q$),
    ('record-glucose-above-target', 'diabetes', 'Your sugar readings have been above target for a while',
$q$Your last few sugar readings have been higher than the range we hope for. This does not mean something terrible is happening. It does mean your care team should look at your numbers.
Some things can help. Take your medicines at the same time each day. Look at the size of your swallow, rice and drinks. Walk a little each day if you can.
Do not change or stop your medicines on your own. Your care team can see your readings in the app. You can send them a message or ask for a visit.$q$),
    ('record-lab-hba1c-normal', 'diabetes', 'Your HbA1c result is in a good range',
$q$Your HbA1c result is in the range we hope for. HbA1c shows your average sugar over about three months, so this is a good sign for the last few months.
Keep up what you are doing. Keep your meals, your medicines and your yearly checks.
If you have questions about your result, ask your care team.$q$),
    ('record-lab-hba1c-high', 'diabetes', 'Your HbA1c results have been above target',
$q$Your last two HbA1c results were higher than the range we hope for. HbA1c shows your average sugar over about three months.
This does not mean something terrible is happening. It does mean your care team should look at your plan with you.
Do not change or stop your medicines on your own. Ask your care team about your results. You can send them a message or ask for a visit.$q$)
  ) as t(code, category, title, body)
  loop
    insert into public.health_education_content (code, title, summary, body, category, content_status, is_placeholder, share_enabled, sort_order)
    values (r.code, r.title,
            'Draft. Needs a named clinical author and Chief Medical Officer approval before anyone can see it.',
            r.body, r.category, 'draft', true, false, 950)
    on conflict (code) do nothing;
    if found then v_new := v_new + 1; end if;
  end loop;

  -- Portion guides. The body uses the line format of packages/shared learning/portion-guide.ts; the amounts are NOT here (config row portion_guide).
  for r in select * from (values
    ('portion-guide-diabetes', 'diabetes'::public.health_education_category, 'diabetes'::public.care_plan_condition, 'Food portions with your own hand: for people living with diabetes',
$q$Use your own hand to measure your food. Your hand is always with you and it fits your body.
A palm is the flat of your hand, without the fingers. A fist is your closed hand. A cupped hand is your hand held like a small bowl.

[portion swallow fist] Pounded yam, eba (garri), amala, fufu
Swallow fills you up, but it turns to sugar in your body. Keep to one fist, and eat it with plenty of soup and vegetables.

[portion rice_jollof fist] White rice, jollof rice, fried rice
Rice also turns to sugar. Keep to one fist and add vegetables or beans to the plate.

[portion beans cupped_hand] Beans, moin-moin, akara
Beans keep you full for longer. Boiled or steamed is better than fried.

[portion soup cupped_hand] Soup (egusi, ogbono, okra, vegetable soup)
Fill more of the soup with vegetables and less with oil.

[portion plantain palm] Plantain, boiled or roasted
Ripe plantain has more sugar than unripe. Boiled or roasted is better than fried.

[portion yam fist] Yam, boiled or roasted
Keep to one fist and eat it with vegetables or fish.

[portion bread palm] Bread
One slice is about the size of your palm. Choose whole grain bread if you can.

[portion drinks cupped_hand] Soft drinks, malt, packaged juice, sweet zobo and kunu
These raise your sugar fast. Water, or tea without sugar, is the better choice.

[portion fruit fist] Fruit (orange, pawpaw, apple, banana, mango)
Eat fruit whole, not as juice. One fist at a time.

[portion protein palm] Fish, meat, eggs, chicken
One palm is enough for a meal. Grilled, boiled or steamed is better than fried.

[portion fried_food fist] Fried foods (puff puff, chin chin, fried yam, fried plantain)
Keep fried foods for a small treat, not a daily food.

This is general information, not a meal plan. Your care team or a dietitian can set the right amounts for you.$q$),
    ('portion-guide-bp', 'hypertension'::public.health_education_category, 'hypertension'::public.care_plan_condition, 'Food portions and salt with your own hand: for people living with high blood pressure',
$q$Use your own hand to measure your food. Your hand is always with you and it fits your body.
A palm is the flat of your hand, without the fingers. A fist is your closed hand. A cupped hand is your hand held like a small bowl.

[portion seasoning_cube fingertip] Seasoning cubes (Maggi, Knorr and others)
Seasoning cubes are very salty. Use as few as you can in a pot, and taste before you add any salt.

[portion table_salt fingertip] Table salt
Add salt at the end of cooking, in small pinches. Do not add salt at the table.

[portion fried_food fist] Fried foods and street snacks
Fried foods, suya and many snacks carry a lot of salt and oil. Keep them for now and then.

[portion soup cupped_hand] Soup and stew
Soup is often the biggest source of salt in a meal. Use fresh pepper, onions and herbs for taste, and fewer cubes.

[portion swallow fist] Pounded yam, eba (garri), amala, fufu
Keep to one fist and eat it with soup that is full of vegetables.

[portion rice_jollof fist] White rice, jollof rice, fried rice
Jollof and fried rice carry a lot of salt. One fist is enough.

[portion plantain palm] Plantain, boiled or roasted
Boiled or roasted plantain is better than fried.

[portion yam fist] Yam, boiled or roasted
One fist, with vegetables.

[portion bread palm] Bread
Bread has hidden salt. About two slices is enough for a meal.

[portion protein palm] Fish, meat, eggs, chicken
Fresh is better than smoked, salted or dried. One palm is enough for a meal.

[portion fruit fist] Fruit and vegetables
Fruit and vegetables help your blood pressure. Eat them often.

This is general information, not a meal plan. Your care team or a dietitian can set the right amounts for you.$q$)
  ) as t(code, category, condition, title, body)
  loop
    insert into public.health_education_content (code, title, summary, body, category, condition, content_status, is_placeholder, share_enabled, sort_order)
    values (r.code, r.title,
            'Draft. The amounts are placeholders. A named dietitian or clinician must set and sign them before anyone can see this.',
            r.body, r.category, r.condition, 'draft', true, false, 960)
    on conflict (code) do nothing;
    if found then v_new := v_new + 1; end if;
  end loop;
  raise notice 'record lessons and portion guide: % draft rows inserted', v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Registries the standing proofs check
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Record-triggered lessons 2026-10-22: PROPOSED classification, to be confirmed by the CMO and DPO.'
  from unnest(array['learning_record_lesson_shows']) as t(table_name)
on conflict (table_name) do nothing;

select private.guard_minor_dependant_table('learning_record_lesson_shows', 'patient_id');

-- ---------------------------------------------------------------------------
-- Self-checks (a failure aborts the migration)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'learning_record_lesson_shows' and c.relrowsecurity) then
    raise exception 'record lessons self-check: the shows table has no row level security';
  end if;
  if has_table_privilege('anon', 'public.learning_record_lesson_shows', 'SELECT') or has_table_privilege('authenticated', 'public.learning_record_lesson_shows', 'INSERT')
     or has_table_privilege('authenticated', 'public.learning_record_lesson_shows', 'UPDATE') or has_table_privilege('authenticated', 'public.learning_record_lesson_shows', 'DELETE') then
    raise exception 'record lessons self-check: the shows table allows anon to read or a client to write';
  end if;
  if not has_table_privilege('authenticated', 'public.learning_record_lesson_shows', 'SELECT') then
    raise exception 'record lessons self-check: authenticated cannot read its own shows';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'learning_record_lesson_shows')
     or not exists (select 1 from public.minor_dependant_table_policy where table_name = 'learning_record_lesson_shows') then
    raise exception 'record lessons self-check: the shows table is missing from a registry';
  end if;
  if has_function_privilege('anon', 'public.record_lesson_shown(text, text, text, uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_lesson_shown(text, text, text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_lesson_lab_items()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_lesson_lab_items()', 'EXECUTE') then
    raise exception 'record lessons self-check: record_lesson_shown grants are wrong';
  end if;
  if not exists (select 1 from public.go_live_guards where key = 'record_triggered_lessons_enabled') then raise exception 'record lessons self-check: the guard is missing'; end if;
  if exists (select 1 from public.go_live_guards where key = 'record_triggered_lessons_enabled' and is_on) then raise exception 'record lessons self-check: the guard must start off'; end if;
  if exists (select 1 from public.health_education_content where code in ('record-bp-in-target', 'record-bp-above-target', 'record-glucose-in-target', 'record-glucose-above-target',
       'record-lab-hba1c-normal', 'record-lab-hba1c-high', 'portion-guide-diabetes', 'portion-guide-bp')
       and (content_status <> 'draft' or not is_placeholder or clinician_reviewed or reviewed_by_name is not null)) then
    raise exception 'record lessons self-check: a seeded row is not an unreviewed draft placeholder';
  end if;
  if (select status from public.learning_config where key = 'portion_guide' and is_active order by version desc limit 1) <> 'proposed' then
    raise exception 'record lessons self-check: the portion guide amounts must start proposed';
  end if;
end $$;
