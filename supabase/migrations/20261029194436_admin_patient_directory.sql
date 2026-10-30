-- Admin patient directory: every patient on the platform with membership, sign-in, activity and time-on-platform facts,
-- reachable from the "Total patients" tile on /admin, with an Excel download.
--
-- Why this does not undo S36a (founder decision OQ-04, INV-10). S36a removed a roster that loaded 5000 patients with date of birth,
-- phone and purchases in ONE read and ONE audit row. This directory is a different shape:
--   * no date of birth (a coarse age band only), no email, no clinical content, phone MASKED (same mask as admin_patient_search);
--   * what it adds is ACTIVITY facts the admin asked for: membership, joined, last sign-in, last activity, visits, time spent, what the
--     patient does most, what they have paid;
--   * every read is audited (action admin.patient_directory_viewed: filters, row counts, never the typed search text), and the Excel
--     export additionally needs a typed reason of 10 to 500 characters, stored in audit_log.reason, written BEFORE any row is returned
--     (same rule as admin_open_patient_record);
--   * admin only (private.is_admin()); institutions still see aggregates only (I9), and anon cannot execute any of it.
-- Contact details and the clinical record stay behind admin_open_patient_record (typed reason) and the clinician ties (INV-12).
--
-- Who counts as a patient matches the "Total patients" tile exactly: profiles.role = 'patient' and not is_test.
--
-- Definitions (also shown on the page, because a number without its definition gets misread):
--   last activity   latest of: app heartbeat (profiles.app_last_active_at), last page view (web_events), last real action
--                   (private.patient_engagement_events)
--   health logging  The engagement source reads vitals, symptoms and medication check-ins, but only their TIMESTAMPS are used, and the three
--                   are collapsed into one generic kind, 'health_log', before anything is counted or returned. The directory therefore never
--                   says WHICH health thing a patient logged (no 'reported a symptom'), only that they logged health information.
--   visit           a run of page views with no gap longer than 30 minutes
--   time spent      sum over visits of (last page view - first page view). An ESTIMATE and a lower bound: a visit with one page view
--                   counts 0, the last page of a visit has unknown dwell time, the mobile app and anyone sending Do-Not-Track write
--                   no page views at all. Nothing is guessed to fill those gaps.
--   active days    distinct Lagos calendar days in the last 30 with a page view, a real action, or (for the most recent one) the app heartbeat,
--                   so a patient who is 'active' only through the heartbeat shows at least one active day
--   purchases       PAID purchases only (active, completed, expired), the same set the paid total adds up
--   active          last activity within 30 days; dormant = older; never = no activity at all
--   audit           a view is audited once per (segment, search length, result count) per 10 minutes, and only for the first page, so
--                   re-sorting and paging through the same result do not fill the log; any other search, filter or result is a new row
--
-- Counts at write time: no data changes, no column added, nothing to convert.
-- ROLLBACK: drop function public.admin_patient_directory(text,text,text,text,integer,integer);
--           drop function public.admin_patient_directory_export(text,text,text,text,text);
--           drop function private.admin_patient_directory_sort_column(text); drop function private.admin_patient_directory_segment_predicate(text);
--           drop function private.admin_patient_directory_rows(text);

create or replace function private.admin_patient_directory_rows(p_search text default null)
returns table (
  patient_id           uuid,
  full_name            text,
  patient_number       text,
  phone_masked         text,
  city                 text,
  state                text,
  age_band             text,
  sex                  text,
  account_type         text,
  is_active            boolean,
  joined_at            timestamptz,
  onboarded_at         timestamptz,
  last_login_at        timestamptz,
  login_count          integer,
  last_active_at       timestamptz,
  activity_status      text,
  visits_total         integer,
  visits_30d           integer,
  active_days_30d      integer,
  time_spent_seconds   bigint,
  avg_visit_seconds    integer,
  main_device          text,
  actions_total        integer,
  actions_30d          integer,
  last_action_at       timestamptz,
  top_actions          jsonb,
  top_sections         jsonb,
  plan                 text,
  membership_state     text,
  membership_source    text,
  membership_started_at timestamptz,
  membership_ends_at   timestamptz,
  auto_renew           boolean,
  purchases_count      integer,
  paid_total_kobo      bigint,
  last_purchase_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q    text := btrim(coalesce(p_search, ''));
  v_like text;
begin
  if not private.is_admin() then
    raise exception 'Only the platform admin can read the patient directory' using errcode = '42501';
  end if;
  -- Escape LIKE wildcards so a typed % or _ is a literal character. Name, patient number, city and state only: never phone or email,
  -- so the directory cannot be used to rebuild a masked number or confirm an address (S36a rule).
  v_like := case when v_q = '' then null
                 else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  return query
  with scope as (
    select p.id, p.full_name, p.patient_number, p.phone, p.city, p.state, p.date_of_birth, p.sex, p.is_dependent_account,
           p.is_active, p.created_at, p.onboarding_completed_at, p.app_last_active_at
      from public.profiles p
     where p.role = 'patient'
       and not coalesce(p.is_test, false)
       and (v_like is null
            or p.full_name ilike v_like escape '\'
            or p.patient_number ilike v_like escape '\'
            or p.city ilike v_like escape '\'
            or p.state ilike v_like escape '\')
  ),
  -- Page views, cut into visits at any gap over 30 minutes.
  ev as (
    select w.profile_id, w.occurred_at, w.path, w.device_type,
           case when lag(w.occurred_at) over (partition by w.profile_id order by w.occurred_at) is null
                  or w.occurred_at - lag(w.occurred_at) over (partition by w.profile_id order by w.occurred_at) > interval '30 minutes'
                then 1 else 0 end as starts_visit
      from public.web_events w
      join scope s on s.id = w.profile_id
  ),
  numbered as (
    select e.*, sum(e.starts_visit) over (partition by e.profile_id order by e.occurred_at) as visit_no from ev e
  ),
  visit_span as (
    select n.profile_id, n.visit_no, min(n.occurred_at) as first_at, max(n.occurred_at) as last_at
      from numbered n group by n.profile_id, n.visit_no
  ),
  web as (
    select v.profile_id,
           count(*)::integer as visits_total,
           (count(*) filter (where v.first_at >= now() - interval '30 days'))::integer as visits_30d,
           coalesce(sum(extract(epoch from (v.last_at - v.first_at))), 0)::bigint as secs,
           max(v.last_at) as last_seen
      from visit_span v group by v.profile_id
  ),
  device as (
    select n.profile_id, mode() within group (order by n.device_type) as main_device
      from numbered n where n.device_type is not null group by n.profile_id
  ),
  -- "/patient/vitals?x=1" -> "vitals". Public pages and bare "/patient" do not name a section and are left out.
  sections as (
    select x.profile_id, x.section, x.n,
           row_number() over (partition by x.profile_id order by x.n desc, x.section) as rn
      from (
        select n.profile_id, split_part(split_part(n.path, '?', 1), '/', 3) as section, count(*) as n
          from numbered n
         where n.path like '/patient/%' and split_part(split_part(n.path, '?', 1), '/', 3) <> ''
         group by 1, 2
      ) x
  ),
  sections_top as (
    select s.profile_id, jsonb_agg(jsonb_build_object('key', s.section, 'count', s.n) order by s.rn) as top_sections
      from sections s where s.rn <= 3 group by s.profile_id
  ),
  -- Real actions: the same event source the analytics console uses for "engaged".
  act as (
    select e.patient_id,
           case when e.channel in ('vitals', 'symptom', 'medication_adherence') then 'health_log' else e.channel end as channel,
           e.occurred_at
      from private.patient_engagement_events() e
      join scope s on s.id = e.patient_id
  ),
  act_by_kind as (
    select a.patient_id, a.channel, count(*) as n,
           row_number() over (partition by a.patient_id order by count(*) desc, a.channel) as rn
      from act a group by a.patient_id, a.channel
  ),
  act_top as (
    select k.patient_id, jsonb_agg(jsonb_build_object('key', k.channel, 'count', k.n) order by k.rn) as top_actions
      from act_by_kind k where k.rn <= 3 group by k.patient_id
  ),
  act_sum as (
    select a.patient_id, count(*)::integer as actions_total,
           (count(*) filter (where a.occurred_at >= now() - interval '30 days'))::integer as actions_30d,
           max(a.occurred_at) as last_action_at
      from act a group by a.patient_id
  ),
  -- Distinct Lagos calendar days with a page view, a real action or the latest app heartbeat in the last 30 days.
  days as (
    select d.pid, count(distinct d.day)::integer as active_days
      from (
        select n.profile_id as pid, (n.occurred_at at time zone 'Africa/Lagos')::date as day from numbered n
         where n.occurred_at >= now() - interval '30 days'
        union all
        select a.patient_id, (a.occurred_at at time zone 'Africa/Lagos')::date from act a
         where a.occurred_at >= now() - interval '30 days'
        union all
        select sc.id, (sc.app_last_active_at at time zone 'Africa/Lagos')::date from scope sc
         where sc.app_last_active_at >= now() - interval '30 days'
      ) d group by d.pid
  ),
  logins as (
    select k.profile_id, sum(k.sign_in_count)::integer as login_count
      from public.user_known_devices k join scope s on s.id = k.profile_id group by k.profile_id
  ),
  -- The membership that is live now, else the most recent one (so "ended" and "lapsed" are visible, not silently "Free").
  mem as (
    select distinct on (m.patient_id) m.patient_id, m.tier, m.state, m.source, m.starts_at, m.ends_at, m.auto_renew
      from public.patient_memberships m join scope s on s.id = m.patient_id
     where not m.is_test
     order by m.patient_id, (m.state = 'active') desc, m.starts_at desc
  ),
  buys as (
    select b.patient_id,
           (count(*) filter (where b.status in ('active', 'completed', 'expired')))::integer as n,
           coalesce(sum(b.amount_kobo) filter (where b.status in ('active', 'completed', 'expired')), 0)::bigint as paid,
           max(b.at) filter (where b.status in ('active', 'completed', 'expired')) as last_at
      from (
        select sp.patient_id, sp.amount_kobo, sp.status::text as status, coalesce(sp.purchased_at, sp.created_at) as at
          from public.service_purchases sp join scope s on s.id = sp.patient_id
        union all
        select pp.patient_id, pp.price_kobo, pp.status::text, coalesce(pp.purchased_at, pp.created_at)
          from public.programme_purchases pp join scope s on s.id = pp.patient_id
      ) b group by b.patient_id
  )
  select
    s.id,
    s.full_name,
    s.patient_number,
    case when s.phone is null or char_length(s.phone) < 7 then null
         else left(s.phone, 4) || repeat('*', greatest(char_length(s.phone) - 7, 3)) || right(s.phone, 3) end,
    s.city,
    s.state,
    case when s.date_of_birth is null then null
         else case
           when extract(year from age(s.date_of_birth)) < 18 then 'Under 18'
           when extract(year from age(s.date_of_birth)) < 30 then '18-29'
           when extract(year from age(s.date_of_birth)) < 40 then '30-39'
           when extract(year from age(s.date_of_birth)) < 50 then '40-49'
           when extract(year from age(s.date_of_birth)) < 60 then '50-59'
           when extract(year from age(s.date_of_birth)) < 70 then '60-69'
           else '70+' end end,
    s.sex::text,
    case when s.is_dependent_account then 'Dependent' else 'Self' end,
    s.is_active,
    s.created_at,
    s.onboarding_completed_at,
    u.last_sign_in_at,
    coalesce(lg.login_count, 0),
    la.last_active,
    case when la.last_active is null then 'never'
         when la.last_active >= now() - interval '30 days' then 'active'
         else 'dormant' end,
    coalesce(w.visits_total, 0),
    coalesce(w.visits_30d, 0),
    coalesce(dy.active_days, 0),
    coalesce(w.secs, 0),
    case when coalesce(w.visits_total, 0) = 0 then 0 else (w.secs / w.visits_total)::integer end,
    dv.main_device,
    coalesce(asum.actions_total, 0),
    coalesce(asum.actions_30d, 0),
    asum.last_action_at,
    coalesce(atop.top_actions, '[]'::jsonb),
    coalesce(st.top_sections, '[]'::jsonb),
    case when m.state = 'active' then m.tier else 'free' end,
    m.state,
    m.source,
    m.starts_at,
    m.ends_at,
    coalesce(m.auto_renew, false),
    coalesce(b.n, 0),
    coalesce(b.paid, 0),
    b.last_at
  from scope s
  left join auth.users u on u.id = s.id
  left join logins lg on lg.profile_id = s.id
  left join web w on w.profile_id = s.id
  left join device dv on dv.profile_id = s.id
  left join sections_top st on st.profile_id = s.id
  left join act_top atop on atop.patient_id = s.id
  left join act_sum asum on asum.patient_id = s.id
  left join days dy on dy.pid = s.id
  left join mem m on m.patient_id = s.id
  left join buys b on b.patient_id = s.id
  cross join lateral (
    select greatest(s.app_last_active_at, w.last_seen, asum.last_action_at) as last_active
  ) la;
end;
$$;

comment on function private.admin_patient_directory_rows(text) is
  'Admin patient directory rows (see 20261029194436). Admin only by its own check; callable only through the two public wrappers. '
  'No date of birth, email or clinical data; phone masked; time spent is an estimate from page views.';

-- The two lookups below are the ONLY source of the column name and the filter that get spliced into dynamic SQL. Unknown input returns null
-- and the callers refuse it (22023); nothing the client typed ever reaches the query text.
create or replace function private.admin_patient_directory_sort_column(p_sort text)
returns text language sql immutable set search_path = '' as $$
  select case coalesce(p_sort, 'joined')
    when 'joined' then 'joined_at'
    when 'last_active' then 'last_active_at'
    when 'last_login' then 'last_login_at'
    when 'time_spent' then 'time_spent_seconds'
    when 'visits' then 'visits_total'
    when 'actions' then 'actions_total'
    when 'paid' then 'paid_total_kobo'
    when 'name' then 'full_name'
    else null end
$$;

create or replace function private.admin_patient_directory_segment_predicate(p_segment text)
returns text language sql immutable set search_path = '' as $$
  select case coalesce(p_segment, 'all')
    when 'all' then 'true'
    when 'active' then 'activity_status = ''active'''
    when 'dormant' then 'activity_status = ''dormant'''
    when 'never' then 'activity_status = ''never'''
    when 'members' then 'plan <> ''free'''
    when 'free' then 'plan = ''free'''
    when 'inactive' then 'not is_active'
    when 'new_30d' then 'joined_at >= now() - interval ''30 days'''
    else null end
$$;

-- A page of the directory, filtered, sorted and counted. One audit row per distinct view (see 'audit' above): filters and counts, never the typed text.
create or replace function public.admin_patient_directory(
  p_search  text    default null,
  p_segment text    default 'all',
  p_sort    text    default 'joined',
  p_dir     text    default 'desc',
  p_limit   integer default 25,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment text := coalesce(p_segment, 'all');
  v_col     text;
  v_dir     text := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_where   text;
  v_summary jsonb;
  v_total   integer;
  v_rows    jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only the platform admin can read the patient directory' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_search, ''))) > 80 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  v_where := private.admin_patient_directory_segment_predicate(v_segment);
  if v_where is null then
    raise exception 'Unknown segment' using errcode = '22023';
  end if;
  v_col := private.admin_patient_directory_sort_column(p_sort);
  if v_col is null then
    raise exception 'Unknown sort' using errcode = '22023';
  end if;

  -- One statement, one evaluation of the rows: the summary covers the searched set, the page covers the chosen segment.
  execute format($q$
    with d as materialized (select * from private.admin_patient_directory_rows(%L)),
         f as (select * from d where %s)
    select
      (select jsonb_build_object(
          'total',          count(*),
          'active',         count(*) filter (where activity_status = 'active'),
          'dormant',        count(*) filter (where activity_status = 'dormant'),
          'never',          count(*) filter (where activity_status = 'never'),
          'members',        count(*) filter (where plan <> 'free'),
          'free',           count(*) filter (where plan = 'free'),
          'inactive',       count(*) filter (where not is_active),
          'account_active', count(*) filter (where is_active),
          'new_30d',        count(*) filter (where joined_at >= now() - interval '30 days'),
          'avg_time_spent_seconds', coalesce(avg(time_spent_seconds) filter (where visits_total > 0), 0)::bigint,
          'paid_total_kobo', coalesce(sum(paid_total_kobo), 0)::bigint) from d),
      (select count(*) from f)::integer,
      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
         from (select * from f order by %I %s nulls last, patient_id limit %s offset %s) t)
  $q$, p_search, v_where, v_col, v_dir, v_limit, v_offset)
  into v_summary, v_total, v_rows;

  -- Only the first page of a result is audited, and an identical view (same segment, search length and result count) within 10 minutes
  -- adds nothing: re-sorting or paging through the same people is not a new access. A different search or filter is always a new row.
  if v_offset = 0 and not exists (
    select 1 from public.audit_log a
     where a.actor_id = (select auth.uid()) and a.action = 'admin.patient_directory_viewed'
       and a.created_at > now() - interval '10 minutes'
       and a.event ->> 'segment' = v_segment
       and a.event ->> 'search_length' = char_length(btrim(coalesce(p_search, '')))::text
       and a.event ->> 'matching' = v_total::text
  ) then
    perform private.log_audit(
      'admin.patient_directory_viewed', 'patient_directory', null,
      jsonb_build_object('segment', v_segment, 'search_length', char_length(btrim(coalesce(p_search, ''))),
                         'rows_returned', jsonb_array_length(v_rows), 'matching', v_total));
  end if;

  return jsonb_build_object('summary', v_summary, 'matching', v_total, 'rows', v_rows);
end;
$$;

comment on function public.admin_patient_directory(text, text, text, text, integer, integer) is
  'Admin only. A page of the patient directory with a summary over the searched set. Audited once per distinct first-page view '
  '(filters and counts, never the typed text). No date of birth, email or clinical data; phone masked.';

-- The whole filtered directory for the Excel download, in the order the admin was looking at. Needs a typed reason; the audit row is written before any row is returned.
create or replace function public.admin_patient_directory_export(
  p_reason  text,
  p_search  text default null,
  p_segment text default 'all',
  p_sort    text default 'joined',
  p_dir     text default 'desc'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_segment text := coalesce(p_segment, 'all');
  v_col     text;
  v_dir     text := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_where   text;
  v_rows    jsonb;
  v_count   integer;
  v_cap     constant integer := 20000;
begin
  if not private.is_admin() then
    raise exception 'Only the platform admin can export the patient directory' using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'Write a reason of 10 to 500 characters' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_search, ''))) > 80 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  v_where := private.admin_patient_directory_segment_predicate(v_segment);
  if v_where is null then
    raise exception 'Unknown segment' using errcode = '22023';
  end if;
  v_col := private.admin_patient_directory_sort_column(p_sort);
  if v_col is null then
    raise exception 'Unknown sort' using errcode = '22023';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from private.admin_patient_directory_rows(%L) where %s order by %I %s nulls last, patient_id limit %s) t',
    p_search, v_where, v_col, v_dir, v_cap + 1) into v_rows;
  v_count := jsonb_array_length(v_rows);
  -- Never hand over a file that looks complete but is not: refuse, and write no audit row (the raise rolls this call back).
  if v_count > v_cap then
    raise exception 'More than % patients match; narrow the view and try again', v_cap using errcode = '54000';
  end if;

  -- Written in the same transaction, before the rows leave this function: an export that cannot be logged is not given.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result)
  values (private.current_org_id(), (select auth.uid()), 'admin.patient_directory_exported', 'patient_directory', null,
          jsonb_build_object('segment', v_segment, 'sort', v_col, 'search_length', char_length(btrim(coalesce(p_search, ''))),
                             'rows_exported', v_count),
          v_reason, 'success');

  return jsonb_build_object('rows', v_rows);
end;
$$;

comment on function public.admin_patient_directory_export(text, text, text, text, text) is
  'Admin only. The filtered directory for an Excel file. A reason of 10 to 500 characters is required and stored in audit_log.reason; '
  'the audit row is written before any row is returned. Refuses (54000, nothing logged or returned) when more than 20000 patients match.';

revoke all on function private.admin_patient_directory_rows(text) from public, anon, authenticated;
revoke all on function private.admin_patient_directory_sort_column(text) from public, anon, authenticated;
revoke all on function private.admin_patient_directory_segment_predicate(text) from public, anon, authenticated;
revoke all on function public.admin_patient_directory(text, text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_patient_directory_export(text, text, text, text, text) from public, anon;
grant execute on function public.admin_patient_directory(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_patient_directory_export(text, text, text, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_patient_directory(text,text,text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_patient_directory_export(text,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.admin_patient_directory_rows(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.admin_patient_directory_rows(text)', 'EXECUTE') then
    raise exception 'admin_patient_directory: an ACL landed wider than intended';
  end if;
end $$;
