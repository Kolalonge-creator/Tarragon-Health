-- S47f (code review findings 3 and 5). Nothing signed, nothing applied to production. A new migration, because it restates three functions that
-- 20261008023634 (this branch) created: the earlier file is left as it was.
--
-- FINDING 3, the notice. The sweep used to mark a notice SENT first and then try to queue it, and swallowed a failure with a warning, so a failed insert lost the
-- notice for good and access could still end. Now: the notification and its event are written in one sub-transaction; only if both succeed is the day added to
-- notices_sent and the failure counter cleared. If the write fails nothing is marked sent, notice_failures counts it, last_notice_error keeps the reason, the next
-- sweep retries, and after 2 failures in a row an ops incident is opened (private.open_job_incident) and kept up to date. Nothing is swallowed silently.
-- Access NEVER ends until at least one notice has been queued successfully.
--
-- FINDING 5, the auto-end, three changes to the founder's rule (his rule was unconditional; the changes are recorded in the design note and OQ-S47-13):
--   a. SOFT end. A guardian grant is no longer hard-deleted. The grant (with its categories and permissions) is copied to public.profile_access_ended with
--      ended_at, ended_reason and restorable_until (30 days), and the live row is removed. Why a move and not a flag on profile_access: dozens of policies and
--      functions decide access by the EXISTENCE of a profile_access row; a flag would need every one of them changed, and one missed would keep a guardian reading.
--      Nothing is lost: restore_ended_guardian_access puts a grant back (view only, never manage), by the young person, within 30 days.
--   b. Related access ends with it: the categories travel with the archived grant, and Care Circle supporter rows for the same people are revoked in the same step.
--   c. If the young person never activated their own login (the record is still a dependant), access does NOT end. It is extended ONCE by 30 days, an ops incident
--      is opened, and the founder decides what should happen to such records (OQ-S47-13). After the single extension it is still not ended automatically.
--
-- Counted first: public.dependant_handovers is created by S42 (not applied to production), so 0 live rows; nothing to convert.

alter table public.dependant_handovers
  add column notice_failures integer not null default 0 check (notice_failures >= 0),
  add column last_notice_error text,
  add column extended_once boolean not null default false,
  add column restorable_until timestamptz;

create table public.profile_access_ended (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  handover_id       uuid references public.dependant_handovers (id) on delete set null,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  grantee_user_id   uuid not null references public.profiles (id) on delete cascade,
  permission_level  public.profile_access_level not null,
  granted_by        uuid,
  original_created_at timestamptz not null,
  clinical_access   boolean not null default false,
  permissions       public.caregiver_permission[],
  expires_at        timestamptz,
  categories        public.care_access_category[] not null default '{}',
  ended_at          timestamptz not null default now(),
  ended_reason      text not null check (ended_reason in ('handover_grace_elapsed')),
  restorable_until  timestamptz not null,
  restored_at       timestamptz,
  is_test           boolean not null default false
);
create index profile_access_ended_profile_idx on public.profile_access_ended (profile_id, ended_at desc);
alter table public.profile_access_ended enable row level security;
-- Only the young person reads the archive of their own record (to restore a guardian). A guardian never sees that their access ended through here.
create policy profile_access_ended_own_read on public.profile_access_ended for select to authenticated using (profile_id = (select auth.uid()));
revoke all on public.profile_access_ended from public, anon, authenticated;
grant select on public.profile_access_ended to authenticated;
comment on table public.profile_access_ended is 'S47f: guardian grants ended by the hand-over grace period, kept for 30 days so the young person can restore one. The live grant row is removed from profile_access (access is decided by its existence).';

create or replace function private.expire_dependant_handover(p_handover uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare h public.dependant_handovers%rowtype; v_ended integer; v_org uuid; v_test boolean; g record; v_cats public.care_access_category[]; v_ids uuid[] := '{}';
begin
  select * into h from public.dependant_handovers where id = p_handover for update;
  if not found or h.state <> 'due' then return false; end if;
  -- never before a notice has actually been queued
  if cardinality(h.notices_sent) = 0 then return false; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = h.patient_id;
  -- Only the access that existed BEFORE the 18th birthday ends: that is the guardians' era. A person the young person chose to let in themselves stays.
  for g in select * from public.profile_access where profile_id = h.patient_id and created_at < (h.birthday_18::timestamp at time zone 'Africa/Lagos') loop
    select coalesce(array_agg(c.category order by c.category), '{}') into v_cats from public.profile_access_categories c where c.profile_access_id = g.id;
    insert into public.profile_access_ended (organisation_id, handover_id, profile_id, grantee_user_id, permission_level, granted_by, original_created_at, clinical_access, permissions, expires_at,
                                             categories, ended_reason, restorable_until, is_test)
      values (v_org, h.id, g.profile_id, g.grantee_user_id, g.permission_level, g.granted_by, g.created_at, g.clinical_access, g.permissions, g.expires_at,
              v_cats, 'handover_grace_elapsed', now() + interval '30 days', coalesce(v_test, false));
    v_ids := v_ids || g.grantee_user_id;
  end loop;
  delete from public.profile_access where profile_id = h.patient_id and grantee_user_id = any (v_ids);   -- categories cascade; they are in the archive row
  get diagnostics v_ended = row_count;
  -- the same people lose any Care Circle seat on this record in the same step
  update public.care_circle_members set state = 'revoked', revoked_at = now()
   where patient_id = h.patient_id and supporter_id = any (v_ids) and revoked_at is null;
  update public.dependant_handovers set state = 'expired', expired_at = now(), guardians_ended = v_ended, restorable_until = now() + interval '30 days' where id = h.id;
  perform private.emit_domain_event('dependant.handover_expired', v_org, jsonb_build_object('handover_id', h.id, 'guardians_ended', v_ended),
    'dependant.handover_expired:' || h.patient_id::text, h.patient_id, 'dependant_handover', h.id);
  perform private.log_audit('dependant.handover_expired', 'profile', h.patient_id, jsonb_build_object('guardians_ended', v_ended, 'soft', true));
  return true;
end $$;
revoke all on function private.expire_dependant_handover(uuid) from public, anon, authenticated;

-- The young person puts one ended guardian back, within 30 days. View only, never manage; the categories come back with it.
create function public.restore_ended_guardian_access(p_ended uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); e public.profile_access_ended%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'handover_not_authorised' using errcode = '42501'; end if;
  select * into e from public.profile_access_ended where id = p_ended and profile_id = v_uid for update;
  if not found then raise exception 'handover_not_available' using errcode = 'P0002'; end if;
  if e.restored_at is not null then raise exception 'handover_already_restored' using errcode = '23505'; end if;
  if e.restorable_until <= now() then raise exception 'handover_restore_window_closed' using errcode = '23514'; end if;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions, expires_at)
    values (e.profile_id, e.grantee_user_id, 'view', v_uid, e.clinical_access, e.permissions, e.expires_at)
    on conflict (profile_id, grantee_user_id) do nothing returning id into v_id;
  if v_id is not null and cardinality(e.categories) > 0 then
    insert into public.profile_access_categories (profile_access_id, category) select v_id, c from unnest(e.categories) c;
  end if;
  update public.profile_access_ended set restored_at = now() where id = e.id;
  perform private.log_audit('dependant.guardian_access_restored', 'profile', v_uid, jsonb_build_object('categories', cardinality(e.categories)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.restore_ended_guardian_access(uuid) from public, anon;
grant execute on function public.restore_ended_guardian_access(uuid) to authenticated;

create or replace function private.sweep_dependant_handovers() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  r record; v_n integer := 0; v_cfg public.handover_config; v_day integer; v_send integer; v_end date; v_chan public.notification_channel;
  v_sent integer[]; v_fail integer; v_dependant boolean; v_ext boolean;
begin
  v_cfg := private.handover_setting();
  for r in
    select id from public.profiles
     where is_dependent_account and dependent_kind = 'minor_child' and date_of_birth is not null
       and (date_of_birth + interval '18 years')::date <= v_today + 30
  loop
    perform private.ensure_dependant_handover(r.id);
    v_n := v_n + 1;
  end loop;

  if v_cfg.version is null then return v_n; end if;

  for r in
    select h.id, h.patient_id, h.organisation_id, h.birthday_18, h.notices_sent, h.expiry_not_before, h.extended_once, h.notice_failures
      from public.dependant_handovers h
     where h.state = 'due' and v_today >= h.birthday_18
  loop
    update public.profile_access set permission_level = 'view' where profile_id = r.patient_id and permission_level = 'manage';
    update public.dependant_handovers set grace_days = coalesce(grace_days, v_cfg.grace_days) where id = r.id;
    v_end := r.birthday_18 + v_cfg.grace_days;
    -- first seen after the grace has already run out and never noticed: a 30 day notice window, not an end
    if cardinality(r.notices_sent) = 0 and r.expiry_not_before is null and v_today >= v_end then
      update public.dependant_handovers set expiry_not_before = v_today + 30 where id = r.id;
      r.expiry_not_before := v_today + 30;
    end if;
    v_end := greatest(v_end, coalesce(r.expiry_not_before, v_end));

    -- 1. the notice: written first, recorded as sent only if it was written
    v_day := (v_today - r.birthday_18) + 1;   -- day 1 is the 18th birthday
    select max(d) into v_send from unnest(v_cfg.notice_days) d where d <= v_day and not (d = any (r.notices_sent));
    if v_send is not null then
      begin
        v_chan := private.patient_reminder_channel(r.patient_id);
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
        values (r.organisation_id, r.patient_id, v_chan, 'pending', 'dependant_handover_notice',
                jsonb_build_object('handover_id', r.id, 'day', v_send, 'end_date', v_end), 'non_clinical');
        perform private.emit_domain_event('dependant.handover_notice', r.organisation_id, jsonb_build_object('handover_id', r.id, 'day', v_send),
          'dependant.handover_notice:' || r.id::text || ':' || v_send::text, r.patient_id, 'dependant_handover', r.id);
        update public.dependant_handovers
           set notices_sent = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(r.notices_sent || array(select d from unnest(v_cfg.notice_days) d where d <= v_send)) d),
               notice_failures = 0, last_notice_error = null
         where id = r.id;
      exception when others then
        -- nothing is marked sent; count it, keep the reason, retry on the next sweep, and tell operations after the second failure in a row
        update public.dependant_handovers set notice_failures = notice_failures + 1, last_notice_error = left(sqlerrm, 200) where id = r.id returning notice_failures into v_fail;
        raise warning 'dependant.handover_notice not queued (attempt %): %', v_fail, sqlerrm;
        if v_fail >= 2 then
          perform private.open_job_incident('handover-notice:' || r.id::text, 'A hand-over notice cannot be queued',
            'Hand-over ' || r.id::text || ' has failed to queue its notice ' || v_fail::text || ' times in a row. No guardian access ends until a notice has been queued. Reason: ' || left(sqlerrm, 160));
        end if;
      end;
    end if;

    -- 2. the end: only once a notice has been queued, and never for a record that has no login of its own
    select notices_sent, extended_once into v_sent, v_ext from public.dependant_handovers where id = r.id;
    if v_today >= v_end then
      if cardinality(v_sent) = 0 then continue; end if;   -- no notice has gone out: wait, the incident above is the alert
      select is_dependent_account into v_dependant from public.profiles where id = r.patient_id;
      if coalesce(v_dependant, false) then
        if not v_ext then
          update public.dependant_handovers set extended_once = true, expiry_not_before = v_today + 30 where id = r.id;
          perform private.open_job_incident('handover-no-login:' || r.id::text, 'A young person has not activated their own login',
            'Hand-over ' || r.id::text || ': the grace period ended but the young person has no login of their own. Access was extended once by 30 days and is not ended automatically. The founder decides what happens to such records.');
        else
          perform private.open_job_incident('handover-no-login:' || r.id::text, 'A young person still has no login of their own',
            'Hand-over ' || r.id::text || ': still no login after the extension. Guardian access has NOT been ended automatically. Needs a decision.');
        end if;
        continue;
      end if;
      if private.expire_dependant_handover(r.id) then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.sweep_dependant_handovers() from public, anon, authenticated;

create or replace function public.my_handover() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); h public.dependant_handovers%rowtype; v_grace integer; v_today date := (now() at time zone 'Africa/Lagos')::date; v_end date;
begin
  if v_uid is null then raise exception 'handover_not_authorised' using errcode = '42501'; end if;
  select * into h from public.dependant_handovers where patient_id = v_uid;
  if not found then return jsonb_build_object('pending', false); end if;
  v_grace := coalesce(h.grace_days, (private.handover_setting()).grace_days);
  v_end := case when v_grace is null then null else greatest(h.birthday_18 + v_grace, coalesce(h.expiry_not_before, h.birthday_18 + v_grace)) end;
  return jsonb_build_object(
    'pending', h.state = 'due' and v_today >= h.birthday_18,
    'state', h.state, 'birthday_18', h.birthday_18, 'completed_at', h.completed_at, 'expired_at', h.expired_at, 'restorable_until', h.restorable_until,
    'access_ends_on', case when h.state = 'due' then v_end end,
    'days_left', case when h.state = 'due' and v_end is not null then greatest(v_end - v_today, 0) end,
    'guardians', case when h.state = 'due' then coalesce((
        select jsonb_agg(jsonb_build_object('id', pa.grantee_user_id, 'first_name', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1)) order by pa.created_at)
          from public.profile_access pa join public.profiles g on g.id = pa.grantee_user_id
         where pa.profile_id = v_uid), '[]'::jsonb) else '[]'::jsonb end,
    'ended_guardians', case when h.state = 'expired' and h.restorable_until > now() then coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'first_name', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1)) order by e.ended_at)
          from public.profile_access_ended e join public.profiles g on g.id = e.grantee_user_id
         where e.profile_id = v_uid and e.restored_at is null and e.restorable_until > now()), '[]'::jsonb) else '[]'::jsonb end);
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.restore_ended_guardian_access(uuid)', 'EXECUTE') then raise exception 'S47f: anon can restore a grant'; end if;
  if has_table_privilege('authenticated', 'public.profile_access_ended', 'INSERT,UPDATE,DELETE') or has_table_privilege('anon', 'public.profile_access_ended', 'SELECT') then raise exception 'S47f: archive grants are wrong'; end if;
  if has_function_privilege('authenticated', 'private.expire_dependant_handover(uuid)', 'EXECUTE') then raise exception 'S47f: expiry callable by a session'; end if;
end $$;
