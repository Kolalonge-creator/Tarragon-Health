-- S74 part 1: partner quality rules and removal from new work (spec 21.7, module 21 safety rule "partners are removed for poor performance by rule").
-- Design: docs/design/S74.md. Research: docs/research/S74.md. Pattern reused: S20 private.remove_ineligible_from_work() (a nightly rule, not a person,
-- takes the partner out of NEW work; reinstatement is a person with a written reason; every step is audited and logged append only).
--
-- What this adds
--   * partner_quality_config   versioned PROPOSED rules (weights, floors, turnaround target, complaint limit, which breaches suspend). Mirrored in
--                              packages/shared proposed-config as `partner.quality`; a test fails if the two drift. The CMO owns the numbers (OQ-360).
--   * partner_complaints       a complaint is recorded by an admin or the Chief Medical Officer and resolved upheld or dismissed with a reason.
--                              Category codes only plus a short staff note; never shown to the partner in full, never a patient name.
--   * partner_quality          one row per partner per month: turnaround target against actual, upheld and open complaints, licence expiry and
--                              state, a 0 to 100 score, the breach codes and the configuration version used (INV-16).
--   * partner_work_status      is a partner open to NEW work, or suspended from it. A missing row means open. + partner_work_status_log (append only).
--   * private.partner_quality_sweep() nightly: computes quality for every active lab, pharmacy and operational clinic, suspends from new work by
--                              rule, emits `partner.quality_breach` (registered in the S10 event registry) and tells admins.
--   * Three refusals of new work (triggers, so no path can go round them): a lab order cannot be given to a suspended laboratory, a prescription
--     cannot be sent to a suspended pharmacy, and (part 3) a clinic slot cannot be reserved at a suspended clinic. Work already in flight is not touched.
--
-- Lab revenue follows decision D-06 (the patient pays the laboratory directly): nothing here moves or owes money.
-- Live counts before this migration (checked 2026-10-07): none of these names existed, so nothing is converted.
--
-- RULES THAT ARE NOT NEGOTIABLE HERE
--   * An EXPIRED licence is a hard stop. It cannot be overridden by a reinstatement; renew the licence first. A missing licence date never suspends
--     anyone (the S15 rule for clinicians): only a date that is set and in the past does.
--   * A performance breach can be overridden by an admin or the CMO with a written reason for `override_days`; the rule does not re-suspend for that
--     time, but the override is a logged person decision, never silent.
--   * No test account ever counts (INV-13): complaints raised by a test profile and orders of a test patient are left out of every figure.
--   * Nothing in an event, notice or log names a patient, a result or a condition (INV-07).

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned)
-- ---------------------------------------------------------------------------
create table public.partner_quality_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index partner_quality_config_one_active on public.partner_quality_config (is_active) where is_active;
alter table public.partner_quality_config enable row level security;
revoke all on public.partner_quality_config from public, anon, authenticated;
comment on table public.partner_quality_config is 'S74: versioned partner quality rules (PROPOSED, CMO owned). New versions only; never edited. Private functions read it.';

-- partner-quality-begin
insert into public.partner_quality_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{
  "window_days": 90,
  "turnaround": { "lab_target_hours": 72, "min_orders": 10, "min_within_target_percent": 80 },
  "complaints": { "category_codes": ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"], "upheld_limit": 3 },
  "licence": { "expiring_days": 30 },
  "weights": { "turnaround": 40, "complaints": 30, "licence": 30 },
  "score": { "warn_below": 70, "suspend_below": 50 },
  "removal": { "auto_suspend": true, "suspend_on": ["licence_expired", "complaints_upheld_limit", "turnaround_below_target", "score_below_floor"], "override_days": 30, "reason_min_chars": 20 }
}
$json$::jsonb);
-- partner-quality-end

create function private.partner_quality_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.partner_quality_config where is_active; $$;
revoke all on function private.partner_quality_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events (S10 registry). Ids, codes and counts only.
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('partner.quality_breach', 'A partner breached a quality rule (turnaround, complaints or licence); it may have been suspended from new work', 'S74', false),
  ('partner.reinstated', 'A person reinstated a partner for new work and wrote why', 'S74', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('partner.quality_breach', 1, array['partner_kind', 'partner_id', 'breaches', 'suspended']),
  ('partner.reinstated', 1, array['partner_kind', 'partner_id']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('partner_quality_attention', 'operational', 'routine', 'admin', array['in_app']::public.notification_channel[], 'immediate',
   'S74: a partner needs a look at its quality check. Names no patient, result or condition (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('partner_quality_attention', 'en', 'in_app', 'A partner needs a look', 'A partner quality check needs your attention. Open the partner quality page.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- A partner row exists. Partners live in three different tables, so the kind is a code and the id is checked here, not by a foreign key.
create function private.partner_exists(p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_kind
    when 'lab' then exists (select 1 from public.lab_providers where id = p_id)
    when 'pharmacy' then exists (select 1 from public.pharmacy_partners where id = p_id)
    when 'clinic' then exists (select 1 from public.provider_organisations where id = p_id)
    else false end
$$;
revoke all on function private.partner_exists(text, uuid) from public, anon, authenticated;

create function private.partner_name(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case p_kind
    when 'lab' then (select name from public.lab_providers where id = p_id)
    when 'pharmacy' then (select name from public.pharmacy_partners where id = p_id)
    when 'clinic' then (select coalesce(display_name, legal_name) from public.provider_organisations where id = p_id) end
$$;
revoke all on function private.partner_name(text, uuid) from public, anon, authenticated;

-- The Tarragon organisation an event or a notice about a partner belongs to. Partners themselves are a shared directory (no organisation_id), so
-- this takes the organisation of the partner's latest piece of work, and falls back to the first active admin's organisation.
create function private.partner_event_org(p_kind text, p_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    case p_kind
      when 'lab' then (select o.organisation_id from public.lab_orders o where o.provider_id = p_id order by o.ordered_at desc limit 1)
      when 'pharmacy' then (select c.organisation_id from public.prescription_collection_codes c where c.pharmacy_partner_id = p_id order by c.created_at desc limit 1)
    end,
    (select organisation_id from public.profiles where role = 'admin' and is_active and organisation_id is not null order by created_at limit 1))
$$;
revoke all on function private.partner_event_org(text, uuid) from public, anon, authenticated;

-- The signed-in person may run the partner quality desk: an admin or the Chief Medical Officer ("ops or the CMO").
create function private.partner_desk_actor() returns boolean
language sql stable security definer set search_path = ''
as $$ select (select auth.uid()) is not null and (private.is_admin() or private.credential_is_cmo()) $$;
revoke all on function private.partner_desk_actor() from public, anon;
grant execute on function private.partner_desk_actor() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table public.partner_complaints (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  partner_kind     text not null check (partner_kind in ('lab', 'pharmacy', 'clinic')),
  partner_id       uuid not null,
  category         text not null check (category in ('late_result', 'wrong_result', 'communication', 'charge_dispute', 'safety', 'licence', 'other')),
  reference_kind   text check (reference_kind in ('lab_order', 'prescription', 'reservation', 'other')),
  reference_id     uuid,
  note             text check (note is null or length(note) <= 500),
  state            text not null default 'open' check (state in ('open', 'upheld', 'dismissed')),
  raised_by        uuid references public.profiles (id) on delete set null,
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check ((state = 'open') = (resolved_at is null)),
  check (state = 'open' or (resolved_by is not null and length(btrim(coalesce(resolution_note, ''))) >= 10)),
  check ((reference_kind is null) = (reference_id is null))
);
create index partner_complaints_partner_idx on public.partner_complaints (partner_kind, partner_id, created_at desc);
create index partner_complaints_open_idx on public.partner_complaints (organisation_id, state) where state = 'open';
alter table public.partner_complaints enable row level security;
revoke all on public.partner_complaints from public, anon, authenticated;
grant select on public.partner_complaints to authenticated;
create policy partner_complaints_desk_read on public.partner_complaints for select to authenticated
  using (private.partner_desk_actor() and organisation_id = private.caller_org());
comment on table public.partner_complaints is
  'S74 (21.7): a complaint about a partner, recorded and resolved by an admin or the CMO through functions. Category codes and a short staff note; the partner reads only a count and category through partner_my_quality(), never the note.';

create table public.partner_quality (
  id                              uuid primary key default gen_random_uuid(),
  partner_kind                    text not null check (partner_kind in ('lab', 'pharmacy', 'clinic')),
  partner_id                      uuid not null,
  period_month                    date not null,
  config_version                  integer not null,
  turnaround_target_hours         numeric,
  turnaround_actual_median_hours  numeric,
  orders_measured                 integer not null default 0,
  pct_within_target               numeric,
  complaints_upheld               integer not null default 0,
  complaints_open                 integer not null default 0,
  licence_expires_at              timestamptz,
  licence_state                   text not null check (licence_state in ('current', 'expiring', 'expired', 'unverified', 'not_tracked')),
  score                           numeric(5, 1) check (score is null or score between 0 and 100),
  components                      jsonb not null default '{}'::jsonb,
  breaches                        text[] not null default '{}',
  computed_at                     timestamptz not null default now(),
  unique (partner_kind, partner_id, period_month)
);
create index partner_quality_partner_idx on public.partner_quality (partner_kind, partner_id, period_month desc);
alter table public.partner_quality enable row level security;
revoke all on public.partner_quality from public, anon, authenticated;
grant select on public.partner_quality to authenticated;
create policy partner_quality_desk_read on public.partner_quality for select to authenticated using (private.partner_desk_actor());
comment on table public.partner_quality is
  'S74 (21.7): the quality snapshot of a partner for a month, recomputed nightly while the month is open. Shared directory fact (no organisation_id, like go_live_guards): read by admin and the CMO, by the partner itself through partner_my_quality().';

create table public.partner_work_status (
  partner_kind        text not null check (partner_kind in ('lab', 'pharmacy', 'clinic')),
  partner_id          uuid not null,
  state               text not null default 'open' check (state in ('open', 'suspended')),
  reason_codes        text[] not null default '{}',
  suspended_at        timestamptz,
  suspended_by_rule   integer,
  suspended_by        uuid references public.profiles (id) on delete set null,
  override_until      timestamptz,
  reinstated_at       timestamptz,
  reinstated_by       uuid references public.profiles (id) on delete set null,
  reinstated_reason   text,
  updated_at          timestamptz not null default now(),
  primary key (partner_kind, partner_id),
  check (state <> 'suspended' or (suspended_at is not null and cardinality(reason_codes) > 0))
);
alter table public.partner_work_status enable row level security;
revoke all on public.partner_work_status from public, anon, authenticated;
grant select on public.partner_work_status to authenticated;
create policy partner_work_status_desk_read on public.partner_work_status for select to authenticated using (private.partner_desk_actor());

create table public.partner_work_status_log (
  id             bigint generated always as identity primary key,
  partner_kind   text not null,
  partner_id     uuid not null,
  from_state     text not null,
  to_state       text not null,
  source         text not null check (source in ('rule', 'person')),
  actor_id       uuid references public.profiles (id) on delete set null,
  reason_codes   text[] not null default '{}',
  reason         text,
  config_version integer,
  quality_id     uuid references public.partner_quality (id) on delete set null,
  created_at     timestamptz not null default clock_timestamp(),
  check (source = 'rule' or (actor_id is not null and length(btrim(coalesce(reason, ''))) >= 1))
);
create index partner_work_status_log_partner_idx on public.partner_work_status_log (partner_kind, partner_id, id desc);
alter table public.partner_work_status_log enable row level security;
revoke all on public.partner_work_status_log from public, anon, authenticated;
grant select on public.partner_work_status_log to authenticated;
create policy partner_work_status_log_desk_read on public.partner_work_status_log for select to authenticated using (private.partner_desk_actor());

create function private.partner_log_append_only() returns trigger language plpgsql set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger partner_work_status_log_append_only before update or delete on public.partner_work_status_log
  for each row execute function private.partner_log_append_only();
create trigger partner_work_status_log_no_truncate before truncate on public.partner_work_status_log
  for each statement execute function private.partner_log_append_only();

-- Is the partner open to NEW work. A missing row is open.
create function private.partner_open_for_new_work(p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from public.partner_work_status s where s.partner_kind = p_kind and s.partner_id = p_id and s.state = 'suspended') $$;
revoke all on function private.partner_open_for_new_work(text, uuid) from public, anon;
grant execute on function private.partner_open_for_new_work(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The quality computation (pure of side effects except the upsert)
-- ---------------------------------------------------------------------------
create function private.partner_licence(p_kind text, p_id uuid) returns table (expires_at timestamptz, verified_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select l.license_expires_at, l.license_verified_at from public.lab_providers l where p_kind = 'lab' and l.id = p_id
  union all
  select p.license_expires_at, p.license_verified_at from public.pharmacy_partners p where p_kind = 'pharmacy' and p.id = p_id
$$;
revoke all on function private.partner_licence(text, uuid) from public, anon, authenticated;

create function private.compute_partner_quality(p_kind text, p_id uuid, p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg public.partner_quality_config%rowtype;
  v_rules jsonb;
  v_window integer;
  v_month date := private.lagos_month(p_now);
  v_exp timestamptz; v_ver timestamptz;
  v_lic_state text;
  v_target numeric; v_min_orders integer; v_min_pct numeric;
  v_n integer := 0; v_median numeric; v_within numeric;
  v_upheld integer; v_open integer; v_limit integer;
  v_c_turn numeric; v_c_comp numeric; v_c_lic numeric;
  v_w jsonb; v_wsum numeric := 0; v_acc numeric := 0;
  v_score numeric; v_breaches text[] := '{}';
  v_id uuid;
begin
  if not private.partner_exists(p_kind, p_id) then raise exception 'partner_not_found' using errcode = '22023'; end if;
  select * into v_cfg from public.partner_quality_config where is_active;
  if not found then raise exception 'partner_quality_config_missing' using errcode = '55000'; end if;
  v_rules := v_cfg.rules;
  v_window := (v_rules ->> 'window_days')::integer;
  v_w := v_rules -> 'weights';

  -- licence
  if p_kind in ('lab', 'pharmacy') then
    select l.expires_at, l.verified_at into v_exp, v_ver from private.partner_licence(p_kind, p_id) l;
    v_lic_state := case
      when v_exp is not null and v_exp <= p_now then 'expired'
      when v_exp is null and v_ver is null then 'unverified'
      when v_exp is not null and v_exp <= p_now + make_interval(days => (v_rules #>> '{licence,expiring_days}')::integer) then 'expiring'
      else 'current' end;
    v_c_lic := case v_lic_state when 'expired' then 0 when 'unverified' then 50 when 'expiring' then 60 else 100 end;
  else
    v_lic_state := 'not_tracked';
  end if;

  -- turnaround (laboratories only; test patients left out, INV-13)
  if p_kind = 'lab' then
    v_target := (v_rules #>> '{turnaround,lab_target_hours}')::numeric;
    v_min_orders := (v_rules #>> '{turnaround,min_orders}')::integer;
    v_min_pct := (v_rules #>> '{turnaround,min_within_target_percent}')::numeric;
    select count(*), percentile_cont(0.5) within group (order by h),
           100.0 * count(*) filter (where h <= v_target) / nullif(count(*), 0)
      into v_n, v_median, v_within
      from (select extract(epoch from (o.resulted_at - o.payment_confirmed_at)) / 3600.0 as h
              from public.lab_orders o join public.profiles pt on pt.id = o.patient_id
             where o.provider_id = p_id and not pt.is_test and o.status = 'resulted'
               and o.payment_confirmed_at is not null and o.resulted_at is not null
               and o.resulted_at >= p_now - make_interval(days => v_window) and o.resulted_at <= p_now) m;
    if v_n >= v_min_orders then v_c_turn := round(v_within, 1); end if;   -- too few orders to judge: not scored, not penalised
  end if;

  -- complaints (test raisers left out)
  select count(*) filter (where state = 'upheld' and created_at >= p_now - make_interval(days => v_window)),
         count(*) filter (where state = 'open')
    into v_upheld, v_open
    from public.partner_complaints where partner_kind = p_kind and partner_id = p_id and not is_test;
  v_limit := (v_rules #>> '{complaints,upheld_limit}')::integer;
  v_c_comp := round(100 * greatest(0, 1 - v_upheld::numeric / v_limit), 1);

  -- score: weighted mean of the components that apply
  if v_c_turn is not null then v_acc := v_acc + v_c_turn * (v_w ->> 'turnaround')::numeric; v_wsum := v_wsum + (v_w ->> 'turnaround')::numeric; end if;
  v_acc := v_acc + v_c_comp * (v_w ->> 'complaints')::numeric; v_wsum := v_wsum + (v_w ->> 'complaints')::numeric;
  if v_c_lic is not null then v_acc := v_acc + v_c_lic * (v_w ->> 'licence')::numeric; v_wsum := v_wsum + (v_w ->> 'licence')::numeric; end if;
  v_score := round(v_acc / v_wsum, 1);

  -- breaches
  if v_lic_state = 'expired' then v_breaches := v_breaches || 'licence_expired'::text; end if;
  if v_upheld >= v_limit then v_breaches := v_breaches || 'complaints_upheld_limit'::text; end if;
  if v_c_turn is not null and v_within < v_min_pct then v_breaches := v_breaches || 'turnaround_below_target'::text; end if;
  if v_score < (v_rules #>> '{score,suspend_below}')::numeric then v_breaches := v_breaches || 'score_below_floor'::text; end if;

  insert into public.partner_quality as q (partner_kind, partner_id, period_month, config_version, turnaround_target_hours, turnaround_actual_median_hours,
         orders_measured, pct_within_target, complaints_upheld, complaints_open, licence_expires_at, licence_state, score, components, breaches, computed_at)
  values (p_kind, p_id, v_month, v_cfg.version, v_target, round(v_median, 1), v_n, round(v_within, 1), v_upheld, v_open, v_exp, v_lic_state, v_score,
          jsonb_strip_nulls(jsonb_build_object('turnaround', v_c_turn, 'complaints', v_c_comp, 'licence', v_c_lic)), v_breaches, p_now)
  on conflict (partner_kind, partner_id, period_month) do update set
    config_version = excluded.config_version, turnaround_target_hours = excluded.turnaround_target_hours,
    turnaround_actual_median_hours = excluded.turnaround_actual_median_hours, orders_measured = excluded.orders_measured,
    pct_within_target = excluded.pct_within_target, complaints_upheld = excluded.complaints_upheld, complaints_open = excluded.complaints_open,
    licence_expires_at = excluded.licence_expires_at, licence_state = excluded.licence_state, score = excluded.score,
    components = excluded.components, breaches = excluded.breaches, computed_at = excluded.computed_at
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.compute_partner_quality(text, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Applying the rule: suspend from NEW work, emit the event, tell the desk
-- ---------------------------------------------------------------------------
create function private.partner_set_status(p_kind text, p_id uuid, p_to text, p_source text, p_actor uuid, p_codes text[], p_reason text,
                                           p_config integer, p_quality uuid, p_override_until timestamptz default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_from text;
begin
  select state into v_from from public.partner_work_status where partner_kind = p_kind and partner_id = p_id for update;
  v_from := coalesce(v_from, 'open');
  insert into public.partner_work_status as s (partner_kind, partner_id, state, reason_codes, suspended_at, suspended_by_rule, suspended_by,
                                                override_until, reinstated_at, reinstated_by, reinstated_reason, updated_at)
  values (p_kind, p_id, p_to, case when p_to = 'suspended' then p_codes else '{}' end,
          case when p_to = 'suspended' then now() end, case when p_source = 'rule' and p_to = 'suspended' then p_config end,
          case when p_source = 'person' and p_to = 'suspended' then p_actor end,
          p_override_until, case when p_to = 'open' then now() end, case when p_to = 'open' then p_actor end,
          case when p_to = 'open' then p_reason end, now())
  on conflict (partner_kind, partner_id) do update set
    state = excluded.state, reason_codes = excluded.reason_codes,
    suspended_at = case when excluded.state = 'suspended' then excluded.suspended_at else s.suspended_at end,
    suspended_by_rule = case when excluded.state = 'suspended' then excluded.suspended_by_rule else s.suspended_by_rule end,
    suspended_by = case when excluded.state = 'suspended' then excluded.suspended_by else s.suspended_by end,
    override_until = excluded.override_until,
    reinstated_at = case when excluded.state = 'open' then excluded.reinstated_at else s.reinstated_at end,
    reinstated_by = case when excluded.state = 'open' then excluded.reinstated_by else s.reinstated_by end,
    reinstated_reason = case when excluded.state = 'open' then excluded.reinstated_reason else s.reinstated_reason end,
    updated_at = now();
  insert into public.partner_work_status_log (partner_kind, partner_id, from_state, to_state, source, actor_id, reason_codes, reason, config_version, quality_id)
  values (p_kind, p_id, v_from, p_to, p_source, p_actor, coalesce(p_codes, '{}'), p_reason, p_config, p_quality);
end $$;
revoke all on function private.partner_set_status(text, uuid, text, text, uuid, text[], text, integer, uuid, timestamptz) from public, anon, authenticated;

create function private.partner_notify_desk(p_org uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' and is_active and organisation_id = p_org and not is_test loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (p_org, r.id, 'in_app', 'pending', 'partner_quality_attention', '{}'::jsonb);
  end loop;
  perform private.notify_clinical_leads(p_org, false, 'A partner needs a look', 'A partner quality check needs your attention. Open the partner quality page.', '{}'::jsonb);
end $$;
revoke all on function private.partner_notify_desk(uuid) from public, anon, authenticated;

create function private.apply_partner_quality(p_kind text, p_id uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  q public.partner_quality%rowtype;
  v_rem jsonb := private.partner_quality_setting('removal');
  v_on text[];
  v_hit text[];
  st public.partner_work_status%rowtype;
  v_suspend boolean := false;
  v_org uuid;
  v_id uuid;
begin
  v_id := private.compute_partner_quality(p_kind, p_id, p_now);
  select * into q from public.partner_quality where id = v_id;
  -- the event key below carries the breach set itself, so the event is idempotent per month and breach set.
  select array(select jsonb_array_elements_text(v_rem -> 'suspend_on')) into v_on;
  v_hit := array(select b from unnest(q.breaches) b where b = any (v_on));
  select * into st from public.partner_work_status where partner_kind = p_kind and partner_id = p_id;

  if coalesce((v_rem ->> 'auto_suspend')::boolean, false) and cardinality(v_hit) > 0 and coalesce(st.state, 'open') = 'open' then
    -- a person's override holds off a performance breach, never an expired licence
    v_suspend := 'licence_expired' = any (v_hit) or st.override_until is null or st.override_until <= p_now;
  end if;

  if v_suspend then
    perform private.partner_set_status(p_kind, p_id, 'suspended', 'rule', null, v_hit, 'Removed from new work by rule', q.config_version, q.id);
  end if;

  if cardinality(q.breaches) > 0 then
    v_org := private.partner_event_org(p_kind, p_id);
    if v_org is not null then
      perform private.emit_domain_event('partner.quality_breach', v_org,
        jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id, 'breaches', to_jsonb(q.breaches), 'suspended', v_suspend or coalesce(st.state, 'open') = 'suspended'),
        -- the key carries the RESULTING state, so the run that suspends and every later run that finds it already suspended share one key (one event, not two)
        'partner_quality_breach:' || p_kind || ':' || p_id || ':' || q.period_month || ':' || md5(array_to_string(q.breaches, ',')) || ':' || (v_suspend or coalesce(st.state, 'open') = 'suspended')::text,
        null, 'partner', p_id);
      if v_suspend or not exists (select 1 from public.notifications n where n.template = 'partner_quality_attention' and n.created_at > p_now - interval '1 day') then
        perform private.partner_notify_desk(v_org);
      end if;
    end if;
  end if;
  perform private.log_audit('partner.quality_computed', 'partner_quality', q.id,
    jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id, 'score', q.score, 'breaches', to_jsonb(q.breaches), 'suspended_now', v_suspend));
  return jsonb_build_object('quality_id', q.id, 'score', q.score, 'breaches', to_jsonb(q.breaches), 'suspended_now', v_suspend);
end $$;
revoke all on function private.apply_partner_quality(text, uuid, timestamptz) from public, anon, authenticated;

-- Nightly sweep (05:45 UTC). One partner failing never stops the others; failures open one ops incident.
create function private.partner_quality_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_done integer := 0; v_susp integer := 0; v_errors integer := 0; v jsonb;
begin
  for r in
    select 'lab'::text as k, id from public.lab_providers where is_active
    union all select 'pharmacy', id from public.pharmacy_partners where is_active
    union all select 'clinic', id from public.provider_organisations where is_operational
  loop
    begin
      v := private.apply_partner_quality(r.k, r.id);
      v_done := v_done + 1;
      if (v ->> 'suspended_now')::boolean then v_susp := v_susp + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'partner_quality_sweep failed for % %: %', r.k, r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (private.partner_event_org(r.k, r.id), 'partner.quality_error', 'partner', r.id, jsonb_build_object('partner_kind', r.k, 'error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'partner_quality_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev3', 'The partner quality sweep failed for some partners',
            format('%s partner(s) could not be checked by private.partner_quality_sweep(); see audit_log action partner.quality_error. They are still open to new work until a check succeeds.', v_errors),
            'partner_quality_sweep', now(), now());
  end if;
  return jsonb_build_object('checked', v_done, 'suspended', v_susp, 'errors', v_errors);
end $$;
revoke all on function private.partner_quality_sweep() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname = 'partner-quality-sweep';
  perform cron.schedule('partner-quality-sweep', '45 5 * * *', $c$select private.partner_quality_sweep()$c$);
end $$;

-- ---------------------------------------------------------------------------
-- 7. People: complaints, manual suspension, reinstatement (all audited; admin or the CMO)
-- ---------------------------------------------------------------------------
create function public.record_partner_complaint(p_kind text, p_id uuid, p_category text, p_reference_kind text default null, p_reference_id uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_org uuid := private.caller_org();
begin
  if not private.partner_desk_actor() or v_org is null then raise exception 'only an admin or the Chief Medical Officer can record a partner complaint' using errcode = '42501'; end if;
  if p_kind not in ('lab', 'pharmacy', 'clinic') or not private.partner_exists(p_kind, p_id) then raise exception 'partner_not_found' using errcode = '22023'; end if;
  insert into public.partner_complaints (organisation_id, partner_kind, partner_id, category, reference_kind, reference_id, note, raised_by, is_test)
  values (v_org, p_kind, p_id, p_category, p_reference_kind, p_reference_id, nullif(btrim(p_note), ''), v_uid,
          coalesce((select is_test from public.profiles where id = v_uid), false))
  returning id into v_id;
  perform private.log_audit('partner.complaint_recorded', 'partner_complaints', v_id, jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id, 'category', p_category));
  return v_id;
end $$;

create function public.resolve_partner_complaint(p_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.partner_complaints%rowtype;
begin
  if not private.partner_desk_actor() then raise exception 'only an admin or the Chief Medical Officer can resolve a partner complaint' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'dismissed') then raise exception 'outcome must be upheld or dismissed' using errcode = '22023'; end if;
  select * into c from public.partner_complaints where id = p_id and organisation_id = private.caller_org() for update;
  if not found then raise exception 'complaint_not_found' using errcode = '42501'; end if;
  if c.state <> 'open' then raise exception 'complaint_already_resolved' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say why in at least 10 characters' using errcode = '22023'; end if;
  update public.partner_complaints set state = p_outcome, resolved_by = v_uid, resolved_at = now(), resolution_note = btrim(p_note) where id = p_id;
  perform private.log_audit('partner.complaint_resolved', 'partner_complaints', p_id, jsonb_build_object('outcome', p_outcome, 'partner_kind', c.partner_kind, 'partner_id', c.partner_id));
end $$;

create function public.suspend_partner_from_new_work(p_kind text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.partner_desk_actor() then raise exception 'only an admin or the Chief Medical Officer can suspend a partner' using errcode = '42501'; end if;
  if p_kind not in ('lab', 'pharmacy', 'clinic') or not private.partner_exists(p_kind, p_id) then raise exception 'partner_not_found' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < (private.partner_quality_setting('removal') ->> 'reason_min_chars')::integer then
    raise exception 'say why in at least % characters', (private.partner_quality_setting('removal') ->> 'reason_min_chars') using errcode = '22023';
  end if;
  if not private.partner_open_for_new_work(p_kind, p_id) then return; end if;
  perform private.partner_set_status(p_kind, p_id, 'suspended', 'person', v_uid, array['person_decision'], btrim(p_reason), null, null);
  perform private.log_audit('partner.suspended', 'partner', p_id, jsonb_build_object('partner_kind', p_kind));
end $$;

create function public.reinstate_partner(p_kind text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rem jsonb := private.partner_quality_setting('removal');
  st public.partner_work_status%rowtype;
  v_lic text;
  v_org uuid;
begin
  if not private.partner_desk_actor() then raise exception 'only an admin or the Chief Medical Officer can reinstate a partner' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < (v_rem ->> 'reason_min_chars')::integer then
    raise exception 'say why in at least % characters', (v_rem ->> 'reason_min_chars') using errcode = '22023';
  end if;
  select * into st from public.partner_work_status where partner_kind = p_kind and partner_id = p_id for update;
  if not found or st.state <> 'suspended' then raise exception 'partner_not_suspended' using errcode = '22023'; end if;
  -- an expired licence is a hard stop: renew it first (re-read from the partner row, not from the old quality snapshot)
  if p_kind in ('lab', 'pharmacy') and exists (select 1 from private.partner_licence(p_kind, p_id) l where l.expires_at is not null and l.expires_at <= now()) then
    raise exception 'licence_expired_renew_first' using errcode = '55000';
  end if;
  perform private.partner_set_status(p_kind, p_id, 'open', 'person', v_uid, '{}', btrim(p_reason), null, null,
                                     now() + make_interval(days => (v_rem ->> 'override_days')::integer));
  perform private.log_audit('partner.reinstated', 'partner', p_id, jsonb_build_object('partner_kind', p_kind));
  v_org := private.partner_event_org(p_kind, p_id);
  if v_org is not null then
    perform private.emit_domain_event('partner.reinstated', v_org, jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id),
      'partner_reinstated:' || p_kind || ':' || p_id || ':' || extract(epoch from clock_timestamp())::bigint, null, 'partner', p_id);
  end if;
end $$;

-- The desk's overview: every partner with its latest quality row and work status. Audited read; no patient data in it.
create function public.partner_quality_overview() returns table (
  partner_kind text, partner_id uuid, partner_name text, is_active boolean, work_state text, reason_codes text[], score numeric,
  breaches text[], licence_state text, licence_expires_at timestamptz, pct_within_target numeric, orders_measured integer,
  complaints_upheld integer, complaints_open integer, computed_at timestamptz, override_until timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  -- like every other desk function here: refuse (42501) a caller who is not the partner desk, rather than quietly returning nothing
  if not private.partner_desk_actor() then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select p.k, p.id, p.name, p.active, coalesce(s.state, 'open'), coalesce(s.reason_codes, '{}'), q.score, coalesce(q.breaches, '{}'), q.licence_state,
         q.licence_expires_at, q.pct_within_target, q.orders_measured, q.complaints_upheld, q.complaints_open, q.computed_at, s.override_until
    from (select 'lab'::text as k, l.id, l.name, l.is_active as active from public.lab_providers l
          union all select 'pharmacy', ph.id, ph.name, ph.is_active from public.pharmacy_partners ph
          union all select 'clinic', po.id, coalesce(po.display_name, po.legal_name), po.is_operational from public.provider_organisations po) p
    left join public.partner_work_status s on s.partner_kind = p.k and s.partner_id = p.id
    left join lateral (select * from public.partner_quality x where x.partner_kind = p.k and x.partner_id = p.id order by x.period_month desc limit 1) q on true
   order by p.k, p.name;
end $$;

-- The partner's own view of how it is doing (no complaint notes, no other partner, no patient).
create function private.partner_of_caller() returns table (partner_kind text, partner_id uuid)
language sql stable security definer set search_path = ''
as $$
  select 'lab'::text, private.lab_partner_provider() where private.lab_partner_provider() is not null
  union all select 'pharmacy', private.pharmacist_partner() where private.pharmacist_partner() is not null
  union all
  select 'clinic', po.id from public.provider_org_members m
    join public.provider_organisations po on po.organisation_id = m.organisation_id
    join public.profiles pr on pr.id = m.profile_id
   where m.profile_id = (select auth.uid()) and m.is_active and pr.is_active and pr.role = 'provider_org_staff' and po.is_operational
     and m.org_role in ('owner', 'operations_manager', 'finance_manager') and private.module_enabled('provider_org_platform')
$$;
revoke all on function private.partner_of_caller() from public, anon;
grant execute on function private.partner_of_caller() to authenticated;

create function public.partner_my_quality() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p record; q public.partner_quality%rowtype; s public.partner_work_status%rowtype; v_c jsonb;
begin
  select * into p from private.partner_of_caller() limit 1;
  if not found then raise exception 'This view is for partner laboratories, pharmacies and clinics' using errcode = '42501'; end if;
  select * into q from public.partner_quality where partner_kind = p.partner_kind and partner_id = p.partner_id order by period_month desc limit 1;
  select * into s from public.partner_work_status where partner_kind = p.partner_kind and partner_id = p.partner_id;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'state', state, 'opened', created_at::date, 'resolved', resolved_at::date) order by created_at desc), '[]')
    into v_c from public.partner_complaints where partner_kind = p.partner_kind and partner_id = p.partner_id and not is_test;
  return jsonb_build_object('partner_kind', p.partner_kind, 'work_state', coalesce(s.state, 'open'), 'reason_codes', coalesce(s.reason_codes, '{}'),
    'score', q.score, 'breaches', coalesce(q.breaches, '{}'), 'licence_state', q.licence_state, 'licence_expires_at', q.licence_expires_at,
    'turnaround_target_hours', q.turnaround_target_hours, 'turnaround_median_hours', q.turnaround_actual_median_hours,
    'pct_within_target', q.pct_within_target, 'orders_measured', q.orders_measured, 'complaints_upheld', q.complaints_upheld,
    'complaints_open', q.complaints_open, 'complaints', v_c, 'computed_at', q.computed_at);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Removal from NEW work, enforced where work is created (triggers: no path goes round them)
-- ---------------------------------------------------------------------------
create function private.refuse_suspended_lab() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.provider_id is not null and (tg_op = 'INSERT' or old.provider_id is distinct from new.provider_id)
     and not private.partner_open_for_new_work('lab', new.provider_id) then
    raise exception 'partner_suspended_from_new_work' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.refuse_suspended_lab() from public, anon, authenticated;
create trigger lab_orders_refuse_suspended_lab before insert or update of provider_id on public.lab_orders
  for each row execute function private.refuse_suspended_lab();

create function private.refuse_suspended_pharmacy() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or old.pharmacy_partner_id is distinct from new.pharmacy_partner_id)
     and not private.partner_open_for_new_work('pharmacy', new.pharmacy_partner_id) then
    raise exception 'partner_suspended_from_new_work' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.refuse_suspended_pharmacy() from public, anon, authenticated;
create trigger prescription_collection_codes_refuse_suspended before insert or update of pharmacy_partner_id on public.prescription_collection_codes
  for each row execute function private.refuse_suspended_pharmacy();

-- The patient-facing "can be chosen" test (S28c) also hides a suspended pharmacy, so nobody is offered a pharmacy that would refuse them.
-- Live body read from 20261007141623_s28c_pharmacy_extras.sql; the only change is the last condition, marked S74.
create or replace function private.pharmacy_location_choosable(p_partner uuid, p_location uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
     where pp.id = p_partner and l.id = p_location and pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now()) and l.is_active and l.verified_at is not null
       and private.partner_open_for_new_work('pharmacy', pp.id))   -- S74
$$;
revoke all on function private.pharmacy_location_choosable(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Grants. Functions: signed-in only (revoke from public, never from anon alone: the PUBLIC pseudo-role carries the execute).
-- ---------------------------------------------------------------------------
revoke all on function public.record_partner_complaint(text, uuid, text, text, uuid, text) from public, anon;
revoke all on function public.resolve_partner_complaint(uuid, text, text) from public, anon;
revoke all on function public.suspend_partner_from_new_work(text, uuid, text) from public, anon;
revoke all on function public.reinstate_partner(text, uuid, text) from public, anon;
revoke all on function public.partner_quality_overview() from public, anon;
revoke all on function public.partner_my_quality() from public, anon;
grant execute on function public.record_partner_complaint(text, uuid, text, text, uuid, text) to authenticated;
grant execute on function public.resolve_partner_complaint(uuid, text, text) to authenticated;
grant execute on function public.suspend_partner_from_new_work(text, uuid, text) to authenticated;
grant execute on function public.reinstate_partner(text, uuid, text) to authenticated;
grant execute on function public.partner_quality_overview() to authenticated;
grant execute on function public.partner_my_quality() to authenticated;
revoke insert, update, delete, truncate on public.partner_complaints, public.partner_quality, public.partner_work_status, public.partner_work_status_log from authenticated;

-- ---------------------------------------------------------------------------
-- 10. Closing assertions
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['partner_quality_config', 'partner_complaints', 'partner_quality', 'partner_work_status', 'partner_work_status_log'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') then raise exception 'authenticated can write % directly', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.reinstate_partner(text,uuid,text)', 'EXECUTE') then raise exception 'anon can call reinstate_partner'; end if;
  if has_function_privilege('anon', 'public.partner_my_quality()', 'EXECUTE') then raise exception 'anon can call partner_my_quality'; end if;
  if not exists (select 1 from cron.job where jobname = 'partner-quality-sweep') then raise exception 'partner-quality-sweep was not scheduled'; end if;
end $$;
