-- OQ-S43m-5 follow-up: every other reader of lab_analyte_readings now respects sensitive_positive (INV-04).
-- A positive HIV, hepatitis B surface antigen or hepatitis C antibody result is never shown to the patient, a caregiver or a share-link
-- recipient without a clinician disclosing it. Live rows today: 0 (nothing was exposed), so there is no data to convert.
--
--   1. private.may_see_sensitive_lab_result(patient): an active non-coordinator doctor who has access to that patient.
--   2. A RESTRICTIVE select policy on lab_analyte_readings: a sensitive row is visible only to such a doctor. This closes every direct
--      table read at once (web and mobile patient screens, the passport, the full-record export) without a filter in each query.
--      service_role and security definer functions bypass RLS and carry their own filter, below.
--      (lab_analyte_readings_current gained the sensitive_positive column in the previous migration, 20261020184127.)
--   3. The definer readers that bypass RLS get the filter in their own body (patched in place from the live definition at apply time, by anchor, so it composes with other migrations that also patch these bodies, e.g. the share-link window migration 20261019200231):
--      record_share_by_token (anonymous share link), hr_biomarker_points (health report), clinical_value_history and
--      my_corrected_record_entries (the patient's own history and corrections; a doctor's history view still shows everything).
-- Same signatures, so ACLs are unchanged. Each anchor must match exactly once or the migration refuses to guess.

create or replace function private.may_see_sensitive_lab_result(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator')
     and private.clinician_has_patient_access(p_patient)
$$;
revoke all on function private.may_see_sensitive_lab_result(uuid) from public, anon;
grant execute on function private.may_see_sensitive_lab_result(uuid) to authenticated;

drop policy if exists lab_analyte_readings_hide_sensitive on public.lab_analyte_readings;
create policy lab_analyte_readings_hide_sensitive on public.lab_analyte_readings
  as restrictive for select to authenticated
  using (not sensitive_positive or private.may_see_sensitive_lab_result(patient_id));

do $migr$
declare
  r record;
  v_oid oid;
  v_def text;
  v_new text;
  v_n integer;
begin
  for r in
    select * from (values
      ('public',  'record_share_by_token',
       $a$where patient_id = v_share.patient_id and report_status in ('final', 'corrected', 'amended')$a$,
       $b$ and not sensitive_positive$b$),
      ('private', 'hr_biomarker_points',
       $a$and l.report_status in ('final', 'corrected', 'amended') and not private.report_excluded_code(l.code)$a$,
       $b$ and not l.sensitive_positive$b$),
      ('public',  'clinical_value_history',
       $a$from public.%1$I t where t.id in (select id from chain)$a$,
       $b$ and ($2 or coalesce(to_jsonb(t) ->> 'sensitive_positive', 'false') <> 'true')$b$),
      ('public',  'my_corrected_record_entries',
       $a$where x.patient_id = $1 and x.correction_status is not null$a$,
       $b$ and coalesce(to_jsonb(x) ->> 'sensitive_positive', 'false') <> 'true'$b$)
    ) as v(sch, fn, anchor, addition)
  loop
    v_n := 0;
    for v_oid in select p.oid from pg_proc p where p.proname = r.fn and p.pronamespace = r.sch::regnamespace loop
      v_def := pg_get_functiondef(v_oid);
      if position(r.anchor || r.addition in v_def) > 0 then v_n := v_n + 1; continue; end if;     -- already patched
      if (length(v_def) - length(replace(v_def, r.anchor, ''))) <> length(r.anchor) then
        raise exception '%.% (%): the anchor is missing or repeated, refusing to guess', r.sch, r.fn, v_oid::regprocedure;
      end if;
      v_new := replace(v_def, r.anchor, r.anchor || r.addition);
      execute v_new;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then raise exception '%.% not found', r.sch, r.fn; end if;
  end loop;
end $migr$;

do $$
begin
  if (select count(*) from pg_policies where tablename = 'lab_analyte_readings' and policyname = 'lab_analyte_readings_hide_sensitive' and permissive = 'RESTRICTIVE') <> 1 then
    raise exception 'restrictive sensitive policy missing';
  end if;
  if has_function_privilege('anon', 'private.may_see_sensitive_lab_result(uuid)', 'EXECUTE') then raise exception 'anon can execute the sensitive-result helper'; end if;
  if (select prosrc from pg_proc where oid = 'public.record_share_by_token(text,text,text)'::regprocedure) not like '%and not sensitive_positive%' then raise exception 'record_share_by_token unfiltered'; end if;
  if (select prosrc from pg_proc where oid = 'private.hr_biomarker_points(uuid,text)'::regprocedure) not like '%not l.sensitive_positive%' then raise exception 'hr_biomarker_points unfiltered'; end if;
  if (select prosrc from pg_proc where oid = 'public.clinical_value_history(text,uuid)'::regprocedure) not like '%sensitive_positive%' then raise exception 'clinical_value_history unfiltered'; end if;
  if (select prosrc from pg_proc where oid = 'public.my_corrected_record_entries(uuid)'::regprocedure) not like '%sensitive_positive%' then raise exception 'my_corrected_record_entries unfiltered'; end if;
end $$;
