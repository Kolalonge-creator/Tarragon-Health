-- Honest outcomes dashboard: do Health Points and engagement change clinical outcomes, or do healthier people just engage more?
-- Design: docs/design/OUTCOMES.md. Audience: the founder / super admin and the Chief Medical Officer ONLY (never an employer, sponsor, HMO or insurer).
--
-- WHAT THIS ADDS (nothing existing is changed):
--   * outcomes_dashboard_config      versioned, PROPOSED values, mirrored as `outcomes.dashboard` in the code registry (a Jest test fails on drift).
--   * outcomes_dashboard_reports     one IMMUTABLE aggregate report per organisation and month, written by a monthly pg_cron job (loud on failure)
--                                    or on demand by a super admin / the CMO. Never publishable, internal only (both are CHECK constraints).
--   * private.outcomes_dash_*        the computation. Every figure is built from existing sources and definitions: S38 outcome_snapshots (blood
--                                    pressure control, the same 7-day average against the person's own signed target else 140/90), S75 HbA1c
--                                    snapshots, S08 adherence, the S58 points ledger, and the abnormal-result alerts and escalations.
--   * public.read_outcomes_dashboard / run_outcomes_dashboard_now / log_outcomes_dashboard_export   the only doors, all super admin or CMO.
--
-- THREE PANELS, NEVER BLENDED INTO ONE SCORE:
--   1. engagement (what we reward)      activity, lessons, check-ins, screenings, milestones, points, by month and by joining cohort.
--   2. clinical outcomes (what we want) blood pressure control, change in systolic, HbA1c, adherence, time to first review of an abnormal result,
--                                       escalation outcomes; for people with hypertension or diabetes in the programme.
--   3. comparison with caveats          high versus low engagement, and points earners versus not, with the SAME people's day-0 baseline as the
--                                       pre-period, a difference-in-differences estimate with a confidence interval, sample sizes, and a
--                                       "not enough data yet" state. Engagement used to define the groups EXCLUDES blood pressure readings, because
--                                       a blood pressure reading is how control is measured: counting it would build the answer into the question.
--
-- SAFETY (each one is proven in packages/db/tests/outcomes_dashboard.sql, with sabotage):
--   * Aggregates only. No function here returns a patient id or an individual row; the per-person working sets are private functions with no grant.
--   * The smallest group shown is private.min_cell_floor() (S75a), raised for a comparison by the configured per-group minimum; every group list goes
--     through private.suppress_groups so a withheld group cannot be recovered by subtraction; the monthly cutoff is HELD BACK when the people newly due
--     since the last report are fewer than the floor (private.suppress_difference), so two stored reports cannot be subtracted to expose a small cohort.
--   * Test accounts, dependants and under-18s are excluded everywhere (INV-13). Mental health, reproductive health, sexual health and HIV / hepatitis
--     data are never read: no PHQ-9 / GAD-7 table, no cycle log, and a screening counts only when its catalogue kind is known, is not marked sensitive and matches none of the protected code patterns. Points from rules that
--     can touch those areas (screening, lab, review) are left out of every points figure.
--   * Descriptive only. The report carries `not_a_causal_claim` and no sentence that could be lifted into marketing; the stored document is data, and
--     the wording lives in the i18n catalogue behind a causal-wording test.
--
-- ROWS AFFECTED: none changed; two new tables, one config row, one cron job.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned)
-- ---------------------------------------------------------------------------
create table public.outcomes_dashboard_config (
  version    integer primary key check (version >= 1),
  config     jsonb not null check (jsonb_typeof(config) = 'object'),
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index outcomes_dashboard_config_one_active on public.outcomes_dashboard_config (is_active) where is_active;
alter table public.outcomes_dashboard_config enable row level security;
revoke all on public.outcomes_dashboard_config from public, anon, authenticated;
create policy outcomes_dashboard_config_read on public.outcomes_dashboard_config
  for select to authenticated using (private.is_admin() or private.credential_is_cmo());
grant select on public.outcomes_dashboard_config to authenticated;

-- outcomes-dashboard-config-begin
insert into public.outcomes_dashboard_config (version, config, notes, is_active)
values (1, $json$
{
  "due_days": [90, 180],
  "primary_day": 90,
  "min_age_years": 18,
  "confidence_level": 0.95,
  "founder_unfrozen_view": { "enabled": false },
  "comparison": {
    "min_per_group": 30,
    "high_active_days_per_30": 12,
    "low_active_days_per_30": 4,
    "exclude_blood_pressure_from_engagement": true,
    "exclude_checkins_from_comparison": true,
    "points_rules_included": ["meal_logged", "lpe_task_completed", "lpe_goal_achieved", "challenge_completed", "wellness_class_attended"]
  },
  "engagement": {
    "points_rules_included": ["vitals_logged", "meal_logged", "adherence_checkin_completed", "lpe_task_completed", "lpe_goal_achieved", "challenge_completed", "wellness_class_attended"],
    "milestone_rules": ["lpe_goal_achieved"],
    "vital_types_allowed": ["blood_pressure", "glucose", "pulse", "temperature", "spo2", "respiratory_rate", "peak_flow", "ketones"],
    "screening_excluded_code_patterns": ["cervic", "mammo", "breast", "hpv", "(^|_)pap(_|$)", "psa", "prostat", "ovar", "pregnan", "antenat", "fertil", "contracep", "menstr", "hiv", "hep", "syphil", "(^|_)sti(_|$)", "mental", "phq", "gad", "depress", "anxiet"],
    "protected_topic_patterns": ["cervic", "mammo", "breast", "hpv", "(^|_)pap(_|$)", "psa", "prostat", "ovar", "pregnan", "antenat", "postnat", "maternal", "fertil", "contracep", "menstr", "menopaus", "period", "sexual", "hiv", "hep", "syphil", "(^|_)sti(_|$)", "mental", "phq", "gad", "depress", "anxiet", "mood", "stress", "wellbeing", "trauma", "grief", "suicid", "self.harm"],
    "escalation_alert_types_allowed": ["abnormal_result", "abnormal_monitoring", "deterioration", "medication_safety"],
    "protected_lesson_categories": ["mental_health", "womens_health", "mens_health", "cancer_screening"]
  }
}
$json$::jsonb, 'PROPOSED, not signed by anyone. Mirrors the outcomes.dashboard entry in packages/shared/src/proposed-config. The CMO owns the thresholds.', true);
-- outcomes-dashboard-config-end

create function private.outcomes_dash_cfg() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  select config into v from public.outcomes_dashboard_config where is_active;
  if v is null then raise exception 'no active outcomes_dashboard_config' using errcode = 'P0001'; end if;
  return v;
end $$;
revoke all on function private.outcomes_dash_cfg() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The stored report (immutable, aggregate, never publishable)
-- ---------------------------------------------------------------------------
create table public.outcomes_dashboard_reports (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  period_start    date not null,
  period_end      date not null,
  -- the day the OUTCOME figures are cut at. It equals period_end unless the report was held back (fewer people newly due than the floor).
  data_cutoff     date not null,
  held_back       boolean not null default false,
  config_version  integer not null references public.outcomes_dashboard_config (version) on delete restrict,
  has_data        boolean not null,
  -- the first report with something in it. An empty month is recorded but is never the baseline.
  is_baseline     boolean not null,
  report          jsonb not null,
  -- who asked for it (null for the scheduled job). No foreign key on purpose: the row is immutable, and ON DELETE SET NULL would be an update.
  generated_by    uuid,
  generated_at    timestamptz not null default now(),
  -- NEVER true: an association between engagement and outcomes is not a result to publish. Changing this is a reviewed migration and a founder decision.
  publishable     boolean not null default false check (publishable = false),
  internal_only   boolean not null default true check (internal_only = true),
  unique (organisation_id, period_start),
  check (period_end > period_start),
  check (data_cutoff <= period_end)
);
alter table public.outcomes_dashboard_reports enable row level security;
revoke all on public.outcomes_dashboard_reports from public, anon, authenticated;
-- Defence in depth: no grant is given to a user role at all (every read goes through read_outcomes_dashboard, which is audited), and if one were
-- ever added this policy still limits it to a super admin or the CMO of the same organisation.
create policy outcomes_dashboard_reports_read on public.outcomes_dashboard_reports
  for select to authenticated
  using ((private.is_admin() or private.credential_is_cmo()) and organisation_id = private.caller_org());

create function private.outcomes_dashboard_reports_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'an outcomes dashboard report is a permanent record and cannot be changed or deleted' using errcode = '42501';
end $$;
revoke all on function private.outcomes_dashboard_reports_immutable() from public, anon, authenticated;
create trigger outcomes_dashboard_reports_00_immutable
  before update or delete on public.outcomes_dashboard_reports
  for each row execute function private.outcomes_dashboard_reports_immutable();

-- ---------------------------------------------------------------------------
-- 3. Small statistical helpers (pure)
-- ---------------------------------------------------------------------------
create function private.outcomes_z(p_conf numeric) returns numeric
language plpgsql immutable set search_path = ''
as $$
declare z numeric;
begin
  z := case p_conf when 0.90 then 1.6448536 when 0.95 then 1.9599640 when 0.99 then 2.5758293 else null end;
  if z is null then raise exception 'unsupported confidence level %, use 0.90, 0.95 or 0.99', p_conf using errcode = '22023'; end if;
  return z;
end $$;
revoke all on function private.outcomes_z(numeric) from public, anon, authenticated;

-- mean with a normal-approximation interval; just {n} when there are fewer than two values
create function private.outcomes_mean_ci(p_n bigint, p_mean numeric, p_sd numeric, p_conf numeric) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare z numeric; se numeric;
begin
  if p_n is null or p_n < 2 or p_mean is null or p_sd is null then return jsonb_build_object('n', coalesce(p_n, 0)); end if;
  z := private.outcomes_z(p_conf);
  se := p_sd / sqrt(p_n::numeric);
  return jsonb_build_object('n', p_n, 'mean', round(p_mean, 2), 'sd', round(p_sd, 2), 'low', round(p_mean - z * se, 2), 'high', round(p_mean + z * se, 2));
end $$;
revoke all on function private.outcomes_mean_ci(bigint, numeric, numeric, numeric) from public, anon, authenticated;

-- difference in differences: the change in group 1 minus the change in group 0, each given as the mean of the per-person CHANGE (so the "difference"
-- is already taken inside each group). The standard error combines the two groups' variances; the interval is the normal approximation.
create function private.outcomes_did(p_n1 bigint, p_m1 numeric, p_sd1 numeric, p_n0 bigint, p_m0 numeric, p_sd0 numeric, p_conf numeric) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare z numeric; se numeric; d numeric;
begin
  if p_n1 is null or p_n0 is null or p_n1 < 2 or p_n0 < 2 or p_m1 is null or p_m0 is null or p_sd1 is null or p_sd0 is null then
    return jsonb_build_object('available', false);
  end if;
  z := private.outcomes_z(p_conf);
  d := p_m1 - p_m0;
  se := sqrt(power(p_sd1, 2) / p_n1::numeric + power(p_sd0, 2) / p_n0::numeric);
  return jsonb_build_object('available', true, 'difference', round(d, 3), 'low', round(d - z * se, 3), 'high', round(d + z * se, 3),
                            'interval_includes_zero', (d - z * se) <= 0 and (d + z * se) >= 0);
end $$;
revoke all on function private.outcomes_did(bigint, numeric, numeric, bigint, numeric, numeric, numeric) from public, anon, authenticated;

-- A count of events and the number of different people behind it, withheld when too few people are behind it.
create function private.outcomes_dash_cell(p_count bigint, p_people bigint, p_min integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_reason text := private.suppress_cell(p_people, null, p_min);
begin
  if v_reason is not null then return jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', p_min); end if;
  return jsonb_build_object('suppressed', false, 'count', p_count, 'people', p_people);
end $$;
revoke all on function private.outcomes_dash_cell(bigint, bigint, integer) from public, anon, authenticated;

-- A screening counts only when its kind is known, is not marked sensitive in the screen catalogue (HIV, hepatitis, cervical, breast, prostate,
-- colorectal and the like), and its code matches none of the protected patterns in the config (reproductive, sexual, mental health). A result with no
-- screen type code has no known kind and is left out.
create function private.outcomes_dash_screening_ok(p_code text, p_patterns text[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code is not null and exists (
    select 1 from public.screen_types t
     where t.code = p_code and not t.sensitive
       and not exists (select 1 from unnest(p_patterns) pat where t.code ~* pat))
$$;
revoke all on function private.outcomes_dash_screening_ok(text, text[]) from public, anon, authenticated;

-- A piece of text (a lesson code and title, a badge code) names a protected topic when it matches any configured pattern.
create function private.outcomes_dash_text_protected(p_text text, p_patterns text[]) returns boolean
language sql immutable set search_path = ''
as $$ select exists (select 1 from unnest(p_patterns) pat where coalesce(p_text, '') ~* pat) $$;
revoke all on function private.outcomes_dash_text_protected(text, text[]) from public, anon, authenticated;

-- An escalation counts only when it is tied to an alert of an allowed kind (never a symptom escalation, which can be about anything) and, when that
-- alert came from a screening result, the screening is of an ordinary kind. An escalation with no alert has no known topic and is left out.
create function private.outcomes_dash_escalation_ok(p_alert uuid, p_types text[], p_patterns text[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_alert is not null and exists (
    select 1 from public.clinician_alerts a
     where a.id = p_alert and a.type_code::text = any (p_types)
       and (a.screening_result_id is null or exists (
             select 1 from public.screening_results r where r.id = a.screening_result_id and private.outcomes_dash_screening_ok(r.screen_type_code, p_patterns))))
$$;
revoke all on function private.outcomes_dash_escalation_ok(uuid, text[], text[]) from public, anon, authenticated;

-- Reports are generated in order. A report may not be made for a month before one that already exists: two cumulative reports made out of order
-- could be subtracted to expose a small group that the held-back rule never saw.
create function private.outcomes_dash_order_ok(p_org uuid, p_start date) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from public.outcomes_dashboard_reports r where r.organisation_id = p_org and r.period_start > p_start) $$;
revoke all on function private.outcomes_dash_order_ok(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Per-person working sets (private, no grant: nothing here is ever returned to a caller)
-- ---------------------------------------------------------------------------
-- Adults with an S38 blood pressure snapshot at p_day whose window closed (plus the grace days) by the cutoff, in the programme, real accounts only.
create function private.outcomes_dash_due(p_org uuid, p_day integer, p_cutoff date, p_cfg jsonb)
returns table (patient_id uuid, anchor date, has_htn boolean, has_dm boolean)
language sql stable security definer set search_path = ''
as $$
  select s.patient_id, s.anchor_date,
         exists (select 1 from public.care_plans cp where cp.patient_id = s.patient_id and cp.condition = 'hypertension' and cp.status in ('active', 'completed')),
         exists (select 1 from public.care_plans cp where cp.patient_id = s.patient_id and cp.condition = 'diabetes' and cp.status in ('active', 'completed'))
    from public.outcome_snapshots s
    join public.profiles p on p.id = s.patient_id
   where s.organisation_id = p_org and s.pathway_code = 'bp' and s.day = p_day
     and s.window_end + (private.outcome_rule('grace_days') #>> '{}')::integer <= p_cutoff
     and not s.is_test and not coalesce(p.is_test, false) and not coalesce(p.is_dependent_account, false)
     and p.date_of_birth is not null
     and extract(year from age(s.anchor_date, p.date_of_birth))::integer >= (p_cfg ->> 'min_age_years')::integer
$$;
revoke all on function private.outcomes_dash_due(uuid, integer, date, jsonb) from public, anon, authenticated;

-- The due people with what the comparison needs: the day-0 baseline and the day-p_day status and systolic, adherence, the HbA1c change, the number of
-- active days and the points earned in the exposure window (day 1 to day p_day after joining; blood pressure readings left out of "active" when configured).
create function private.outcomes_dash_people(p_org uuid, p_day integer, p_cutoff date, p_cfg jsonb)
returns table (patient_id uuid, anchor date, has_htn boolean, has_dm boolean, s0 text, s_due text, sys0 numeric, sys_due numeric, adh integer,
               hba1c_change numeric, hba1c_goal text, active_days integer, points_earned integer)
language sql stable security definer set search_path = ''
as $$
  select d.patient_id, d.anchor, d.has_htn, d.has_dm,
         coalesce(b0.bp_status, 'insufficient_data'), bd.bp_status, b0.bp_avg_7d_sys, bd.bp_avg_7d_sys, bd.adherence_pct::integer,
         case when h.change_status = 'measured' then h.change_abs end, h.goal_status,
         coalesce(act.n, 0), coalesce(pts.n, 0)
    from private.outcomes_dash_due(p_org, p_day, p_cutoff, p_cfg) d
    join public.outcome_snapshots bd on bd.patient_id = d.patient_id and bd.pathway_code = 'bp' and bd.day = p_day
    left join public.outcome_snapshots b0 on b0.patient_id = d.patient_id and b0.pathway_code = 'bp' and b0.day = 0
    left join public.outcome_measure_snapshots h on h.patient_id = d.patient_id and h.measure_code = 'hba1c' and h.day = p_day and not h.is_test
    cross join lateral (
      select ((d.anchor + 1)::timestamp at time zone 'Africa/Lagos') as w_from, ((d.anchor + p_day + 1)::timestamp at time zone 'Africa/Lagos') as w_to
    ) w
    left join lateral (
      select count(*)::integer as n from (
        select (v.taken_at at time zone 'Africa/Lagos')::date as day from private.vitals_readings_current v
         where v.patient_id = d.patient_id and v.taken_at >= w.w_from and v.taken_at < w.w_to and v.correction_status is null
           and v.source::text in ('manual', 'device') and v.vital_type::text in (select jsonb_array_elements_text(p_cfg #> '{engagement,vital_types_allowed}'))
           and (not coalesce((p_cfg #>> '{comparison,exclude_blood_pressure_from_engagement}')::boolean, true) or v.vital_type::text <> 'blood_pressure')
        union
        select (n.logged_at at time zone 'Africa/Lagos')::date from public.nutrition_log_entries n
         where n.patient_id = d.patient_id and n.logged_at >= w.w_from and n.logged_at < w.w_to
        union
        select (c.responded_at at time zone 'Africa/Lagos')::date from public.medication_adherence_checkins c
         where c.patient_id = d.patient_id and c.status = 'responded' and c.responded_at >= w.w_from and c.responded_at < w.w_to
           and not coalesce((p_cfg #>> '{comparison,exclude_checkins_from_comparison}')::boolean, true)
        union
        select (e.understood_at at time zone 'Africa/Lagos')::date from public.health_education_progress e
          join public.health_education_content hc on hc.id = e.content_id
         where e.patient_id = d.patient_id and e.status = 'understood' and e.understood_at >= w.w_from and e.understood_at < w.w_to
           and not private.outcomes_dash_text_protected(hc.code || ' ' || hc.title, array(select jsonb_array_elements_text(p_cfg #> '{engagement,protected_topic_patterns}')))
           and hc.category::text <> all (array(select jsonb_array_elements_text(p_cfg #> '{engagement,protected_lesson_categories}')))
      ) days
    ) act on true
    left join lateral (
      select coalesce(sum(l.points), 0)::integer as n from public.wellness_points_ledger l
       where l.patient_id = d.patient_id and l.kind = 'earn' and l.created_at >= w.w_from and l.created_at < w.w_to
         and coalesce(l.rule_code, l.reason) in (select jsonb_array_elements_text(p_cfg #> '{comparison,points_rules_included}'))
    ) pts on true
$$;
revoke all on function private.outcomes_dash_people(uuid, integer, date, jsonb) from public, anon, authenticated;

-- Adults with hypertension or diabetes in the programme (a joined real account with an active or completed care plan for either).
create function private.outcomes_dash_programme(p_org uuid, p_cutoff date, p_cfg jsonb) returns table (patient_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.id
    from public.profiles p
   where p.organisation_id = p_org and p.role = 'patient' and not coalesce(p.is_test, false) and not coalesce(p.is_dependent_account, false)
     and p.date_of_birth is not null
     and extract(year from age(p_cutoff, p.date_of_birth))::integer >= (p_cfg ->> 'min_age_years')::integer
     and private.outcome_anchor(p.id) is not null
     and exists (select 1 from public.care_plans cp where cp.patient_id = p.id and cp.condition in ('hypertension', 'diabetes') and cp.status in ('active', 'completed'))
$$;
revoke all on function private.outcomes_dash_programme(uuid, date, jsonb) from public, anon, authenticated;

-- The comparison groups with their sums: one row per cohort, way of drawing the groups, and group. Used by the comparison panel and by the held-back rule.
create function private.outcomes_dash_cmp_rows(p_org uuid, p_cutoff date, p_cfg jsonb)
returns table (cohort text, cmp_by text, grp text, n_due integer, n_pair integer, c0 integer, c1 integer, m_ctl numeric, sd_ctl numeric, m_sys numeric, sd_sys numeric,
               m_strict numeric, sd_strict numeric, n_hb integer, m_hb numeric, sd_hb numeric)
language sql stable security definer set search_path = ''
as $$
  with params as (select (p_cfg ->> 'primary_day')::integer as day, (p_cfg #>> '{comparison,high_active_days_per_30}')::numeric as hi, (p_cfg #>> '{comparison,low_active_days_per_30}')::numeric as lo),
  base as (
    select p.*, (p.s0 in ('controlled', 'uncontrolled') and p.s_due in ('controlled', 'uncontrolled')) as pair,
           case when p.active_days * 30.0 / pr.day >= pr.hi then 'high' when p.active_days * 30.0 / pr.day <= pr.lo then 'low' else 'middle' end as eng_band,
           case when p.points_earned >= 1 then 'earners' else 'non_earners' end as pts_band
      from private.outcomes_dash_people(p_org, (p_cfg ->> 'primary_day')::integer, p_cutoff, p_cfg) p cross join params pr),
  u as (
    select 'hypertension'::text as cohort, 'engagement'::text as cmp_by, eng_band as grp, * from base where has_htn
    union all select 'hypertension', 'points', pts_band, * from base where has_htn
    union all select 'diabetes', 'engagement', eng_band, * from base where has_dm
    union all select 'diabetes', 'points', pts_band, * from base where has_dm)
  select cohort, cmp_by, grp,
         count(*)::integer, (count(*) filter (where pair))::integer,
         (count(*) filter (where pair and s0 = 'controlled'))::integer, (count(*) filter (where pair and s_due = 'controlled'))::integer,
         avg(case when pair then (s_due = 'controlled')::integer - (s0 = 'controlled')::integer end),
         stddev_samp(case when pair then (s_due = 'controlled')::integer - (s0 = 'controlled')::integer end),
         avg(sys_due - sys0) filter (where pair), stddev_samp(sys_due - sys0) filter (where pair),
         -- the strict case: everyone due counts, and a person with no usable reading at either end is NOT controlled there
         avg((s_due = 'controlled')::integer - (s0 = 'controlled')::integer), stddev_samp((s_due = 'controlled')::integer - (s0 = 'controlled')::integer),
         (count(*) filter (where hba1c_change is not null))::integer, avg(hba1c_change), stddev_samp(hba1c_change)
    from u group by cohort, cmp_by, grp
$$;
revoke all on function private.outcomes_dash_cmp_rows(uuid, date, jsonb) from public, anon, authenticated;

-- EVERY denominator and group size behind a figure the report can show, at a cutoff. Used by the held-back rule (and nothing else): if any of them
-- has moved by a few people since the last report, the whole report is held back.
create function private.outcomes_dash_counts(p_org uuid, p_cutoff date, p_cfg jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb; d integer; h record; r record;
  v_pat text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,screening_excluded_code_patterns}'));
  v_etypes text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,escalation_alert_types_allowed}'));
begin
  for d in select jsonb_array_elements_text(p_cfg -> 'due_days')::integer loop
    select (count(*) filter (where has_htn))::integer as htn_n,
           (count(*) filter (where has_htn and s_due = 'controlled'))::integer as htn_c, (count(*) filter (where has_htn and s_due = 'uncontrolled'))::integer as htn_u,
           (count(*) filter (where has_htn and s_due = 'insufficient_data'))::integer as htn_i,
           (count(*) filter (where has_htn and s0 = 'controlled'))::integer as htn_c0, (count(*) filter (where has_htn and s0 = 'uncontrolled'))::integer as htn_u0,
           (count(*) filter (where has_htn and s0 = 'insufficient_data'))::integer as htn_i0,
           (count(*) filter (where has_htn and s0 in ('controlled', 'uncontrolled') and s_due in ('controlled', 'uncontrolled')))::integer as htn_pair,
           (count(*) filter (where has_htn and adh is not null))::integer as htn_adh,
           (count(*) filter (where has_dm))::integer as dm_n, (count(*) filter (where has_dm and hba1c_change is not null))::integer as dm_chg,
           (count(*) filter (where has_dm and hba1c_goal in ('reached', 'not_reached')))::integer as dm_goal,
           (count(*) filter (where has_dm and hba1c_goal = 'reached'))::integer as dm_reached
      into h from private.outcomes_dash_people(p_org, d, p_cutoff, p_cfg);
    v := v || jsonb_build_object('htn_n_' || d, h.htn_n, 'htn_c_' || d, h.htn_c, 'htn_u_' || d, h.htn_u, 'htn_i_' || d, h.htn_i, 'htn_c0_' || d, h.htn_c0, 'htn_u0_' || d, h.htn_u0,
      'htn_i0_' || d, h.htn_i0, 'htn_pair_' || d, h.htn_pair, 'htn_adh_' || d, h.htn_adh, 'dm_n_' || d, h.dm_n, 'dm_chg_' || d, h.dm_chg, 'dm_goal_' || d, h.dm_goal, 'dm_reached_' || d, h.dm_reached);
  end loop;
  for r in select * from private.outcomes_dash_cmp_rows(p_org, p_cutoff, p_cfg) loop
    v := v || jsonb_build_object('cmp_' || r.cohort || '_' || r.cmp_by || '_' || r.grp || '_due', r.n_due, 'cmp_' || r.cohort || '_' || r.cmp_by || '_' || r.grp || '_pair', r.n_pair,
      'cmp_' || r.cohort || '_' || r.cmp_by || '_' || r.grp || '_c0', r.c0, 'cmp_' || r.cohort || '_' || r.cmp_by || '_' || r.grp || '_c1', r.c1,
      'cmp_' || r.cohort || '_' || r.cmp_by || '_' || r.grp || '_hb', r.n_hb);
  end loop;
  select count(distinct x.patient_id)::integer as people, count(*)::integer as results, (count(*) filter (where x.acked))::integer as reviewed,
         (count(distinct x.patient_id) filter (where x.acked))::integer as reviewed_people
    into r from (
      select x0.id, x0.patient_id, exists (select 1 from public.clinician_alerts a where a.screening_result_id = x0.id and a.acknowledged_at is not null and a.acknowledged_at >= x0.created_at) as acked
        from public.screening_results x0 join private.outcomes_dash_programme(p_org, p_cutoff, p_cfg) g on g.patient_id = x0.patient_id
       where x0.result_status in ('abnormal', 'critical') and (x0.created_at at time zone 'Africa/Lagos')::date <= p_cutoff
         and private.outcomes_dash_screening_ok(x0.screen_type_code, v_pat)) x;
  v := v || jsonb_build_object('review_people', r.people, 'review_results', r.results, 'review_reviewed', r.reviewed, 'review_reviewed_people', r.reviewed_people);
  for r in
    select e.status::text as status, count(distinct e.patient_id)::integer as people
      from public.escalations e join private.outcomes_dash_programme(p_org, p_cutoff, p_cfg) g on g.patient_id = e.patient_id
     where (e.created_at at time zone 'Africa/Lagos')::date <= p_cutoff and private.outcomes_dash_escalation_ok(e.clinician_alert_id, v_etypes, v_pat)
     group by e.status
  loop
    v := v || jsonb_build_object('escalation_' || r.status, r.people);
  end loop;
  return v;
end $$;
revoke all on function private.outcomes_dash_counts(uuid, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Panel 1: engagement (what we reward). One calendar month, by Africa/Lagos days.
-- ---------------------------------------------------------------------------
create function private.outcomes_dash_engagement(p_org uuid, p_month date, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month::timestamp)::date;
  v_end date := (date_trunc('month', p_month::timestamp) + interval '1 month')::date;
  v_from timestamptz := (date_trunc('month', p_month::timestamp)) at time zone 'Africa/Lagos';
  v_to timestamptz := (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Africa/Lagos';
  v_floor integer := private.min_cell_floor();
  v_floor2 integer := private.min_cell_floor(null, 2);
  v_age integer := (p_cfg ->> 'min_age_years')::integer;
  v_pts text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,points_rules_included}'));
  v_mile text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,milestone_rules}'));
  v_pat text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,screening_excluded_code_patterns}'));
  v_topic text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,protected_topic_patterns}'));
  v_lcat text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,protected_lesson_categories}'));
  v_vitals text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,vital_types_allowed}'));
  a record; l record; k record; m record; s record; mm record;
  v_groups jsonb; v_cohorts jsonb;
begin
  drop table if exists pg_temp._od_pop;
  create temp table _od_pop on commit drop as
    select p.id as patient_id from public.profiles p
     where p.organisation_id = p_org and p.role = 'patient' and not coalesce(p.is_test, false) and not coalesce(p.is_dependent_account, false)
       and p.date_of_birth is not null and extract(year from age(v_end, p.date_of_birth))::integer >= v_age;

  drop table if exists pg_temp._od_days;
  create temp table _od_days on commit drop as
    select distinct x.patient_id, x.day from (
      select v.patient_id, (v.taken_at at time zone 'Africa/Lagos')::date as day
        from private.vitals_readings_current v join _od_pop q on q.patient_id = v.patient_id
       where v.taken_at >= v_from and v.taken_at < v_to and v.correction_status is null and v.source::text in ('manual', 'device')
         and v.vital_type::text = any (v_vitals)
      union all
      select n.patient_id, (n.logged_at at time zone 'Africa/Lagos')::date
        from public.nutrition_log_entries n join _od_pop q on q.patient_id = n.patient_id
       where n.logged_at >= v_from and n.logged_at < v_to
      union all
      select c.patient_id, (c.responded_at at time zone 'Africa/Lagos')::date
        from public.medication_adherence_checkins c join _od_pop q on q.patient_id = c.patient_id
       where c.status = 'responded' and c.responded_at >= v_from and c.responded_at < v_to
      union all
      select e.patient_id, (e.understood_at at time zone 'Africa/Lagos')::date
        from public.health_education_progress e join _od_pop q on q.patient_id = e.patient_id join public.health_education_content hc on hc.id = e.content_id
       where e.status = 'understood' and e.understood_at >= v_from and e.understood_at < v_to and not private.outcomes_dash_text_protected(hc.code || ' ' || hc.title, v_topic) and hc.category::text <> all (v_lcat)
    ) x;

  select count(distinct patient_id) as people, count(*) as person_days into a from _od_days;
  select count(*) as n, count(distinct e.patient_id) as people into l
    from public.health_education_progress e join _od_pop q on q.patient_id = e.patient_id join public.health_education_content hc on hc.id = e.content_id
   where e.status = 'understood' and e.understood_at >= v_from and e.understood_at < v_to and not private.outcomes_dash_text_protected(hc.code || ' ' || hc.title, v_topic) and hc.category::text <> all (v_lcat);
  select count(*) as n, count(distinct c.patient_id) as people into k
    from public.medication_adherence_checkins c join _od_pop q on q.patient_id = c.patient_id
   where c.status = 'responded' and c.responded_at >= v_from and c.responded_at < v_to;
  select count(*) as n, count(distinct r.patient_id) as people into s
    from public.screening_results r join _od_pop q on q.patient_id = r.patient_id
   where r.created_at >= v_from and r.created_at < v_to and private.outcomes_dash_screening_ok(r.screen_type_code, v_pat);
  select count(*) as n, count(distinct x.patient_id) as people into m from (
    select g.patient_id from public.wellness_points_ledger g join _od_pop q on q.patient_id = g.patient_id
     where g.kind = 'earn' and g.created_at >= v_from and g.created_at < v_to and coalesce(g.rule_code, g.reason) = any (v_mile)
    union all
    select b.patient_id from public.patient_wellness_badges b join _od_pop q on q.patient_id = b.patient_id join public.wellness_badges wb on wb.id = b.badge_id
     where b.awarded_at >= v_from and b.awarded_at < v_to and not private.outcomes_dash_text_protected(wb.code || ' ' || coalesce(wb.criteria_reason, ''), v_topic)) x;
  select coalesce(sum(g.points), 0) as points, count(distinct g.patient_id) as people into mm
    from public.wellness_points_ledger g join _od_pop q on q.patient_id = g.patient_id
   where g.kind = 'earn' and g.created_at >= v_from and g.created_at < v_to and coalesce(g.rule_code, g.reason) = any (v_pts);

  -- by joining cohort: the month people joined (or "not a member"), only for people who were active this month
  drop table if exists pg_temp._od_coh;
  create temp table _od_coh on commit drop as
    select case when private.outcome_anchor(d.patient_id) is null then 'not_a_member'
                else to_char(date_trunc('month', private.outcome_anchor(d.patient_id)::timestamp), 'YYYY-MM') end as cohort,
           d.patient_id, count(*)::integer as days,
           (select coalesce(sum(g.points), 0)::integer from public.wellness_points_ledger g
             where g.patient_id = d.patient_id and g.kind = 'earn' and g.created_at >= v_from and g.created_at < v_to and coalesce(g.rule_code, g.reason) = any (v_pts)) as points
      from _od_days d group by d.patient_id;
  select coalesce(jsonb_agg(jsonb_build_object('key', cohort, 'n', people, 'days', days, 'points', points) order by cohort), '[]'::jsonb) into v_groups
    from (select cohort, count(*) as people, sum(days) as days, sum(points) as points from _od_coh group by cohort) t;
  select coalesce(jsonb_agg(
           case when (x ->> 'suppressed')::boolean then jsonb_build_object('cohort', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason')
                else jsonb_build_object('cohort', x ->> 'key', 'suppressed', false, 'active_people', (x ->> 'n')::integer,
                       'active_days', (x ->> 'days')::integer, 'mean_active_days', round((x ->> 'days')::numeric / (x ->> 'n')::numeric, 1),
                       'points_issued', (x ->> 'points')::integer) end order by x ->> 'key'), '[]'::jsonb)
    into v_cohorts from jsonb_array_elements(private.suppress_groups(v_groups, v_floor2)) x;

  return jsonb_build_object(
    'month', v_start, 'minimum_cell', v_floor, 'minimum_cell_by_cohort', v_floor2,
    'active_people', private.outcomes_dash_cell(a.people, a.people, v_floor),
    'active_logging_days', case when private.suppress_cell(a.people, null, v_floor) is null
        then jsonb_build_object('suppressed', false, 'person_days', a.person_days, 'people', a.people, 'mean_per_active_person', round(a.person_days::numeric / a.people, 1))
        else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(a.people, null, v_floor), 'minimum', v_floor) end,
    'lessons_completed', private.outcomes_dash_cell(l.n, l.people, v_floor),
    'medicine_checkins_answered', private.outcomes_dash_cell(k.n, k.people, v_floor),
    'screenings_done', private.outcomes_dash_cell(s.n, s.people, v_floor),
    'milestones', private.outcomes_dash_cell(m.n, m.people, v_floor),
    'points_issued', case when private.suppress_cell(mm.people, null, v_floor) is null
        then jsonb_build_object('suppressed', false, 'points', mm.points, 'earners', mm.people)
        else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(mm.people, null, v_floor), 'minimum', v_floor) end,
    'by_cohort', v_cohorts,
    'raw_active_people_nonzero', coalesce(a.people, 0) > 0);  -- removed before storing: whether a held-back cell had anyone behind it is not for the page
end $$;
revoke all on function private.outcomes_dash_engagement(uuid, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Panel 2: clinical outcomes (what we care about), cumulative to the data cutoff
-- ---------------------------------------------------------------------------
create function private.outcomes_dash_outcomes(p_org uuid, p_cutoff date, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_floor integer := private.min_cell_floor();
  v_conf numeric := (p_cfg ->> 'confidence_level')::numeric;
  v_pat text[] := array(select jsonb_array_elements_text(p_cfg #> '{engagement,screening_excluded_code_patterns}'));
  d integer; h record; g record; r record;
  v_due jsonb; v_blk jsonb; v_bp jsonb := '[]'::jsonb; v_dm jsonb := '[]'::jsonb; v_review jsonb; v_esc jsonb; v_groups jsonb;
  v_reason text; v_wl numeric[];
begin
  for d in select jsonb_array_elements_text(p_cfg -> 'due_days')::integer loop
    drop table if exists pg_temp._od_people;
    create temp table _od_people on commit drop as select * from private.outcomes_dash_people(p_org, d, p_cutoff, p_cfg);

    -- hypertension: blood pressure control at this day, with the same people's day-0 status beside it
    select count(*)::integer as n,
           (count(*) filter (where s_due = 'controlled'))::integer as c, (count(*) filter (where s_due = 'uncontrolled'))::integer as u,
           (count(*) filter (where s_due = 'insufficient_data'))::integer as i,
           (count(*) filter (where s0 = 'controlled'))::integer as c0, (count(*) filter (where s0 = 'uncontrolled'))::integer as u0,
           (count(*) filter (where s0 = 'insufficient_data'))::integer as i0,
           (count(*) filter (where s0 in ('controlled', 'uncontrolled') and s_due in ('controlled', 'uncontrolled')))::integer as n_pair,
           avg(sys_due - sys0) filter (where s0 in ('controlled', 'uncontrolled') and s_due in ('controlled', 'uncontrolled')) as m_sys,
           stddev_samp(sys_due - sys0) filter (where s0 in ('controlled', 'uncontrolled') and s_due in ('controlled', 'uncontrolled')) as sd_sys,
           (count(*) filter (where adh is not null))::integer as n_adh, avg(adh) filter (where adh is not null) as m_adh
      into h from _od_people where has_htn;
    v_due := private.outcome_cohort_json(h.n, h.c, h.u, h.i, v_floor);
    v_blk := jsonb_build_object('day', d, 'cohort', 'hypertension', 'due', v_due);
    if not (v_due ->> 'suppressed')::boolean then
      v_wl := private.wilson_interval(h.c, h.n, v_conf);
      v_blk := v_blk || jsonb_build_object(
        'before', private.outcome_cohort_json(h.n, h.c0, h.u0, h.i0, v_floor),
        'strict_rate_interval', jsonb_build_object('low', v_wl[1], 'high', v_wl[2]),
        'measured_rate_interval', case when (v_due ->> 'rate_among_measured_pct') is not null then
            jsonb_build_object('low', (private.wilson_interval(h.c, h.c + h.u, v_conf))[1], 'high', (private.wilson_interval(h.c, h.c + h.u, v_conf))[2]) end,
        'systolic_change', case when private.suppress_cell(h.n_pair, null, v_floor) is null then private.outcomes_mean_ci(h.n_pair, h.m_sys, h.sd_sys, v_conf)
                                else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(h.n_pair, null, v_floor), 'minimum', v_floor) end,
        'adherence', case when private.suppress_cell(h.n_adh, null, v_floor) is null then jsonb_build_object('suppressed', false, 'people', h.n_adh, 'mean_pct', round(h.m_adh, 1))
                          else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(h.n_adh, null, v_floor), 'minimum', v_floor) end);
    end if;
    v_bp := v_bp || jsonb_build_array(v_blk);

    -- diabetes: the change in HbA1c from the person's own baseline, and whether they reached their goal
    select count(*)::integer as n_dm, (count(*) filter (where hba1c_change is not null))::integer as n_chg, avg(hba1c_change) as m_chg, stddev_samp(hba1c_change) as sd_chg,
           (count(*) filter (where hba1c_goal in ('reached', 'not_reached')))::integer as n_goal,
           (count(*) filter (where hba1c_goal = 'reached'))::integer as n_reached,
           (count(*) filter (where hba1c_goal = 'not_reached'))::integer as n_not
      into g from _od_people where has_dm;
    v_reason := private.suppress_cell(g.n_goal, array[g.n_reached, g.n_not]::bigint[], v_floor);
    v_dm := v_dm || jsonb_build_array(jsonb_build_object('day', d, 'cohort', 'diabetes',
      -- survivorship: how many people with diabetes were due, and what share of them have no HbA1c change to show
      'not_measured_pct', case when private.suppress_cell(g.n_dm, array[g.n_chg, g.n_dm - g.n_chg]::bigint[], v_floor) is null then round(100.0 * (g.n_dm - g.n_chg) / g.n_dm, 1) end,
      'hba1c_change', case when private.suppress_cell(g.n_chg, null, v_floor) is null then private.outcomes_mean_ci(g.n_chg, g.m_chg, g.sd_chg, v_conf)
                           else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(g.n_chg, null, v_floor), 'minimum', v_floor) end,
      'hba1c_goal', case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_floor)
                         else jsonb_build_object('suppressed', false, 'people', g.n_goal, 'reached', g.n_reached, 'reached_pct', round(100.0 * g.n_reached / g.n_goal, 1),
                              'interval', jsonb_build_object('low', (private.wilson_interval(g.n_reached, g.n_goal, v_conf))[1], 'high', (private.wilson_interval(g.n_reached, g.n_goal, v_conf))[2])) end));
  end loop;

  -- time to the first clinician review of an abnormal screening result (the first acknowledgement of the alert raised for it), people in the programme
  select count(distinct t.patient_id)::integer as people, (count(distinct t.patient_id) filter (where t.hrs is not null))::integer as reviewed_people,
         (count(distinct t.patient_id) filter (where t.hrs is null))::integer as waiting_people,
         (count(*) filter (where t.hrs is not null))::integer as reviewed, (count(*) filter (where t.hrs is null))::integer as waiting,
         percentile_cont(0.5) within group (order by t.hrs) filter (where t.hrs is not null) as med_h,
         percentile_cont(0.9) within group (order by t.hrs) filter (where t.hrs is not null) as p90_h
    into r from (
      select x.id, x.patient_id, extract(epoch from (min(a.acknowledged_at) - x.created_at)) / 3600.0 as hrs
        from public.screening_results x
        join private.outcomes_dash_programme(p_org, p_cutoff, p_cfg) pg on pg.patient_id = x.patient_id
        left join public.clinician_alerts a on a.screening_result_id = x.id and a.acknowledged_at is not null and a.acknowledged_at >= x.created_at
       where x.result_status in ('abnormal', 'critical') and (x.created_at at time zone 'Africa/Lagos')::date <= p_cutoff
         and private.outcomes_dash_screening_ok(x.screen_type_code, v_pat)
       group by x.id, x.patient_id, x.created_at) t;
  v_reason := private.suppress_cell(r.people, array[r.reviewed_people, r.waiting_people]::bigint[], v_floor);
  v_review := case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_floor)
    else jsonb_build_object('suppressed', false, 'people', r.people, 'results', r.reviewed + r.waiting, 'reviewed', r.reviewed, 'waiting_for_first_review', r.waiting,
           'median_hours', case when r.reviewed > 0 then round(r.med_h::numeric, 1) end, 'p90_hours', case when r.reviewed > 0 then round(r.p90_h::numeric, 1) end) end;

  -- escalation outcomes: what state each escalation raised for people in the programme has reached (the status only, never the reason or the note)
  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'n', people) order by status), '[]'::jsonb) into v_groups from (
    select e.status::text as status, count(distinct e.patient_id) as people
      from public.escalations e join private.outcomes_dash_programme(p_org, p_cutoff, p_cfg) pg on pg.patient_id = e.patient_id
     where (e.created_at at time zone 'Africa/Lagos')::date <= p_cutoff
       and private.outcomes_dash_escalation_ok(e.clinician_alert_id, array(select jsonb_array_elements_text(p_cfg #> '{engagement,escalation_alert_types_allowed}')), v_pat)
     group by e.status) z;
  select coalesce(jsonb_agg(case when (x ->> 'suppressed')::boolean then jsonb_build_object('status', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason')
                                 else jsonb_build_object('status', x ->> 'key', 'suppressed', false, 'people', (x ->> 'n')::integer) end order by x ->> 'key'), '[]'::jsonb)
    into v_esc from jsonb_array_elements(private.suppress_groups(v_groups, v_floor)) x;

  return jsonb_build_object('data_cutoff', p_cutoff, 'minimum_cell', v_floor, 'hypertension', v_bp, 'diabetes', v_dm,
    'time_to_first_review', v_review, 'escalations', v_esc,
    'not_measured', jsonb_build_array('medicine_refill_completion', 'glucose_time_in_range'));
end $$;
revoke all on function private.outcomes_dash_outcomes(uuid, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Panel 3: comparison with caveats. Groups by engagement and by points; the pre-period is the SAME people's day-0 baseline.
-- ---------------------------------------------------------------------------
create function private.outcomes_dash_comparison(p_org uuid, p_cutoff date, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_day integer := (p_cfg ->> 'primary_day')::integer;
  v_conf numeric := (p_cfg ->> 'confidence_level')::numeric;
  v_thr integer := greatest(private.min_cell_floor(null, 2), (p_cfg #>> '{comparison,min_per_group}')::integer);
  v_coh text; v_cmpby text; v_keys text[]; v_hi_k text; v_lo_k text;
  v_out jsonb := '{}'::jsonb; v_by jsonb; v_groups jsonb; v_shown jsonb; v_both boolean; gh record; gl record;
begin
  drop table if exists pg_temp._od_cmp;
  create temp table _od_cmp on commit drop as select * from private.outcomes_dash_cmp_rows(p_org, p_cutoff, p_cfg);

  foreach v_coh in array array['hypertension', 'diabetes'] loop
    v_by := '{}'::jsonb;
    foreach v_cmpby in array array['engagement', 'points'] loop
      if v_cmpby = 'engagement' then v_keys := array['high', 'middle', 'low']; v_hi_k := 'high'; v_lo_k := 'low';
      else v_keys := array['earners', 'non_earners']; v_hi_k := 'earners'; v_lo_k := 'non_earners'; end if;

      if v_coh = 'hypertension' then
        -- blood pressure control and systolic: a group is the people measured at both ends
        select coalesce(jsonb_agg(jsonb_build_object('key', k.name, 'n', coalesce(t.n_pair, 0)) order by k.name), '[]'::jsonb) into v_groups
          from unnest(v_keys) as k(name) left join _od_cmp t on t.cohort = v_coh and t.cmp_by = v_cmpby and t.grp = k.name;
        select coalesce(jsonb_agg(
                 case when (x ->> 'suppressed')::boolean then jsonb_build_object('group', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason')
                 else (select jsonb_build_object('group', t.grp, 'suppressed', false, 'people_measured_at_both_ends', t.n_pair,
                         'not_measured_at_both_ends_pct', case when private.suppress_cell(t.n_due, array[t.n_pair, t.n_due - t.n_pair]::bigint[], v_thr) is null
                                                              then round(100.0 * (t.n_due - t.n_pair) / t.n_due, 1) end,
                         'controlled_before_pct', round(100.0 * t.c0 / t.n_pair, 1), 'controlled_after_pct', round(100.0 * t.c1 / t.n_pair, 1),
                         'controlled_before_interval', jsonb_build_object('low', (private.wilson_interval(t.c0, t.n_pair, v_conf))[1], 'high', (private.wilson_interval(t.c0, t.n_pair, v_conf))[2]),
                         'controlled_after_interval', jsonb_build_object('low', (private.wilson_interval(t.c1, t.n_pair, v_conf))[1], 'high', (private.wilson_interval(t.c1, t.n_pair, v_conf))[2]),
                         'change_in_controlled_share', private.outcomes_mean_ci(t.n_pair, t.m_ctl, t.sd_ctl, v_conf),
                         'systolic_change', private.outcomes_mean_ci(t.n_pair, t.m_sys, t.sd_sys, v_conf))
                       from _od_cmp t where t.cohort = v_coh and t.cmp_by = v_cmpby and t.grp = x ->> 'key') end order by x ->> 'key'), '[]'::jsonb)
          into v_shown from jsonb_array_elements(private.suppress_groups(v_groups, v_thr)) x;
        select * into gh from _od_cmp where cohort = v_coh and cmp_by = v_cmpby and grp = v_hi_k;
        select * into gl from _od_cmp where cohort = v_coh and cmp_by = v_cmpby and grp = v_lo_k;
        -- the estimate needs BOTH groups to be shown: a withheld group is never half-used
        v_both := gh.grp is not null and gl.grp is not null
                  and not exists (select 1 from jsonb_array_elements(v_shown) x where x ->> 'group' in (v_hi_k, v_lo_k) and (x ->> 'suppressed')::boolean);
        v_by := v_by || jsonb_build_object(v_cmpby, jsonb_build_object(
          'groups', v_shown, 'high_group', v_hi_k, 'low_group', v_lo_k,
          'difference_in_differences', case when v_both then jsonb_build_object(
              'control', private.outcomes_did(gh.n_pair, gh.m_ctl, gh.sd_ctl, gl.n_pair, gl.m_ctl, gl.sd_ctl, v_conf),
              'systolic', private.outcomes_did(gh.n_pair, gh.m_sys, gh.sd_sys, gl.n_pair, gl.m_sys, gl.sd_sys, v_conf),
              -- the worst case beside it: everyone due is counted, and a person with no usable reading is NOT controlled
              'control_strict', private.outcomes_did(gh.n_due, gh.m_strict, gh.sd_strict, gl.n_due, gl.m_strict, gl.sd_strict, v_conf))
            else jsonb_build_object('control', jsonb_build_object('available', false), 'systolic', jsonb_build_object('available', false), 'control_strict', jsonb_build_object('available', false)) end));
      else
        -- diabetes: the HbA1c change per person; a group is the people with a measured change
        select coalesce(jsonb_agg(jsonb_build_object('key', k.name, 'n', coalesce(t.n_hb, 0)) order by k.name), '[]'::jsonb) into v_groups
          from unnest(v_keys) as k(name) left join _od_cmp t on t.cohort = v_coh and t.cmp_by = v_cmpby and t.grp = k.name;
        select coalesce(jsonb_agg(
                 case when (x ->> 'suppressed')::boolean then jsonb_build_object('group', x ->> 'key', 'suppressed', true, 'reason', x ->> 'reason')
                 else (select jsonb_build_object('group', t.grp, 'suppressed', false, 'people_with_hba1c_change', t.n_hb,
                         'not_measured_pct', case when private.suppress_cell(t.n_due, array[t.n_hb, t.n_due - t.n_hb]::bigint[], v_thr) is null then round(100.0 * (t.n_due - t.n_hb) / t.n_due, 1) end,
                         'hba1c_change', private.outcomes_mean_ci(t.n_hb, t.m_hb, t.sd_hb, v_conf))
                       from _od_cmp t where t.cohort = v_coh and t.cmp_by = v_cmpby and t.grp = x ->> 'key') end order by x ->> 'key'), '[]'::jsonb)
          into v_shown from jsonb_array_elements(private.suppress_groups(v_groups, v_thr)) x;
        select * into gh from _od_cmp where cohort = v_coh and cmp_by = v_cmpby and grp = v_hi_k;
        select * into gl from _od_cmp where cohort = v_coh and cmp_by = v_cmpby and grp = v_lo_k;
        v_both := gh.grp is not null and gl.grp is not null
                  and not exists (select 1 from jsonb_array_elements(v_shown) x where x ->> 'group' in (v_hi_k, v_lo_k) and (x ->> 'suppressed')::boolean);
        v_by := v_by || jsonb_build_object(v_cmpby, jsonb_build_object(
          'groups', v_shown, 'high_group', v_hi_k, 'low_group', v_lo_k,
          'difference_in_differences', case when v_both
            then jsonb_build_object('hba1c', private.outcomes_did(gh.n_hb, gh.m_hb, gh.sd_hb, gl.n_hb, gl.m_hb, gl.sd_hb, v_conf))
            else jsonb_build_object('hba1c', jsonb_build_object('available', false)) end));
      end if;
    end loop;
    v_out := v_out || jsonb_build_object(v_coh, v_by);
  end loop;

  return jsonb_build_object('day', v_day, 'minimum_per_group', v_thr, 'confidence_level', v_conf,
    'pre_period', 'day_0_same_people',
    'engagement_excludes_blood_pressure_readings', coalesce((p_cfg #>> '{comparison,exclude_blood_pressure_from_engagement}')::boolean, true),
    'cohorts', v_out, 'association_not_proof', true, 'not_a_causal_claim', true);
end $$;
revoke all on function private.outcomes_dash_comparison(uuid, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The whole report, and storing it
-- ---------------------------------------------------------------------------
create function private.run_outcomes_dashboard(p_org uuid, p_month date, p_by uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month::timestamp)::date;
  v_end date := (date_trunc('month', p_month::timestamp) + interval '1 month')::date;
  v_cutoff date := (date_trunc('month', p_month::timestamp) + interval '1 month' - interval '1 day')::date;
  v_cfgrow public.outcomes_dashboard_config%rowtype;
  v_cfg jsonb;
  v_prev public.outcomes_dashboard_reports%rowtype;
  v_prev_cut date;
  v_cur jsonb; v_old jsonb; v_key text;
  v_held boolean := false;
  v_eng jsonb; v_out jsonb; v_cmp jsonb; v_report jsonb; v_has boolean; v_id uuid;
begin
  select id into v_id from public.outcomes_dashboard_reports where organisation_id = p_org and period_start = v_start;
  if v_id is not null then return v_id; end if;

  if not private.outcomes_dash_order_ok(p_org, v_start) then
    raise exception 'a report for a later month already exists; reports are made in order' using errcode = '22023';
  end if;

  select * into v_cfgrow from public.outcomes_dashboard_config where is_active;
  if not found then raise exception 'no active outcomes_dashboard_config' using errcode = 'P0001'; end if;
  v_cfg := v_cfgrow.config;

  -- The held-back rule: if the people newly standing behind any cumulative figure since the last report are fewer than the floor, the outcome
  -- figures stay cut at the last report's cutoff, so two stored reports can never be subtracted to expose a small group.
  select * into v_prev from public.outcomes_dashboard_reports where organisation_id = p_org and period_start < v_start order by period_start desc limit 1;
  v_prev_cut := coalesce(v_prev.data_cutoff, date '2000-01-01');
  v_cur := private.outcomes_dash_counts(p_org, v_cutoff, v_cfg);
  v_old := private.outcomes_dash_counts(p_org, v_prev_cut, v_cfg);
  -- EVERY denominator and group size counts (private.outcomes_dash_counts). A figure that only grew by a few people is the disclosive case; a figure that
  -- shrank cannot come from newly due people and would otherwise hold the report back for ever, so it does not.
  -- The first report has nothing to be subtracted from: each of its small cells is already withheld on its own merits.
  for v_key in select jsonb_object_keys(v_cur) union select jsonb_object_keys(v_old) loop
    exit when v_prev.id is null;
    if coalesce((v_cur ->> v_key)::bigint, 0) >= coalesce((v_old ->> v_key)::bigint, 0)
       and private.suppress_difference(coalesce((v_cur ->> v_key)::bigint, 0), coalesce((v_old ->> v_key)::bigint, 0)) then
      v_held := true;
    end if;
  end loop;
  if v_held then v_cutoff := v_prev_cut; end if;

  v_eng := private.outcomes_dash_engagement(p_org, v_start, v_cfg);
  v_out := private.outcomes_dash_outcomes(p_org, v_cutoff, v_cfg);
  v_cmp := private.outcomes_dash_comparison(p_org, v_cutoff, v_cfg);
  v_has := (v_eng ->> 'raw_active_people_nonzero')::boolean or exists (select 1 from jsonb_each_text(v_cur) e where e.value::bigint > 0);

  v_report := jsonb_build_object(
    'schema', 1, 'month', v_start,
    'panels', jsonb_build_object('engagement', v_eng - 'raw_active_people_nonzero', 'outcomes', v_out, 'comparison', v_cmp),
    'scope', jsonb_build_object('adults_only', true, 'test_accounts_excluded', true, 'dependants_excluded', true,
             'protected_categories_excluded', jsonb_build_array('mental_health', 'reproductive_health', 'sexual_health', 'hiv_hepatitis')),
    'held_back', v_held, 'not_a_causal_claim', true, 'internal_only', true);

  insert into public.outcomes_dashboard_reports
    (organisation_id, period_start, period_end, data_cutoff, held_back, config_version, has_data, is_baseline, report, generated_by)
  values
    (p_org, v_start, v_end, v_cutoff, v_held, v_cfgrow.version, v_has,
     v_has and not exists (select 1 from public.outcomes_dashboard_reports x where x.organisation_id = p_org and x.is_baseline),
     v_report, p_by)
  on conflict (organisation_id, period_start) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.outcomes_dashboard_reports where organisation_id = p_org and period_start = v_start;
  end if;
  return v_id;
end $$;
revoke all on function private.run_outcomes_dashboard(uuid, date, uuid) from public, anon, authenticated;

-- The scheduled job: the previous Lagos month, every organisation that has anything to report. A failure is never only a log line.
create function private.run_outcomes_dashboard_monthly() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  r record; v_n integer := 0; v_failed integer := 0; v_last text;
begin
  for r in
    select o.id as organisation_id from public.organisations o
     where exists (select 1 from public.outcome_snapshots s where s.organisation_id = o.id and not s.is_test)
        or exists (select 1 from public.wellness_points_ledger l join public.profiles p on p.id = l.patient_id
                    where l.organisation_id = o.id and not coalesce(p.is_test, false))
  loop
    begin
      perform private.run_outcomes_dashboard(r.organisation_id, v_month, null);
      v_n := v_n + 1;
    exception when others then
      v_failed := v_failed + 1; v_last := sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, event)
        values (r.organisation_id, 'outcomes_dashboard.error', 'outcomes_dashboard_report', jsonb_build_object('month', v_month, 'error', sqlerrm));
    end;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('outcomes-dashboard-failing', 'The monthly outcomes dashboard failed',
      v_failed || ' organisation(s) could not be reported for ' || v_month || ' (' || left(coalesce(v_last, ''), 200) || '). See audit_log action outcomes_dashboard.error. '
      || 'Fix the cause and re-run the job BEFORE the next scheduled run (3rd of next month): once a later report exists this month cannot be made, by design, because filling the gap afterwards would let two reports be subtracted. Otherwise the gap is permanent.');
  end if;
  return v_n;
end $$;
revoke all on function private.run_outcomes_dashboard_monthly() from public, anon, authenticated;

select cron.schedule('outcomes-dashboard-monthly', '45 3 3 * *', $$ select private.run_outcomes_dashboard_monthly(); $$);

-- ---------------------------------------------------------------------------
-- 9. The doors (super admin or the CMO; everyone else is refused with 42501)
-- ---------------------------------------------------------------------------
create function public.run_outcomes_dashboard_now(p_month date) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_org uuid := private.caller_org();
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only a super admin or the Chief Medical Officer can run the outcomes dashboard' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'say which month' using errcode = '22023'; end if;
  if v_org is null then raise exception 'no organisation' using errcode = '22023'; end if;
  if date_trunc('month', p_month::timestamp) >= date_trunc('month', now() at time zone 'Africa/Lagos') then
    raise exception 'choose a month that has finished' using errcode = '22023';
  end if;
  v_id := private.run_outcomes_dashboard(v_org, p_month, v_uid);
  perform private.log_audit('outcomes_dashboard.run', 'outcomes_dashboard_report', v_id, jsonb_build_object('month', p_month));
  return v_id;
end $$;
revoke all on function public.run_outcomes_dashboard_now(date) from public, anon;
grant execute on function public.run_outcomes_dashboard_now(date) to authenticated;

-- The stored reports of the caller's organisation, newest first. Every read is written to the audit log.
create function public.read_outcomes_dashboard(p_limit integer default 12) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.caller_org(); v_out jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only a super admin or the Chief Medical Officer can read the outcomes dashboard' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'period_start', r.period_start, 'data_cutoff', r.data_cutoff, 'held_back', r.held_back,
           'config_version', r.config_version, 'is_baseline', r.is_baseline, 'publishable', r.publishable,
           'generated_at', r.generated_at, 'report', r.report) order by r.period_start desc), '[]'::jsonb)
    into v_out from (select * from public.outcomes_dashboard_reports x where x.organisation_id = v_org
                      order by x.period_start desc limit least(greatest(coalesce(p_limit, 12), 1), 36)) r;
  perform private.log_audit('outcomes_dashboard.read', 'outcomes_dashboard_report', null, jsonb_build_object('limit', p_limit));
  return v_out;
end $$;
revoke all on function public.read_outcomes_dashboard(integer) from public, anon;
grant execute on function public.read_outcomes_dashboard(integer) to authenticated;

-- A download is logged BEFORE the file is built; a download that cannot be logged is not given (same rule as log_outcome_export).
create function public.log_outcomes_dashboard_export() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only a super admin or the Chief Medical Officer can export the outcomes dashboard' using errcode = '42501';
  end if;
  perform private.log_audit('outcomes_dashboard.export', 'outcomes_dashboard_report', null, '{}'::jsonb);
end $$;
revoke all on function public.log_outcomes_dashboard_export() from public, anon;
grant execute on function public.log_outcomes_dashboard_export() to authenticated;

-- The founder-only UNFROZEN view (founder decision on OQ-OUT-09 and OQ-OUT-11). The stored reports stay frozen by the held-back rule. In a small pilot that
-- leaves the founder blind, so this read computes the same outcome and comparison figures to TODAY. It lifts the held-back freeze and nothing else: every
-- cell still goes through the shared minimum-cell and complementary-suppression rules and every protected-data exclusion still applies.
--   * Only the super-admin account (profiles.role = 'admin', private.is_admin()); not the CMO, not a clinician, a sponsor, a delegated permission holder, or anon.
--     (This platform has no separate "founder" role: the super admin account is the founder's.)
--   * Off by default: config outcomes_dashboard_config.founder_unfrozen_view.enabled. Turning it on is a new config version.
--   * A reason of at least 10 characters is required and is written to audit_log with every read.
--   * It never writes a report (stored reports stay immutable) and has no export: no CSV route exists for it.
create function public.read_outcomes_founder_unfrozen(p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_cfg jsonb;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_out jsonb;
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'only the super admin can open the founder view' using errcode = '42501';
  end if;
  v_cfg := private.outcomes_dash_cfg();
  if not coalesce((v_cfg #>> '{founder_unfrozen_view,enabled}')::boolean, false) then
    raise exception 'the founder view is switched off' using errcode = '55000';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'say why you are opening the founder view (10 to 500 characters)' using errcode = '22023';
  end if;
  if v_org is null then raise exception 'no organisation' using errcode = '22023'; end if;
  v_out := jsonb_build_object(
    'founder_view', true, 'stored', false, 'as_of', v_today, 'config_version', (select version from public.outcomes_dashboard_config where is_active),
    'outcomes', private.outcomes_dash_outcomes(v_org, v_today, v_cfg),
    'comparison', private.outcomes_dash_comparison(v_org, v_today, v_cfg),
    'not_a_causal_claim', true, 'internal_only', true);
  -- The access is written before anything is returned, so a read that cannot be logged is not given. The row records WHAT was returned in aggregate (the data cutoff and how many
  -- cells were shown and how many held back), never the figures: the log must not become a second copy of small-group numbers.
  perform private.log_audit('outcomes_dashboard.founder_unfrozen_read', 'outcomes_dashboard_report', null, jsonb_build_object(
    'reason', v_reason, 'as_of', v_today, 'data_cutoff', v_today,
    'cells_shown', (select count(*) from jsonb_path_query(v_out, '$.** ? (@.suppressed == false)')),
    'cells_withheld', (select count(*) from jsonb_path_query(v_out, '$.** ? (@.suppressed == true)'))));
  return v_out;
end $$;
revoke all on function public.read_outcomes_founder_unfrozen(text) from public, anon;
grant execute on function public.read_outcomes_founder_unfrozen(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if not exists (select 1 from cron.job where jobname = 'outcomes-dashboard-monthly') then raise exception 'OUTCOMES assertion: the monthly job is not scheduled'; end if;
  if coalesce((private.outcomes_dash_cfg() #>> '{founder_unfrozen_view,enabled}')::boolean, true) then raise exception 'OUTCOMES assertion: the founder view is not off by default'; end if;
  foreach f in array array['public.run_outcomes_dashboard_now(date)', 'public.read_outcomes_dashboard(integer)', 'public.log_outcomes_dashboard_export()', 'public.read_outcomes_founder_unfrozen(text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'OUTCOMES assertion: anon can execute %', f; end if;
  end loop;
  foreach f in array array['private.run_outcomes_dashboard(uuid,date,uuid)', 'private.run_outcomes_dashboard_monthly()', 'private.outcomes_dash_people(uuid,integer,date,jsonb)',
                           'private.outcomes_dash_due(uuid,integer,date,jsonb)', 'private.outcomes_dash_comparison(uuid,date,jsonb)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then raise exception 'OUTCOMES assertion: a user role can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.outcomes_dashboard_reports', 'SELECT') or has_table_privilege('authenticated', 'public.outcomes_dashboard_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.outcomes_dashboard_reports', 'UPDATE') or has_table_privilege('authenticated', 'public.outcomes_dashboard_reports', 'DELETE')
     or has_table_privilege('anon', 'public.outcomes_dashboard_reports', 'SELECT') then
    raise exception 'OUTCOMES assertion: a user role has a grant on the reports table';
  end if;
  if private.outcomes_did(100, 0.30, 0.5, 100, 0.10, 0.5, 0.95) <> jsonb_build_object('available', true, 'difference', 0.200, 'low', 0.061, 'high', 0.339, 'interval_includes_zero', false) then
    raise exception 'OUTCOMES assertion: difference in differences gave %', private.outcomes_did(100, 0.30, 0.5, 100, 0.10, 0.5, 0.95);
  end if;
end $$;
