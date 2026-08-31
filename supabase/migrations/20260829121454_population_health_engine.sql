-- Tarragon Health — Population Health Management Engine (spec §41)
--
-- Every piece of "population health" the platform tracks already exists,
-- scattered: prevention_risk_scores/patient_risk_scores give risk tiers,
-- patient_care_gaps derives open gaps, prevention_campaigns targets an
-- eligible subset for a time-boxed intervention, care_outreach_tasks turns
-- a gap into a coordinator worklist item, private.patient_engagement_events()
-- is the real (non-pageview) behavioural-activity signal, and
-- analytics_population_summary/get_geo_health_aggregates give a platform-
-- wide read. What's missing is the thing spec §41 actually asks for: a
-- first-class, *dynamic* "Population" — define it once, generate its
-- membership live from current data (never a manually maintained list),
-- and read risk/care-gaps/outcomes/interventions off the same object.
--
-- population_definitions is that object. Its `filters` jsonb is a small,
-- typed vocabulary (documented on the column, validated app-side with Zod)
-- covering exactly spec §41.3's five segmentation axes — clinical
-- (conditions/prevention_conditions), risk (risk_levels/control_status),
-- prevention (care_gap_types), engagement (engagement bands), geography
-- (states) — plus age/sex. It is deliberately NOT the generic predicate DSL
-- prevention_campaigns.eligibility_rule already uses (lib/rules/predicate.ts):
-- that DSL is evaluated app-side, per patient, against only that patient's
-- own already-RLS-visible data (see its own file header) — exactly right for
-- "am I eligible", wrong for "show me the 40 patients who match", which is
-- what a registry/segment view needs. get_population_members() below is a
-- server-side, staff-only, security-definer aggregate query instead, on the
-- same "explicit is_org_staff() re-check inside the function" pattern
-- high_risk_patient_ids() already established (20260827203219) — safe
-- because the gate is re-applied per call, not inherited from RLS.
--
-- Five system registries (spec §41.4: Hypertension, Diabetes, CKD,
-- Pregnancy, Cancer screening) are seeded per organisation and re-seeded for
-- every future one by a trigger — expressed as ordinary `filters` rows, not
-- a special case, which is the proof the generic engine actually covers the
-- named registries the spec asks for rather than needing bespoke code per
-- registry.
--
-- get_population_members() is the single membership engine; summary/
-- outcomes/outreach are all read or written through it so there is exactly
-- one place "who is in this population" is decided.
--
-- Deliberately NOT built here: hospital utilisation (spec §41.12) — nothing
-- in this schema captures admissions/claims, so it is left out rather than
-- guessed at (same discipline geo_health_intelligence's header already
-- applied to "service shortages"/"engagement differences"); a UI-level
-- population/segment builder that lets staff author `filters` from scratch
-- (this migration is the engine, not the admin form); and re-running
-- prevention_campaigns' own eligibility/enrolment/actions machinery — a
-- campaign MAY now target a population (population_id, added below) but
-- enrolment/actions/redemption are untouched.

create type public.population_kind as enum ('registry', 'custom');
create type public.population_status as enum ('active', 'archived');

create table public.population_definitions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  name              text not null,
  description       text,
  kind              public.population_kind not null default 'custom',
  is_system         boolean not null default false,
  status            public.population_status not null default 'active',
  filters           jsonb not null default '{}'::jsonb,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint population_definitions_org_name_unique unique (organisation_id, name)
);

comment on column public.population_definitions.filters is
  'Typed segmentation filter (spec §41.3): conditions, prevention_conditions, risk_levels, care_gap_types, control_status, engagement, min_age, max_age, sex, states, pregnant_only. Every key is optional; an absent/empty array means unconstrained on that axis.';

create index population_definitions_org_idx on public.population_definitions (organisation_id, status);

create trigger population_definitions_set_updated_at
  before update on public.population_definitions
  for each row execute function private.set_updated_at();

alter table public.population_definitions enable row level security;

create policy population_definitions_select on public.population_definitions
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy population_definitions_insert on public.population_definitions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id) and not is_system);
create policy population_definitions_update on public.population_definitions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy population_definitions_delete on public.population_definitions
  for delete to authenticated
  using (private.is_org_staff(organisation_id) and not is_system);

grant select, insert, update, delete on public.population_definitions to authenticated;
revoke all on public.population_definitions from anon;

-- ---------------------------------------------------------------------------
-- Seed the five system registries (spec §41.4) for every existing
-- organisation, and for every organisation created from now on.
-- ---------------------------------------------------------------------------

create or replace function private.seed_system_population_registries(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.population_definitions
    (organisation_id, name, description, kind, is_system, filters)
  values
    (p_organisation_id, 'Hypertension registry',
     'Patients on an active hypertension care plan.',
     'registry', true, '{"conditions":["hypertension"]}'::jsonb),
    (p_organisation_id, 'Diabetes registry',
     'Patients on an active diabetes care plan.',
     'registry', true, '{"conditions":["diabetes"]}'::jsonb),
    (p_organisation_id, 'CKD registry',
     'Patients on an active chronic kidney disease care plan.',
     'registry', true, '{"conditions":["ckd"]}'::jsonb),
    (p_organisation_id, 'Pregnancy registry',
     'Patients who have told us they are currently pregnant.',
     'registry', true, '{"pregnant_only":true}'::jsonb),
    (p_organisation_id, 'Cancer screening registry',
     'Patients with a breast, cervical, colorectal, or prostate cancer risk assessment on file.',
     'registry', true,
     '{"prevention_conditions":["breast_ca","cervical_ca","colorectal_ca","prostate_ca"]}'::jsonb)
  on conflict (organisation_id, name) do nothing;
$$;

do $$
declare
  v_org record;
begin
  for v_org in select id from public.organisations loop
    perform private.seed_system_population_registries(v_org.id);
  end loop;
end $$;

create or replace function private.seed_population_registries_for_new_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_system_population_registries(new.id);
  return new;
end;
$$;

create trigger organisations_seed_population_registries
  after insert on public.organisations
  for each row execute function private.seed_population_registries_for_new_org();

-- ---------------------------------------------------------------------------
-- get_population_members() — the membership engine. Security definer with
-- an explicit is_org_staff() re-check (same shape as high_risk_patient_ids,
-- 20260827203219) rather than SECURITY INVOKER, because this aggregates
-- across every patient in the org — that needs staff-only gating applied
-- once, deliberately, not "whatever profiles/care_plans/screening_schedules
-- RLS happens to allow a caller to join across", which is fragile to reason
-- about here. Returns an EMPTY set (not an error) for a population that
-- doesn't exist or isn't in the caller's org, matching high_risk_patient_ids'
-- fail-closed style.
-- ---------------------------------------------------------------------------

create or replace function public.get_population_members(p_population_id uuid)
returns table (
  patient_id            uuid,
  full_name             text,
  age_years             integer,
  sex                   public.sex,
  state                 text,
  matched_conditions    public.care_plan_condition[],
  risk_tier             public.risk_level,
  control_status        text,
  open_care_gap_types   text[],
  engagement_band       text,
  last_engagement_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_def public.population_definitions%rowtype;
begin
  select * into v_def from public.population_definitions pd where pd.id = p_population_id;
  if not found then
    return;
  end if;
  if not private.is_org_staff(v_def.organisation_id) then
    return;
  end if;

  return query
  with f as (
    select
      coalesce((select array_agg(elem::public.care_plan_condition)
                from jsonb_array_elements_text(coalesce(v_def.filters->'conditions', '[]'::jsonb)) elem),
               '{}'::public.care_plan_condition[]) as conditions,
      coalesce((select array_agg(elem::public.prevention_condition)
                from jsonb_array_elements_text(coalesce(v_def.filters->'prevention_conditions', '[]'::jsonb)) elem),
               '{}'::public.prevention_condition[]) as prevention_conditions,
      coalesce((select array_agg(elem::public.risk_level)
                from jsonb_array_elements_text(coalesce(v_def.filters->'risk_levels', '[]'::jsonb)) elem),
               '{}'::public.risk_level[]) as risk_levels,
      coalesce((select array_agg(elem)
                from jsonb_array_elements_text(coalesce(v_def.filters->'care_gap_types', '[]'::jsonb)) elem),
               '{}'::text[]) as care_gap_types,
      coalesce((select array_agg(elem)
                from jsonb_array_elements_text(coalesce(v_def.filters->'control_status', '[]'::jsonb)) elem),
               '{}'::text[]) as control_statuses,
      coalesce((select array_agg(elem)
                from jsonb_array_elements_text(coalesce(v_def.filters->'states', '[]'::jsonb)) elem),
               '{}'::text[]) as states,
      coalesce((select array_agg(elem)
                from jsonb_array_elements_text(coalesce(v_def.filters->'engagement', '[]'::jsonb)) elem),
               '{}'::text[]) as engagement_bands,
      nullif(v_def.filters->>'min_age', '')::integer as min_age,
      nullif(v_def.filters->>'max_age', '')::integer as max_age,
      nullif(v_def.filters->>'sex', '')::public.sex as sex_filter,
      coalesce((v_def.filters->>'pregnant_only')::boolean, false) as pregnant_only
  ),
  latest_prevention as (
    select distinct on (prs.profile_id, prs.condition)
      prs.profile_id, prs.condition, prs.tier, prs.computed_at
    from public.prevention_risk_scores prs
    where prs.organisation_id = v_def.organisation_id
    order by prs.profile_id, prs.condition, prs.computed_at desc
  ),
  conds as (
    select cp.patient_id, array_agg(distinct cp.condition) as conditions
    from public.care_plans cp
    where cp.organisation_id = v_def.organisation_id and cp.status = 'active'
    group by cp.patient_id
  ),
  gaps as (
    select g.patient_id, array_agg(distinct g.gap_type) as gap_types
    from public.patient_care_gaps g
    where g.organisation_id = v_def.organisation_id
    group by g.patient_id
  ),
  engagement as (
    select e.patient_id, max(e.occurred_at) as last_engagement_at
    from private.patient_engagement_events() e
    group by e.patient_id
  ),
  scored as (
    select
      p.id as patient_id,
      p.full_name,
      extract(year from age(p.date_of_birth))::integer as age_years,
      p.sex,
      p.state,
      coalesce(p.is_pregnant, false) as is_pregnant,
      coalesce(c.conditions, '{}'::public.care_plan_condition[]) as matched_conditions,
      coalesce(g.gap_types, '{}'::text[]) as gap_types,
      eng.last_engagement_at,
      (select array_agg(distinct lp.condition) from latest_prevention lp where lp.profile_id = p.id)
        as scored_conditions,
      (select tier from latest_prevention lp where lp.profile_id = p.id
       order by array_position(array['very_high','high','unknown','moderate','low'], tier::text)
       limit 1) as worst_tier,
      exists (select 1 from latest_prevention lp where lp.profile_id = p.id and lp.tier <> 'unknown')
        as has_confident_score,
      exists (select 1 from latest_prevention lp where lp.profile_id = p.id and lp.tier in ('high', 'very_high'))
        as has_high_tier
    from public.profiles p
    left join conds c on c.patient_id = p.id
    left join gaps g on g.patient_id = p.id
    left join engagement eng on eng.patient_id = p.id
    where p.organisation_id = v_def.organisation_id and p.role = 'patient'
  )
  select
    s.patient_id,
    s.full_name,
    s.age_years,
    s.sex,
    s.state,
    s.matched_conditions,
    s.worst_tier,
    case when not s.has_confident_score then 'unknown'
         when s.has_high_tier then 'uncontrolled'
         else 'controlled' end,
    s.gap_types,
    case
      when s.last_engagement_at >= now() - interval '7 days' then 'active'
      when s.last_engagement_at >= now() - interval '30 days' then 'declining'
      else 'disengaged'
    end,
    s.last_engagement_at
  from scored s, f
  where
    (array_length(f.conditions, 1) is null or s.matched_conditions && f.conditions)
    and (array_length(f.prevention_conditions, 1) is null or s.scored_conditions && f.prevention_conditions)
    and (array_length(f.risk_levels, 1) is null or exists (
          select 1 from latest_prevention lp where lp.profile_id = s.patient_id and lp.tier = any(f.risk_levels)
        ))
    and (array_length(f.care_gap_types, 1) is null or s.gap_types && f.care_gap_types)
    and (array_length(f.states, 1) is null or s.state = any(f.states))
    and (f.min_age is null or s.age_years >= f.min_age)
    and (f.max_age is null or s.age_years <= f.max_age)
    and (f.sex_filter is null or s.sex = f.sex_filter)
    and (not f.pregnant_only or s.is_pregnant)
    and (array_length(f.control_statuses, 1) is null or
         (case when not s.has_confident_score then 'unknown'
               when s.has_high_tier then 'uncontrolled'
               else 'controlled' end) = any(f.control_statuses))
    and (array_length(f.engagement_bands, 1) is null or
         (case
            when s.last_engagement_at >= now() - interval '7 days' then 'active'
            when s.last_engagement_at >= now() - interval '30 days' then 'declining'
            else 'disengaged'
          end) = any(f.engagement_bands));
end;
$$;

revoke all on function public.get_population_members(uuid) from public;
revoke all on function public.get_population_members(uuid) from anon;
grant execute on function public.get_population_members(uuid) to authenticated;

comment on function public.get_population_members(uuid) is
  'Dynamic, live-computed membership of a population_definitions row (spec §41.4/§41.5) — never a stored/materialised list. Staff-only (private.is_org_staff, re-checked inside the function); returns empty for an unknown/foreign population rather than raising.';

-- ---------------------------------------------------------------------------
-- get_population_summary() — spec §41.11's dashboard shape (risk
-- distribution, control status, care gaps, engagement) for one population.
-- ---------------------------------------------------------------------------

create or replace function public.get_population_summary(p_population_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select * from public.get_population_members(p_population_id)
  )
  select jsonb_build_object(
    'total_members', (select count(*) from members),
    'risk_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('risk_level', coalesce(risk_tier::text, 'unscored'), 'patients', n) order by n desc)
      from (select risk_tier, count(*) n from members group by risk_tier) t
    ), '[]'::jsonb),
    'control_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', control_status, 'patients', n) order by n desc)
      from (select control_status, count(*) n from members group by control_status) t
    ), '[]'::jsonb),
    'care_gaps', coalesce((
      select jsonb_agg(jsonb_build_object('gap_type', gap_type, 'patients', n) order by n desc)
      from (
        select gap_type, count(distinct patient_id) n
        from members, unnest(open_care_gap_types) gap_type
        group by gap_type
      ) t
    ), '[]'::jsonb),
    'engagement', coalesce((
      select jsonb_agg(jsonb_build_object('band', engagement_band, 'patients', n) order by n desc)
      from (select engagement_band, count(*) n from members group by engagement_band) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_population_summary(uuid) from public;
revoke all on function public.get_population_summary(uuid) from anon;
grant execute on function public.get_population_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_population_outcomes() — spec §41.12. Disease control and engagement
-- are re-surfaced from the same member rows (they are genuinely both a
-- segmentation axis and an outcome); screening completion, medication
-- adherence, and care-plan completion are computed fresh from
-- screening_schedules / medication_logs / care_plans for the population's
-- members. Hospital utilisation is deliberately omitted — see the file
-- header.
-- ---------------------------------------------------------------------------

create or replace function public.get_population_outcomes(p_population_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select patient_id, control_status, engagement_band
    from public.get_population_members(p_population_id)
  ),
  screen as (
    select
      count(*) filter (where ss.status = 'completed') as completed,
      count(*) filter (where ss.status in ('completed', 'overdue', 'pending', 'booked')) as total
    from public.screening_schedules ss
    join members m on m.patient_id = ss.patient_id
  ),
  meds as (
    select
      count(*) filter (where ml.status = 'taken') as taken,
      count(*) as total
    from public.medication_logs ml
    join members m on m.patient_id = ml.patient_id
    where ml.logged_at >= now() - interval '90 days'
  ),
  plans as (
    select
      count(*) filter (where cp.status = 'completed') as completed,
      count(*) filter (where cp.status in ('completed', 'active', 'paused')) as total
    from public.care_plans cp
    join members m on m.patient_id = cp.patient_id
  )
  select jsonb_build_object(
    'disease_control', coalesce((
      select jsonb_agg(jsonb_build_object('status', control_status, 'patients', n) order by n desc)
      from (select control_status, count(*) n from members group by control_status) t
    ), '[]'::jsonb),
    'engagement', coalesce((
      select jsonb_agg(jsonb_build_object('band', engagement_band, 'patients', n) order by n desc)
      from (select engagement_band, count(*) n from members group by engagement_band) t
    ), '[]'::jsonb),
    'screening_completion_rate',
      (select case when total = 0 then null else round(100.0 * completed / total, 1) end from screen),
    'screening_completed', (select completed from screen),
    'screening_total', (select total from screen),
    'medication_adherence_rate',
      (select case when total = 0 then null else round(100.0 * taken / total, 1) end from meds),
    'medication_checkins_taken', (select taken from meds),
    'medication_checkins_total', (select total from meds),
    'care_plan_completion_rate',
      (select case when total = 0 then null else round(100.0 * completed / total, 1) end from plans),
    'care_plans_completed', (select completed from plans),
    'care_plans_total', (select total from plans)
  );
$$;

revoke all on function public.get_population_outcomes(uuid) from public;
revoke all on function public.get_population_outcomes(uuid) from anon;
grant execute on function public.get_population_outcomes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Population campaigns (spec §41.8) — a prevention_campaigns row may now
-- target a population instead of (or alongside) its own eligibility_rule.
-- Enrolment/actions/redemption are untouched; this is purely "who is the
-- audience".
-- ---------------------------------------------------------------------------

alter table public.prevention_campaigns
  add column population_id uuid references public.population_definitions (id) on delete set null;

create index prevention_campaigns_population_idx
  on public.prevention_campaigns (population_id) where population_id is not null;

-- ---------------------------------------------------------------------------
-- get_campaign_effectiveness() — spec §41.13. The funnel a campaign's own
-- enrolment status already tracks (invited -> joined -> completed/declined)
-- IS the before/after measurement — "invited" is the population's baseline,
-- "completed" is the after. No separate snapshot table is invented.
-- ---------------------------------------------------------------------------

create or replace function public.get_campaign_effectiveness(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_population_id uuid;
begin
  select organisation_id, population_id into v_org, v_population_id
  from public.prevention_campaigns where id = p_campaign_id;

  if v_org is null or not private.is_org_staff(v_org) then
    return '{}'::jsonb;
  end if;

  return (
    with e as (
      select status, count(*) n
      from public.prevention_campaign_enrolments
      where campaign_id = p_campaign_id
      group by status
    )
    select jsonb_build_object(
      'invited', coalesce((select n from e where status = 'invited'), 0),
      'joined', coalesce((select n from e where status = 'joined'), 0),
      'completed', coalesce((select n from e where status = 'completed'), 0),
      'declined', coalesce((select n from e where status = 'declined'), 0),
      'total_enrolled', coalesce((select sum(n) from e), 0),
      'completion_rate', (
        select case when sum(n) = 0 then null
                     else round(100.0 * coalesce(sum(n) filter (where status = 'completed'), 0) / sum(n), 1) end
        from e
      ),
      'population_size', case when v_population_id is null then null
        else (select count(*) from public.get_population_members(v_population_id)) end
    )
  );
end;
$$;

revoke all on function public.get_campaign_effectiveness(uuid) from public;
revoke all on function public.get_campaign_effectiveness(uuid) from anon;
grant execute on function public.get_campaign_effectiveness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- trigger_population_outreach() — spec §41.7/§41.14: turn an open care gap
-- into a coordinator worklist item + patient nudge, staff-initiated (e.g.
-- launching "Know Your Blood Pressure Month") rather than waiting for the
-- nightly private.queue_care_outreach() scan. Reuses that same
-- care_outreach_tasks table and its (patient_id, trigger_type) live-status
-- unique index, so a population-launched task and a nightly-scan task for
-- the same patient+gap never duplicate — whichever inserts first wins, the
-- other is a no-op. Only members with an open gap are queued: outreach here
-- is gap-driven, matching the spec's own diagram (care gap -> notification
-- -> booking -> monitoring -> completion); a population member with nothing
-- open has nothing for a coordinator to act on. Sends both whatsapp and
-- in_app notifications, same as the nightly job, since WhatsApp template
-- delivery is not guaranteed to be live (see CLAUDE.md's standing
-- follow-ups) and in_app is the working fallback.
-- ---------------------------------------------------------------------------

create or replace function public.trigger_population_outreach(p_population_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_queued integer;
begin
  select organisation_id, name into v_org, v_name
  from public.population_definitions where id = p_population_id;

  if v_org is null then
    raise exception 'population % not found', p_population_id;
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorized for this population''s organisation';
  end if;

  with candidates as (
    select m.patient_id, gap_type
    from public.get_population_members(p_population_id) m,
         unnest(m.open_care_gap_types) as gap_type
  ),
  inserted as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select
      v_org,
      c.patient_id,
      c.gap_type::public.outreach_trigger_type,
      jsonb_build_object(
        'source', 'population_outreach',
        'population_id', p_population_id,
        'population_name', v_name
      ),
      case c.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        when 'repeated_no_show' then 2
        else 3
      end,
      now()
    from candidates c
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning organisation_id, patient_id
  ),
  distinct_patients as (
    select distinct organisation_id, patient_id from inserted
  ),
  whatsapp_notified as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select i.organisation_id, i.patient_id, 'whatsapp', 'pending', 'care_outreach_checkin',
           jsonb_build_object('reasons', array['population_health_campaign'], 'population_name', v_name)
    from distinct_patients i
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select i.organisation_id, i.patient_id, 'in_app', 'pending', 'care_outreach_checkin',
         jsonb_build_object('reasons', array['population_health_campaign'], 'population_name', v_name)
  from distinct_patients i;

  select count(distinct patient_id) into v_queued
  from public.get_population_members(p_population_id) m, unnest(m.open_care_gap_types) as gap_type;

  return coalesce(v_queued, 0);
end;
$$;

revoke all on function public.trigger_population_outreach(uuid) from public;
revoke all on function public.trigger_population_outreach(uuid) from anon;
grant execute on function public.trigger_population_outreach(uuid) to authenticated;

comment on function public.trigger_population_outreach(uuid) is
  'Staff-initiated: queues a care_outreach_tasks row (+ whatsapp/in_app nudge) for every current population member with an open care gap. Returns how many distinct patients had at least one gap right now — not how many NEW rows were inserted (a patient already queued by the nightly scan is not double-counted as a failure, just a no-op insert).';

-- ---------------------------------------------------------------------------
-- Prove it, don't hope it.
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.get_population_members(uuid)', 'EXECUTE') then
    raise exception 'get_population_members is EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.get_population_members(uuid)', 'EXECUTE') then
    raise exception 'get_population_members is NOT EXECUTE-able by authenticated';
  end if;
  if has_function_privilege('anon', 'public.get_population_summary(uuid)', 'EXECUTE') then
    raise exception 'get_population_summary is EXECUTE-able by anon';
  end if;
  if has_function_privilege('anon', 'public.get_population_outcomes(uuid)', 'EXECUTE') then
    raise exception 'get_population_outcomes is EXECUTE-able by anon';
  end if;
  if has_function_privilege('anon', 'public.get_campaign_effectiveness(uuid)', 'EXECUTE') then
    raise exception 'get_campaign_effectiveness is EXECUTE-able by anon';
  end if;
  if has_function_privilege('anon', 'public.trigger_population_outreach(uuid)', 'EXECUTE') then
    raise exception 'trigger_population_outreach is EXECUTE-able by anon';
  end if;

  -- Every existing organisation must have all five system registries.
  if exists (
    select 1 from public.organisations o
    where (
      select count(*) from public.population_definitions pd
      where pd.organisation_id = o.id and pd.is_system
    ) <> 5
  ) then
    raise exception 'an organisation is missing one or more system population registries';
  end if;
end $$;
