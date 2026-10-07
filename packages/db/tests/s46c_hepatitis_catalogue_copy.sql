-- S46c proof: the patient-facing catalogue copy for hepatitis B and C matches the S46 serology rule. One rolled-back transaction.
-- Proves: the Know Your Basics description keeps blood group and genotype once for life, calls hepatitis B and C yearly, says hepatitis B
-- stops on recorded protection, carries no "never asked to pay" promise and no em dash; no lab test description says hepatitis is done once;
-- the rule data it describes is the active one (hep_c annual, hep_b annual with a stop). SABOTAGE: the old copy put back must fail the same checks.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
create function pg_temp.checks(p_phase text) returns void language plpgsql as $f$
declare d text := (select description from public.panel_bundles where code = 'know_your_basics');
begin
  insert into results values
   (p_phase, 'bundle keeps blood group and genotype once for life', 'true', (d ~* 'never change' and d ~* 'once and kept for life')::text),
   (p_phase, 'bundle calls hepatitis B and C yearly', 'true', (d ~* 'hepatitis B and C can be tested every year')::text),
   (p_phase, 'bundle says hepatitis B stops on recorded protection', 'true', (d ~* 'stops once your care team records')::text),
   (p_phase, 'no never-asked-to-pay promise', 'false', (d ~* 'never be asked to pay')::text),
   (p_phase, 'no em dash', 'false', (d like '%—%')::text),
   (p_phase, 'no lab test description says hepatitis is once', '0',
     (select count(*)::text from public.lab_tests where description ~* '(hepatitis|hbsag|hcv)[^.]*(once|for life|lifetime)'));
end $f$;
select pg_temp.checks('real');
insert into results values ('real', 'active serology rule: hep_c and hep_b yearly, hep_b stops on immunity', 'true',
  (select ((config -> 'hep_c' ->> 'repeatMonths') = '12' and (config -> 'hep_b' ->> 'repeatMonths') = '12'
           and config -> 'hep_b' -> 'stopsWhenHbvStatus' ? 'immune' and not (config -> 'hep_c' ? 'oncePerLifetime'))::text
     from public.serology_rule_versions where status = 'active'));
-- sabotage: the old copy
update public.panel_bundles set description = 'Blood group, genotype and hepatitis B and C. Do these once and kept for life. You will never be asked to pay for them again.' where code = 'know_your_basics';
select pg_temp.checks('sabotaged');
do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then raise exception 'S46c proof FAILED: %', (select string_agg(check_name || ' got ' || coalesce(actual,'null'), '; ') from results where phase='real' and expected is distinct from actual); end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: sabotage flipped % of 3', v_caught; end if;
end $$;
select * from results where phase = 'real';
rollback;
