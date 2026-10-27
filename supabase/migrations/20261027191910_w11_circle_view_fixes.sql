-- W-11 (innovation gap register): Care Circle supporter view fixes. Everything here ships DARK or narrows what a supporter sees.
-- (Revised in place after code review, 2026-10-27, because nothing here is applied yet.)
--
-- LIVE VERSIONS REPLACED (read with pg_get_functiondef on koiplnmbgnqnbywhpjlf, 2026-10-27, after the S69b merge #1297 / 20261027183410):
--   private.circle_member_for(uuid,text)     = 20261006214127_s29c_care_circle_followup.sql (paused/alerts-paused cases), unchanged since
--   private.circle_view_blocks_core(uuid,text[]) = 20261006214127 (core) + the S42 consent line from 20261007230822
--   private.circle_monthly_block(uuid,text[])    = 20261007160007_s75_a5_circle_monthly_share_flag.sql
--   public.circle_supporter_view(uuid)           = 20261006214127_s29c_care_circle_followup.sql
--   public.circle_weekly_digest(uuid) (S69b) is NOT replaced: it calls private.circle_member_for, so the minor gate below covers it.
--
--   1. UNDER 18: a Care Circle is for adults. The refusal lives in the shared gate private.circle_member_for, so the supporter view, the weekly
--      digest, tasks, alerts and every other reader get it. The age test uses the Africa/Lagos date. A NULL date_of_birth means: refused when the
--      profile is a dependant account (is_dependent_account), otherwise unknown passes (a missing date is not proof of a child; the existing
--      receives_care and not-dependant checks on invites still apply). Insert triggers on care_circle_members and care_circle_invites stay;
--      circle_supporter_view keeps its circle_not_found. A one-time, idempotent function (private.circle_revoke_minor_memberships) revokes the
--      existing active memberships and pending invites of under-18 patients and writes one audit row per patient; it runs here once.
--   2. WEEKLY BP BLOCK (private.circle_view_blocks_core): the last view_weeks calendar weeks are always listed (a week with no readings is an
--      explicit gap: readings 0, averages null). A week with fewer readings than the monthly rule's min_readings (private.report_rule, 3) returns
--      null averages; its count stays. DIRECTION is computed only when BOTH the current and the previous calendar week have enough readings.
--   3. MONTHLY BLOCK: versus_target and direction are returned only when platform_modules key `sponsor_outcome_surfaces` is on. It is inserted
--      OFF here. The home BP target is NOT changed (D-09); patient_bp_target defaults are untouched.
-- Not touched: sponsor_care_report (W-12), any reproductive or minor-category access logic.

-- 1. the module key, OFF, idempotent
insert into public.platform_modules (key, label, description)
values ('sponsor_outcome_surfaces',
        'Sponsor outcome surfaces (versus-target and direction)',
        'Lets sponsor and Care Circle surfaces show a monthly average as above/at/below target and a month-on-month direction. Off until the founder, as CMO, re-signs the home blood pressure target (D-09). While off those two fields are never returned to a supporter.')
on conflict (key) do nothing;

-- 2. the minor test and the shared gate
create or replace function private.circle_patient_is_minor(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case
             when p.date_of_birth is not null then p.date_of_birth > (((now() at time zone 'Africa/Lagos')::date) - interval '18 years')::date
             else coalesce(p.is_dependent_account, false)
           end
      from public.profiles p where p.id = p_patient
  ), false)
$$;
revoke all on function private.circle_patient_is_minor(uuid) from public, anon, authenticated;

create or replace function private.circle_member_for(p_patient uuid, p_permission text default null) returns public.care_circle_members
language sql stable security definer set search_path = ''
as $$
  select m.* from public.care_circle_members m
    join public.profiles s on s.id = m.supporter_id and s.is_active
   where m.patient_id = p_patient and m.supporter_id = (select auth.uid())
     and m.state = 'active' and m.expires_at > now()
     and not private.circle_patient_is_minor(m.patient_id)   -- W-11: a Care Circle is for adults
     and (p_permission is null or p_permission = any (m.permissions))
     and case coalesce(p_permission, '')
           when 'pay_for_care' then true
           when 'red_alerts' then not private.circle_alerts_paused(m.patient_id)
           else not private.circle_paused(m.patient_id)
         end
   limit 1
$$;

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
drop trigger if exists care_circle_invites_refuse_minor on public.care_circle_invites;
create trigger care_circle_invites_refuse_minor before insert on public.care_circle_invites
  for each row execute function private.circle_refuse_minor_patient();
drop trigger if exists care_circle_members_refuse_minor on public.care_circle_members;
create trigger care_circle_members_refuse_minor before insert on public.care_circle_members
  for each row execute function private.circle_refuse_minor_patient();

-- one-time, idempotent: end what already exists for an under-18 patient, one audit row per patient
create or replace function private.circle_revoke_minor_memberships() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0; v_m integer; v_i integer;
begin
  for r in
    select p.id as patient_id, p.organisation_id
      from public.profiles p
     where private.circle_patient_is_minor(p.id)
       and (exists (select 1 from public.care_circle_members m where m.patient_id = p.id and m.state = 'active')
            or exists (select 1 from public.care_circle_invites i where i.patient_id = p.id and i.state = 'pending'))
  loop
    update public.care_circle_members set state = 'revoked', revoked_at = now() where patient_id = r.patient_id and state = 'active';
    get diagnostics v_m = row_count;
    update public.care_circle_invites set state = 'cancelled' where patient_id = r.patient_id and state = 'pending';
    get diagnostics v_i = row_count;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
    values (r.organisation_id, 'care_circle.minor_revoked', 'profile', r.patient_id,
            jsonb_build_object('members_revoked', v_m, 'invites_cancelled', v_i), r.patient_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.circle_revoke_minor_memberships() from public, anon, authenticated;
select private.circle_revoke_minor_memberships();

-- 3. weekly block: a spine of the last view_weeks calendar weeks; null averages below min_readings; direction needs both weeks
create or replace function private.circle_view_blocks_core(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_min integer := coalesce((private.report_rule('min_readings') #>> '{}')::integer, 3);   -- W-11
  out jsonb := '{}'::jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric; v_na integer; v_nb integer;
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
    -- W-11: every calendar week in the window is listed (a gap has readings 0); below min_readings the averages are null (the count stays).
    select coalesce(jsonb_agg(jsonb_build_object('week_start', k.wk,
                                                 'systolic', case when coalesce(w.n, 0) >= v_min then w.sys end,
                                                 'diastolic', case when coalesce(w.n, 0) >= v_min then w.dia end,
                                                 'readings', coalesce(w.n, 0)) order by k.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', v_today::timestamp)::date - 7 * i) as wk from generate_series(0, v_weeks - 1) i) k
      left join (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                        round(avg(diastolic))::integer dia, count(*)::integer n
                   from public.vitals_readings
                  where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
                    and coalesce(validation_status::text, '') <> 'rejected'
                    and taken_at >= (date_trunc('week', v_today::timestamp)::date - 7 * (v_weeks - 1))::timestamp at time zone 'Africa/Lagos'
                  group by 1) w on w.wk = k.wk;
    -- W-11: direction only when BOTH the current and the previous calendar week have enough readings
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric,
           (v_bp -> -1 ->> 'readings')::integer, (v_bp -> -2 ->> 'readings')::integer into v_a, v_b, v_na, v_nb;
    v_dir := case when v_a is null or v_b is null or coalesce(v_na, 0) < v_min or coalesce(v_nb, 0) < v_min then null
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

-- 4. monthly block: versus_target and direction behind sponsor_outcome_surfaces
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
  -- which member this is: the supporter themself, or (patient preview only) the member the patient is previewing
  if v_uid is not null and v_uid = p_patient and v_preview is not null then
    select * into m from public.care_circle_members where id = v_preview::uuid and patient_id = p_patient and state = 'active';
  else
    select * into m from public.care_circle_members
     where patient_id = p_patient and supporter_id = v_uid and state = 'active' order by created_at limit 1;
  end if;
  -- no member, or the patient has not chosen to share the monthly report with this supporter: not shared
  if m.id is null or not m.monthly_report_shared then return '{}'::jsonb; end if;
  -- A supporter sees only months from the month they were added onward, never the history from before the patient chose to share with them.
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

-- 5. the supporter view keeps its own circle_not_found for a minor (live body plus the guard)
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
     or has_function_privilege('authenticated', 'private.circle_monthly_block(uuid,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.circle_revoke_minor_memberships()', 'EXECUTE') then
    raise exception 'W-11: a circle function has the wrong privilege';
  end if;
  if exists (select 1 from public.care_circle_members m where m.state = 'active' and private.circle_patient_is_minor(m.patient_id)) then
    raise exception 'W-11: an under-18 patient still has an active circle member';
  end if;
  raise notice 'PASS: W-11 circle view fixes in place; outcome surfaces module off';
end $$;
