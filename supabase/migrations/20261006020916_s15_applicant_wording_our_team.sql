-- S15: wording fix for messages a doctor applicant or clinician reads.
--
-- The first S15 migration told the applicant "your care team lead will ...", as if the applicant were a patient being
-- looked after by a lead. A doctor applying to Tarragon is addressed by the organisation, so these now say "our team".
-- Only message text changes. Each affected function is rewritten from its own live definition with the phrases swapped,
-- so owners, grants and settings are kept, and the block ends by proving no such phrase is left.

do $$
declare
  f record;
  v_def text;
  v_new text;
  v_count int := 0;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and pg_get_functiondef(p.oid) ilike '%care team lead%'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_new := v_def;
    v_new := replace(v_new, 'Your care team lead will switch you on', 'Our team will switch you on');
    v_new := replace(v_new, 'Your care team lead can tell you more', 'Our team can tell you more');
    v_new := replace(v_new, 'ask your care team lead to reopen it', 'contact our team to reopen it');
    v_new := replace(v_new, 'your care team lead will review and may allow another', 'our team will review and may allow another');
    v_new := replace(v_new, 'your care team lead will let you know', 'our team will let you know');
    v_new := replace(v_new, 'your care team lead will reinstate you', 'our team will reinstate you');
    v_new := replace(v_new, 'Your care team lead', 'Our team');
    v_new := replace(v_new, 'your care team lead', 'our team');
    if v_new <> v_def then
      execute v_new;
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'expected at least one function to carry the old wording';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and pg_get_functiondef(p.oid) ilike '%care team lead%'
  ) then
    raise exception 'old wording is still present in a function';
  end if;
end $$;
