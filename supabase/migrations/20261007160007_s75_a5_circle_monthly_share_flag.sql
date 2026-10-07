-- S75 A5 (CMO decision S-21): the monthly report is shared with a Care Circle supporter only when the patient says so, per supporter.
--
-- Until now (S38d) a supporter saw the "monthly" block automatically through ticks the patient had given for the weekly view
-- (weekly_bp_trend, adherence_summary). The patient never chose to share the monthly report itself.
--
-- Now:
--   * care_circle_members.monthly_report_shared (boolean, default false) is the explicit, per-supporter flag.
--   * private.circle_monthly_block returns the monthly block only when the flag is true AND the supporter still holds the existing
--     weekly_bp_trend / adherence_summary tick for that part (within that supporter's existing permission). No flag: no block, which
--     reads as "not shared", never zero.
--   * public.set_circle_monthly_report_share(member, on) is the patient's control, one supporter at a time; each change is written to
--     the care access log (kind permission_changed, no health data).
--   * public.my_care_circle() now returns monthly_report_shared per member so the screen can show the switch.
--   * public.circle_preview_member(member) now tells the block which member the patient is previewing (a transaction-local setting,
--     honoured only when the caller is the patient and the member is theirs) so "see what they see" matches what the supporter sees.
--
-- SAFER DIRECTION, STATED PLAINLY: every existing supporter starts with the flag OFF (column default), so supporters who were
-- receiving the monthly block through their ticks STOP receiving it until the patient turns it on for them. Nothing is deleted.
-- Expiring report links (S-21 says "expiring links") are NOT built: there is no link or token for a report today; the block is a view
-- inside the supporter's own access, which already ends on expiry or revocation. Reported as not built.
--
-- Bodies for circle_preview_member and my_care_circle are the live definitions from 20261006214127_s29c_care_circle_followup.sql (the only
-- definitions on this tree) with one added line each. circle_monthly_block is the S38d body with the member lookup replaced.

alter table public.care_circle_members
  add column monthly_report_shared boolean not null default false,
  add column monthly_report_shared_at timestamptz;
comment on column public.care_circle_members.monthly_report_shared is
  'S75 A5. The patient chose to share the monthly report with this supporter. Off by default; the monthly block also needs the weekly tick for each part.';

create or replace function private.circle_monthly_block(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_bp boolean := 'weekly_bp_trend' = any (p_permissions); v_adh boolean := 'adherence_summary' = any (p_permissions);
  v_uid uuid := (select auth.uid());
  v_preview text := nullif(current_setting('tarragon.circle_preview_member', true), '');
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
                                                   'versus_target', r.payload #>> '{average,versus_target}') end,
           'direction', case when v_bp then r.payload ->> 'direction_vs_last_month' end,
           'adherence_pct', case when v_adh then (r.payload ->> 'adherence_pct')::integer end,
           'adherence_shared', case when v_adh then true end)) order by r.month desc), '[]'::jsonb)
    into v_rows
    from (select month, payload from public.monthly_reports where patient_id = p_patient and month >= v_from order by month desc limit 3) r;
  return jsonb_build_object('monthly', v_rows);
end $$;
revoke all on function private.circle_monthly_block(uuid, text[]) from public, anon, authenticated;

create or replace function public.circle_preview_member(p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.care_circle_members%rowtype; v_name text;
begin
  select * into m from public.care_circle_members
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now();
  if not found then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = m.patient_id;
  perform set_config('tarragon.circle_preview_member', m.id::text, true);
  return jsonb_build_object('patient_id', m.patient_id, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at, 'preview', true,
                            'alert_sample', 'red_alerts' = any (m.permissions))
         || private.circle_view_blocks(m.patient_id, m.permissions);
end $$;

create or replace function public.my_care_circle() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at,
                'monthly_report_shared', m.monthly_report_shared)
                order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.id, 'hint', i.invitee_hint, 'kind', i.invitee_kind,
                'relationship', i.relationship, 'permissions', to_jsonb(i.permissions), 'expires_at', i.expires_at) order by i.created_at)
              from public.care_circle_invites i
             where i.patient_id = (select auth.uid()) and i.state = 'pending' and i.expires_at > now()), '[]'::jsonb),
    'pause', (select jsonb_build_object('paused_until', p.paused_until, 'pause_alerts', p.pause_alerts)
                from public.care_circle_pauses p where p.patient_id = (select auth.uid()) and p.paused_until > now()),
    'pause_days', (private.circle_rules() ->> 'pause_days')::integer)
$$;

-- The patient's own switch, one supporter at a time. Patient only (the member row must name the caller as the patient).
create function public.set_circle_monthly_report_share(p_member uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare m public.care_circle_members%rowtype;
begin
  if (select auth.uid()) is null or p_on is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  update public.care_circle_members
     set monthly_report_shared = p_on, monthly_report_shared_at = case when p_on then now() else null end
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now()
   returning * into m;
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  perform private.log_care_access(m.patient_id, 'permission_changed', 'care_circle',
                                  jsonb_build_object('monthly_report_shared', p_on, 'by_patient', true), m.supporter_id);
  return p_on;
end $$;
revoke all on function public.set_circle_monthly_report_share(uuid, boolean) from public, anon;
grant execute on function public.set_circle_monthly_report_share(uuid, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_circle_monthly_report_share(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.circle_monthly_block(uuid,text[])', 'EXECUTE') then
    raise exception 'S75 A5: a circle function has the wrong privilege';
  end if;
  if exists (select 1 from public.care_circle_members where monthly_report_shared) then
    raise exception 'S75 A5: an existing supporter was opted in; every existing supporter must start with the flag off';
  end if;
  raise notice 'PASS: S75 A5 monthly report share flag in place, every existing supporter starts off';
end $$;
