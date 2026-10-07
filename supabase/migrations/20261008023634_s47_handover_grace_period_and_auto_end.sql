-- S47 (decision 6, chat selection 2026-10-07; NOT a signature): hand-over at 18 gets a 90-day grace period and then ends by itself.
--
-- OLD (S42, migration 20261007231450): at 18 every guardian drops to view-only and STAYS view-only for ever until the young person completes the
-- hand-over; nothing ever ended access for a young person who never chose.
-- NEW: at the 18th birthday the guardian is view-only for a grace period (handover_config.grace_days, PROPOSED 90). The young person gets repeated
-- notices (days 1, 30, 60 and 85, config notice_days) whose text names no condition (INV-07) and which respect quiet hours and discreet mode (they ride
-- the normal notification queue, content_class non_clinical). If the young person completes the hand-over, only the guardians they chose stay, view-only,
-- exactly as before. If they do not choose by the end of the grace period, access of EVERY guardian from before the birthday ENDS automatically (state expired, audited, an event
-- with counts only). The emergency card and the emergency contacts are separate tables and are not touched.
-- Observation, not a decision: the expiry applies even if the young person never activated their own login (the founder's rule is unconditional).
--
-- Counted first (live, 2026-10-07): dependant_handovers does not exist in production yet (S42 is unapplied), so there are no rows to convert.
-- Not applied to production by the author.

create table public.handover_config (
  version      integer primary key check (version >= 1),
  grace_days   integer not null check (grace_days between 1 and 365),
  notice_days  integer[] not null check (cardinality(notice_days) >= 1),
  status       text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  is_active    boolean not null default false,
  note         text,
  created_at   timestamptz not null default now()
);
create unique index handover_config_one_active on public.handover_config (is_active) where is_active;
alter table public.handover_config enable row level security;
create policy handover_config_read on public.handover_config for select to authenticated using (true);
revoke all on public.handover_config from public, anon, authenticated;
grant select on public.handover_config to authenticated;

-- handover-config-begin
insert into public.handover_config (version, grace_days, notice_days, status, is_active, note)
values (1, 90, array[1, 30, 60, 85], 'proposed', true, 'S47 chat selection 2026-10-07 (not a signature): 90 day grace after the 18th birthday; notices on days 1, 30, 60 and 85 (day 1 is the birthday).');
-- handover-config-end

create function private.handover_setting() returns public.handover_config
language sql stable security definer set search_path = ''
as $$ select c from public.handover_config c where c.is_active limit 1 $$;
revoke all on function private.handover_setting() from public, anon, authenticated;

-- the table: a new state, the grace length each row was made under, which notices went out
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dependant_handovers'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) ilike '%state%') loop
    execute format('alter table public.dependant_handovers drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.dependant_handovers
  add column grace_days integer,
  add column notices_sent integer[] not null default '{}',
  add column expired_at timestamptz;
alter table public.dependant_handovers
  add constraint dependant_handovers_state_check check (state in ('due', 'completed', 'expired')),
  add constraint dependant_handovers_closed_check check (
    (state = 'due' and completed_at is null and expired_at is null)
    or (state = 'completed' and completed_at is not null and guardians_ended is not null and consent_text_key is not null)
    or (state = 'expired' and expired_at is not null and guardians_ended is not null));

-- neutral notice (INV-07): names no condition, reading, result or medicine
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values ('dependant_handover_notice', 'operational', 'important', 'patient', array['in_app','push','email']::public.notification_channel[], 'scheduled',
        'A choice about who keeps seeing your record is waiting. Sent on days 1, 30, 60 and 85 after the 18th birthday.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('dependant_handover_notice', 'en', 'in_app', 'A choice is waiting for you', 'You are now 18. Open the app to choose who can keep seeing your record. If you do not choose, access for the people who could see it ends on {{end_date}}.'),
  ('dependant_handover_notice', 'en', 'push', null, 'A choice is waiting for you in the app.'),
  ('dependant_handover_notice', 'en', 'email', 'A choice is waiting for you', 'You are now 18. Open the app to choose who can keep seeing your record. If you do not choose, access for the people who could see it ends on {{end_date}}.')
on conflict (template_key, locale, channel) do nothing;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('dependant.handover_notice', 'A reminder to the young person to choose who keeps access (ids and a day number only)', 'S47', false),
  ('dependant.handover_expired', 'The hand-over grace period ended with no choice and guardian access ended (counts only)', 'S47', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('dependant.handover_notice', 1, array['handover_id']),
  ('dependant.handover_expired', 1, array['handover_id'])
on conflict do nothing;

-- Ends every guardian grant on a hand-over whose grace period has run out. Idempotent: a closed row is left alone.
create function private.expire_dependant_handover(p_handover uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare h public.dependant_handovers%rowtype; v_ended integer; v_org uuid;
begin
  select * into h from public.dependant_handovers where id = p_handover for update;
  if not found or h.state <> 'due' then return false; end if;
  select organisation_id into v_org from public.profiles where id = h.patient_id;
  -- Only the access that existed BEFORE the 18th birthday ends: that is the guardians' era. A person the young person themselves chose to let in during the
  -- grace period (a grant made on or after the birthday) is their own decision and is left alone.
  delete from public.profile_access
   where profile_id = h.patient_id and created_at < (h.birthday_18::timestamp at time zone 'Africa/Lagos');
  get diagnostics v_ended = row_count;
  update public.dependant_handovers set state = 'expired', expired_at = now(), guardians_ended = v_ended where id = h.id;
  perform private.emit_domain_event('dependant.handover_expired', v_org, jsonb_build_object('handover_id', h.id, 'guardians_ended', v_ended),
    'dependant.handover_expired:' || h.patient_id::text, h.patient_id, 'dependant_handover', h.id);
  perform private.log_audit('dependant.handover_expired', 'profile', h.patient_id, jsonb_build_object('guardians_ended', v_ended));
  return true;
end $$;
revoke all on function private.expire_dependant_handover(uuid) from public, anon, authenticated;

-- The daily sweep restated: the S42 behaviour (row + due event within 30 days of the birthday) plus view-only at the birthday, the notices and the expiry.
create or replace function private.sweep_dependant_handovers() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_n integer := 0; v_cfg public.handover_config; v_day integer; v_send integer; v_end date; v_chan public.notification_channel;
begin
  v_cfg := private.handover_setting();
  for r in
    select id from public.profiles
     where is_dependent_account and dependent_kind = 'minor_child' and date_of_birth is not null
       and (date_of_birth + interval '18 years')::date <= current_date + 30
  loop
    perform private.ensure_dependant_handover(r.id);
    v_n := v_n + 1;
  end loop;

  if v_cfg.version is null then return v_n; end if;

  for r in
    select h.id, h.patient_id, h.organisation_id, h.birthday_18, h.notices_sent
      from public.dependant_handovers h
     where h.state = 'due' and current_date >= h.birthday_18
  loop
    -- the guardian is view-only from the birthday, whatever the 03:30 job has or has not yet done
    update public.profile_access set permission_level = 'view' where profile_id = r.patient_id and permission_level = 'manage';
    update public.dependant_handovers set grace_days = coalesce(grace_days, v_cfg.grace_days) where id = r.id;
    v_end := r.birthday_18 + v_cfg.grace_days;
    if current_date >= v_end then
      if private.expire_dependant_handover(r.id) then v_n := v_n + 1; end if;
      continue;
    end if;
    v_day := (current_date - r.birthday_18) + 1;   -- day 1 is the 18th birthday
    select max(d) into v_send from unnest(v_cfg.notice_days) d where d <= v_day and not (d = any (r.notices_sent));
    if v_send is not null then
      -- the latest missed notice goes out once; earlier missed ones are marked sent, not replayed
      update public.dependant_handovers set notices_sent = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(r.notices_sent || array(select d from unnest(v_cfg.notice_days) d where d <= v_send)) d) where id = r.id;
      begin
        v_chan := private.patient_reminder_channel(r.patient_id);
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, v_chan, 'pending', 'dependant_handover_notice',
                jsonb_build_object('handover_id', r.id, 'day', v_send, 'end_date', v_end), 'non_clinical');
        perform private.emit_domain_event('dependant.handover_notice', r.organisation_id, jsonb_build_object('handover_id', r.id, 'day', v_send),
          'dependant.handover_notice:' || r.id::text || ':' || v_send::text, r.patient_id, 'dependant_handover', r.id);
      exception when others then
        raise warning 'dependant.handover_notice not queued: %', sqlerrm;
      end;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.sweep_dependant_handovers() from public, anon, authenticated;

-- What the young person sees, now with the end date and the days left.
create or replace function public.my_handover() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); h public.dependant_handovers%rowtype; v_grace integer;
begin
  if v_uid is null then raise exception 'handover_not_authorised' using errcode = '42501'; end if;
  select * into h from public.dependant_handovers where patient_id = v_uid;
  if not found then return jsonb_build_object('pending', false); end if;
  v_grace := coalesce(h.grace_days, (private.handover_setting()).grace_days);
  return jsonb_build_object(
    'pending', h.state = 'due' and current_date >= h.birthday_18,
    'state', h.state, 'birthday_18', h.birthday_18, 'completed_at', h.completed_at, 'expired_at', h.expired_at,
    'access_ends_on', case when h.state = 'due' and v_grace is not null then h.birthday_18 + v_grace end,
    'days_left', case when h.state = 'due' and v_grace is not null then greatest((h.birthday_18 + v_grace) - current_date, 0) end,
    'guardians', case when h.state = 'due' then coalesce((
        select jsonb_agg(jsonb_build_object('id', pa.grantee_user_id, 'first_name', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1)) order by pa.created_at)
          from public.profile_access pa join public.profiles g on g.id = pa.grantee_user_id
         where pa.profile_id = v_uid), '[]'::jsonb) else '[]'::jsonb end);
end $$;

do $$
begin
  if (select grace_days from public.handover_config where is_active) <> 90 then raise exception 'S47 self-check: grace must start at 90 days'; end if;
  if has_function_privilege('authenticated', 'private.expire_dependant_handover(uuid)', 'EXECUTE') then raise exception 'S47 self-check: expiry callable by a session'; end if;
  if has_function_privilege('authenticated', 'private.sweep_dependant_handovers()', 'EXECUTE') then raise exception 'S47 self-check: sweep callable by a session'; end if;
  if not exists (select 1 from cron.job where jobname = 'dependant-handover-sweep-daily') then raise exception 'S47 self-check: hand-over cron missing'; end if;
end $$;
