-- S38f: a sponsor's own staff can read their programme's group figures, one frozen figure per programme per month (closes OQ-258 and the
-- compare-two-days weakness of OQ-254 for sponsors). Needs S38e (sponsor_cohorts, private.sponsor_report_aggregate).
--
-- WHO. Sponsor staff are the existing institution logins hmo_admin, corporate_admin and ngo_admin (spec I9: aggregate only, never an individual).
-- They are already kept out of every patient table by private.is_org_staff, and that is not touched here. A login counts as sponsor staff only
-- when it is active, its role matches the type of the organisation it belongs to (hmo_admin in an hmo, corporate_admin in a corporate, ngo_admin in
-- an ngo), and it sees only the programmes whose sponsor_org_id is that organisation. No new role, no link table.
--
-- WHAT. Never the live report. A job writes one snapshot per programme for the month that has just closed (from the 3rd, like the patient
-- reports), once, and a snapshot is never changed or deleted. Sponsor staff read snapshots only, so there is no refresh button and no way to
-- run the report twice in a day and subtract. The snapshot is the same aggregate as the admin report (only members who agreed, test accounts
-- never, small groups withheld whole, complementary suppression). Only the latest closed month is ever written, so a snapshot always reflects the
-- consents as they stood when that month closed; older months are not rebuilt later from today's consents.
--
-- Held back: if the people behind a month's figure differ from those behind the last published figure by a small number, the month is published
-- as 'held back' (reason small_change) and the comparison stays with the last published figure. That closes subtracting two months.
--
-- Every read by sponsor staff is written to the audit log. A programme that is not the caller's gets the same refusal as one that does not
-- exist. Sponsor staff never see a member, a count of people below the minimum, a name or a list.

create table public.sponsor_report_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  cohort_id       uuid not null references public.sponsor_cohorts (id) on delete restrict,
  sponsor_org_id  uuid not null references public.organisations (id) on delete restrict,
  period          date not null check (period = date_trunc('month', period)::date),
  payload         jsonb not null,
  -- The people the figure was drawn from, kept only to compare one month with the last published one. Never returned to anyone.
  member_set      uuid[] not null default '{}',
  held_back       boolean not null default false,
  generated_at    timestamptz not null default now(),
  unique (cohort_id, period)
);
alter table public.sponsor_report_snapshots enable row level security;
revoke all on public.sponsor_report_snapshots from public, anon, authenticated;

create function private.sponsor_snapshots_write_once() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'sponsor_report_snapshots_write_once' using errcode = 'P0001'; end $$;
create trigger sponsor_snapshots_write_once before update or delete on public.sponsor_report_snapshots
  for each row execute function private.sponsor_snapshots_write_once();
revoke all on function private.sponsor_snapshots_write_once() from public, anon, authenticated;

-- The sponsor organisation the caller works for, or null when the caller is not sponsor staff.
create function private.sponsor_staff_org() returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.organisation_id
    from public.profiles p join public.organisations o on o.id = p.organisation_id
   where p.id = (select auth.uid()) and p.is_active
     and ((p.role = 'hmo_admin' and o.type::text = 'hmo') or (p.role = 'corporate_admin' and o.type::text = 'corporate') or (p.role = 'ngo_admin' and o.type::text = 'ngo'))
$$;
revoke all on function private.sponsor_staff_org() from public, anon, authenticated;

-- The members a sponsor figure is drawn from: the same test as private.sponsor_report_aggregate (joined, still in, active, not a test account,
-- agreed under the current text and consent still in force). The proof asserts the two agree.
create function private.sponsor_agreed_members(p_cohort uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(pc.patient_id order by pc.patient_id), '{}')
    from public.profile_cohorts pc join public.profiles p on p.id = pc.patient_id
   where pc.cohort_id = p_cohort and pc.left_at is null and not pc.is_test and not coalesce(p.is_test, false) and p.is_active
     and pc.reporting_consent and exists (select 1 from public.consent_versions v where v.id = pc.consent_version_id and v.is_current)
     and private.sponsor_consent_in_force(pc.patient_id)
$$;
revoke all on function private.sponsor_agreed_members(uuid) from public, anon, authenticated;

-- The monthly job: the latest closed month only, from the grace days until a week later, for programmes that existed and were valid in that month.
create function private.generate_sponsor_snapshots(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.report_rule('grace_days') #>> '{}')::integer;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  c record; n integer := 0; v_failed integer := 0; v_last text; v_set uuid[]; v_prev uuid[]; v_diff integer; v_min integer; v_held boolean; v_payload jsonb;
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
      insert into public.sponsor_report_snapshots (organisation_id, cohort_id, sponsor_org_id, period, payload, member_set, held_back)
      values (c.organisation_id, c.id, c.sponsor_org_id, v_month, v_payload, v_set, v_held)
      on conflict (cohort_id, period) do nothing;
      n := n + 1;
    exception when others then
      v_failed := v_failed + 1; v_last := sqlerrm;
    end;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('sponsor-snapshots-failing', 'Sponsor monthly figures are failing',
      v_failed || ' sponsor figures could not be written on the last run (' || left(v_last, 200) || '). They are retried every day.');
  end if;
  return n;
end $$;
revoke all on function private.generate_sponsor_snapshots(timestamptz) from public, anon, authenticated;
select cron.schedule('sponsor-snapshots', '40 2 * * *', $$ select private.generate_sponsor_snapshots(); $$);

-- The caller's programmes (sponsor staff only). The code is shown because the sponsor hands it to the people it covers.
create function public.sponsor_staff_programmes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.staff_listed', 'organisation', v_org, '{}'::jsonb);
  return jsonb_build_object('sponsor', (select name from public.organisations where id = v_org), 'programmes', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', case when c.status = 'active' then c.code end, 'valid_from', c.valid_from, 'valid_to', c.valid_to,
             'status', c.status, 'latest_period', (select max(s.period) from public.sponsor_report_snapshots s where s.cohort_id = c.id)) order by c.created_at desc)
      from public.sponsor_cohorts c where c.sponsor_org_id = v_org and not c.is_test), '[]'::jsonb));
end $$;
revoke all on function public.sponsor_staff_programmes() from public, anon;
grant execute on function public.sponsor_staff_programmes() to authenticated;

-- A programme's frozen monthly figures, newest first (at most 12), as {ok, months}. Audited. Another sponsor's programme and a missing one
-- get the same {ok:false}, and the refusal is itself written to the audit log (it is returned, not raised, so the audit row is kept).
create function public.sponsor_staff_figures(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org(); v_rows jsonb;
begin
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort and sponsor_org_id = v_org and not is_test) then
    perform private.log_audit('sponsor.staff_refused', 'sponsor_cohort', null, jsonb_build_object('asked_for', p_cohort));
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('period', period, 'generated_at', generated_at, 'figures', payload) order by period desc), '[]'::jsonb) into v_rows
    from (select period, generated_at, payload from public.sponsor_report_snapshots where cohort_id = p_cohort order by period desc limit 12) x;
  perform private.log_audit('sponsor.staff_viewed', 'sponsor_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'months', v_rows);
end $$;
revoke all on function public.sponsor_staff_figures(uuid) from public, anon;
grant execute on function public.sponsor_staff_figures(uuid) to authenticated;

-- A file download of one programme's figures by sponsor staff: the access is written first and no file is given if it could not be (the
-- web route calls this before building the file). Same refusal for another sponsor's programme and a missing one.
create function public.log_sponsor_staff_export(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort and sponsor_org_id = v_org and not is_test) then
    perform private.log_audit('sponsor.staff_refused', 'sponsor_cohort', null, jsonb_build_object('asked_for', p_cohort));
    return jsonb_build_object('ok', false);
  end if;
  perform private.log_audit('sponsor.staff_exported', 'sponsor_cohort', p_cohort, jsonb_build_object('format', 'csv'));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.log_sponsor_staff_export(uuid) from public, anon;
grant execute on function public.log_sponsor_staff_export(uuid) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.sponsor_report_snapshots', 'SELECT') or has_table_privilege('anon', 'public.sponsor_report_snapshots', 'SELECT') then
    raise exception 'S38f: sponsor_report_snapshots is readable directly';
  end if;
  if has_function_privilege('anon', 'public.sponsor_staff_figures(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.sponsor_staff_programmes()', 'EXECUTE') or has_function_privilege('anon', 'public.log_sponsor_staff_export(uuid)', 'EXECUTE') then
    raise exception 'S38f: anon can execute a sponsor staff function';
  end if;
  if has_function_privilege('authenticated', 'private.generate_sponsor_snapshots(timestamptz)', 'EXECUTE') or has_function_privilege('authenticated', 'private.sponsor_staff_org()', 'EXECUTE') or has_function_privilege('authenticated', 'private.sponsor_agreed_members(uuid)', 'EXECUTE') then
    raise exception 'S38f: a private helper is callable by users';
  end if;
end $$;
