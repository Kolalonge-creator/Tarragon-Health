-- S46c part 2: a caregiver or guardian reads a dependant's SIGNED yearly Health Report, section by section, by access category (founder
-- instruction, 2026-10-07). Not applied to production by the author.
--
-- Nothing here widens health_reports itself: the table policy still lets only the patient read their own signed row. A caregiver reads through ONE
-- function that applies the access categories to the frozen report and returns only the sections the grant covers.
--
-- The category check is written fresh (it is NOT a copy of private.can_read_clinical or any table's older policy):
--   * a grant is a live profile_access row (not expired) with the caller as grantee; no row means nothing, answered as "not found";
--   * vitals_readings opens the blood pressure, weight and device sections; labs_results opens the lab, trend and (non-reproductive) screening
--     sections; the cardiovascular risk band needs BOTH (it is derived from both);
--   * reproductive sections need an EXPLICIT reproductive_health category row. The manage bypass of a dependent account never implies it, and for
--     a 10 to 17 year old the adolescent confidentiality gate (guardian_may_view_confidential_domain) must also pass;
--   * the screening questionnaires (PHQ-9, GAD-7) are the only mental health content in a report. There is no mental health access category, so they
--     need an EXPLICIT medical_history row plus the adolescent mental_health gate (OQ-S46-12);
--   * sensitive serology never appears: the report holds none (honesty guard) and every code is re-checked here against report_excluded_code;
--   * hand-over at 18 (S42): once a minor_child dependant has turned 18 the guardian reads nothing unless a COMPLETED hand-over names that guardian
--     as kept (a guardian the young person has not kept, or a hand-over not yet completed, reads nothing). If S42's dependant_handovers table is not
--     present the answer is "nothing", never "everything";
--   * a Care Circle supporter reads nothing: the S29 permission list has no report permission and this function never consults the circle (OQ-S46-13);
--   * the signed summary is free text written for the patient, so it is returned only when no section was withheld;
--   * only the latest SIGNED version is read; a draft or a superseded version is never returned (INV-11).
-- Every read writes one line to the patient's care access log (the "who looked" list).

create function private.report_caregiver_scope(p_patient uuid, p_grantee uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  pa public.profile_access%rowtype;
  p public.profiles%rowtype;
  v_cats public.care_access_category[];
  v_bypass boolean;
  v_adult_kept boolean := true;
  v_vit boolean; v_lab boolean; v_rep boolean; v_mental boolean;
begin
  if p_grantee is null or p_patient is null or p_grantee = p_patient then return jsonb_build_object('allowed', false); end if;
  select * into pa from public.profile_access x where x.profile_id = p_patient and x.grantee_user_id = p_grantee and (x.expires_at is null or x.expires_at > now());
  if not found then return jsonb_build_object('allowed', false); end if;
  select * into p from public.profiles where id = p_patient;
  if not found or p.role <> 'patient' then return jsonb_build_object('allowed', false); end if;

  -- hand-over at 18: a minor_child dependant who has turned 18 is read only by a guardian the young person kept
  if p.is_dependent_account and p.dependent_kind = 'minor_child' and p.date_of_birth is not null
     and (p.date_of_birth + interval '18 years')::date <= current_date then
    v_adult_kept := false;
    if to_regclass('public.dependant_handovers') is not null then
      execute 'select exists (select 1 from public.dependant_handovers h where h.patient_id = $1 and h.state = ''completed'' and $2 = any (h.guardians_kept))'
        into v_adult_kept using p_patient, p_grantee;
    end if;
    if not v_adult_kept then return jsonb_build_object('allowed', false, 'reason', 'handover'); end if;
  end if;

  select coalesce(array_agg(pac.category), '{}') into v_cats from public.profile_access_categories pac where pac.profile_access_id = pa.id;
  -- the manage grant of a dependent account stands for the everyday categories only, never for the sensitive ones
  v_bypass := pa.permission_level = 'manage' and p.is_dependent_account;
  v_vit := 'vitals_readings' = any (v_cats) or v_bypass;
  v_lab := 'labs_results' = any (v_cats) or v_bypass;
  v_rep := 'reproductive_health' = any (v_cats)
           and private.guardian_may_view_confidential_domain(p_patient, p_grantee, 'sexual_reproductive_health');
  v_mental := 'medical_history' = any (v_cats)
           and private.guardian_may_view_confidential_domain(p_patient, p_grantee, 'mental_health');
  return jsonb_build_object('allowed', v_vit or v_lab or v_rep or v_mental,
                            'vitals', v_vit, 'labs', v_lab, 'reproductive', v_rep, 'mental', v_mental);
end $$;
revoke all on function private.report_caregiver_scope(uuid, uuid) from public, anon, authenticated;

create function public.caregiver_health_report(p_patient uuid, p_year integer default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope jsonb;
  r public.health_reports%rowtype;
  c jsonb;
  v_vit boolean; v_lab boolean; v_rep boolean; v_mental boolean;
  v_repro text[];
  v_withheld text[] := '{}';
  v_summary_withheld boolean := false;
  v_name text;
  v_items jsonb; v_pri jsonb; v_also jsonb; v_done jsonb; v_due jsonb; v_trends jsonb; v_q jsonb; v_risk jsonb;
begin
  if v_uid is null then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  v_scope := private.report_caregiver_scope(p_patient, v_uid);
  -- one answer for "no grant", "hand-over ended it", "no signed report" and "nothing shared": the caller learns nothing about which
  if not coalesce((v_scope ->> 'allowed')::boolean, false) then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  select * into r from public.health_reports hr
   where hr.patient_id = p_patient and hr.status = 'signed' and hr.signed_by is not null and (p_year is null or hr.year = p_year)
   order by hr.year desc, hr.version desc limit 1;
  if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;

  v_vit := (v_scope ->> 'vitals')::boolean; v_lab := (v_scope ->> 'labs')::boolean;
  v_rep := (v_scope ->> 'reproductive')::boolean; v_mental := (v_scope ->> 'mental')::boolean;
  c := r.composed;
  select coalesce(array_agg(distinct e ->> 'code'), '{}') into v_repro
    from jsonb_array_elements(coalesce(c -> 'screening' -> 'done', '[]'::jsonb) || coalesce(c -> 'screening' -> 'due', '[]'::jsonb)) e
   where coalesce((e ->> 'reproductive')::boolean, false);

  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_items from jsonb_array_elements(coalesce(c -> 'items', '[]'::jsonb)) i
   where not private.report_excluded_code(coalesce(i ->> 'code', ''))
     and case i ->> 'kind'
           when 'bp' then v_vit
           when 'lab' then v_lab
           when 'screening' then case when (i ->> 'code') = any (v_repro) then v_rep else v_lab end
           else false end;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_pri from jsonb_array_elements(coalesce(c -> 'priorities', '[]'::jsonb)) x
   where case x ->> 'category'
           when 'bp' then v_vit
           when 'lab' then v_lab
           when 'risk' then v_vit and v_lab
           when 'screening' then case when replace(x ->> 'id', 'screening:', '') = any (v_repro) then v_rep else v_lab end
           else false end;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_also from jsonb_array_elements(coalesce(c -> 'alsoWorthKnowing', '[]'::jsonb)) x
   where case x ->> 'category'
           when 'bp' then v_vit
           when 'lab' then v_lab
           when 'risk' then v_vit and v_lab
           when 'screening' then case when replace(x ->> 'id', 'screening:', '') = any (v_repro) then v_rep else v_lab end
           else false end;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_done from jsonb_array_elements(coalesce(c -> 'screening' -> 'done', '[]'::jsonb)) e
   where case when coalesce((e ->> 'reproductive')::boolean, false) then v_rep else v_lab end;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_due from jsonb_array_elements(coalesce(c -> 'screening' -> 'due', '[]'::jsonb)) e
   where case when coalesce((e ->> 'reproductive')::boolean, false) then v_rep else v_lab end;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_trends from jsonb_array_elements(coalesce(c -> 'trends', '[]'::jsonb)) e
   where v_lab and not private.report_excluded_code(coalesce(e ->> 'code', ''));
  v_q := case when v_mental then coalesce(c -> 'questionnaires', '[]'::jsonb) else '[]'::jsonb end;
  v_risk := case when v_vit and v_lab then coalesce(c -> 'risk', '{"state":"not_assessed"}'::jsonb) else '{"state":"not_assessed"}'::jsonb end;

  if not v_vit then v_withheld := v_withheld || array['bp', 'devices']; end if;
  if not v_lab then v_withheld := v_withheld || array['labs', 'trends', 'screening']; end if;
  if not (v_vit and v_lab) then v_withheld := v_withheld || array['risk']; end if;
  -- anything dropped from the signed content means the doctor's free-text summary may talk about it
  v_summary_withheld := jsonb_array_length(v_items) <> jsonb_array_length(coalesce(c -> 'items', '[]'::jsonb))
    or jsonb_array_length(v_pri) <> jsonb_array_length(coalesce(c -> 'priorities', '[]'::jsonb))
    or jsonb_array_length(v_also) <> jsonb_array_length(coalesce(c -> 'alsoWorthKnowing', '[]'::jsonb))
    or jsonb_array_length(v_done) <> jsonb_array_length(coalesce(c -> 'screening' -> 'done', '[]'::jsonb))
    or jsonb_array_length(v_due) <> jsonb_array_length(coalesce(c -> 'screening' -> 'due', '[]'::jsonb))
    or jsonb_array_length(v_trends) <> jsonb_array_length(coalesce(c -> 'trends', '[]'::jsonb))
    or jsonb_array_length(v_q) <> jsonb_array_length(coalesce(c -> 'questionnaires', '[]'::jsonb))
    or (not (v_vit and v_lab) and coalesce(c -> 'risk' ->> 'state', 'not_assessed') = 'assessed')
    or (not v_vit and (coalesce((c -> 'weight' ->> 'count')::integer, 0) > 0));

  select coalesce(nullif(btrim(split_part(full_name, ' ', 1)), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  -- scope 'health_summary' (the existing vocabulary; a new scope would need the log's check constraint and its labels changed): the metadata says it is the yearly report
  perform private.log_care_access(p_patient, 'record_viewed', 'health_summary', jsonb_build_object('kind', 'yearly_report', 'year', r.year, 'version', r.version), v_uid);

  return jsonb_build_object(
    'id', r.id, 'patient_id', p_patient, 'first_name', v_name, 'year', r.year, 'version', r.version,
    'config_version_id', r.config_version_id,
    'summary_text', case when v_summary_withheld then null else r.summary_text end,
    'summary_withheld', v_summary_withheld,
    'signer_name', r.signer_name, 'signer_registration', r.signer_registration, 'signed_at', r.signed_at, 'correction_note', r.correction_note,
    'withheld', to_jsonb(v_withheld),
    'composed', (c - 'weight' - 'devices') || jsonb_build_object(
        'items', v_items, 'priorities', v_pri, 'alsoWorthKnowing', v_also, 'trends', v_trends, 'questionnaires', v_q, 'risk', v_risk,
        'screening', jsonb_build_object('done', v_done, 'due', v_due),
        'weight', case when v_vit then c -> 'weight' else null end,
        'devices', case when v_vit then c -> 'devices' else jsonb_build_object('manual', 0, 'device', 0, 'wearable', 0) end));
end $$;
revoke all on function public.caregiver_health_report(uuid, integer) from public, anon;
grant execute on function public.caregiver_health_report(uuid, integer) to authenticated;

-- The people I may read a report for: first name, year and version only. Same scope check; nothing is listed that the read would refuse.
create function public.caregiver_report_list() returns table (patient_id uuid, first_name text, year integer, version integer, signed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return; end if;
  return query
    select x.patient_id, coalesce(nullif(btrim(split_part(p.full_name, ' ', 1)), ''), 'Someone'), x.year, x.version, x.signed_at
      from (select distinct on (hr.patient_id) hr.patient_id, hr.year, hr.version, hr.signed_at
              from public.health_reports hr
              join public.profile_access pa on pa.profile_id = hr.patient_id and pa.grantee_user_id = v_uid
             where hr.status = 'signed' and hr.signed_by is not null
             order by hr.patient_id, hr.year desc, hr.version desc) x
      join public.profiles p on p.id = x.patient_id
     where coalesce((private.report_caregiver_scope(x.patient_id, v_uid) ->> 'allowed')::boolean, false)
     order by x.signed_at desc;
end $$;
revoke all on function public.caregiver_report_list() from public, anon;
grant execute on function public.caregiver_report_list() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.caregiver_health_report(uuid,integer)', 'EXECUTE') or has_function_privilege('anon', 'public.caregiver_report_list()', 'EXECUTE') then
    raise exception 'S46c: a caregiver report function is open to anon';
  end if;
  if has_function_privilege('authenticated', 'private.report_caregiver_scope(uuid,uuid)', 'EXECUTE') then
    raise exception 'S46c: the caregiver scope helper is callable by a session';
  end if;
  if has_table_privilege('authenticated', 'public.health_reports', 'INSERT') or has_table_privilege('anon', 'public.health_reports', 'SELECT') then
    raise exception 'S46c: health_reports grants changed';
  end if;
end $$;
