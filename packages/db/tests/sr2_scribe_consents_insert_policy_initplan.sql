-- SR2 proof: scribe_consents_insert_clinical keeps its rule and no longer calls auth.uid() per row
-- (migration *_sr2_scribe_consents_insert_policy_initplan.sql). Behaviour of the policy (a tied, active clinician records a consent; an
-- untied one or another clinician's staff id is refused) is proven by s21g_scribe_consent_and_chart_access.sql and s39g_tied_staff_writes.sql,
-- which run in the same replay; this script proves the shape of the rewrite.
-- Proves: the policy exists once, for INSERT, for authenticated; it still names staff_may_write with medical_history and the active-clinician
-- check; auth.uid() appears only inside a (select ...) wrapper.
-- SABOTAGE: the policy put back on a bare auth.uid(); the wrapper check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.bare() returns text language sql as
$$ select count(*)::text from pg_policies where tablename = 'scribe_consents' and policyname = 'scribe_consents_insert_clinical'
     and regexp_replace(with_check, '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi') ~ 'auth\.uid\(\)' $$;

do $$
begin
  perform pg_temp.ck('real', 'one insert policy for authenticated', '1/INSERT/{authenticated}',
    (select count(*) || '/' || min(cmd) || '/' || min(roles::text) from pg_policies where tablename = 'scribe_consents' and policyname = 'scribe_consents_insert_clinical'));
  perform pg_temp.ck('real', 'still requires the medical_history write tie', 'true',
    (select (with_check ~ 'staff_may_write\(patient_id, organisation_id, ''medical_history''')::text from pg_policies where tablename = 'scribe_consents' and policyname = 'scribe_consents_insert_clinical'));
  perform pg_temp.ck('real', 'still requires an active clinician that owns the staff row', 'true',
    (select (with_check ~ 'cs\.active = true' and with_check ~ 'cs\.id = scribe_consents\.clinician_staff_id')::text from pg_policies where tablename = 'scribe_consents' and policyname = 'scribe_consents_insert_clinical'));
  perform pg_temp.ck('real', 'auth.uid() only inside a select wrapper', '0', pg_temp.bare());

  alter policy scribe_consents_insert_clinical on public.scribe_consents
    with check (private.staff_may_write(patient_id, organisation_id, 'medical_history'::public.care_access_category)
      and exists (select 1 from public.clinical_staff cs where cs.id = scribe_consents.clinician_staff_id and cs.profile_id = auth.uid() and cs.active = true));
  perform pg_temp.ck('sabotaged', 'auth.uid() only inside a select wrapper (flips when sabotaged)', '0', pg_temp.bare());
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'SR2 scribe policy proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
