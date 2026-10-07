-- S38g: tell a sponsor's own staff that last month's programme figures are ready. Follows S38f (applied) and replaces only
-- private.generate_sponsor_snapshots, adding the notice; nothing else changes.
--
-- WHO. The same people who can read the figures: an active hmo_admin, corporate_admin or ngo_admin whose role matches the type of the sponsor
-- organisation, never a test account. Each gets an email (the address comes from their login) and a push for the phone app if they have one,
-- so they can read it on either, or both.
-- WHEN. Once per person per month, when a month's figure is PUBLISHED (however many programmes the sponsor has). A held-back month sends nothing (there is no figure to read), and a figure that already
-- existed sends nothing again.
-- WHAT. Fixed neutral copy (INV-07): no programme name, number, condition or person. The row carries only the destination address and the figure's month, which the
-- sender uses and never echoes, and the figure's month (which names no one). Nothing depends on the notice: the figure is on the page and in the app either way, a failure to queue the
-- notice never loses the figure, and failures open one incident.

create function private.notify_sponsor_staff_figures(p_sponsor_org uuid, p_snapshot uuid, p_period date) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select p.id, p.organisation_id, u.email
      from public.profiles p
      join public.organisations o on o.id = p.organisation_id
      join auth.users u on u.id = p.id
     where p.organisation_id = p_sponsor_org and p.is_active and not coalesce(p.is_test, false)
       and ((p.role = 'hmo_admin' and o.type::text = 'hmo') or (p.role = 'corporate_admin' and o.type::text = 'corporate') or (p.role = 'ngo_admin' and o.type::text = 'ngo'))
  loop
    -- One notice per person per figure month, however many programmes the sponsor has: the month is kept in the row (it names no one) and anyone
    -- already told about that month, for any programme, is not told again.
    if exists (select 1 from public.notifications x where x.recipient_id = r.id and x.template = 'sponsor_figures_ready' and x.payload ->> 'period' = p_period::text) then
      continue;
    end if;
    if r.email is not null and btrim(r.email) <> '' then
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (r.id, r.organisation_id, 'email', 'sponsor_figures_ready', jsonb_build_object('to_email', r.email, 'period', p_period), 'pending', 'non_clinical', 'routine', 'sponsor_report_snapshots', p_snapshot);
      n := n + 1;
    end if;
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (r.id, r.organisation_id, 'push', 'sponsor_figures_ready', jsonb_build_object('period', p_period), 'pending', 'non_clinical', 'routine', 'sponsor_report_snapshots', p_snapshot);
  end loop;
  return n;
end $$;
revoke all on function private.notify_sponsor_staff_figures(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.generate_sponsor_snapshots(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.report_rule('grace_days') #>> '{}')::integer;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  c record; n integer := 0; v_failed integer := 0; v_last text; v_set uuid[]; v_prev uuid[]; v_diff integer; v_min integer; v_held boolean; v_payload jsonb;
  v_sid uuid; v_notice_failed integer := 0; v_notice_last text;
begin
  -- Only inside a short catch-up window after the grace days. Later than that the live data no longer describes the month that closed, so a
  -- gap is left rather than a figure that is mislabelled; a failing run opens an incident every day it fails.
  if v_today < (v_end + 1 + v_grace) or v_today > (v_end + 1 + v_grace + 7) then return 0; end if;
  for c in
    select sc.id, sc.organisation_id, sc.sponsor_org_id from public.sponsor_cohorts sc
     where not sc.is_test and sc.valid_from <= v_end and sc.valid_to >= v_month
       and sc.created_at < (v_end + 1)::timestamp at time zone 'Africa/Lagos'   -- the programme existed when the month closed
       and not exists (select 1 from public.sponsor_report_snapshots s where s.cohort_id = sc.id and s.period = v_month)
  loop
    begin
      -- Two published months can be subtracted to expose the few people who changed between them. So when the people behind this month's
      -- figure differ from those behind the last published figure by a small number (not none, not enough to hide among), this month is held
      -- back whole; the comparison stays with the last published figure, so the difference builds up until it is large enough to publish.
      v_set := private.sponsor_agreed_members(c.id);
      select member_set into v_prev from public.sponsor_report_snapshots where cohort_id = c.id and not held_back order by period desc limit 1;
      select greatest((private.outcome_rule('min_cell') #>> '{}')::integer, o.min_cohort_size) into v_min from public.organisations o where o.id = c.sponsor_org_id;
      v_diff := case when v_prev is null then 0 else
        (select count(*) from (select unnest(v_set) except select unnest(v_prev)) a)::integer + (select count(*) from (select unnest(v_prev) except select unnest(v_set)) b)::integer end;
      v_held := v_diff between 1 and v_min - 1;
      v_payload := case when v_held
        then jsonb_build_object('held_back', true, 'reason', 'small_change', 'minimum', v_min,
               'limitations', 'This month''s figure is held back because it would differ from the last published one by only a few people, which could reveal them. It will appear once enough has changed.')
        else private.sponsor_report_aggregate(c.id, null, v_end) end;
      v_sid := null;
      insert into public.sponsor_report_snapshots (organisation_id, cohort_id, sponsor_org_id, period, payload, member_set, held_back)
      values (c.organisation_id, c.id, c.sponsor_org_id, v_month, v_payload, v_set, v_held)
      on conflict (cohort_id, period) do nothing
      returning id into v_sid;
      n := n + 1;
      -- The notice is best effort and must never lose the figure just written: its own block, its own incident.
      if v_sid is not null and not v_held then
        begin
          perform private.notify_sponsor_staff_figures(c.sponsor_org_id, v_sid, v_month);
        exception when others then
          v_notice_failed := v_notice_failed + 1; v_notice_last := sqlerrm;
        end;
      end if;
    exception when others then
      v_failed := v_failed + 1; v_last := sqlerrm;
    end;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('sponsor-snapshots-failing', 'Sponsor monthly figures are failing',
      v_failed || ' sponsor figures could not be written on the last run (' || left(v_last, 200) || '). They are retried every day.');
  end if;
  if v_notice_failed > 0 then
    perform private.open_job_incident('sponsor-notices-failing', 'Sponsor figure notices are failing',
      v_notice_failed || ' notices that sponsor figures are ready could not be queued (' || left(v_notice_last, 200) || '). The figures themselves are on the page and in the app.');
  end if;
  return n;
end $$;
revoke all on function private.generate_sponsor_snapshots(timestamptz) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.notify_sponsor_staff_figures(uuid,uuid,date)', 'EXECUTE') or has_function_privilege('anon', 'private.notify_sponsor_staff_figures(uuid,uuid,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.generate_sponsor_snapshots(timestamptz)', 'EXECUTE') then
    raise exception 'S38g: a private helper is callable by users';
  end if;
end $$;
