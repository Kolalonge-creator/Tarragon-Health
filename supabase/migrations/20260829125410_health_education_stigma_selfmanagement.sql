-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.6
-- self-management, §46.7 education): closes the two remaining content gaps
-- against the spec's topic list — stigma reduction (explicitly named, not
-- covered by any of the 14 existing mental_health articles from
-- 20260810015050) and physical activity / healthy routines (§46.6's
-- self-management list; sleep, relaxation, and social connection are
-- already covered by mh-sleep-mental-health-link, mh-coping-skills-anxious-
-- moments, and mh-building-support-network). Same shape/honesty rule as
-- that migration: clinician_reviewed left at its default false, no
-- fabricated reviewed_by_name/reviewed_at.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

('mh-stigma-reduction', 'Mental health stigma: why it persists, and what helps',
 'Stigma is one of the biggest reasons people delay getting help — and it says nothing true about the person experiencing it.',
 E'Stigma around mental health usually comes from misunderstanding, not malice — the mistaken idea that a mental health condition reflects weakness, a personal failing, or something to hide, rather than a common, treatable medical condition like any other.\n\nThis matters practically, not just as an attitude: stigma is one of the most consistently cited reasons people delay seeking help, sometimes for years, which tends to make things harder to treat than if they had been addressed earlier.\n\nWhat helps: talking about mental health as openly as you would a physical condition, noticing your own assumptions when a diagnosis label makes you think less of someone (including yourself), and remembering that needing support is a sign of managing something real, not a character flaw. Your care team treats a mental health concern with exactly the same seriousness and confidentiality as anything else on your chart.',
 'article', 3, null, 'mental_health', 150,
 '[{"question": "What does needing mental health support say about someone?", "options": ["That they are weak or have failed", "That they are managing something real, like any other medical concern", "Nothing, it should never be discussed"], "answer_index": 1}]'::jsonb),

('mh-physical-activity-mood', 'Physical activity and mood: a genuinely two-way link',
 'Movement is one of the few things that reliably helps mood in both the short and long term — and you do not need a gym.',
 E'Regular physical activity is one of the better-evidenced, lowest-cost things you can do for mood and anxiety — even a brisk 20-30 minute walk measurably improves mood for hours afterward, and consistent activity over weeks is linked to meaningfully lower rates of depression and anxiety.\n\nThe reverse is also true: low mood and anxiety make starting or keeping up activity harder, which can quietly turn into a downward spiral of doing less and feeling worse. Breaking in from the activity side, even in small amounts, is often easier than waiting to "feel like it" first.\n\nThis does not need to mean structured exercise — a walk, dancing, house or yard work, or playing with children or pets all count. Starting smaller than feels worthwhile (ten minutes, not sixty) is a reasonable, sustainable way in.',
 'article', 3, null, 'mental_health', 160, null),

('mh-healthy-routines', 'Healthy routines: the small structure that protects mental health',
 'Regularity in ordinary things does more for mental health than it gets credit for.',
 E'A consistent daily rhythm — regular wake and sleep times, regular meals, some regular activity and social contact — is a genuinely protective factor for mental health, not just a tidiness preference. Mood and anxiety conditions often disrupt these routines first, and a disrupted routine in turn makes the underlying condition harder to manage, each reinforcing the other.\n\nThis is especially worth naming during a difficult stretch (grief, a health diagnosis, a major life change), when routine is often the first thing to slip and the last thing that feels worth the effort — even though it is doing real, quiet work.\n\nYou do not need a rigid schedule. A small number of anchors — a consistent wake time, one regular meal, a short daily walk — give a difficult day some structure to hold onto, without needing everything else to go right.',
 'article', 3, null, 'mental_health', 170, null);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.health_education_content
  where code in ('mh-stigma-reduction', 'mh-physical-activity-mood', 'mh-healthy-routines');

  if v_count <> 3 then
    raise exception 'expected 3 new mental_health rows, found %', v_count;
  end if;

  raise notice 'PASS: mental-health stigma/self-management content gaps closed (3 rows)';
end $$;
