-- Yearly "still need this person's access?" review of proxy and caregiver access.
--
-- Why: the NHS proxy-access standard (January 2026) is grant, redact, review, revoke. Tarragon already has grant (S04 setup, S42 safeguards), redact
-- (narrow_proxy_access, category-scoped access) and revoke (revoke_proxy_access, end_proxy_access). Review was missing: a grant given once stayed
-- for ever unless the person remembered it. This adds the yearly prompt.
--
-- What:
--   * public.proxy_review_config   versioned PROPOSED values (12 months, repeat every 30 days, at most 4 reminders a cycle). Mirrored as proposed config
--                                  `proxy.annual_review`; a Jest mirror test compares the two.
--   * public.proxy_access_reviews  append-only history: reminder_sent, proxy_told, kept, narrowed, removed. A review cycle starts at the grant or at the
--                                  last keep/narrow, so a grant is due 12 months after whichever is later. Nothing is stored on profile_access.
--   * private.proxy_review_state()  the one place "due" is worked out, shared by the sweep and the two readers.
--   * public.my_proxy_reviews() / public.proxy_review_due_as_proxy() / public.answer_proxy_review()   the person's list, the proxy's calm "a yearly check
--                                  is due" flag (a boolean per person, never an outcome), and the one door for Keep, Narrow, Remove.
--   * private.sweep_proxy_access_reviews() + pg_cron 'proxy-access-review-daily'.
--
-- Rules that matter:
--   * Access is NEVER removed by this job. Not answering only repeats the reminder up to the cap; the item stays on the person's list for ever (an
--     elder must never be locked out of help by silence).
--   * Out of scope: under-18 dependants (guardian access is ended by the hand-over at 18, S42/S47) and accounts that have no login of their own
--     (is_dependent_account), because nobody could answer. Grants past their own expires_at are skipped.
--   * The proxy is told once per cycle, calmly, that a yearly check is due. Narrowing and removal stay silent (decision D5): the proxy flag is a boolean
--     of "due", never what the person chose.
--   * Notices name no person, condition or result (INV-07) and ride the normal notification queue, so quiet hours and discreet mode (S04b-3) apply. The
--     in-app row is always written, so the review never depends on push or email working.
--   * A notice that cannot be queued writes no history row, so the next daily sweep retries it, and the failure is opened as an operations incident.
--
-- Counted first (live, 2026-10-16): profile_access holds 0 rows, 0 older than 12 months, so no review is due on the day this lands and no existing
-- row is converted. Live ledger checked the same day (before 20261016185844_s03b_auth_sms_hold landed on main-dev): the newest live version was 20261016023011, the newest local file at the time, nothing unrecognised.

-- ---------------------------------------------------------------------------
-- 1. Versioned PROPOSED config
-- ---------------------------------------------------------------------------
create table public.proxy_review_config (
  version         integer primary key check (version >= 1),
  interval_months integer not null check (interval_months between 1 and 60),
  repeat_days     integer not null check (repeat_days between 1 and 365),
  max_reminders   integer not null check (max_reminders between 1 and 12),
  proxy_notice_days integer not null default 14 check (proxy_notice_days between 1 and 90),  -- how long the proxy's "yearly check" flag shows, counted from the notice and NOT from the person's answer
  tell_proxy      boolean not null default true,   -- false: the proxy is told nothing at all (no notice, no "due" flag); a safeguarding switch, set by a new version
  status          text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  is_active       boolean not null default false,
  note            text,
  created_at      timestamptz not null default now()
);
create unique index proxy_review_config_one_active on public.proxy_review_config (is_active) where is_active;
alter table public.proxy_review_config enable row level security;
create policy proxy_review_config_read on public.proxy_review_config for select to authenticated using (true);
revoke all on public.proxy_review_config from public, anon, authenticated;
grant select on public.proxy_review_config to authenticated;

insert into public.proxy_review_config (version, interval_months, repeat_days, max_reminders, tell_proxy, proxy_notice_days, status, is_active, note)
values (1, 12, 30, 4, true, 14, 'proposed', true,
        'Build proposal 2026-10-16 (not a signature): review every 12 months from the grant or the last keep; reminders repeat every 30 days, at most 4 in a cycle (the first plus three); access is never removed by silence. tell_proxy = true was asked for in the build brief; the safer value for a coercive household is false, a founder decision before launch (OQ-678).');

-- ---------------------------------------------------------------------------
-- 2. Append-only history
-- ---------------------------------------------------------------------------
create table public.proxy_access_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  grantee_user_id uuid references public.profiles (id) on delete set null,   -- the person's history outlives the proxy's account
  grant_id        uuid,   -- not a foreign key: the grant is deleted by a removal and the history must outlive it
  kind            text not null check (kind in ('reminder_sent', 'proxy_told', 'kept', 'narrowed', 'removed')),
  detail          jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false
);
create index proxy_access_reviews_pair_idx on public.proxy_access_reviews (patient_id, grantee_user_id, created_at desc);
alter table public.proxy_access_reviews enable row level security;
revoke all on public.proxy_access_reviews from public, anon, authenticated;
grant select on public.proxy_access_reviews to authenticated;
-- The person reads their own history. The proxy reads nothing here: D5 (narrowing and removal are silent to them).
create policy proxy_access_reviews_owner_select on public.proxy_access_reviews for select to authenticated
  using (patient_id = (select auth.uid()));

create function private.proxy_access_reviews_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Two cascades from deleting a profile run one trigger level down and are the only changes allowed:
  --   * the proxy's account is erased: their id on the history rows becomes null (nothing else changes), so the person keeps their history;
  --   * the person's own account is erased: their rows go with it (the profile row is already gone when this runs).
  if pg_trigger_depth() > 1 then
    if tg_op = 'UPDATE' and new.grantee_user_id is null
       and (to_jsonb(new) - 'grantee_user_id') = (to_jsonb(old) - 'grantee_user_id') then
      return new;
    end if;
    if tg_op = 'DELETE' and not exists (select 1 from public.profiles p where p.id = old.patient_id) then
      return old;
    end if;
  end if;
  raise exception 'proxy access review history is append only' using errcode = '42501';
end $$;
revoke all on function private.proxy_access_reviews_append_only() from public, anon, authenticated;
create trigger proxy_access_reviews_append_only
  before update or delete on public.proxy_access_reviews
  for each row execute function private.proxy_access_reviews_append_only();

comment on table public.proxy_access_reviews is
  'Yearly proxy-access review history (reminders sent, proxy told, keep, narrow, remove). Append only. Written only by the SECURITY DEFINER sweep and answer_proxy_review. Under-18 dependants are never in scope, so the S04b-1e default guard (deny for a minor) is the right classification and is left in place.';

-- Every patient-keyed table is in the S39d data registry (export, test purge, retention). Default classification as profile_access gets: consent, kept for
-- review. Marked unreviewed: the retention class is for the CMO and the DPO to confirm.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
values ('proxy_access_reviews', 'patient_id', 'consent', 'review', true,
        'Yearly proxy-access review history (reminders, keep, narrow, remove). Default S39d classification like profile_access; awaiting review.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The one place "due" is worked out
-- ---------------------------------------------------------------------------
create function private.proxy_review_state(p_patient uuid default null, p_grantee uuid default null)
returns table (
  grant_id uuid, patient_id uuid, organisation_id uuid, grantee_id uuid,
  cycle_start timestamptz, due_at timestamptz, is_due boolean,
  reminders_in_cycle integer, last_reminder_at timestamptz, proxy_told boolean, last_answer_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  -- A missing config is an error the readers and the screen can see, never an empty list that reads as "nothing to review".
  if not exists (select 1 from public.proxy_review_config c where c.is_active) then
    raise exception 'proxy review: no active proxy_review_config row' using errcode = 'P0001';
  end if;
  return query
  with cfg as (select c.interval_months from public.proxy_review_config c where c.is_active limit 1)
  select pa.id, pa.profile_id, p.organisation_id, pa.grantee_user_id,
         cs.cycle_start,
         cs.cycle_start + make_interval(months => cfg.interval_months),
         now() >= cs.cycle_start + make_interval(months => cfg.interval_months),
         coalesce(rm.n, 0)::integer, rm.last_at, coalesce(rm.told, false), ans.last_answer_at
    from cfg
   cross join public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    join public.profiles g on g.id = pa.grantee_user_id
    left join lateral (
      select max(r.created_at) as last_answer_at
        from public.proxy_access_reviews r
       where r.patient_id = pa.profile_id and r.grantee_user_id = pa.grantee_user_id
         and r.kind in ('kept', 'narrowed') and r.created_at >= pa.created_at) ans on true
   cross join lateral (select greatest(pa.created_at, coalesce(ans.last_answer_at, pa.created_at)) as cycle_start) cs
    left join lateral (
      select count(*) filter (where r.kind = 'reminder_sent') as n,
             max(r.created_at) filter (where r.kind = 'reminder_sent') as last_at,
             bool_or(r.kind = 'proxy_told') as told
        from public.proxy_access_reviews r
       where r.patient_id = pa.profile_id and r.grantee_user_id = pa.grantee_user_id
         and r.created_at > cs.cycle_start) rm on true
   where (p_patient is null or pa.profile_id = p_patient)
     and (p_grantee is null or pa.grantee_user_id = p_grantee)
     and (pa.expires_at is null or pa.expires_at > now())
     and not coalesce(p.is_dependent_account, false)                                              -- a record with no login of its own cannot answer
     and (p.date_of_birth is null or p.date_of_birth <= (current_date - interval '18 years')::date); -- under 18: the hand-over at 18 covers it
end $$;
revoke all on function private.proxy_review_state(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the person sees, and what the proxy sees
-- ---------------------------------------------------------------------------
create function public.my_proxy_reviews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'grant_id', s.grant_id,
             'grantee_id', s.grantee_id,
             'first_name', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1),
             'since', pa.created_at,
             'categories', coalesce((select jsonb_agg(pac.category order by pac.category) from public.profile_access_categories pac where pac.profile_access_id = s.grant_id), '[]'::jsonb),
             'due_at', s.due_at,
             'is_due', s.is_due,
             'days_overdue', case when s.is_due then greatest((current_date - s.due_at::date), 0) else 0 end,
             'last_reviewed_at', s.last_answer_at)
           order by s.due_at)
      from private.proxy_review_state(v_uid, null) s
      join public.profile_access pa on pa.id = s.grant_id
      join public.profiles g on g.id = s.grantee_id
     ), '[]'::jsonb);
end $$;

-- For the proxy: only that a yearly check was announced for someone they help. A boolean per person, never what was chosen (D5).
create function public.proxy_review_due_as_proxy() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.proxy_review_config c where c.is_active) then
    raise exception 'proxy review: no active proxy_review_config row' using errcode = 'P0001';
  end if;
  -- A safeguarding switch: when the active config says the proxy is told nothing, they see nothing.
  if not (select c.tell_proxy from public.proxy_review_config c where c.is_active) then
    return '[]'::jsonb;
  end if;
  -- Shown for a fixed window counted from the notice, NOT while the review is open and NOT until the person answers: a flag that cleared when they
  -- answered would tell a controlling proxy the moment of the answer (D5). Still a boolean per person, never an outcome.
  return coalesce((
    select jsonb_agg(jsonb_build_object('patient_id', x.patient_id))
      from (select distinct r.patient_id
              from public.proxy_access_reviews r
              join public.profile_access pa on pa.profile_id = r.patient_id and pa.grantee_user_id = r.grantee_user_id
             where r.grantee_user_id = v_uid and r.kind = 'proxy_told'
               and r.created_at > now() - make_interval(days => (select c.proxy_notice_days from public.proxy_review_config c where c.is_active))) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Keep, narrow or remove: one door, composed from the existing controls
-- ---------------------------------------------------------------------------
-- Records a narrowing or removal that has ALREADY happened. Best effort by design: the action must never be undone by bookkeeping. A failure is
-- never silent, though: it is a warning in the log and an operations incident, because a missing row means the review cycle did not restart.
create function private.record_proxy_review_answer(
  p_org uuid, p_patient uuid, p_grantee uuid, p_grant uuid, p_kind text, p_detail jsonb, p_test boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, grant_id, kind, detail, is_test)
    values (p_org, p_patient, p_grantee, p_grant, p_kind, coalesce(p_detail, '{}'::jsonb), p_test);
  exception when others then
    raise warning 'proxy review: % done but its history was not written for grant %: %', p_kind, p_grant, sqlerrm;
    begin
      perform private.open_job_incident('proxy-review:history', 'A yearly access review answer could not be recorded',
        'A narrowing or removal succeeded but its review history row failed to write, so the review cycle did not restart. Last reason: ' || left(sqlerrm, 160));
    exception when others then
      null;   -- the warning above is the fallback; the person''s action already succeeded
    end;
  end;
  -- A failing audit write must not roll the history row back with it: it is reported separately.
  begin
    perform private.log_audit('proxy_access.review_' || p_kind, 'profile', p_patient, jsonb_build_object('grant_id', p_grant) || coalesce(p_detail, '{}'::jsonb));
  exception when others then
    raise warning 'proxy review: % done but its audit row was not written for grant %: %', p_kind, p_grant, sqlerrm;
    begin
      perform private.open_job_incident('proxy-review:audit', 'A yearly access review answer could not be audited',
        'A narrowing or removal succeeded and was recorded, but its audit row failed to write. Last reason: ' || left(sqlerrm, 160));
    exception when others then
      null;
    end;
  end;
end $$;
revoke all on function private.record_proxy_review_answer(uuid, uuid, uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;

create function public.answer_proxy_review(
  p_grantee uuid,
  p_action text,
  p_categories public.care_access_category[] default null,
  p_notify boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_grant public.profile_access%rowtype;
  v_org uuid;
  v_left integer;
  v_test boolean;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('keep', 'narrow', 'remove') then
    raise exception 'choose keep, narrow or remove' using errcode = '22023';
  end if;
  -- Only the person whose record it is. The proxy, a stranger and anon all land here with the same refusal.
  select * into v_grant from public.profile_access where profile_id = v_uid and grantee_user_id = p_grantee;
  if v_grant.id is null then
    raise exception 'no such access' using errcode = 'P0002';
  end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;

  if p_action = 'keep' then
    -- The keep IS the history row (it restarts the cycle), so a failure here must be seen by the person, not swallowed.
    insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, grant_id, kind, is_test)
    values (v_org, v_uid, p_grantee, v_grant.id, 'kept', v_test);
    perform private.log_audit('proxy_access.review_kept', 'profile', v_uid, jsonb_build_object('grant_id', v_grant.id));
    return jsonb_build_object('ok', true, 'action', 'keep');
  elsif p_action = 'narrow' then
    if p_categories is null or cardinality(p_categories) = 0 then
      -- Leaving nothing ticked would keep the grant (and its payment and alert permissions) while the person believes the access is gone.
      raise exception 'keep at least one category, or remove the access' using errcode = '22023';
    end if;
    v_left := public.narrow_proxy_access(p_grantee, p_categories, coalesce(p_notify, false));
    if v_left = 0 then
      -- narrow_proxy_access keeps the INTERSECTION of what the proxy holds and what was passed, so a stale list can still leave nothing. Raising
      -- rolls the narrowing back: a grant with no category but its payment and alert permissions must never look like "removed".
      raise exception 'none of those categories are shared any more; choose again or remove the access' using errcode = '22023';
    end if;
    -- The narrowing has happened. Bookkeeping must never undo it.
    perform private.record_proxy_review_answer(v_org, v_uid, p_grantee, v_grant.id, 'narrowed', jsonb_build_object('categories_left', v_left), v_test);
    return jsonb_build_object('ok', true, 'action', 'narrow', 'categories_left', v_left);
  else
    perform public.revoke_proxy_access(p_grantee);
    -- Ending access is a safety control. A problem writing the history must never stop it.
    perform private.record_proxy_review_answer(v_org, v_uid, p_grantee, v_grant.id, 'removed', '{}'::jsonb, v_test);
    return jsonb_build_object('ok', true, 'action', 'remove');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Templates (INV-07 lint: no person, condition, reading or result named) and the event
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('proxy_review_due', 'administrative', 'routine', 'patient', array['in_app', 'email', 'push']::public.notification_channel[], 'scheduled',
   'Yearly prompt to the person: do the people who help you still need access. Names no one. In-app is always written; push or email are added only when the person''s own channel preference allows.'),
  ('proxy_review_due_proxy', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'scheduled',
   'Calm notice to someone who helps another person: a yearly check is due. Says nothing about the outcome and never that access was narrowed or removed.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('proxy_review_due', 'en', 'in_app', null, 'A yearly check: do the people who help you still need access? Open Tarragon Health on the web to keep, change or remove it'),
  ('proxy_review_due', 'en', 'email', 'A yearly check on who can help you', 'Once a year we ask whether the people who help you still need access. Open Tarragon Health on the web to keep, change or remove it. Nothing changes unless you choose.'),
  ('proxy_review_due', 'en', 'push', null, 'A yearly check is waiting. Open Tarragon Health on the web to review who can help you'),
  ('proxy_review_due_proxy', 'en', 'in_app', null, 'A yearly check is due. The person you help is looking over who can help them. You do not need to do anything')
on conflict (template_key, locale, channel) do nothing;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('proxy.review_due', 'A yearly review of someone''s proxy or caregiver access is due or being repeated (a date and a count only: no grantee, no grant)', 'S04', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('proxy.review_due', 1, array['due_on'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 7. The daily sweep. Never removes access; only queues reminders, within the cap.
-- ---------------------------------------------------------------------------
create function private.sweep_proxy_access_reviews() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg public.proxy_review_config;
  r record;
  v_n integer := 0;
  v_failed integer := 0;
  v_first_error text;
  v_chan public.notification_channel;
  v_test boolean;
  v_people uuid[] := '{}';    -- people already notified in this run: one notice per person per run, however many grants are due. Every due grant still gets its own
                              -- reminder_sent row (the person was told that cycle), so each grant's cap counts the same notices
  v_proxies uuid[] := '{}';
  v_skip_person boolean;
  v_skip_proxy boolean;
begin
  select * into v_cfg from public.proxy_review_config where is_active limit 1;
  if v_cfg.version is null then
    -- Never a silent zero: with no active config nobody is reminded and the screens error.
    perform private.open_job_incident('proxy-review:no-config', 'The yearly access review has no active configuration',
      'proxy_review_config has no active row, so no yearly access review reminder can be queued and the review screen reports an error. No access is removed. Activate a version.');
    return 0;
  end if;

  for r in
    select * from private.proxy_review_state() s
     where s.is_due
       and s.reminders_in_cycle < v_cfg.max_reminders
       and (s.reminders_in_cycle = 0 or s.last_reminder_at + make_interval(days => v_cfg.repeat_days) <= now() + interval '1 hour')   -- an hour of slack: the daily run may start slightly before the previous one did
  loop
    begin
      select coalesce(is_test, false) into v_test from public.profiles where id = r.patient_id;
      v_skip_person := r.patient_id = any (v_people);
      v_skip_proxy := r.grantee_id = any (v_proxies);
      if not v_skip_person then
        -- the guaranteed notice, in the app
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
        values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'proxy_review_due', '{}'::jsonb, 'non_clinical', 'profile_access', r.grant_id);
        -- and the person's own channel as well, when it is not the app (quiet hours and discreet mode are applied by the sender)
        v_chan := private.patient_reminder_channel(r.patient_id);
        if v_chan <> 'in_app' and not v_test then   -- test accounts never get real email or push (same rule as the daily nudge)
          insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
          values (r.organisation_id, r.patient_id, v_chan, 'pending', 'proxy_review_due', '{}'::jsonb, 'non_clinical', 'profile_access', r.grant_id);
        end if;
        -- The event names the person and a date. It carries no grantee and no grant: who has access to whom stays in the history table the proxy cannot read.
        perform private.emit_domain_event('proxy.review_due', r.organisation_id,
          jsonb_build_object('due_on', r.due_at::date, 'n', r.reminders_in_cycle + 1),
          'proxy.review_due:' || md5(r.grant_id::text || ':' || r.cycle_start::date::text) || ':' || (r.reminders_in_cycle + 1)::text,
          r.patient_id, 'proxy_review', null);
      end if;
      insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, grant_id, kind, detail, is_test)
      values (r.organisation_id, r.patient_id, r.grantee_id, r.grant_id, 'reminder_sent',
              jsonb_build_object('n', r.reminders_in_cycle + 1), v_test);

      -- the proxy is told once per cycle, calmly, and only in the app, and only if the active config says so (a safeguarding switch)
      if v_cfg.tell_proxy and not r.proxy_told then
        if not v_skip_proxy then
          insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
          values (r.organisation_id, r.grantee_id, 'in_app', 'pending', 'proxy_review_due_proxy', '{}'::jsonb, 'non_clinical', 'profile_access', r.grant_id);
        end if;
        insert into public.proxy_access_reviews (organisation_id, patient_id, grantee_user_id, grant_id, kind, is_test)
        values (r.organisation_id, r.patient_id, r.grantee_id, r.grant_id, 'proxy_told', v_test);
      end if;
      -- recorded only now, after everything above succeeded (a plpgsql variable is not rolled back with the failed block)
      v_people := array_append(v_people, r.patient_id);
      if v_cfg.tell_proxy then v_proxies := array_append(v_proxies, r.grantee_id); end if;
      v_n := v_n + 1;
    exception when others then
      -- everything in this block rolled back, so no history row exists and tomorrow's sweep tries again
      v_failed := v_failed + 1;
      v_first_error := coalesce(v_first_error, left(sqlerrm, 160));
      raise warning 'proxy.review_due not queued for grant %: %', r.grant_id, sqlerrm;
    end;
  end loop;

  -- One incident for the run, however many grants failed, and a failure to open it must not abort the sweep or hide the warnings above.
  if v_failed > 0 then
    begin
      perform private.open_job_incident('proxy-review:notices', 'Yearly access review notices cannot be queued',
        v_failed::text || ' due yearly access review notice(s) failed to queue in the last daily sweep. Each is retried on the next sweep and no access is removed. First reason: ' || v_first_error);
    exception when others then
      raise warning 'proxy review: could not open the incident for % failed notices: %', v_failed, sqlerrm;
    end;
  end if;
  return v_n;
end $$;
revoke all on function private.sweep_proxy_access_reviews() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'proxy-access-review-daily') then
    perform cron.unschedule('proxy-access-review-daily');
  end if;
end $$;
select cron.schedule('proxy-access-review-daily', '50 3 * * *', $$ select private.sweep_proxy_access_reviews(); $$);

-- the automations registry (S80) lists every scheduled job
insert into public.automation_jobs (job_name, purpose, schedule, source)
select 'proxy-access-review-daily', 'Queues the yearly "still need this person''s access?" reminders. Never removes access.', '50 3 * * *', 'pg_cron'
 where to_regclass('public.automation_jobs') is not null
on conflict (job_name) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Grants: explicit, because the default ACLs hand EXECUTE out (PUBLIC on public.*, authenticated on private.*)
-- ---------------------------------------------------------------------------
revoke all on function public.my_proxy_reviews() from public, anon;
revoke all on function public.proxy_review_due_as_proxy() from public, anon;
revoke all on function public.answer_proxy_review(uuid, text, public.care_access_category[], boolean) from public, anon;
grant execute on function public.my_proxy_reviews() to authenticated;
grant execute on function public.proxy_review_due_as_proxy() to authenticated;
grant execute on function public.answer_proxy_review(uuid, text, public.care_access_category[], boolean) to authenticated;

-- Proof, not hope.
do $$
declare f text;
begin
  foreach f in array array['public.my_proxy_reviews()', 'public.proxy_review_due_as_proxy()',
                           'public.answer_proxy_review(uuid, text, public.care_access_category[], boolean)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'proxy review: anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'proxy review: authenticated cannot execute %', f; end if;
  end loop;
  foreach f in array array['private.proxy_review_state(uuid, uuid)', 'private.sweep_proxy_access_reviews()',
                           'private.record_proxy_review_answer(uuid, uuid, uuid, uuid, text, jsonb, boolean)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'proxy review: % is callable by an API role', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.proxy_access_reviews', 'SELECT') or has_table_privilege('anon', 'public.proxy_review_config', 'SELECT') then
    raise exception 'proxy review: anon can read a table';
  end if;
  if has_table_privilege('authenticated', 'public.proxy_access_reviews', 'INSERT, UPDATE, DELETE') then
    raise exception 'proxy review: authenticated can write the history';
  end if;
  if not exists (select 1 from cron.job where jobname = 'proxy-access-review-daily' and active) then
    raise exception 'proxy review: the daily cron entry was not created';
  end if;
  if not exists (select 1 from public.minor_dependant_table_policy where table_name = 'proxy_access_reviews') then
    raise exception 'proxy review: proxy_access_reviews is not classified for under-18 dependants';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'proxy_access_reviews') then
    raise exception 'proxy review: proxy_access_reviews is not in the data registry';
  end if;
  if (select count(*) from public.proxy_review_config where is_active) <> 1 then
    raise exception 'proxy review: exactly one active config row is required';
  end if;
end $$;
