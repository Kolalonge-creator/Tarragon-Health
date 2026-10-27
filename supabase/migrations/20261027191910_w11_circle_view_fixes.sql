-- W-11 (innovation gap register): Care Circle supporter view fixes. Everything here ships DARK or narrows what a supporter sees.
--
--   1. Weekly blood pressure block (private.circle_view_blocks_core, the builder behind public.circle_supporter_view): a week with
--      fewer readings than the monthly report's min_readings rule (private.report_rule('min_readings'), currently 3) returns its
--      averages as null. The reading count n stays in the payload, so the screen can say "not enough readings yet". The week-on-week
--      direction is computed only from weeks that have enough readings. Before this, a single reading showed as a "weekly average".
--   2. Monthly block (private.circle_monthly_block): `versus_target` and `direction` are returned only when the new platform_modules
--      key `sponsor_outcome_surfaces` is on. It is inserted OFF here. The home BP target is NOT changed (founder D-09: the target is
--      re-signed by the founder as CMO before this key is switched on). patient_bp_target defaults are untouched.
--   3. Under-18 patients: a Care Circle is for adults. New invites and members for a patient whose date_of_birth makes them under 18
--      are refused by a trigger, and public.circle_supporter_view raises circle_not_found for such a patient (same answer as any
--      stranger), so a row that predates this trigger still shows nothing. A patient with no date of birth on file is not refused
--      (unknown is not "minor"; the existing receives_care / not-dependent checks still apply).
--
-- Bodies are the LIVE definitions (read with pg_get_functiondef on koiplnmbgnqnbywhpjlf, 2026-10-27, identical to
-- 20261007160007 and 20261006214127 plus the S42 consent line), with the changes marked "W-11". Signatures and grants are unchanged
-- (create or replace keeps grants). Not touched: sponsor_care_report (W-12), any reproductive or minor-category access logic.

-- 1. the module key, OFF, idempotent
insert into public.platform_modules (key, label, description)
values ('sponsor_outcome_surfaces',
        'Sponsor outcome surfaces (versus-target and direction)',
        'Lets sponsor and Care Circle surfaces show a monthly average as above/at/below target and a month-on-month direction. Off until the founder, as CMO, re-signs the home blood pressure target (D-09). While off those two fields are never returned to a supporter.')
on conflict (key) do nothing;

-- 2. weekly block: n >= min_readings or null
create or replace function private.circle_view_blocks_core(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_min integer := coalesce((private.report_rule('min_readings') #>> '{}')::integer, 3);   -- W-11
  out jsonb := '{}'::jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric;
  v_next timestamptz; v_missed integer;
begin
  -- S42: without the vitals x Care Circle consent, the vitals-derived blocks are not built.
  if not private.consent_in_force(p_patient, 'vitals', 'care_circle_sharing') then
    p_permissions := array_remove(array_remove(p_permissions, 'adherence_summary'), 'weekly_bp_trend');
  end if;
  if 'adherence_summary' = any (p_permissions) then
    select count(*) filter (where status in ('taken', 'delayed')), count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped'))
      into v_taken, v_due
      from public.medication_logs
     where patient_id = p_patient and scheduled_for_date between v_today - 6 and v_today;
    out := out || jsonb_build_object('adherence', jsonb_build_object('days', 7, 'taken', v_taken, 'due', v_due,
              'percent', case when v_due > 0 then round(100.0 * v_taken / v_due)::integer end));
  end if;

  if 'weekly_bp_trend' = any (p_permissions) then
    -- weekly averages only: no single reading, no time of day, no symptom, no note.
    -- W-11: a week with fewer than min_readings readings carries null averages (the count stays).
    select coalesce(jsonb_agg(jsonb_build_object('week_start', w.wk,
                                                 'systolic', case when w.n >= v_min then w.sys end,
                                                 'diastolic', case when w.n >= v_min then w.dia end,
                                                 'readings', w.n) order by w.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                   round(avg(diastolic))::integer dia, count(*)::integer n
              from public.vitals_readings
             where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
               and coalesce(validation_status::text, '') <> 'rejected'
               and taken_at >= (v_today - (v_weeks * 7))::timestamp at time zone 'Africa/Lagos'
             group by 1) w;
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric into v_a, v_b;
    -- W-11: no direction unless both of the last two weeks have enough readings
    v_dir := case when jsonb_array_length(v_bp) < 2 or v_a is null or v_b is null then null
                  when v_a - v_b >= 5 then 'higher' when v_a - v_b <= -5 then 'lower' else 'steady' end;
    out := out || jsonb_build_object('bp_trend', jsonb_build_object('weeks', v_bp, 'direction', v_dir));
  end if;

  if 'appointments' = any (p_permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()),
           count(*) filter (where status = 'no_show' and scheduled_for > now() - interval '30 days')
      into v_next, v_missed
      from public.appointments where patient_id = p_patient;
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next, 'missed_30d', v_missed));
  end if;

  if 'pay_for_care' = any (p_permissions) then
    out := out || jsonb_build_object('can_pay', true);
  end if;
  return out;
end $$;
revoke all on function private.circle_view_blocks_core(uuid, text[]) from public, anon, authenticated;

-- 3. monthly block: versus_target and direction behind sponsor_outcome_surfaces
create or replace function private.circle_monthly_block(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_bp boolean := 'weekly_bp_trend' = any (p_permissions); v_adh boolean := 'adherence_summary' = any (p_permissions);
  v_uid uuid := (select auth.uid());
  v_preview text := nullif(current_setting('tarragon.circle_preview_member', true), '');
  v_outcomes boolean := private.module_enabled('sponsor_outcome_surfaces');   -- W-11
  m public.care_circle_members%rowtype;
  v_rows jsonb; v_from date;
begin
  if not (v_bp or v_adh) then return '{}'::jsonb; end if;
  if v_uid is not null and v_uid = p_patient and v_preview is not null then
    select * into m from public.care_circle_members where id = v_preview::uuid and patient_id = p_patient and state = 'active';
  else
    select * into m from public.care_circle_members
     where patient_id = p_patient and supporter_id = v_uid and state = 'active' order by created_at limit 1;
  end if;
  if m.id is null or not m.monthly_report_shared then return '{}'::jsonb; end if;
  v_from := date_trunc('month', m.created_at at time zone 'Africa/Lagos')::date;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'month', r.month,
           'enough_readings', case when v_bp then (r.payload ->> 'enough_readings')::boolean end,
           'average', case when v_bp and (r.payload ->> 'enough_readings')::boolean
                           then jsonb_build_object('systolic', round((r.payload #>> '{average,systolic}')::numeric)::integer,
                                                   'diastolic', round((r.payload #>> '{average,diastolic}')::numeric)::integer,
                                                   'versus_target', case when v_outcomes then r.payload #>> '{average,versus_target}' end) end,   -- W-11
           'direction', case when v_bp and v_outcomes then r.payload ->> 'direction_vs_last_month' end,                                              -- W-11
           'adherence_pct', case when v_adh then (r.payload ->> 'adherence_pct')::integer end,
           'adherence_shared', case when v_adh then true end)) order by r.month desc), '[]'::jsonb)
    into v_rows
    from (select month, payload from public.monthly_reports where patient_id = p_patient and month >= v_from order by month desc limit 3) r;
  return jsonb_build_object('monthly', v_rows);
end $$;
revoke all on function private.circle_monthly_block(uuid, text[]) from public, anon, authenticated;

-- 4. under-18 patients are refused
create or replace function private.circle_patient_is_minor(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select date_of_birth > (current_date - interval '18 years')::date from public.profiles where id = p_patient), false) $$;
revoke all on function private.circle_patient_is_minor(uuid) from public, anon, authenticated;

create or replace function private.circle_refuse_minor_patient() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.circle_patient_is_minor(new.patient_id) then
    raise exception 'circle_not_authorised' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.circle_refuse_minor_patient() from public, anon, authenticated;

create trigger care_circle_invites_refuse_minor before insert on public.care_circle_invites
  for each row execute function private.circle_refuse_minor_patient();
create trigger care_circle_members_refuse_minor before insert on public.care_circle_members
  for each row execute function private.circle_refuse_minor_patient();

create or replace function public.circle_supporter_view(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  v_name text;
  out jsonb;
begin
  -- W-11: a Care Circle is for adults; an under-18 patient's page is "not found", the same answer a stranger gets
  if private.circle_patient_is_minor(p_patient) then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  m := private.circle_member_for(p_patient);
  if m.id is null then
    -- a paused circle: only the right to pay is left, and nothing says why. Anyone else gets the same "not found" as before.
    m := private.circle_member_for(p_patient, 'pay_for_care');
    if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                              'permissions', to_jsonb(array['pay_for_care']), 'shared_until', m.expires_at, 'can_pay', true);
  end if;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at)
         || private.circle_view_blocks(p_patient, m.permissions);
  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', to_jsonb(m.permissions)), m.supporter_id);
  return out;
end $$;

do $$
begin
  if not exists (select 1 from public.platform_modules where key = 'sponsor_outcome_surfaces' and not is_enabled) then
    raise exception 'W-11: sponsor_outcome_surfaces must exist and be OFF';
  end if;
  if has_function_privilege('anon', 'public.circle_supporter_view(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.circle_patient_is_minor(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.circle_view_blocks_core(uuid,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.circle_monthly_block(uuid,text[])', 'EXECUTE') then
    raise exception 'W-11: a circle function has the wrong privilege';
  end if;
  raise notice 'PASS: W-11 circle view fixes in place; outcome surfaces module off';
end $$;
