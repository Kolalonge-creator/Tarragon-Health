-- D-09: the home blood pressure target can now be signed by the Chief Medical Officer, from the sign-off hub.
--
-- WHY: bp_target_config v1 (home 135/85, clinic 140/90, the reading-grade thresholds) was born unsigned and inactive by the W-25 migration
-- (20261027192319) with "There is no signer yet". It had no sign function and no hub line, so the CMO could not find it or sign it, and every
-- surface that waits on it (the cascade S75-1, the sponsor and Care Circle "versus target" and "direction" fields behind the
-- sponsor_outcome_surfaces module) stayed frozen.
--
-- WHAT THIS DOES:
--   1. public.sign_bp_target_config(version): the active CMO only (42501 for anyone else). Validates every value the readers need, refuses a
--      version already signed, activates the signed one and deactivates the rest (the existing superseded-activation trigger still refuses an
--      older version), writes an audit row. approved_by is the CMO's clinical_staff id (the column's foreign key).
--   2. public.bp_target_config_for_signoff(): the live signed version, the newest unsigned version newer than it, and the default a home
--      average is judged against today, for the hub. The CMO and admins only; the table itself stays unreadable to every user role.
--   3. private.monthly_report_payload: a patient with no personal home target has their monthly home average judged against the SIGNED home
--      target (135/85 in v1) once one is in force, and against the outcome-rule default (140/90) only while nothing is signed. Unsigned today,
--      so behaviour is UNCHANGED until the CMO signs. A personal target set by a clinician still wins. This is the patient's monthly report and
--      the monthly block a Care Circle member sees.
--      Deliberately NOT changed: private.patient_bp_target itself, so private.risk_compute and public.my_membership_offer keep the baseline
--      their own separately governed margins were tuned against. Moving those is its own decision (risk_config and the offer rule).
--   4. The v1 note's "and an external clinician (separate signer, not built here)" is stale: D-16 (2026-10-27) makes the founder the CMO and
--      the only signer. The note is corrected; config and version are untouched (the row is unsigned, so the immutability trigger allows it).
--
-- KNOWN LIMIT (unchanged, recorded): the monthly average (private.bp_window_stats) includes pharmacy-labelled and unlabelled readings, so it is
-- not a pure home average; judging it against the home line is the stricter reading, never a false "on target" for a pharmacy reading.
--
-- NOT DONE HERE: the sponsor_outcome_surfaces module stays OFF. Opening it is a separate superadmin press after the signature.
--
-- LIVE FACTS (read 2026-11-03, koiplnmbgnqnbywhpjlf): bp_target_config has one row, v1, unsigned, inactive; no sign_* function exists for it;
-- private.monthly_report_payload body below is the live one (pg_get_functiondef) with one added block; patient_bp_targets has 0 rows;
-- private.outcome_rule('default_target') = 140/90; vitals_readings.measurement_context holds home_self (62) and null (1825); ledger head
-- 20261103215654.

-- 4. the stale signer note
update public.bp_target_config
   set notes = 'W-25 / D-09. PROPOSED until signed. Home 135/85 and clinic 140/90 are the figures in the plan (FD5) and in the home programme bands; the grade thresholds are engineering proposals. Signed by the Chief Medical Officer alone (D-16) through public.sign_bp_target_config(). Until then no outcome or sponsor surface may use a home target, and a monthly home average is judged against the outcome default.'
 where version = 1 and approved_by is null;

-- 1. the sign function
create function public.sign_bp_target_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.bp_target_config%rowtype; v_staff uuid; v_ctx record;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then
    raise exception 'only the chief medical officer can sign the blood pressure targets' using errcode = '42501';
  end if;
  select * into c from public.bp_target_config where version = p_version for update;
  if not found then raise exception 'no such blood pressure target version' using errcode = 'P0002'; end if;
  if c.approved_by is not null then raise exception 'that version is already signed; a change is a new version' using errcode = '23514'; end if;

  -- every value a reader uses must be a whole number in a range that can work: a signed target that judges nothing is a silent failure
  if exists (
    select 1 from (values
      ('{targets,home,systolic}', 100, 180), ('{targets,home,diastolic}', 60, 110),
      ('{targets,clinic,systolic}', 100, 180), ('{targets,clinic,diastolic}', 60, 110),
      ('{grade,minReadingsPerPerson}', 1, 50), ('{grade,restMinutes}', 0, 60),
      ('{grade,minGapMinutes}', 0, 60), ('{grade,repeatWindowMinutes}', 1, 240),
      ('{grade,plausible,systolicMin}', 40, 120), ('{grade,plausible,systolicMax}', 180, 320),
      ('{grade,plausible,diastolicMin}', 20, 80), ('{grade,plausible,diastolicMax}', 100, 220)) k(path, lo, hi)
    where jsonb_typeof(c.config #> k.path::text[]) is distinct from 'number'
       or (c.config #>> k.path::text[]) !~ '^[0-9]{1,4}$'
       or (c.config #>> k.path::text[])::integer not between k.lo and k.hi
  ) then
    raise exception 'this version has a missing or out-of-range value and cannot be signed' using errcode = '22023';
  end if;
  if (c.config #>> '{targets,home,diastolic}')::integer >= (c.config #>> '{targets,home,systolic}')::integer
     or (c.config #>> '{targets,clinic,diastolic}')::integer >= (c.config #>> '{targets,clinic,systolic}')::integer then
    raise exception 'a diastolic target must be below its systolic target' using errcode = '22023';
  end if;
  -- every measurement context maps to one of the two targets, and the contexts the readers know are all present
  for v_ctx in select key, value from jsonb_each(c.config -> 'contextToTarget') loop
    if jsonb_typeof(v_ctx.value) <> 'string' or (v_ctx.value #>> '{}') not in ('home', 'clinic') then
      raise exception 'context % maps to an unknown target', v_ctx.key using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from unnest(array['diary', 'clinic', 'pharmacy', 'home_self', 'home_assisted']) ctx(k) where not (c.config -> 'contextToTarget') ? ctx.k) then
    raise exception 'this version does not say which target applies to every measurement context' using errcode = '22023';
  end if;

  -- the signer's own clinical_staff row (approved_by's foreign key); the CMO test above is the one authority gate
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active'
   order by cs.created_at limit 1;
  if v_staff is null then raise exception 'no active clinical staff record for the signer' using errcode = '42501'; end if;

  update public.bp_target_config set is_active = false where is_active and version <> p_version;
  update public.bp_target_config set approved_by = v_staff, approved_at = now(), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'bp_target_config.signed',
            'bp_target_config', c.id, jsonb_build_object('version', p_version, 'targets', c.config -> 'targets'));
end $$;
revoke all on function public.sign_bp_target_config(integer) from public, anon, authenticated;
grant execute on function public.sign_bp_target_config(integer) to authenticated;

-- 2. the hub reader
create function public.bp_target_config_for_signoff() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_live record; v_pending record;
begin
  perform private.uid_or_deny();
  if not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select version, config, approved_at into v_live from public.bp_target_config
   where is_active and approved_by is not null order by version desc limit 1;
  select version, config into v_pending from public.bp_target_config
   where not is_active and approved_by is null and version > coalesce(v_live.version, 0)
   order by version desc limit 1;
  return jsonb_build_object(
    'live', case when v_live.version is not null then jsonb_build_object('version', v_live.version, 'config', v_live.config, 'approved_at', v_live.approved_at) end,
    'pending', case when v_pending.version is not null then jsonb_build_object('version', v_pending.version, 'config', v_pending.config) end,
    -- what a monthly home average is judged against TODAY, so the sign-off text never hard-codes the "before" figure
    'current_default', case when v_live.version is not null then v_live.config #> '{targets,home}' else private.outcome_rule('default_target') end);
end $$;
revoke all on function public.bp_target_config_for_signoff() from public, anon, authenticated;
grant execute on function public.bp_target_config_for_signoff() to authenticated;

-- 3. the monthly report judges a home average against the signed home target (live body, one block added after the target is read)
create or replace function private.monthly_report_payload(p_patient uuid, p_month date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_min integer := (private.report_rule('min_readings') #>> '{}')::integer;
  v_thr integer := (private.report_rule('direction_threshold_systolic') #>> '{}')::integer;
  v_from date := p_month; v_to date := (p_month + interval '1 month' - interval '1 day')::date;
  t record; m record; pm record; w jsonb := '[]'::jsonb; ws date; we date; wk record; v_dir text; v_adh jsonb; v_adh_pct integer;
  v_enough boolean; v_signed jsonb;
begin
  select * into t from private.patient_bp_target(p_patient);
  -- D-09: with no personal target, a home average is judged against the SIGNED home target once one is in force, never the clinic line
  if t.source = 'default' then
    v_signed := private.bp_target_config_active();
    if v_signed is not null then
      t.sys := (v_signed #>> '{targets,home,systolic}')::integer;
      t.dia := (v_signed #>> '{targets,home,diastolic}')::integer;
    end if;
  end if;
  select * into m from private.bp_window_stats(p_patient, v_from, v_to);
  select * into pm from private.bp_window_stats(p_patient, (p_month - interval '1 month')::date, (p_month - interval '1 day')::date);
  v_enough := m.n >= v_min;
  ws := v_from;
  while ws <= v_to loop
    we := least(ws + 6, v_to);
    select * into wk from private.bp_window_stats(p_patient, ws, we);
    w := w || jsonb_build_array(jsonb_build_object('week_start', ws, 'readings', wk.n, 'avg_systolic', case when wk.n >= v_min then wk.avg_sys end,
                                                   'avg_diastolic', case when wk.n >= v_min then wk.avg_dia end));
    ws := ws + 7;
  end loop;
  v_dir := case when not v_enough or pm.n < v_min then 'not_enough_data'
                when m.avg_sys <= pm.avg_sys - v_thr then 'lower'
                when m.avg_sys >= pm.avg_sys + v_thr then 'higher' else 'similar' end;
  -- No exception handler on purpose: this report is written once. If adherence cannot be read the report is NOT written (the job counts the
  -- failure, opens an incident and tries again tomorrow) rather than storing "nothing to show" for good.
  v_adh := private.weekly_adherence(p_patient, ((v_to + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 second');
  v_adh_pct := nullif(v_adh ->> 'percent', '')::integer;
  return jsonb_build_object(
    'month', p_month, 'readings', m.n, 'days_logged', m.days, 'enough_readings', v_enough, 'minimum_readings', v_min,
    'target', jsonb_build_object('systolic', t.sys, 'diastolic', t.dia, 'source', t.source),
    'average', case when v_enough then jsonb_build_object('systolic', m.avg_sys, 'diastolic', m.avg_dia,
                      'versus_target', case when m.avg_sys < t.sys and m.avg_dia < t.dia then 'under' else 'above' end) end,
    'weeks', w, 'direction_vs_last_month', v_dir,
    'adherence_pct', v_adh_pct);
end $function$;
revoke all on function private.monthly_report_payload(uuid, date) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sign_bp_target_config(integer)', 'EXECUTE') then raise exception 'anon can execute sign_bp_target_config'; end if;
  if has_function_privilege('anon', 'public.bp_target_config_for_signoff()', 'EXECUTE') then raise exception 'anon can execute bp_target_config_for_signoff'; end if;
  if has_function_privilege('authenticated', 'private.monthly_report_payload(uuid, date)', 'EXECUTE') then raise exception 'authenticated can execute private.monthly_report_payload'; end if;
  if exists (select 1 from public.bp_target_config where is_active or approved_by is not null) then
    raise exception 'this migration must not sign or activate anything';
  end if;
end $$;
