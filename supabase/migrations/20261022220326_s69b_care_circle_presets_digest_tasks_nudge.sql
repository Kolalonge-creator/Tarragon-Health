-- S69b: Care Circle upgrade (docs/design/S69b-care-circle.md). Patterns taken from Medisafe Medfriend, Apple Health Sharing and
-- Lotsa Helping Hands, kept inside the existing Care Circle (care_circle_members, the one gate private.circle_member_for, the
-- patient's "who looked" log). No new role and no new permission name.
--
--   (a) Waiting state. A supporter can now answer an invite with "not now". The person who sent the invite is never told: their list
--       keeps saying "waiting for them" until the invite runs out on its own, and the word "declined" is never sent to them. (The two
--       named presets, "Can see" and "Can see and help", are a screen-side grouping of the existing permissions and need no database
--       change; they live in packages/shared/src/care-circle-presets.ts.)
--   (b) A calm weekly digest for a supporter, computed on read from the permissions granted: counts of days only, never a value
--       unless the matching permission is held, and only a generic push ("Your circle has an update"). Module care_circle_digest, OFF.
--   (c) Small shared tasks inside the circle ("take her to the lab on Tuesday"). A fixed list of task kinds and a date, no free text,
--       no chat. Who may post and claim is the patient and a supporter in the "Can see and help" preset (a member holding
--       pay_for_care). Module care_circle_tasks, OFF.
--   (d) A gentle nudge to a supporter when a dose has had no answer after a grace period, only if the patient switched it on for that
--       supporter, never for a red event (that path, private.notify_circle_red_alert, is not touched), and held back by the patient-first
--       window when the care_circle_checkin_window module is on. Module care_circle_missed_dose_alert, OFF.
--   (e) Every supporter read added here (digest, task list, nudge list) is written to care_access_events, the patient's own list.
--
-- Live checks owed before apply (nothing was applied from this branch): list_migrations for anything recent; pg_get_functiondef of
-- public.my_care_circle (this file restates the S75 A5 body with additions) and private.circle_member_for (read, not replaced).

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED, Founder owner), mirrored as care_circle.supporter_tools in packages/shared/src/proposed-config
-- ---------------------------------------------------------------------------
create table public.care_circle_tools_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index care_circle_tools_config_one_active on public.care_circle_tools_config (is_active) where is_active;

create function private.care_circle_tools_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  -- every key is a positive whole number; a missing or odd one would make a comparison null and quietly lift a limit
  foreach k in array array['missed_dose_grace_minutes', 'missed_dose_window_minutes', 'missed_dose_max_per_day', 'digest_days',
                           'task_max_open', 'task_keep_days', 'task_max_days_ahead', 'task_stale_days', 'task_done_visible_days'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'missed_dose_grace_minutes')::integer between 5 and 240
     and (r ->> 'missed_dose_window_minutes')::integer between 15 and 240
     and (r ->> 'missed_dose_max_per_day')::integer <= 10
     and (r ->> 'digest_days')::integer between 1 and 14
     and (r ->> 'task_max_open')::integer <= 50
     and (r ->> 'task_max_days_ahead')::integer <= 365
     and (r ->> 'task_stale_days')::integer <= 90
     and (r ->> 'task_done_visible_days')::integer <= 30;
exception when others then
  return false;
end;
$$;
revoke all on function private.care_circle_tools_rules_valid(jsonb) from public, anon, authenticated;
alter table public.care_circle_tools_config add constraint care_circle_tools_config_rules_valid check (private.care_circle_tools_rules_valid(rules));

-- care-circle-tools-rules-begin
insert into public.care_circle_tools_config (version, is_active, effective_from, rules) values (1, true, '2026-10-22', $json$
{
  "missed_dose_grace_minutes": 30,
  "missed_dose_window_minutes": 60,
  "missed_dose_max_per_day": 3,
  "digest_days": 7,
  "task_max_open": 10,
  "task_keep_days": 30,
  "task_max_days_ahead": 90,
  "task_stale_days": 7,
  "task_done_visible_days": 7
}
$json$::jsonb);
-- care-circle-tools-rules-end

alter table public.care_circle_tools_config enable row level security;
create policy care_circle_tools_config_read on public.care_circle_tools_config for select to authenticated using (true);
revoke all on public.care_circle_tools_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.care_circle_tools_config from authenticated;
grant select on public.care_circle_tools_config to authenticated;

create function private.circle_tools_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.care_circle_tools_config where is_active $$;
revoke all on function private.circle_tools_rules() from public, anon, authenticated;

-- Three new modules, all born OFF (private.go_live_conditions is not touched; a module with no condition simply needs a superadmin).
insert into public.platform_modules (key, label, description) values
  ('care_circle_digest', 'Care Circle weekly digest',
   'A short weekly summary for a supporter, built only from what the patient let them see. OFF until switched on.'),
  ('care_circle_tasks', 'Care Circle shared tasks',
   'Small tasks inside a circle that a supporter can claim ("I will take her to the lab on Tuesday"). A fixed list of kinds and a date, no free text, no chat. OFF until switched on.'),
  ('care_circle_missed_dose_alert', 'Care Circle gentle nudge when a dose has had no answer',
   'A supporter the patient chose is nudged after a grace period (PROPOSED, 30 minutes). Never for a red event, which alerts supporters at once through its own path. OFF until the Chief Medical Officer has ruled.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Columns on the existing tables
-- ---------------------------------------------------------------------------
-- The patient's own switch, per supporter. Off by default. It only works while the supporter still holds adherence_summary.
alter table public.care_circle_members add column missed_dose_alert boolean not null default false;
comment on column public.care_circle_members.missed_dose_alert is
  'S69b. The patient chose to let this supporter be nudged when a dose has had no answer after the grace period. Off by default; cleared when adherence_summary is removed.';

-- "Not now" adds no column and changes no state: the invite stays state 'pending' (the sender can select that column, and the invite
-- cap and the daily invite limit count it exactly as before) and is made dead for the invitee by using up its wrong-try allowance,
-- which private.circle_invite_for_caller already treats as "this token no longer works" (attempts is not granted to authenticated).

create function private.circle_member_clear_nudge() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not ('adherence_summary' = any (new.permissions)) then new.missed_dose_alert := false; end if;
  return new;
end $$;
revoke all on function private.circle_member_clear_nudge() from public, anon, authenticated;
create trigger care_circle_members_clear_nudge before insert or update of permissions, missed_dose_alert on public.care_circle_members
  for each row execute function private.circle_member_clear_nudge();

-- ---------------------------------------------------------------------------
-- 3. Waiting state: "not now" is silent for the sender
-- ---------------------------------------------------------------------------
create function public.decline_care_circle_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare i public.care_circle_invites%rowtype;
begin
  -- the same lookup and the same silent failure as preview and accept (it counts a wrong-account try; it RETURNS, never raises)
  i := private.circle_invite_for_caller(p_token, true);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  update public.care_circle_invites set attempts = greatest(attempts, (private.circle_rules() ->> 'max_attempts')::integer) where id = i.id;
  -- nobody is notified and no column the sender can read changes: the invite is still 'pending' and shows as waiting until it expires
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.decline_care_circle_invite(text) from public, anon;
grant execute on function public.decline_care_circle_invite(text) to authenticated;

-- Body restated from 20261007160007_s75_a5_circle_monthly_share_flag.sql with: each invite carrying the neutral word "waiting" and each
-- member carrying missed_dose_alert.
create or replace function public.my_care_circle() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at,
                'monthly_report_shared', m.monthly_report_shared, 'missed_dose_alert', m.missed_dose_alert)
                order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.id, 'hint', i.invitee_hint, 'kind', i.invitee_kind,
                'relationship', i.relationship, 'permissions', to_jsonb(i.permissions), 'expires_at', i.expires_at, 'state', 'waiting') order by i.created_at)
              from public.care_circle_invites i
             where i.patient_id = (select auth.uid()) and i.state = 'pending' and i.expires_at > now()), '[]'::jsonb),
    'pause', (select jsonb_build_object('paused_until', p.paused_until, 'pause_alerts', p.pause_alerts)
                from public.care_circle_pauses p where p.patient_id = (select auth.uid()) and p.paused_until > now()),
    'pause_days', (private.circle_rules() ->> 'pause_days')::integer)
$$;

-- ---------------------------------------------------------------------------
-- 4. Which tools are on (so a screen shows a control only when its module is on)
-- ---------------------------------------------------------------------------
create function public.circle_tools_status() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when (select auth.uid()) is null then jsonb_build_object('digest', false, 'tasks', false, 'missed_dose', false, 'grace_minutes', null)
         else jsonb_build_object('digest', private.module_enabled('care_circle_digest'),
                                 'tasks', private.module_enabled('care_circle_tasks'),
                                 'missed_dose', private.module_enabled('care_circle_missed_dose_alert'),
                                 -- the wait before a nudge, from configuration, so no screen hard-codes the number
                                 'grace_minutes', (private.circle_tools_rules() ->> 'missed_dose_grace_minutes')::integer) end
$$;
revoke all on function public.circle_tools_status() from public, anon;
grant execute on function public.circle_tools_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The patient's switch for the gentle nudge (per supporter)
-- ---------------------------------------------------------------------------
create function public.set_circle_missed_dose_alert(p_member uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare m public.care_circle_members%rowtype;
begin
  if (select auth.uid()) is null or p_on is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into m from public.care_circle_members
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now();
  if not found then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  if p_on then
    if not private.module_enabled('care_circle_missed_dose_alert') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
    -- the nudge needs the supporter to be allowed to see how doses are going at all
    if not ('adherence_summary' = any (m.permissions)) then raise exception 'circle_nudge_needs_adherence' using errcode = 'P0001'; end if;
  end if;
  update public.care_circle_members set missed_dose_alert = p_on where id = m.id;
  perform private.log_care_access(m.patient_id, 'permission_changed', 'care_circle', jsonb_build_object('missed_dose_alert', p_on, 'by_patient', true), m.supporter_id);
  return true;
end $$;
revoke all on function public.set_circle_missed_dose_alert(uuid, boolean) from public, anon;
grant execute on function public.set_circle_missed_dose_alert(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Shared tasks
-- ---------------------------------------------------------------------------
create table public.care_circle_tasks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  created_by      uuid not null references public.profiles (id) on delete cascade,
  -- a fixed list: there is no free text anywhere in a task, so nothing medical can be typed into one
  kind            text not null check (kind in ('take_to_appointment', 'take_to_lab', 'collect_medicines', 'visit', 'phone_call', 'errand')),
  needed_by       date,
  state           text not null default 'open' check (state in ('open', 'claimed', 'done', 'cancelled')),
  claimed_by      uuid references public.profiles (id) on delete set null,
  claimed_at      timestamptz,
  done_at         timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index care_circle_tasks_patient_idx on public.care_circle_tasks (patient_id, state);
create index care_circle_tasks_claimed_idx on public.care_circle_tasks (claimed_by) where state = 'claimed';
create trigger care_circle_tasks_set_updated_at before update on public.care_circle_tasks
  for each row execute function private.set_updated_at();

-- The patient reads their own tasks. A supporter reads through public.circle_tasks only (audited, pause-aware), never the table.
alter table public.care_circle_tasks enable row level security;
revoke all on public.care_circle_tasks from public, anon, authenticated;
grant select on public.care_circle_tasks to authenticated;
create policy care_circle_tasks_patient_own on public.care_circle_tasks for select to authenticated
  using (patient_id = (select auth.uid()));

-- S39d: the data registry. Operational, deleted at the end of retention, not exported whole (a row names the supporter who claimed it).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
values ('care_circle_tasks', 'patient_id', 'operational', 'delete', false,
        'S69b 2026-10-22: PROPOSED, to be confirmed by the CMO and DPO. A small shared task inside a Care Circle (fixed kind and a date, no free text). in_export is false because a row names the supporter who claimed it.'),
       ('care_circle_missed_dose_alerts', 'patient_id', 'operational', 'delete', false,
        'S69b 2026-10-22: PROPOSED, to be confirmed by the CMO and DPO. Bookkeeping that one gentle nudge was sent to one supporter for one dose slot (no medicine name stored beyond the medication id). in_export is false: it names the supporter.')
on conflict (table_name) do nothing;

-- Jobs and the digest's job counts are visible only to a member who holds at least one view permission or pay_for_care. A supporter who
-- holds only red_alerts (or only attend_consultation) is in the circle for a different reason and reads no job.
create function private.circle_perms_see_tasks(p_permissions text[]) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p_permissions && array['adherence_summary', 'weekly_bp_trend', 'appointments', 'pay_for_care']::text[], false) $$;
revoke all on function private.circle_perms_see_tasks(text[]) from public, anon, authenticated;

-- Who is the caller in this circle? 'patient' (their own circle), 'helper' (an active, unexpired, not-paused member in the
-- "Can see and help" preset, i.e. holding pay_for_care), 'viewer' (any other active member), or null (a stranger, an expired or removed
-- member: they all get the same "not found").
create function private.circle_task_role(p_patient uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.care_circle_members%rowtype;
begin
  if v_uid is null then return null; end if;
  if v_uid = p_patient then
    return case when exists (select 1 from public.profiles where id = p_patient and is_active and receives_care) then 'patient' end;
  end if;
  m := private.circle_member_for(p_patient);
  if m.id is null or not private.circle_perms_see_tasks(m.permissions) then return null; end if;
  return case when 'pay_for_care' = any (m.permissions) then 'helper' else 'viewer' end;
end $$;
revoke all on function private.circle_task_role(uuid) from public, anon, authenticated;

-- A neutral, payload-free notice about a task. Additive: a failure opens an incident but never undoes the task action.
create function private.circle_task_notify(p_task public.care_circle_tasks, p_to_patient boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  begin
    if p_to_patient then
      perform private.circle_notify_always(p_task.patient_id, p_task.organisation_id, 'circle_task_update', 'care_circle_tasks', p_task.id, array['in_app'], 'routine');
    else
      -- the only thing in a helper's payload is whose circle it is, so the inbox line can open that person's page; it is never echoed in text
      for r in select m.supporter_id from public.care_circle_members m join public.profiles sp on sp.id = m.supporter_id and sp.is_active
                where m.patient_id = p_task.patient_id and m.state = 'active' and m.expires_at > now() and 'pay_for_care' = any (m.permissions)
                  and m.supporter_id <> p_task.created_by and sp.is_test = p_task.is_test and not private.circle_paused(m.patient_id) loop
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
        values (r.supporter_id, p_task.organisation_id, 'in_app', 'circle_task_update', jsonb_build_object('patient_id', p_task.patient_id), 'pending', 'non_clinical', 'routine', 'care_circle_tasks', p_task.id);
      end loop;
    end if;
  exception when others then
    begin
      perform private.page_incident(p_task.organisation_id, 'circle_task_notice_failed:' || p_task.id, 'A Care Circle task notice could not be sent',
        'A notice about a shared task (' || p_task.id || ') failed: ' || sqlerrm);
    exception when others then
      raise warning 'circle task notice and its incident both failed for %: %', p_task.id, sqlerrm;
    end;
  end;
end $$;
revoke all on function private.circle_task_notify(public.care_circle_tasks, boolean) from public, anon, authenticated;

create function public.post_circle_task(p_patient uuid, p_kind text, p_needed_by date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ahead integer := (private.circle_tools_rules() ->> 'task_max_days_ahead')::integer;
  t public.care_circle_tasks%rowtype;
  p public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  v_role := private.circle_task_role(p_patient);
  if v_role is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  if v_role = 'viewer' then raise exception 'circle_task_needs_help_preset' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('take_to_appointment', 'take_to_lab', 'collect_medicines', 'visit', 'phone_call', 'errand') then
    raise exception 'task_kind_invalid' using errcode = '22023';
  end if;
  if p_needed_by is not null and (p_needed_by < v_today or p_needed_by > v_today + v_ahead) then raise exception 'task_date_invalid' using errcode = '22023'; end if;
  select * into p from public.profiles where id = p_patient;
  if (select count(*) from public.care_circle_tasks where patient_id = p_patient and state in ('open', 'claimed'))
       >= (private.circle_tools_rules() ->> 'task_max_open')::integer then
    raise exception 'task_limit' using errcode = 'P0001';
  end if;
  insert into public.care_circle_tasks (organisation_id, patient_id, created_by, kind, needed_by, is_test)
  values (p.organisation_id, p_patient, v_uid, p_kind, p_needed_by, coalesce(p.is_test, false))
  returning * into t;
  -- the patient posts: the helpers are told; a helper posts: the patient is told. Neutral, no payload.
  perform private.circle_task_notify(t, v_role = 'helper');
  if v_role = 'helper' then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('tasks'), 'posted', true), v_uid);
  end if;
  return jsonb_build_object('ok', true, 'task_id', t.id);
end $$;
revoke all on function public.post_circle_task(uuid, text, date) from public, anon;
grant execute on function public.post_circle_task(uuid, text, date) to authenticated;

create function public.circle_tasks(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_role text; v_today date := (now() at time zone 'Africa/Lagos')::date; out jsonb;
  v_visible integer := (private.circle_tools_rules() ->> 'task_done_visible_days')::integer;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  v_role := private.circle_task_role(p_patient);
  if v_role is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', t.id, 'kind', t.kind, 'needed_by', t.needed_by, 'state', t.state,
           'claimed_by_name', case when t.state in ('claimed', 'done') then coalesce(nullif(split_part(btrim(cp.full_name), ' ', 1), ''), 'Someone') end,
           'mine', t.claimed_by = v_uid,
           'posted_by_me', t.created_by = v_uid,
           'can_claim', v_role = 'helper' and t.state = 'open',
           'can_release', t.state = 'claimed' and t.claimed_by = v_uid,
           'can_complete', (t.state = 'claimed' and (v_role = 'patient' or (v_role = 'helper' and t.claimed_by = v_uid))) or (t.state = 'open' and v_role = 'patient'),
           -- the same rule cancel_circle_task enforces: the patient, or the poster while still a helper (a poster who dropped to viewer cannot)
           'can_cancel', t.state in ('open', 'claimed') and (v_role = 'patient' or (v_role = 'helper' and t.created_by = v_uid)))
           order by (t.state = 'done'), t.needed_by nulls last, t.created_at), '[]'::jsonb)
    into out
    from public.care_circle_tasks t left join public.profiles cp on cp.id = t.claimed_by
   where t.patient_id = p_patient and (t.state in ('open', 'claimed') or (t.state = 'done' and t.done_at > now() - make_interval(days => v_visible)));
  -- a supporter's look is written to the patient's own list (the patient reading their own tasks is not a look)
  if v_role <> 'patient' then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('tasks')), v_uid);
  end if;
  return jsonb_build_object('role', v_role, 'tasks', out, 'today', v_today);
end $$;
revoke all on function public.circle_tasks(uuid) from public, anon;
grant execute on function public.circle_tasks(uuid) to authenticated;

create function public.claim_circle_task(p_task uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  select * into t from public.care_circle_tasks where id = p_task for update;
  if not found or private.circle_task_role(t.patient_id) is distinct from 'helper' then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  -- first one wins; a task already claimed answers false, never an error that names who has it
  if t.state <> 'open' then return false; end if;
  update public.care_circle_tasks set state = 'claimed', claimed_by = v_uid, claimed_at = now() where id = t.id returning * into t;
  perform private.circle_task_notify(t, true);
  return true;
end $$;
revoke all on function public.claim_circle_task(uuid) from public, anon;
grant execute on function public.claim_circle_task(uuid) to authenticated;

create function public.release_circle_task(p_task uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  update public.care_circle_tasks set state = 'open', claimed_by = null, claimed_at = null
   where id = p_task and state = 'claimed' and claimed_by = v_uid returning * into t;
  if t.id is null then return false; end if;
  perform private.circle_task_notify(t, true);
  return true;
end $$;
revoke all on function public.release_circle_task(uuid) from public, anon;
grant execute on function public.release_circle_task(uuid) to authenticated;

create function public.complete_circle_task(p_task uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype; v_role text;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into t from public.care_circle_tasks where id = p_task for update;
  if not found then return false; end if;
  v_role := private.circle_task_role(t.patient_id);
  -- the person who claimed it (while still a helper) or the patient
  if not (v_role = 'patient' or (v_role = 'helper' and t.claimed_by = v_uid)) then return false; end if;
  if t.state not in ('open', 'claimed') or (t.state = 'open' and v_role <> 'patient') then return false; end if;
  update public.care_circle_tasks set state = 'done', done_at = now() where id = t.id returning * into t;
  if v_role = 'helper' then perform private.circle_task_notify(t, true); end if;
  return true;
end $$;
revoke all on function public.complete_circle_task(uuid) from public, anon;
grant execute on function public.complete_circle_task(uuid) to authenticated;

create function public.cancel_circle_task(p_task uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype; v_role text;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into t from public.care_circle_tasks where id = p_task for update;
  if not found then return false; end if;
  v_role := private.circle_task_role(t.patient_id);
  if not (v_role = 'patient' or (v_role = 'helper' and t.created_by = v_uid)) then return false; end if;
  if t.state not in ('open', 'claimed') then return false; end if;
  update public.care_circle_tasks set state = 'cancelled', claimed_by = null where id = t.id returning * into t;
  if v_role = 'patient' then perform private.circle_task_notify(t, false); else perform private.circle_task_notify(t, true); end if;
  return true;
end $$;
revoke all on function public.cancel_circle_task(uuid) from public, anon;
grant execute on function public.cancel_circle_task(uuid) to authenticated;

-- Housekeeping, safe whether or not the module is on: a task claimed by someone who is no longer a helper goes back to open; a task
-- whose date is long gone is cancelled; finished and cancelled tasks are deleted after task_keep_days.
create function private.sweep_circle_tasks() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer := 0; k integer; v_keep integer := (private.circle_tools_rules() ->> 'task_keep_days')::integer;
  v_stale integer := (private.circle_tools_rules() ->> 'task_stale_days')::integer;
begin
  update public.care_circle_tasks t set state = 'open', claimed_by = null, claimed_at = null
   where t.state = 'claimed' and not exists (
     select 1 from public.care_circle_members m
      where m.patient_id = t.patient_id and m.supporter_id = t.claimed_by and m.state = 'active' and m.expires_at > now()
        and 'pay_for_care' = any (m.permissions));
  get diagnostics k = row_count; n := n + k;
  update public.care_circle_tasks set state = 'cancelled', claimed_by = null
   where state in ('open', 'claimed') and needed_by is not null and needed_by < (now() at time zone 'Africa/Lagos')::date - v_stale;
  get diagnostics k = row_count; n := n + k;
  delete from public.care_circle_tasks where state in ('done', 'cancelled') and updated_at < now() - make_interval(days => v_keep);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke all on function private.sweep_circle_tasks() from public, anon, authenticated;
select cron.schedule('care-circle-tasks-sweep', '17 * * * *', $$ select private.sweep_circle_tasks(); $$);

-- ---------------------------------------------------------------------------
-- 7. The weekly digest (computed on read, only from permissions held; counts of days, never a value)
-- ---------------------------------------------------------------------------
create function public.circle_weekly_digest(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.care_circle_members%rowtype;
  v_days integer := (private.circle_tools_rules() ->> 'digest_days')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
  v_name text;
  out jsonb;
  v_all integer; v_with integer; v_read integer; v_next timestamptz;
  v_open integer; v_claimed integer; v_done integer;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_digest') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  -- the one gate: an active, unexpired member, and a paused circle shows nothing (same "not found" as everything else)
  m := private.circle_member_for(p_patient);
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  v_from := v_today - (v_days - 1);
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'from', v_from, 'to', v_today, 'days', v_days);

  if 'adherence_summary' = any (m.permissions) then
    select count(*) filter (where due > 0 and taken = due), count(*) filter (where due > 0) into v_all, v_with
      from (select scheduled_for_date,
                   count(*) filter (where status in ('taken', 'delayed')) taken,
                   count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped')) due
              from public.medication_logs
             where patient_id = p_patient and scheduled_for_date between v_from and v_today
             group by scheduled_for_date) d;
    out := out || jsonb_build_object('doses', jsonb_build_object('days_all_taken', v_all, 'days_with_doses', v_with));
  end if;

  if 'weekly_bp_trend' = any (m.permissions) then
    -- days on which a reading was logged: a count, never a value, a time or a note
    select count(distinct (taken_at at time zone 'Africa/Lagos')::date) into v_read
      from private.vitals_readings_current
     where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
       and coalesce(validation_status::text, '') <> 'rejected'
       and taken_at >= v_from::timestamp at time zone 'Africa/Lagos';
    out := out || jsonb_build_object('readings', jsonb_build_object('days_logged', v_read));
  end if;

  if 'appointments' = any (m.permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()) into v_next
      from public.appointments where patient_id = p_patient;
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next));
  end if;

  -- job counts are visible to members who may see jobs at all (a view permission or pay_for_care), not to a red_alerts-only member
  if private.circle_perms_see_tasks(m.permissions) then
    select count(*) filter (where state = 'open'), count(*) filter (where state = 'claimed'),
           count(*) filter (where state = 'done' and done_at > now() - make_interval(days => v_days))
      into v_open, v_claimed, v_done from public.care_circle_tasks where patient_id = p_patient;
    out := out || jsonb_build_object('tasks', jsonb_build_object('open', v_open, 'claimed', v_claimed, 'done', v_done));
  end if;

  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('digest')), v_uid);
  return out;
end $$;
revoke all on function public.circle_weekly_digest(uuid) from public, anon;
grant execute on function public.circle_weekly_digest(uuid) to authenticated;

-- Once a week (Monday 07:00 Lagos) each supporter with something to look at gets ONE generic notice. Nothing about a person, a
-- reading, a dose or a condition is in it (INV-07). The digest itself is only ever built when the supporter opens it.
create function private.send_circle_digests() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0; v_week text := to_char((now() at time zone 'Africa/Lagos')::date, 'IYYY-IW');
begin
  if not private.module_enabled('care_circle_digest') then return 0; end if;
  for r in select m.id, m.supporter_id, m.organisation_id, m.is_test, m.alert_mode
             from public.care_circle_members m join public.profiles sp on sp.id = m.supporter_id and sp.is_active and sp.is_test = m.is_test
            where m.state = 'active' and m.expires_at > now() and not private.circle_paused(m.patient_id)
              and m.permissions && array['adherence_summary', 'weekly_bp_trend', 'appointments']::text[] loop
    begin
      perform private.circle_notify(r.supporter_id, r.organisation_id, 'circle_digest', 'care_circle_digests',
                                    md5(r.id::text || ':' || v_week)::uuid,
                                    case when r.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'routine', r.is_test);
      n := n + 1;
    exception when others then
      begin
        perform private.page_incident(r.organisation_id, 'circle_digest_failed:' || r.id, 'A Care Circle weekly update could not be sent',
          'The weekly update for one Care Circle member (' || r.id || ') failed: ' || sqlerrm);
      exception when others then
        raise warning 'circle digest notice and its incident both failed for %: %', r.id, sqlerrm;
      end;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.send_circle_digests() from public, anon, authenticated;
select cron.schedule('care-circle-digest-weekly', '0 6 * * 1', $$ select private.send_circle_digests(); $$);

-- ---------------------------------------------------------------------------
-- 8. The gentle nudge (a dose with no answer after the grace period), only where the patient said yes
-- ---------------------------------------------------------------------------
create table public.care_circle_missed_dose_alerts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  member_id          uuid not null references public.care_circle_members (id) on delete cascade,
  medication_id      uuid not null references public.medications (id) on delete cascade,
  scheduled_for_date date not null,
  scheduled_time     text not null,
  notified           boolean not null default true,
  sent_at            timestamptz not null default now(),
  unique (member_id, medication_id, scheduled_for_date, scheduled_time)
);
create index care_circle_missed_dose_alerts_member_idx on public.care_circle_missed_dose_alerts (member_id, sent_at desc);
-- no access at all: every read and write is through the functions below
alter table public.care_circle_missed_dose_alerts enable row level security;
revoke all on public.care_circle_missed_dose_alerts from public, anon, authenticated;

-- p_now is for the proof only (a Lagos wall-clock time); the cron job passes nothing.
create function private.sweep_circle_missed_doses(p_now timestamp default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.circle_tools_rules();
  v_now timestamp := coalesce(p_now, now() at time zone 'Africa/Lagos');
  v_today date := v_now::date;
  v_grace integer := (cfg ->> 'missed_dose_grace_minutes')::integer;
  v_win integer := (cfg ->> 'missed_dose_window_minutes')::integer;
  v_cap integer := (cfg ->> 'missed_dose_max_per_day')::integer;
  v_hold integer := 0;
  r record; n integer := 0; v_sent integer; v_notify boolean;
begin
  if not private.module_enabled('care_circle_missed_dose_alert') then return 0; end if;
  -- the patient-first window, when the CMO has switched it on, also holds this nudge back: the circle is not told before the window ends
  if private.module_enabled('care_circle_checkin_window') then v_hold := (private.circle_rules() ->> 'checkin_window_minutes')::integer; end if;
  -- nothing here reads a triage event, a page or an emergency event: a red event reaches supporters at once through
  -- private.notify_circle_red_alert, which this migration does not touch.
  -- The slots come from private.medication_slots_on, exactly as queue_medication_dose_reminders reads them, so start and end dates,
  -- every-n-days, weekdays and tapers are respected, and a malformed schedule has no slots instead of aborting the sweep. A slot that
  -- falls before the schedule took effect (a medicine just added or just edited) is never nudged. The time text is checked before it is
  -- cast, inside a CASE, so a bad string can never abort the sweep outside the per-row handler below.
  for r in
    select s.member_id, s.patient_id, s.supporter_id, s.organisation_id, s.is_test, s.alert_mode, s.medication_id, s.slot_time as schedule_time
      from (
        select m.id as member_id, m.patient_id, m.supporter_id, m.organisation_id, m.is_test, m.alert_mode, med.id as medication_id, sl.slot_time,
               case when sl.slot_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v_today + sl.slot_time::time end as slot_at,
               (greatest(med.created_at, coalesce(med.schedule_effective_from, med.created_at)) at time zone 'Africa/Lagos') as active_from
          from public.care_circle_members m
          join public.profiles sp on sp.id = m.supporter_id and sp.is_active and sp.is_test = m.is_test
          join public.profiles pp on pp.id = m.patient_id and pp.is_active
          join public.medications med on med.patient_id = m.patient_id and med.is_active
          cross join lateral private.medication_slots_on(med.schedule_spec, med.schedule_times, v_today) sl
         where m.state = 'active' and m.expires_at > now() and m.missed_dose_alert and 'adherence_summary' = any (m.permissions)
           and not private.circle_paused(m.patient_id)
      ) s
     where s.slot_at is not null
       and s.slot_at >= s.active_from
       and s.slot_at + make_interval(mins => v_grace + v_hold) <= v_now
       and s.slot_at + make_interval(mins => v_grace + v_hold + v_win) > v_now
       -- any answer at all (taken, late, skipped, missed, not available) means the patient has dealt with the slot
       and not exists (select 1 from public.medication_logs l where l.medication_id = s.medication_id and l.scheduled_for_date = v_today and l.scheduled_time = s.slot_time)
       and not exists (select 1 from public.care_circle_missed_dose_alerts a
                        where a.member_id = s.member_id and a.medication_id = s.medication_id and a.scheduled_for_date = v_today and a.scheduled_time = s.slot_time)
  loop
    begin
      select count(distinct a.scheduled_time) into v_sent from public.care_circle_missed_dose_alerts a
       where a.member_id = r.member_id and a.scheduled_for_date = v_today and a.notified;
      -- one notice per supporter per time slot (two medicines at 08:00 are one nudge), and a daily cap so it never becomes noise
      v_notify := v_sent < v_cap and not exists (select 1 from public.care_circle_missed_dose_alerts a
                   where a.member_id = r.member_id and a.scheduled_for_date = v_today and a.scheduled_time = r.schedule_time and a.notified);
      if v_notify then
        perform private.circle_notify(r.supporter_id, r.organisation_id, 'circle_gentle_nudge', 'care_circle_missed_dose_alerts',
                                      md5(r.member_id::text || ':' || v_today::text || ':' || r.schedule_time)::uuid,
                                      case when r.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'routine', r.is_test);
      end if;
      insert into public.care_circle_missed_dose_alerts (organisation_id, patient_id, member_id, medication_id, scheduled_for_date, scheduled_time, notified)
      values (r.organisation_id, r.patient_id, r.member_id, r.medication_id, v_today, r.schedule_time, v_notify)
      on conflict do nothing;
      if v_notify then n := n + 1; end if;
    exception when others then
      -- one failing row must not stop the others; nothing was recorded, so the next run inside the window tries again
      begin
        perform private.page_incident(r.organisation_id, 'circle_nudge_failed:' || r.member_id, 'A Care Circle nudge could not be sent',
          'A gentle nudge for one Care Circle member (' || r.member_id || ') failed: ' || sqlerrm);
      exception when others then
        raise warning 'circle nudge and its incident both failed for %: %', r.member_id, sqlerrm;
      end;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.sweep_circle_missed_doses(timestamp) from public, anon, authenticated;
select cron.schedule('care-circle-missed-dose-sweep', '*/5 * * * *', $$ select private.sweep_circle_missed_doses(); $$);

-- What the supporter's screen shows after a nudge: the person's first name and nothing else (no medicine, no time, no count).
create function public.circle_recent_nudges() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hours integer := (private.circle_rules() ->> 'alert_visible_hours')::integer;
  r record; out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_missed_dose_alert') then return '[]'::jsonb; end if;
  for r in
    select m.patient_id, coalesce(nullif(split_part(btrim(pp.full_name), ' ', 1), ''), 'Someone') as name, max(a.sent_at) as since
      from public.care_circle_missed_dose_alerts a
      join public.care_circle_members m on m.id = a.member_id
      join public.profiles pp on pp.id = m.patient_id
     where m.supporter_id = v_uid and m.state = 'active' and m.expires_at > now() and m.missed_dose_alert
       and 'adherence_summary' = any (m.permissions) and not private.circle_paused(m.patient_id)
       and a.notified and a.sent_at > now() - make_interval(hours => v_hours)
       -- once the patient has answered the slot (taken, late, skipped, missed or not available) there is nothing left to nudge about
       and not exists (select 1 from public.medication_logs l
                        where l.medication_id = a.medication_id and l.scheduled_for_date = a.scheduled_for_date and l.scheduled_time = a.scheduled_time)
     group by m.patient_id, pp.full_name
     order by max(a.sent_at) desc
  loop
    out := out || jsonb_build_array(jsonb_build_object('patient_id', r.patient_id, 'name', r.name, 'since', r.since));
    perform private.log_care_access(r.patient_id, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('nudge')), v_uid);
  end loop;
  return out;
end $$;
revoke all on function public.circle_recent_nudges() from public, anon;
grant execute on function public.circle_recent_nudges() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The migration is the test
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.decline_care_circle_invite(text)', 'public.cancel_care_circle_invite(uuid)', 'public.my_care_circle()',
                           'public.circle_tools_status()', 'public.set_circle_missed_dose_alert(uuid, boolean)', 'public.post_circle_task(uuid, text, date)',
                           'public.circle_tasks(uuid)', 'public.claim_circle_task(uuid)', 'public.release_circle_task(uuid)',
                           'public.complete_circle_task(uuid)', 'public.cancel_circle_task(uuid)', 'public.circle_weekly_digest(uuid)',
                           'public.circle_recent_nudges()', 'private.sweep_circle_tasks()', 'private.send_circle_digests()',
                           'private.sweep_circle_missed_doses(timestamp)', 'private.circle_task_role(uuid)', 'private.circle_task_notify(public.care_circle_tasks, boolean)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.care_circle_tasks', 'SELECT') or has_table_privilege('anon', 'public.care_circle_missed_dose_alerts', 'SELECT') then
    raise exception 'anon can read the new circle tables';
  end if;
  if has_table_privilege('authenticated', 'public.care_circle_missed_dose_alerts', 'SELECT') then
    raise exception 'care_circle_missed_dose_alerts must have no direct access';
  end if;
  if has_table_privilege('authenticated', 'public.care_circle_tasks', 'INSERT') or has_table_privilege('authenticated', 'public.care_circle_tasks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.care_circle_tasks', 'DELETE') then
    raise exception 'care_circle_tasks must be written only through its functions';
  end if;
  if exists (select 1 from public.platform_modules where key in ('care_circle_digest', 'care_circle_tasks', 'care_circle_missed_dose_alert') and is_enabled) then
    raise exception 'the new Care Circle modules must ship OFF';
  end if;
  -- the red path is read, not replaced: it must not mention the nudge, the window or the new modules
  if pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) ~ 'missed_dose|care_circle_tasks|care_circle_digest' then
    raise exception 'the red-alert path must not depend on the new tools';
  end if;
end $$;
