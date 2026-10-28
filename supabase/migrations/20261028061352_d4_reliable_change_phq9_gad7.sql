-- D4 (gap 71): reliable change for PHQ-9 and GAD-7, shown beside the existing response (a fall of 50 percent or more) and remission figures.
-- Design: docs/design/S75-outcome-measures.md (D4 addendum). Pattern: WP3 (20261024201705): PROPOSED definitions, born UNSIGNED and INACTIVE, only the Chief
-- Medical Officer signs, admin-only aggregate, the single minimum-cell rule, a fixed "descriptive, not causal" note.
--
-- WHAT THIS ADDS (nothing here changes a stored row of any person):
--   1. outcome_reliable_change_config: a versioned, immutable definition of "reliable change" in points for each instrument. PROPOSED, UNSIGNED, INACTIVE.
--      Mirrored in the code registry as `outcomes.reliable_change_rules` (packages/shared/src/proposed-config); a test compares the two.
--      Until the CMO signs, the report below returns {withheld: true, reason: awaiting_cmo_signature} and no figure.
--   2. public.mental_health_reliable_change_report(instrument, day, from, to): for the people the existing response report already counts (a baseline total
--      of 5 or more, adults, not excluded, not a test account), how many had a reliable improvement, no reliable change, a reliable deterioration, or no
--      follow-up score. Beside it, the response and remission figures for the very same group. Admin, analyst or CMO only; aggregate only.
--
-- HARD RULES KEPT: only the TOTAL score in outcome_mh_snapshots is read (the snapshot table has no column for a single answer or a safety flag, and nothing
-- here touches the raw screening table except through private.s75_in_scope, which reads a total only). The group figures go through the one rule
-- (private.min_cell_floor / suppress_cell / suppress_groups); mental-health rows stay patient-only at row level (no policy added anywhere).
--
-- Counts before this migration (live): no outcome_reliable_change_config table; nothing to convert.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned, unsigned)
-- ---------------------------------------------------------------------------
create table public.outcome_reliable_change_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint outcome_reliable_change_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index outcome_reliable_change_config_one_active on public.outcome_reliable_change_config (is_active) where is_active;
create index outcome_reliable_change_config_approved_by_idx on public.outcome_reliable_change_config (approved_by) where approved_by is not null;
alter table public.outcome_reliable_change_config enable row level security;
revoke all on public.outcome_reliable_change_config from public, anon, authenticated;
grant select on public.outcome_reliable_change_config to authenticated;
create policy outcome_reliable_change_config_read on public.outcome_reliable_change_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.outcome_reliable_change_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outcome_reliable_change_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a reliable change config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'a reliable change config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.outcome_reliable_change_config_guard() from public, anon, authenticated;
create trigger outcome_reliable_change_config_guard before insert or update or delete on public.outcome_reliable_change_config
  for each row execute function private.outcome_reliable_change_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.outcome_reliable_change_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- reliable-change-v1-begin
insert into public.outcome_reliable_change_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-28', $json$
{
  "instruments": {
    "phq9": { "reliable_change_points": 6, "scale_points": 27 },
    "gad7": { "reliable_change_points": 4, "scale_points": 21 }
  },
  "categories": [
    { "code": "reliable_improvement", "label": "Reliable improvement", "definition": "The follow-up total is lower than the baseline total by at least the reliable change points for the instrument." },
    { "code": "no_reliable_change", "label": "No reliable change", "definition": "Both totals are known and the difference is smaller than the reliable change points, in either direction. This is not a statement that nothing changed." },
    { "code": "reliable_deterioration", "label": "Reliable deterioration", "definition": "The follow-up total is higher than the baseline total by at least the reliable change points for the instrument." },
    { "code": "insufficient_data", "label": "No follow-up score", "definition": "No score near the day, or no baseline score. Shown as missing, never counted as not improved." }
  ],
  "group": "The same people the response and remission figures count: adults who are not excluded and whose baseline total was 5 or more. A person whose baseline total is below the reliable change points cannot show a reliable improvement, however well they are.",
  "source": "Method: Jacobson NS, Truax P, J Consult Clin Psychol 1991;59:12-19 (the reliable change index). Points: the figures the English NHS Talking Therapies programme uses for reliable change, 6 points on the PHQ-9 and 4 points on the GAD-7. These were written from the published sources by the builder and have not been checked against the primary texts. They were derived in English-speaking clinical populations and are NOT validated for Nigeria or for self-completion in the app. The CMO confirms or changes them before signing; any change is a new version.",
  "note": "These figures are descriptive, not causal. They show how scores moved for the people counted. They cannot show why, and they do not show that any service caused a change. A screening score is not a diagnosis."
}
$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE (D4). Owner: CMO. Reliable change in points for the PHQ-9 and the GAD-7. Nothing shows until the CMO signs.');
-- reliable-change-v1-end

create function public.sign_outcome_reliable_change_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.outcome_reliable_change_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the reliable change definitions' using errcode = '42501'; end if;
  select * into c from public.outcome_reliable_change_config where version = p_version for update;
  if not found then raise exception 'no such reliable change configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.outcome_reliable_change_config set is_active = false where is_active and version <> p_version;
  update public.outcome_reliable_change_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'outcome_reliable_change_config.signed',
            'outcome_reliable_change_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_outcome_reliable_change_config(integer) from public, anon, authenticated;
grant execute on function public.sign_outcome_reliable_change_config(integer) to authenticated;

-- The active, signed version (null while the CMO has not signed anything).
create function private.reliable_change_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config || jsonb_build_object('_version', version) from public.outcome_reliable_change_config where is_active and approved_at is not null order by version desc limit 1 $$;
revoke all on function private.reliable_change_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The classification (one place; the TypeScript function in packages/shared/src/reliable-change.ts is the same rule and a test pins the two together)
-- ---------------------------------------------------------------------------
-- baseline or score missing -> insufficient_data; change = score - baseline; a fall of at least the points -> reliable_improvement; a rise of at least the points
-- -> reliable_deterioration; otherwise no_reliable_change.
create function private.reliable_change_class(p_baseline integer, p_score integer, p_points integer) returns text
language sql immutable set search_path = ''
as $$
  select case when p_baseline is null or p_score is null or p_points is null or p_points < 1 then 'insufficient_data'
              when p_score - p_baseline <= -p_points then 'reliable_improvement'
              when p_score - p_baseline >= p_points then 'reliable_deterioration'
              else 'no_reliable_change' end
$$;
revoke all on function private.reliable_change_class(integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The report (admin, analyst or CMO; aggregate only; stable-looking output, audited)
-- ---------------------------------------------------------------------------
create function public.mental_health_reliable_change_report(p_instrument text, p_day integer, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cfg jsonb;
  v_ver integer;
  v_rule jsonb;
  v_min integer;
  v_pts integer;
  a record;
  v_groups jsonb; v_marked jsonb; v_out jsonb := '[]'::jsonb; g jsonb; v_x jsonb; v_cats jsonb := '[]'::jsonb; v_whole text;
begin
  if v_uid is null or not private.s75_is_outcome_analyst() then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if p_instrument not in ('phq9', 'gad7') then raise exception 'outcome_measure_not_enabled' using errcode = '22023'; end if;
  v_cfg := private.reliable_change_config();
  if v_cfg is null then
    return jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature', 'measure', p_instrument);
  end if;
  v_ver := private.s75_measures_version();
  if v_ver is null then
    return jsonb_build_object('withheld', true, 'reason', 'measures_not_active', 'measure', p_instrument);
  end if;
  v_rule := private.s75_measure_rule(v_ver, p_instrument);
  if v_rule is null or p_day = 0 or not (v_rule -> 'days') @> to_jsonb(p_day) then
    raise exception 'outcome_measure_not_enabled' using errcode = '22023';
  end if;
  v_pts := (v_cfg #>> array['instruments', p_instrument, 'reliable_change_points'])::integer;
  v_min := private.min_cell_floor();
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  -- The group is the one the response report counts. Only totals are read.
  select count(*) as n,
         count(*) filter (where private.reliable_change_class(s.baseline_score::integer, s.score::integer, v_pts) = 'reliable_improvement') as imp,
         count(*) filter (where private.reliable_change_class(s.baseline_score::integer, s.score::integer, v_pts) = 'no_reliable_change') as nochg,
         count(*) filter (where private.reliable_change_class(s.baseline_score::integer, s.score::integer, v_pts) = 'reliable_deterioration') as det,
         count(*) filter (where private.reliable_change_class(s.baseline_score::integer, s.score::integer, v_pts) = 'insufficient_data') as ins,
         count(*) filter (where s.response_status = 'response') as r_yes,
         count(*) filter (where s.response_status = 'no_response') as r_no,
         count(*) filter (where s.response_status = 'insufficient_data') as r_ins,
         count(*) filter (where s.remission_status = 'remitted') as m_yes,
         count(*) filter (where s.remission_status = 'not_remitted') as m_no
    into a
    from public.outcome_mh_snapshots s join public.profiles pr on pr.id = s.patient_id
   where s.instrument = p_instrument and s.day = p_day and s.response_status <> 'not_applicable'
     and not s.is_test and not coalesce(pr.is_test, false)
     and private.s75_in_scope(s.patient_id, s.instrument, v_rule, s.anchor_date)
     and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to);

  v_whole := private.suppress_cell(a.n, null, v_min);
  if v_whole is not null then
    v_cats := jsonb_build_object('suppressed', true, 'reason', v_whole, 'minimum', v_min);
  else
    -- the four categories partition the group; zero is shown as zero, a small non-zero one is withheld with a neighbour so it cannot be subtracted
    v_groups := '[]'::jsonb;
    for g in select * from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('key', 'reliable_improvement', 'n', a.imp), jsonb_build_object('key', 'no_reliable_change', 'n', a.nochg),
        jsonb_build_object('key', 'reliable_deterioration', 'n', a.det), jsonb_build_object('key', 'insufficient_data', 'n', a.ins))) loop
      if (g ->> 'n')::bigint > 0 then v_groups := v_groups || g; end if;
    end loop;
    v_marked := private.suppress_groups(v_groups, v_min);
    for g in select * from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('key', 'reliable_improvement', 'n', a.imp), jsonb_build_object('key', 'no_reliable_change', 'n', a.nochg),
        jsonb_build_object('key', 'reliable_deterioration', 'n', a.det), jsonb_build_object('key', 'insufficient_data', 'n', a.ins))) loop
      if (g ->> 'n')::bigint = 0 then
        v_out := v_out || jsonb_build_object('key', g ->> 'key', 'suppressed', false, 'n', 0, 'pct_of_group', 0);
      else
        select x into v_x from jsonb_array_elements(v_marked) x where x ->> 'key' = g ->> 'key';
        if (v_x ->> 'suppressed')::boolean then
          v_out := v_out || jsonb_build_object('key', g ->> 'key', 'suppressed', true, 'reason', v_x ->> 'reason', 'minimum', v_min);
        else
          v_out := v_out || jsonb_build_object('key', g ->> 'key', 'suppressed', false, 'n', (g ->> 'n')::bigint, 'pct_of_group', round(100.0 * (g ->> 'n')::bigint / nullif(a.n, 0), 1));
        end if;
      end if;
    end loop;
    v_cats := jsonb_build_object('suppressed', false, 'n', a.n, 'categories', v_out);
  end if;

  perform private.log_audit('outcomes.mental_health_reliable_change_report', 'outcome_report', null, jsonb_build_object('measure', p_instrument, 'day', p_day, 'from', p_from, 'to', p_to));
  return jsonb_build_object(
    'measure', p_instrument, 'day', p_day, 'config_version', v_ver, 'reliable_change_config_version', (v_cfg ->> '_version')::integer,
    'minimum_cell', v_min, 'reliable_change_points', v_pts,
    'reliable_change', v_cats,
    'response', private.s75_cohort_json(a.n::integer, a.r_yes::integer, a.r_no::integer, a.r_ins::integer, v_min),
    'remission', private.s75_cohort_json(a.n::integer, a.m_yes::integer, a.m_no::integer, a.r_ins::integer, v_min),
    'group', v_cfg ->> 'group', 'source', v_cfg ->> 'source', 'note', v_cfg ->> 'note',
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'comparison_group', 'none', 'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.mental_health_reliable_change_report(text, integer, date, date) from public, anon;
grant execute on function public.mental_health_reliable_change_report(text, integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.outcome_reliable_change_config where is_active or approved_at is not null) then
    raise exception 'D4: the reliable change config must be born unsigned and inactive';
  end if;
  if private.reliable_change_class(12, 6, 6) <> 'reliable_improvement' or private.reliable_change_class(12, 7, 6) <> 'no_reliable_change'
     or private.reliable_change_class(8, 14, 6) <> 'reliable_deterioration' or private.reliable_change_class(null, 3, 6) <> 'insufficient_data' then
    raise exception 'D4: the reliable change classification is wrong';
  end if;
  if has_function_privilege('anon', 'public.mental_health_reliable_change_report(text,integer,date,date)', 'EXECUTE') then
    raise exception 'D4: anon can run the report';
  end if;
end $$;
