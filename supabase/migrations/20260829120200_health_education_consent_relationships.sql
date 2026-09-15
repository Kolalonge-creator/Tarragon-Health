-- Sexual & Reproductive Health platform — gap closure 3/3, step 2/2: the two
-- topics spec §47.11 lists that a full-text search confirmed did not exist
-- anywhere in this library before this migration ("consent", "healthy
-- relationship") — condoms, contraception, testing, and STI prevention
-- already have real articles (20260810014719). Same honesty rule as every
-- other health-education batch in this codebase: clinician_reviewed left at
-- its default false, no fabricated reviewed_by_name/reviewed_at, category
-- is null (applies to everyone, not gendered — same reasoning as the new
-- 'sexual_health' enum value's own migration header).

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

('sexual-health-consent', 'Consent, in plain terms',
 'What consent actually means, and why "yes" only counts when it is freely given.',
 E'Consent means both people clearly and freely agree to what is happening, every time. It cannot be assumed from silence, from what someone wore, from a past relationship, or from having said yes before — a yes to one thing, or on one occasion, is not a yes to anything else.\n\nA few things worth knowing:\n\n- Consent has to be freely given. Agreeing because you feel pressured, guilted, threatened, or afraid of what happens if you say no is not the same as agreeing.\n- It can be withdrawn at any time, including in the middle of something already started — and a partner stopping when asked is not optional, it is the whole point.\n- Someone who is asleep, very drunk, or otherwise unable to make a clear decision cannot give consent, no matter what they said earlier.\n- Checking in ("is this okay?", "do you want to keep going?") is not awkward or unromantic — it is what makes sure the other person is actually enjoying what is happening, not just tolerating it.\n\nIf something happened to you without your consent, that is not your fault, and support is available — your care team can talk this through with you confidentially, at your own pace, whenever you are ready.',
 'article', 3, null, 'sexual_health', 10, null),

('sexual-health-healthy-relationships', 'What makes a relationship healthy',
 'A few honest signs to check for, in yourself and in a partner.',
 E'There is no single template for a good relationship, but a few things tend to show up in healthy ones, whatever they look like:\n\n- You can say no, disagree, or change your mind without it turning into punishment, silence, or guilt-tripping.\n- Decisions that affect you both — including anything about sex, money, or who you spend time with — are actually decisions, not announcements.\n- Neither of you is cut off from friends, family, or your own life outside the relationship.\n- Apologies happen and actually change behaviour, rather than being a way to move on from a pattern that keeps repeating.\n- You feel like yourself around this person, more often than not.\n\nWorth taking seriously, in yourself or a partner: controlling who you see or talk to, monitoring your phone or whereabouts, threats (to leave, to harm themselves, to harm you), or physical force of any kind, even described as "just messing around." None of that is a normal part of conflict.\n\nIf any of this sounds familiar and unwelcome, you are not overreacting, and you do not have to figure it out alone — your care team can talk it through with you confidentially, and can help you think through next steps at whatever pace feels safe.',
 'article', 4, null, 'sexual_health', 20, null)

on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.health_education_content where code = 'sexual-health-consent') then
    raise exception 'FAIL: sexual-health-consent article missing';
  end if;
  if not exists (select 1 from public.health_education_content where code = 'sexual-health-healthy-relationships') then
    raise exception 'FAIL: sexual-health-healthy-relationships article missing';
  end if;
  if (select count(*) from public.health_education_content where category = 'sexual_health') <> 2 then
    raise exception 'FAIL: expected exactly 2 sexual_health-category articles';
  end if;
  raise notice 'PASS: consent + healthy-relationships education content installed under the new sexual_health category';
end $$;
