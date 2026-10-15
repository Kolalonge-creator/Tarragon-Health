-- S66 (INV-07, decision A14): the notification lint now refuses cycle and reproductive words.
-- A cycle reminder is the most sensitive routine message the platform sends (phones are read over shoulders and shared between family
-- members), and the in-app preview used to say "Your period is expected in a couple of days". The copy is now "Your tracker has an update"
-- (apps/web/src/lib/notifications/describe-in-app.ts) and these words may never appear in a template, push, email or preview again:
-- period(s), cycle*, fertil*, ovulat*, menopaus*, perimenopaus*, menstru*, luteal, follicular, conceiv*.
-- The code copy is supabase/functions/_shared/notifications/neutral.ts (FORBIDDEN_TERMS_VERSION 2); a Jest test fails if the two lists differ.
--
-- Counted first (live, 2026-10-07): 0 active notification_template_locales rows contain any of these words (the one row that mentions a "cycle"
-- is an inactive sms template that reads a {{cycle_year}} placeholder, which the lint strips before it looks at words). So no active template
-- is rewritten here; the trigger enforce_notification_locale_neutral refuses any future row that does.

insert into public.notification_forbidden_terms (term, kind, version) values
  ('period', 'term', 2), ('periods', 'term', 2), ('cycle*', 'term', 2), ('fertil*', 'term', 2), ('ovulat*', 'term', 2),
  ('menopaus*', 'term', 2), ('perimenopaus*', 'term', 2), ('menstru*', 'term', 2), ('luteal', 'term', 2), ('follicular', 'term', 2),
  ('conceiv*', 'term', 2)
on conflict (term, kind) do nothing;

do $$
declare v_bad integer;
begin
  if cardinality(private.notification_text_violations('Your period is expected in a couple of days')) = 0
     or cardinality(private.notification_text_violations('Your fertile window starts tomorrow')) = 0
     or cardinality(private.notification_text_violations('Cycle reminder')) = 0
     or cardinality(private.notification_text_violations('Ovulation day')) = 0
     or cardinality(private.notification_text_violations('Menopause check')) = 0 then
    raise exception 'S66: the lint did not flag a reproductive phrase';
  end if;
  if cardinality(private.notification_text_violations('Your tracker has an update')) <> 0 then
    raise exception 'S66: the neutral tracker line must pass the lint';
  end if;
  select count(*) into v_bad from public.notification_template_locales l
   where l.is_active and cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body)) > 0;
  if v_bad <> 0 then raise exception 'S66: % active template rows now break INV-07 and must be reworded first', v_bad; end if;
  raise notice 'PASS: S66 reproductive terms added to the INV-07 list';
end $$;
