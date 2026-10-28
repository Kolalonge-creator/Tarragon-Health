-- S79: Module 24 Institution console, gap closure (functions 24.1 to 24.6). Design: docs/design/S79.md. Research: docs/research/S79.md.
--
-- Counted first (this is a build against the repository, not a live count; re-check before apply): the module is new, so no row of any table created
-- here exists. No stored row of any older table is changed.
--
-- What this adds, all behind the platform switch institution_console (OFF; every new function calls private.assert_module_enabled):
--   1. institution_config: versioned PROPOSED rules (mirrored in packages/shared proposed-config institution.rules, a test fails on drift).
--   2. Programme configuration (24.2): institution_programme_configs, a versioned REQUEST from sponsor staff that Tarragon approves. It reads the programmes,
--      campaigns and sponsored items that already exist. The rewards budget is a requested number only, never a balance (INV-09; OQ-S58-06 pool waits).
--   3. Usage billing (24.4): usage_records (append-only, integer kobo, NO person column) rolled up from committed sponsor reservations, and usage_statements
--      (one frozen statement per sponsor per month, lines under the minimum folded into "other services"), linked to an existing employer invoice by finance.
--   4. Procurement and renewal pack (24.6): sponsor_procurement_pack, built only from frozen suppressed snapshots, statements, the sponsor's own contract and
--      the approved configuration, audited before anything is returned.
--   5. Privacy ledger (24.3): sponsor_privacy_ledger lists which tiles were withheld and why (reason codes only, never a count below the minimum).
--   6. Eligibility upload (24.1): roster_upload_batches/rows, staged -> approved -> committed, add/remove/replace, row-level error report, leavers end the
--      employer link through the existing employer_mark_departed (the person's account and record are untouched), commit reuses employer_bulk_upsert_roster.
--   7. One enrolment-code entry (24.1): enter_enrolment_code checks employer join codes and programme codes together, refuses an ambiguous code, shares the
--      ten-an-hour guess limit; a trigger stops a new code equal to a code in the other table; admin_enrolment_code_overlap is a read-only report.
--      The two tables are NOT merged.
--   8. sponsor_code_sheet: the codes a sponsor hands out (for the printable QR sheet), audited.
-- I8: nothing here prices or pays by head or by capitation. I9: every table is revoked from users and reached only through functions that return aggregates;
-- no function returns a person id, name, phone or email to a sponsor role. Reproductive, pregnancy and mental health data are read by nothing here.

-- ---------------------------------------------------------------------------
-- 0. Platform switch (OFF) and versioned rules
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('institution_console', 'Institution console gap closure (S79)',
   'Programme configuration requests, usage statements, procurement pack, privacy ledger, staged eligibility upload and the single enrolment-code entry. Off until the CMO has confirmed the pathway list, finance has agreed the statement layout, counsel has seen the procurement pack and the founder has said yes.')
on conflict (key) do nothing;

create table public.institution_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index institution_config_one_active on public.institution_config ((true)) where is_active;
alter table public.institution_config add constraint institution_config_rules_valid check (
  jsonb_typeof(rules) = 'object'
  and (rules ->> 'roster_stage_max_rows') ~ '^[0-9]+$' and (rules ->> 'roster_stage_max_rows')::integer between 1 and 5000
  and (rules ->> 'roster_end_second_approver_pct') ~ '^[0-9]+$' and (rules ->> 'roster_end_second_approver_pct')::integer between 1 and 100
  and (rules ->> 'roster_batch_expiry_days') ~ '^[0-9]+$' and (rules ->> 'roster_batch_expiry_days')::integer between 1 and 30
  and (rules ->> 'rewards_budget_max_kobo') ~ '^[0-9]+$' and (rules ->> 'rewards_budget_max_kobo')::bigint between 0 and 100000000000
  and jsonb_typeof(rules -> 'programme_pathways') = 'array' and jsonb_array_length(rules -> 'programme_pathways') between 1 and 20);

-- institution-rules-v1-begin (the code registry entry institution.rules must equal this; a test fails if they drift)
insert into public.institution_config (version, is_active, effective_from, rules) values (1, true, '2026-10-27', $json$
{"roster_stage_max_rows":5000,"roster_end_second_approver_pct":30,"roster_batch_expiry_days":7,"rewards_budget_max_kobo":5000000000,"programme_pathways":["hypertension","diabetes","prevention_screening","nutrition_and_activity"]}
$json$::jsonb);
-- institution-rules-v1-end
alter table public.institution_config enable row level security;
revoke all on public.institution_config from public, anon, authenticated;

create function private.institution_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.institution_config where is_active $$;
revoke all on function private.institution_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Programme configuration requests (24.2)
-- ---------------------------------------------------------------------------
create table public.institution_programme_configs (
  id                  uuid primary key default gen_random_uuid(),
  sponsor_org_id      uuid not null references public.organisations (id) on delete restrict,
  version             integer not null check (version >= 1),
  status              text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'superseded')),
  pathways            text[] not null default '{}',
  item_codes          text[] not null default '{}' check (cardinality(item_codes) <= 40),
  campaign_ids        uuid[] not null default '{}' check (cardinality(campaign_ids) <= 40),
  rewards_budget_kobo bigint not null default 0 check (rewards_budget_kobo >= 0 and rewards_budget_kobo <= 100000000000),
  note                text check (note is null or char_length(note) <= 1000),
  submitted_by        uuid references public.profiles (id) on delete set null,
  submitted_at        timestamptz not null default now(),
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  review_note         text check (review_note is null or char_length(review_note) <= 1000),
  is_test             boolean not null default false,
  unique (sponsor_org_id, version),
  check ((status in ('approved', 'rejected')) = (reviewed_at is not null) or status = 'superseded')
);
create index institution_programme_configs_sponsor_idx on public.institution_programme_configs (sponsor_org_id, version desc);
alter table public.institution_programme_configs enable row level security;
revoke all on public.institution_programme_configs from public, anon, authenticated;

-- What a request SAYS cannot change; only its status and review fields move, forward.
create function private.institution_configs_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'institution_config_immutable' using errcode = 'P0001'; end if;
  if new.sponsor_org_id is distinct from old.sponsor_org_id or new.version is distinct from old.version or new.pathways is distinct from old.pathways
     or new.item_codes is distinct from old.item_codes or new.campaign_ids is distinct from old.campaign_ids
     or new.rewards_budget_kobo is distinct from old.rewards_budget_kobo or new.note is distinct from old.note
     or new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at then
    raise exception 'institution_config_immutable' using errcode = 'P0001';
  end if;
  if old.status in ('approved', 'rejected', 'superseded') and new.status is distinct from old.status
     and not (old.status = 'approved' and new.status = 'superseded') then
    raise exception 'institution_config_bad_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.institution_configs_guard() from public, anon, authenticated;
create trigger institution_configs_guard before update or delete on public.institution_programme_configs
  for each row execute function private.institution_configs_guard();

create function public.institution_config_submit(p_pathways text[], p_item_codes text[], p_campaign_ids uuid[], p_rewards_budget_kobo bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.sponsor_staff_org(); v_rules jsonb; v_allowed text[]; v_ver integer; v_id uuid; c text; k uuid;
  v_paths text[] := coalesce(p_pathways, '{}'); v_items text[] := coalesce(p_item_codes, '{}'); v_camps uuid[] := coalesce(p_campaign_ids, '{}');
  v_is_test boolean;
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  v_rules := private.institution_rules();
  select array_agg(x) into v_allowed from jsonb_array_elements_text(v_rules -> 'programme_pathways') x;
  foreach c in array v_paths loop
    -- a pathway must be one of the proposed list; reproductive, pregnancy and mental health pathways are not on it and cannot be added by a sponsor
    if not (c = any (v_allowed)) then raise exception 'institution_config_invalid' using errcode = '22023'; end if;
  end loop;
  foreach c in array v_items loop
    if not exists (select 1 from public.catalog_items ci where ci.code = c) then raise exception 'institution_config_invalid' using errcode = '22023'; end if;
  end loop;
  foreach k in array v_camps loop
    if not exists (select 1 from public.prevention_campaigns pc where pc.id = k and pc.organisation_id = v_org)
       and not exists (select 1 from public.employer_campaigns ec where ec.id = k and ec.organisation_id = v_org) then
      raise exception 'institution_config_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_rewards_budget_kobo is null or p_rewards_budget_kobo < 0 or p_rewards_budget_kobo > (v_rules ->> 'rewards_budget_max_kobo')::bigint then
    raise exception 'institution_config_invalid' using errcode = '22023';
  end if;
  if cardinality(v_paths) = 0 and cardinality(v_items) = 0 and cardinality(v_camps) = 0 and p_rewards_budget_kobo = 0 then
    raise exception 'institution_config_invalid' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.institution_programme_configs where sponsor_org_id = v_org;
  update public.institution_programme_configs set status = 'superseded' where sponsor_org_id = v_org and status = 'submitted';
  select coalesce(pr.is_test, false) into v_is_test from public.profiles pr where pr.id = (select auth.uid());
  insert into public.institution_programme_configs (sponsor_org_id, version, pathways, item_codes, campaign_ids, rewards_budget_kobo, note, submitted_by, is_test)
  values (v_org, v_ver, v_paths, v_items, v_camps, p_rewards_budget_kobo, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), coalesce(v_is_test, false)) returning id into v_id;
  perform private.log_audit('sponsor.config_submitted', 'institution_programme_config', v_id, jsonb_build_object('version', v_ver, 'rewards_budget_kobo', p_rewards_budget_kobo));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver);
end $$;
revoke all on function public.institution_config_submit(text[], text[], uuid[], bigint, text) from public, anon;
grant execute on function public.institution_config_submit(text[], text[], uuid[], bigint, text) to authenticated;

-- The one screen: what exists (programmes, campaigns, sponsored items) next to what the sponsor has asked for. Aggregate and the sponsor's own money only.
create function public.institution_config_current() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.config_viewed', 'organisation', v_org, '{}'::jsonb);
  return jsonb_build_object(
    'allowed_pathways', private.institution_rules() -> 'programme_pathways',
    'rewards_budget_max_kobo', (private.institution_rules() ->> 'rewards_budget_max_kobo')::bigint,
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'kind', kind) order by kind, code)
                         from (select distinct ci.code, ci.kind from public.catalog_items ci where ci.active) i), '[]'::jsonb),
    'programmes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'item_codes', p.item_codes, 'share_percent', p.share_percent,
                       'budget_kobo', p.budget_kobo, 'budget_left_kobo', private.sponsor_budget_left(p.id), 'per_person_cap_kobo', p.per_person_cap_kobo,
                       'valid_from', p.valid_from, 'valid_to', p.valid_to) order by p.created_at desc)
                         from public.sponsor_programmes p where p.sponsor_org_id = v_org and not p.is_test), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x ->> 'name') from (
                    select jsonb_build_object('id', pc.id, 'name', pc.name, 'status', pc.status::text, 'kind', 'prevention') x from public.prevention_campaigns pc where pc.organisation_id = v_org
                    union all
                    select jsonb_build_object('id', ec.id, 'name', ec.name, 'status', ec.status::text, 'kind', 'employer') from public.employer_campaigns ec where ec.organisation_id = v_org) u), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status, 'pathways', r.pathways, 'item_codes', r.item_codes,
                       'campaign_ids', r.campaign_ids, 'rewards_budget_kobo', r.rewards_budget_kobo, 'note', r.note, 'submitted_at', r.submitted_at,
                       'review_note', r.review_note) order by r.version desc)
                         from (select * from public.institution_programme_configs where sponsor_org_id = v_org order by version desc limit 10) r), '[]'::jsonb));
end $$;
revoke all on function public.institution_config_current() from public, anon;
grant execute on function public.institution_config_current() to authenticated;

create function public.admin_review_institution_config(p_id uuid, p_approve boolean, p_note text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare r public.institution_programme_configs%rowtype;
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  select * into r from public.institution_programme_configs where id = p_id for update;
  if not found or r.status <> 'submitted' then return false; end if;
  if p_approve is not true and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'institution_config_reason_required' using errcode = '22023'; end if;
  if p_approve then
    update public.institution_programme_configs set status = 'superseded' where sponsor_org_id = r.sponsor_org_id and status = 'approved';
  end if;
  update public.institution_programme_configs
     set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  perform private.log_audit('sponsor.config_reviewed', 'institution_programme_config', p_id, jsonb_build_object('approved', p_approve));
  return true;
end $$;
revoke all on function public.admin_review_institution_config(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_institution_config(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Usage records and statements (24.4). No person column anywhere.
-- ---------------------------------------------------------------------------
create table public.usage_records (
  id             uuid primary key default gen_random_uuid(),
  sponsor_org_id uuid not null references public.organisations (id) on delete restrict,
  programme_id   uuid not null references public.sponsor_programmes (id) on delete restrict,
  service_code   text not null check (char_length(service_code) between 1 and 80),
  period         date not null check (period = date_trunc('month', period)::date),
  kind           text not null check (kind in ('usage', 'adjustment')),
  units          integer not null,
  amount_kobo    bigint not null,
  created_at     timestamptz not null default now(),
  is_test        boolean not null default false,
  check (kind = 'adjustment' or (units > 0 and amount_kobo > 0)),
  check (kind = 'usage' or units <> 0 or amount_kobo <> 0)
);
create index usage_records_sponsor_period_idx on public.usage_records (sponsor_org_id, period);
create index usage_records_key_idx on public.usage_records (programme_id, service_code, period, is_test);
alter table public.usage_records enable row level security;
revoke all on public.usage_records from public, anon, authenticated;

create function private.usage_write_once() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'usage_records_write_once' using errcode = 'P0001'; end $$;
revoke all on function private.usage_write_once() from public, anon, authenticated;
create trigger usage_records_write_once before update or delete on public.usage_records for each row execute function private.usage_write_once();

create table public.usage_statements (
  id             uuid primary key default gen_random_uuid(),
  sponsor_org_id uuid not null references public.organisations (id) on delete restrict,
  period         date not null check (period = date_trunc('month', period)::date),
  payload        jsonb not null,
  total_kobo     bigint not null check (total_kobo >= 0),
  generated_at   timestamptz not null default now(),
  unique (sponsor_org_id, period)
);
alter table public.usage_statements enable row level security;
revoke all on public.usage_statements from public, anon, authenticated;
create trigger usage_statements_write_once before update or delete on public.usage_statements for each row execute function private.usage_write_once();

create table public.usage_statement_invoice_links (
  statement_id uuid primary key references public.usage_statements (id) on delete restrict,
  invoice_id   uuid not null references public.employer_invoices (id) on delete restrict,
  linked_by    uuid references public.profiles (id) on delete set null,
  linked_at    timestamptz not null default now()
);
alter table public.usage_statement_invoice_links enable row level security;
revoke all on public.usage_statement_invoice_links from public, anon, authenticated;
create trigger usage_links_write_once before update or delete on public.usage_statement_invoice_links for each row execute function private.usage_write_once();

-- Roll one Lagos month of committed sponsor reservations into usage_records. Idempotent: a second run writes nothing; a reservation committed or
-- refunded after the first run writes one adjustment row with the difference (rows are never edited).
create function private.roll_up_usage(p_month date) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_start timestamptz := v_month::timestamp at time zone 'Africa/Lagos';
  v_end   timestamptz := (v_month + interval '1 month')::timestamp at time zone 'Africa/Lagos';
  r record; v_n integer := 0;
begin
  for r in
    with cur as (
      select res.programme_id, sp.sponsor_org_id, ci.code as service_code, res.is_test, count(*)::bigint as units, sum(res.amount_kobo)::bigint as amt
        from public.sponsor_reservations res
        join public.sponsor_programmes sp on sp.id = res.programme_id
        join public.orders o on o.id = res.order_id
        join public.catalog_items ci on ci.id = o.catalog_item_id
       where res.state = 'committed' and res.settled_at >= v_start and res.settled_at < v_end
       group by res.programme_id, sp.sponsor_org_id, ci.code, res.is_test),
    rec as (
      select programme_id, sponsor_org_id, service_code, is_test, sum(units)::bigint as units, sum(amount_kobo)::bigint as amt
        from public.usage_records where period = v_month group by programme_id, sponsor_org_id, service_code, is_test)
    select coalesce(c.programme_id, x.programme_id) as programme_id, coalesce(c.sponsor_org_id, x.sponsor_org_id) as sponsor_org_id,
           coalesce(c.service_code, x.service_code) as service_code, coalesce(c.is_test, x.is_test) as is_test,
           coalesce(c.units, 0) - coalesce(x.units, 0) as du, coalesce(c.amt, 0) - coalesce(x.amt, 0) as da, (x.programme_id is null) as first_time
      from cur c full join rec x on x.programme_id = c.programme_id and x.service_code = c.service_code and x.is_test = c.is_test
     where coalesce(c.units, 0) - coalesce(x.units, 0) <> 0 or coalesce(c.amt, 0) - coalesce(x.amt, 0) <> 0
  loop
    insert into public.usage_records (sponsor_org_id, programme_id, service_code, period, kind, units, amount_kobo, is_test)
    values (r.sponsor_org_id, r.programme_id, r.service_code, v_month, case when r.first_time then 'usage' else 'adjustment' end, r.du::integer, r.da, r.is_test);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.roll_up_usage(date) from public, anon, authenticated;

-- One frozen statement per sponsor for the month that closed (from the third day of the month). A service line is shown only when enough different
-- people used it (the single minimum-cell rule); smaller lines are folded into one amount, "other services", with no service name and no unit count.
create function private.generate_usage_statements(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_start timestamptz := v_month::timestamp at time zone 'Africa/Lagos';
  v_end   timestamptz := (v_month + interval '1 month')::timestamp at time zone 'Africa/Lagos';
  s record; l record; v_min integer; v_lines jsonb; v_other bigint; v_folded integer; v_total bigint; v_supp jsonb; v_people bigint; v_n integer := 0; v_name text;
begin
  if not private.module_enabled('institution_console') or extract(day from v_today) < 3 then return 0; end if;
  perform private.roll_up_usage(v_month);
  for s in
    select ur.sponsor_org_id, ur.is_test from public.usage_records ur
     where ur.period = v_month group by ur.sponsor_org_id, ur.is_test
       having sum(ur.units) <> 0 or sum(ur.amount_kobo) <> 0
  loop
    continue when s.is_test;
    continue when exists (select 1 from public.usage_statements us where us.sponsor_org_id = s.sponsor_org_id and us.period = v_month);
    select o.name, private.min_cell_floor(o.min_cohort_size) into v_name, v_min from public.organisations o where o.id = s.sponsor_org_id;
    v_lines := '[]'::jsonb; v_other := 0; v_folded := 0; v_total := 0;
    for l in
      select ur.service_code, sum(ur.units)::bigint as units, sum(ur.amount_kobo)::bigint as amt
        from public.usage_records ur where ur.sponsor_org_id = s.sponsor_org_id and ur.period = v_month and not ur.is_test
       group by ur.service_code having sum(ur.units) <> 0 or sum(ur.amount_kobo) <> 0 order by ur.service_code
    loop
      select count(distinct res.beneficiary_id) into v_people
        from public.sponsor_reservations res
        join public.sponsor_programmes sp on sp.id = res.programme_id and sp.sponsor_org_id = s.sponsor_org_id
        join public.orders o on o.id = res.order_id
        join public.catalog_items ci on ci.id = o.catalog_item_id and ci.code = l.service_code
       where res.state = 'committed' and not res.is_test and res.settled_at >= v_start and res.settled_at < v_end;
      v_total := v_total + l.amt;
      if private.suppress_cell(v_people, null, v_min) is null then
        v_lines := v_lines || jsonb_build_object('service_code', l.service_code, 'units', l.units, 'amount_kobo', l.amt);
      else
        v_other := v_other + l.amt; v_folded := v_folded + 1;
      end if;
    end loop;
    continue when v_total <= 0 and jsonb_array_length(v_lines) = 0;
    v_supp := case when v_folded > 0 then jsonb_build_array(jsonb_build_object('tile', 'service_lines', 'reason', 'under_minimum', 'count', v_folded)) else '[]'::jsonb end;
    insert into public.usage_statements (sponsor_org_id, period, payload, total_kobo)
    values (s.sponsor_org_id, v_month, jsonb_build_object('sponsor', v_name, 'period', v_month, 'lines', v_lines, 'other_services_kobo', v_other, 'total_kobo', v_total,
              'suppressed', v_supp, 'minimum_cell', v_min, 'note', 'Amounts are whole kobo. A service used by fewer people than the minimum is combined into other services so that no person can be picked out.'), v_total);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.generate_usage_statements(timestamptz) from public, anon, authenticated;
select cron.schedule('usage-statements', '20 3 * * *', $$ select private.generate_usage_statements(); $$);

create function public.sponsor_usage_statements() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.usage_viewed', 'organisation', v_org, '{}'::jsonb);
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'period', x.period, 'total_kobo', x.total_kobo, 'statement', x.payload,
           'invoice', case when i.id is null then null else jsonb_build_object('id', i.id, 'status', i.status::text, 'amount_kobo', i.amount_kobo, 'due_at', i.due_at) end) order by x.period desc)
      from (select * from public.usage_statements where sponsor_org_id = v_org order by period desc limit 24) x
      left join public.usage_statement_invoice_links l on l.statement_id = x.id
      left join public.employer_invoices i on i.id = l.invoice_id), '[]'::jsonb);
end $$;
revoke all on function public.sponsor_usage_statements() from public, anon;
grant execute on function public.sponsor_usage_statements() to authenticated;

create function public.admin_link_usage_statement(p_statement uuid, p_invoice uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare st public.usage_statements%rowtype; inv public.employer_invoices%rowtype;
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or not (private.is_finance() or private.is_admin()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  select * into st from public.usage_statements where id = p_statement;
  select * into inv from public.employer_invoices where id = p_invoice;
  if st.id is null or inv.id is null or inv.organisation_id <> st.sponsor_org_id or inv.status = 'void' then raise exception 'usage_link_invalid' using errcode = '22023'; end if;
  insert into public.usage_statement_invoice_links (statement_id, invoice_id, linked_by) values (p_statement, p_invoice, (select auth.uid()))
  on conflict (statement_id) do nothing;
  if not found then return false; end if;
  perform private.log_audit('sponsor.usage_linked', 'usage_statement', p_statement, jsonb_build_object('invoice', p_invoice));
  return true;
end $$;
revoke all on function public.admin_link_usage_statement(uuid, uuid) from public, anon;
grant execute on function public.admin_link_usage_statement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Privacy ledger (24.3) and the procurement pack (24.6)
-- ---------------------------------------------------------------------------
create function private.sponsor_ledger_entries(p_sponsor uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(e order by e ->> 'period' desc, e ->> 'programme', e ->> 'tile'), '[]'::jsonb) from (
    select jsonb_build_object('period', s.period, 'programme', c.name, 'tile', k.key, 'reason', coalesce(k.value ->> 'reason', 'withheld')) as e
      from public.sponsor_report_snapshots s
      join public.sponsor_cohorts c on c.id = s.cohort_id and not c.is_test
      cross join lateral jsonb_each(case when jsonb_typeof(s.payload) = 'object' then s.payload else '{}'::jsonb end) k
     where s.sponsor_org_id = p_sponsor and not s.held_back and jsonb_typeof(k.value) = 'object' and k.value ->> 'suppressed' = 'true'
    union all
    select jsonb_build_object('period', s.period, 'programme', c.name, 'tile', 'month', 'reason', 'held_back_small_change')
      from public.sponsor_report_snapshots s join public.sponsor_cohorts c on c.id = s.cohort_id and not c.is_test
     where s.sponsor_org_id = p_sponsor and s.held_back
    union all
    select jsonb_build_object('period', us.period, 'programme', 'Usage statement', 'tile', sp ->> 'tile', 'reason', sp ->> 'reason', 'count', sp -> 'count')
      from public.usage_statements us cross join lateral jsonb_array_elements(us.payload -> 'suppressed') sp
     where us.sponsor_org_id = p_sponsor
     limit 300) u
$$;
revoke all on function private.sponsor_ledger_entries(uuid) from public, anon, authenticated;

create function public.sponsor_privacy_ledger() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.ledger_viewed', 'organisation', v_org, '{}'::jsonb);
  return jsonb_build_object('minimum_cell', private.min_cell_floor((select min_cohort_size from public.organisations where id = v_org)), 'entries', private.sponsor_ledger_entries(v_org));
end $$;
revoke all on function public.sponsor_privacy_ledger() from public, anon;
grant execute on function public.sponsor_privacy_ledger() to authenticated;

-- The pack. The access is audited before the data is built, one row per programme in the same shape log_sponsor_staff_export writes, and a pack-level row.
create function public.sponsor_procurement_pack(p_format text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org(); v_min integer; v_name text; c record; v_programmes jsonb := '[]'::jsonb; v_snap record;
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if p_format is null or p_format not in ('csv', 'pdf') then raise exception 'pack_format_invalid' using errcode = '22023'; end if;
  select o.name, private.min_cell_floor(o.min_cohort_size) into v_name, v_min from public.organisations o where o.id = v_org;
  for c in select * from public.sponsor_cohorts where sponsor_org_id = v_org and not is_test order by created_at desc loop
    perform private.log_audit('sponsor.staff_exported', 'sponsor_cohort', c.id, jsonb_build_object('format', p_format, 'pack', true));
    select s.period, s.held_back, s.payload into v_snap from public.sponsor_report_snapshots s where s.cohort_id = c.id and not s.held_back order by s.period desc limit 1;
    v_programmes := v_programmes || jsonb_build_object('name', c.name, 'status', c.status, 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                      'latest_period', v_snap.period, 'figures', v_snap.payload);
  end loop;
  perform private.log_audit('sponsor.pack_exported', 'organisation', v_org, jsonb_build_object('format', p_format, 'programmes', jsonb_array_length(v_programmes)));
  return jsonb_build_object(
    'sponsor', v_name, 'generated_at', now(), 'format', p_format, 'minimum_cell', v_min,
    'programmes', v_programmes,
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'status', k.status::text, 'effective_from', k.effective_from, 'effective_to', k.effective_to,
                  'per_employee_per_year_kobo', k.per_employee_per_year_kobo, 'employee_count', k.employee_count) order by k.created_at desc)
                  from public.corporate_contracts k where k.organisation_id = v_org), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('period', x.period, 'total_kobo', x.total_kobo, 'lines', x.payload -> 'lines', 'other_services_kobo', x.payload -> 'other_services_kobo') order by x.period desc)
                  from (select * from public.usage_statements where sponsor_org_id = v_org order by period desc limit 12) x), '[]'::jsonb),
    'configuration', (select jsonb_build_object('version', r.version, 'pathways', r.pathways, 'item_codes', r.item_codes, 'rewards_budget_kobo', r.rewards_budget_kobo, 'approved_at', r.reviewed_at)
                  from public.institution_programme_configs r where r.sponsor_org_id = v_org and r.status = 'approved' order by r.version desc limit 1),
    'privacy_ledger', private.sponsor_ledger_entries(v_org),
    'methodology', 'Figures are about the members of each programme who agreed to share group figures, as a group. They are written once a month and never refreshed. A figure for a group smaller than the minimum is not shown, and nor is any figure that could reveal it; a month that differs from the last published one by only a few people is held back. Blood pressure control is counted at day 90 with people who stopped logging counted as not controlled. Adherence and engagement are shown separately and are not outcomes. Nothing here is a claim that the programme caused a change. Reproductive, pregnancy and mental health information is never included. Amounts are whole kobo; a service used by fewer people than the minimum is combined into other services.');
end $$;
revoke all on function public.sponsor_procurement_pack(text) from public, anon;
grant execute on function public.sponsor_procurement_pack(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staged eligibility upload (24.1)
-- ---------------------------------------------------------------------------
create table public.roster_upload_batches (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  mode            text not null check (mode in ('add', 'remove', 'replace')),
  filename        text check (filename is null or char_length(filename) <= 200),
  status          text not null default 'staged' check (status in ('staged', 'approved', 'committed', 'cancelled', 'expired')),
  row_count       integer not null check (row_count >= 0),
  summary         jsonb not null default '{}'::jsonb,
  staged_by       uuid references public.profiles (id) on delete set null,
  staged_at       timestamptz not null default now(),
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz,
  committed_at    timestamptz,
  cancelled_at    timestamptz,
  is_test         boolean not null default false,
  check ((status in ('approved', 'committed')) = (approved_at is not null) or status in ('cancelled', 'expired')),
  check ((status = 'committed') = (committed_at is not null))
);
create index roster_upload_batches_org_idx on public.roster_upload_batches (organisation_id, staged_at desc);
alter table public.roster_upload_batches enable row level security;
revoke all on public.roster_upload_batches from public, anon, authenticated;

create table public.roster_upload_rows (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.roster_upload_batches (id) on delete cascade,
  row_no           integer not null,
  kind             text not null default 'file' check (kind in ('file', 'absent')),
  status           text not null check (status in ('ok', 'error')),
  planned_action   text not null check (planned_action in ('insert', 'update', 'end', 'none')),
  error            text check (error is null or char_length(error) <= 300),
  note             text check (note is null or char_length(note) <= 300),
  roster_member_id uuid references public.employer_roster_members (id) on delete set null,
  -- the normalised values the commit will apply; blanked after commit, cancel or expiry so the staging table does not keep personal data
  norm             jsonb,
  mask             text,
  unique (batch_id, row_no, kind)
);
create index roster_upload_rows_batch_idx on public.roster_upload_rows (batch_id);
alter table public.roster_upload_rows enable row level security;
revoke all on public.roster_upload_rows from public, anon, authenticated;

-- A phone number from a payroll export: spaces and dashes removed; a Nigerian local number (0803...) becomes +234803...
create function private.roster_normalise_phone(p text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when regexp_replace(p, '[\s\-().]', '', 'g') ~ '^0[789][01][0-9]{8}$' then '+234' || substr(regexp_replace(p, '[\s\-().]', '', 'g'), 2)
    when regexp_replace(p, '[\s\-().]', '', 'g') ~ '^234[789][01][0-9]{8}$' then '+' || regexp_replace(p, '[\s\-().]', '', 'g')
    else regexp_replace(p, '[\s\-().]', '', 'g') end
$$;
revoke all on function private.roster_normalise_phone(text) from public, anon, authenticated;

create function private.roster_mask(p_phone text, p_email text) returns text
language sql immutable set search_path = ''
as $$
  select case when p_phone is not null then '+...' || right(p_phone, 4)
              when p_email is not null then left(p_email, 1) || '***@' || split_part(p_email, '@', 2) else '' end
$$;
revoke all on function private.roster_mask(text, text) from public, anon, authenticated;

create function public.employer_stage_roster_upload(p_organisation_id uuid, p_mode text, p_rows jsonb, p_filename text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rules jsonb := private.institution_rules(); v_batch uuid; v_row jsonb; v_i integer := 0; v_phone text; v_email text; v_dept uuid; v_loc uuid; v_ref text;
  v_status text; v_from date; v_until date; v_existing public.employer_roster_members%rowtype; v_err text; v_note text; v_action text; v_norm jsonb;
  v_seen_keys text[] := '{}'; v_matched uuid[] := '{}'; v_ins integer := 0; v_upd integer := 0; v_end integer := 0; v_none integer := 0; v_errs integer := 0;
  v_active integer; v_absent integer := 0; a record; v_is_test boolean;
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or not private.can_manage_employer(p_organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('add', 'remove', 'replace') then raise exception 'roster_mode_invalid' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'roster_rows_invalid' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > (v_rules ->> 'roster_stage_max_rows')::integer then raise exception 'roster_rows_invalid' using errcode = '22023'; end if;
  select coalesce(pr.is_test, false) into v_is_test from public.profiles pr where pr.id = (select auth.uid());
  insert into public.roster_upload_batches (organisation_id, mode, filename, row_count, staged_by, is_test)
  values (p_organisation_id, p_mode, nullif(left(btrim(coalesce(p_filename, '')), 200), ''), jsonb_array_length(p_rows), (select auth.uid()), coalesce(v_is_test, false)) returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1; v_err := null; v_note := null; v_action := 'none'; v_dept := null; v_loc := null; v_existing := null; v_norm := null;
    v_phone := private.roster_normalise_phone(v_row ->> 'phone');
    v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');
    v_ref := nullif(btrim(coalesce(v_row ->> 'employee_reference', '')), '');
    v_status := nullif(lower(btrim(coalesce(v_row ->> 'employment_status', ''))), '');
    begin v_from := nullif(btrim(coalesce(v_row ->> 'eligible_from', '')), '')::date; v_until := nullif(btrim(coalesce(v_row ->> 'eligible_until', '')), '')::date;
    exception when others then v_from := null; v_until := null; v_err := 'eligibility date is not a valid date'; end;

    -- find the person (even when the row is otherwise wrong, so a replace file never treats them as absent)
    select * into v_existing from public.employer_roster_members m
     where m.organisation_id = p_organisation_id
       and ((v_phone is not null and m.phone = v_phone) or (v_email is not null and lower(btrim(m.email)) = v_email) or (v_ref is not null and m.employee_reference = v_ref))
     order by (m.status in ('pending', 'invited', 'claimed')) desc, m.created_at limit 1;
    if v_existing.id is not null then v_matched := v_matched || v_existing.id; end if;

    if v_err is null and v_phone is null and v_email is null then v_err := 'no phone or email'; end if;
    if v_err is null and v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_err := 'phone is not a valid number'; end if;
    if v_err is null and v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_err := 'email is not valid'; end if;
    if v_err is null and v_status is not null and v_status not in ('full_time', 'part_time', 'contract', 'nysc', 'intern') then v_err := 'employment status is not one of the allowed values'; end if;
    if v_err is null and v_from is not null and v_until is not null and v_until < v_from then v_err := 'eligible until is before eligible from'; end if;
    if v_err is null and nullif(btrim(coalesce(v_row ->> 'department', '')), '') is not null then
      select id into v_dept from public.employer_departments where organisation_id = p_organisation_id and lower(btrim(name)) = lower(btrim(v_row ->> 'department'));
      if v_dept is null then v_err := 'unknown department: ' || left(v_row ->> 'department', 80); end if;
    end if;
    if v_err is null and nullif(btrim(coalesce(v_row ->> 'location', '')), '') is not null then
      select id into v_loc from public.employer_locations where organisation_id = p_organisation_id and lower(btrim(name)) = lower(btrim(v_row ->> 'location'));
      if v_loc is null then v_err := 'unknown location: ' || left(v_row ->> 'location', 80); end if;
    end if;
    if v_err is null then
      -- the same person twice in one file
      if (coalesce('p:' || v_phone, '') <> '' and ('p:' || v_phone) = any (v_seen_keys)) or (v_email is not null and ('e:' || v_email) = any (v_seen_keys))
         or (v_ref is not null and ('r:' || v_ref) = any (v_seen_keys)) then
        v_err := 'this person appears more than once in the file';
      else
        if v_phone is not null then v_seen_keys := v_seen_keys || ('p:' || v_phone); end if;
        if v_email is not null then v_seen_keys := v_seen_keys || ('e:' || v_email); end if;
        if v_ref is not null then v_seen_keys := v_seen_keys || ('r:' || v_ref); end if;
      end if;
    end if;

    if v_err is null then
      if p_mode = 'remove' then
        if v_existing.id is null then v_note := 'not on the roster; nothing to end';
        elsif v_existing.status in ('departed', 'removed') then v_note := 'already left';
        else v_action := 'end'; end if;
      else
        if v_existing.id is null then v_action := 'insert';
        elsif v_existing.status in ('departed', 'removed') then v_note := 'previously left; they can rejoin with the organisation code';
        else v_action := 'update'; end if;
        v_norm := jsonb_strip_nulls(jsonb_build_object('phone', v_phone, 'email', v_email, 'full_name', nullif(btrim(coalesce(v_row ->> 'full_name', '')), ''), 'employee_reference', v_ref,
                    'department', nullif(btrim(coalesce(v_row ->> 'department', '')), ''), 'location', nullif(btrim(coalesce(v_row ->> 'location', '')), ''),
                    'job_category', nullif(btrim(coalesce(v_row ->> 'job_category', '')), ''), 'employment_status', v_status,
                    'eligible_from', v_from, 'eligible_until', v_until));
      end if;
    end if;

    if v_err is not null then v_errs := v_errs + 1;
    elsif v_action = 'insert' then v_ins := v_ins + 1; elsif v_action = 'update' then v_upd := v_upd + 1; elsif v_action = 'end' then v_end := v_end + 1; else v_none := v_none + 1; end if;
    insert into public.roster_upload_rows (batch_id, row_no, status, planned_action, error, note, roster_member_id, norm, mask)
    values (v_batch, v_i, case when v_err is null then 'ok' else 'error' end, case when v_err is null then v_action else 'none' end, v_err, v_note, v_existing.id,
            case when v_err is null and v_action in ('insert', 'update') then v_norm end, private.roster_mask(v_phone, v_email));
  end loop;

  -- replace: anyone on the roster who is not in the file leaves (planned only; nothing is changed until approval and commit)
  if p_mode = 'replace' then
    for a in select m.id, m.phone, m.email from public.employer_roster_members m
              where m.organisation_id = p_organisation_id and m.status in ('pending', 'invited', 'claimed') and not (m.id = any (v_matched)) loop
      v_absent := v_absent + 1; v_end := v_end + 1;
      insert into public.roster_upload_rows (batch_id, row_no, kind, status, planned_action, note, roster_member_id, mask)
      values (v_batch, v_absent, 'absent', 'ok', 'end', 'not in the file', a.id, private.roster_mask(a.phone, a.email));
    end loop;
  end if;

  select count(*) into v_active from public.employer_roster_members where organisation_id = p_organisation_id and status in ('pending', 'invited', 'claimed');
  update public.roster_upload_batches set summary = jsonb_build_object('insert', v_ins, 'update', v_upd, 'end', v_end, 'no_change', v_none, 'errors', v_errs,
         'active_roster', v_active, 'end_share_pct', case when v_active > 0 then round(100.0 * v_end / v_active, 1) else 0 end)
   where id = v_batch;
  perform private.log_audit('employer_roster.upload_staged', 'roster_upload_batch', v_batch, jsonb_build_object('mode', p_mode, 'rows', v_i, 'errors', v_errs));
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'summary', (select summary from public.roster_upload_batches where id = v_batch));
end $$;
revoke all on function public.employer_stage_roster_upload(uuid, text, jsonb, text) from public, anon;
grant execute on function public.employer_stage_roster_upload(uuid, text, jsonb, text) to authenticated;

-- The preview: summary and rows with a masked contact and the planned action. Errors first.
create function public.employer_roster_upload_preview(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.roster_upload_batches%rowtype;
begin
  perform private.assert_module_enabled('institution_console');
  select * into b from public.roster_upload_batches where id = p_batch;
  if (select auth.uid()) is null or b.id is null or not private.can_manage_employer(b.organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  return jsonb_build_object('batch', jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'row_count', b.row_count, 'staged_at', b.staged_at, 'approved_at', b.approved_at, 'staged_by_you', b.staged_by = (select auth.uid())),
    'summary', b.summary,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('row', r.row_no, 'kind', r.kind, 'status', r.status, 'action', r.planned_action, 'error', r.error, 'note', r.note, 'contact', r.mask)
                       order by (r.status = 'error') desc, r.kind, r.row_no)
                       from (select * from public.roster_upload_rows where batch_id = p_batch order by (status = 'error') desc, kind, row_no limit 300) r), '[]'::jsonb));
end $$;
revoke all on function public.employer_roster_upload_preview(uuid) from public, anon;
grant execute on function public.employer_roster_upload_preview(uuid) to authenticated;

-- The row-level error report for download: every row with a problem or a note, and why. No full contact is repeated.
create function public.employer_roster_upload_report(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.roster_upload_batches%rowtype;
begin
  perform private.assert_module_enabled('institution_console');
  select * into b from public.roster_upload_batches where id = p_batch;
  if (select auth.uid()) is null or b.id is null or not private.can_manage_employer(b.organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('row', r.row_no, 'status', r.status, 'reason', coalesce(r.error, r.note), 'contact', r.mask) order by r.row_no)
                     from public.roster_upload_rows r where r.batch_id = p_batch and r.kind = 'file' and (r.status = 'error' or r.note is not null)), '[]'::jsonb);
end $$;
revoke all on function public.employer_roster_upload_report(uuid) from public, anon;
grant execute on function public.employer_roster_upload_report(uuid) to authenticated;

create function public.employer_approve_roster_upload(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.roster_upload_batches%rowtype; v_rules jsonb := private.institution_rules(); v_ends integer; v_share numeric; v_uid uuid := (select auth.uid());
begin
  perform private.assert_module_enabled('institution_console');
  select * into b from public.roster_upload_batches where id = p_batch for update;
  if v_uid is null or b.id is null or not private.can_manage_employer(b.organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  if b.status = 'staged' and b.staged_at < now() - make_interval(days => (v_rules ->> 'roster_batch_expiry_days')::integer) then
    update public.roster_upload_batches set status = 'expired' where id = b.id;
    update public.roster_upload_rows set norm = null where batch_id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if b.status <> 'staged' then return jsonb_build_object('ok', false, 'reason', 'not_staged'); end if;
  v_ends := coalesce((b.summary ->> 'end')::integer, 0); v_share := coalesce((b.summary ->> 'end_share_pct')::numeric, 0);
  -- a file that ends people is applied only when it is wholly clean: a partly wrong file must never end the wrong people
  if b.mode in ('remove', 'replace') and coalesce((b.summary ->> 'errors')::integer, 0) > 0 then return jsonb_build_object('ok', false, 'reason', 'has_errors'); end if;
  -- a second pair of eyes before people leave: a different person, or Tarragon staff
  if v_ends > 0 and b.staged_by = v_uid and not private.is_admin() and not private.is_org_staff(b.organisation_id) then return jsonb_build_object('ok', false, 'reason', 'second_approver_needed'); end if;
  -- a large share leaving: Tarragon only
  if v_ends > 0 and v_share >= (v_rules ->> 'roster_end_second_approver_pct')::numeric and not private.is_admin() then return jsonb_build_object('ok', false, 'reason', 'tarragon_approval_needed'); end if;
  update public.roster_upload_batches set status = 'approved', approved_by = v_uid, approved_at = now() where id = b.id;
  perform private.log_audit('employer_roster.upload_approved', 'roster_upload_batch', b.id, jsonb_build_object('mode', b.mode, 'ends', v_ends));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.employer_approve_roster_upload(uuid) from public, anon;
grant execute on function public.employer_approve_roster_upload(uuid) to authenticated;

create function public.employer_commit_roster_upload(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.roster_upload_batches%rowtype; v_rows jsonb; v_res jsonb; v_ended integer := 0; r record; v_uid uuid := (select auth.uid());
begin
  perform private.assert_module_enabled('institution_console');
  select * into b from public.roster_upload_batches where id = p_batch for update;
  if v_uid is null or b.id is null or not private.can_manage_employer(b.organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  if b.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  select coalesce(jsonb_agg(norm order by row_no), '[]'::jsonb) into v_rows from public.roster_upload_rows where batch_id = b.id and kind = 'file' and status = 'ok' and planned_action in ('insert', 'update');
  if jsonb_array_length(v_rows) > 0 then
    -- the existing upsert does the writing; it re-validates, and anything it would skip means the roster changed since staging, so the whole commit is undone
    v_res := public.employer_bulk_upsert_roster(b.organisation_id, v_rows, 'bulk_upload');
    if jsonb_array_length(v_res -> 'skipped') > 0 then raise exception 'roster_changed_since_staging' using errcode = 'P0001'; end if;
  end if;
  -- leavers: the employer link ends (employer_mark_departed); the person keeps their account and every row of their own record
  for r in select roster_member_id from public.roster_upload_rows where batch_id = b.id and planned_action = 'end' and roster_member_id is not null loop
    perform public.employer_mark_departed(r.roster_member_id, 'eligibility file (' || b.mode || ')');
    v_ended := v_ended + 1;
  end loop;
  update public.roster_upload_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.roster_upload_rows set norm = null where batch_id = b.id;
  perform private.log_audit('employer_roster.upload_committed', 'roster_upload_batch', b.id, jsonb_build_object('mode', b.mode, 'ended', v_ended, 'summary', b.summary));
  return jsonb_build_object('ok', true, 'applied', coalesce(v_res, '{}'::jsonb) - 'skipped', 'ended', v_ended);
end $$;
revoke all on function public.employer_commit_roster_upload(uuid) from public, anon;
grant execute on function public.employer_commit_roster_upload(uuid) to authenticated;

create function public.employer_cancel_roster_upload(p_batch uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare b public.roster_upload_batches%rowtype;
begin
  perform private.assert_module_enabled('institution_console');
  select * into b from public.roster_upload_batches where id = p_batch for update;
  if (select auth.uid()) is null or b.id is null or not private.can_manage_employer(b.organisation_id) then raise exception 'Not authorised for this organisation' using errcode = '42501'; end if;
  if b.status not in ('staged', 'approved') then return false; end if;
  update public.roster_upload_batches set status = 'cancelled', cancelled_at = now() where id = b.id;
  update public.roster_upload_rows set norm = null where batch_id = b.id;
  perform private.log_audit('employer_roster.upload_cancelled', 'roster_upload_batch', b.id, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.employer_cancel_roster_upload(uuid) from public, anon;
grant execute on function public.employer_cancel_roster_upload(uuid) to authenticated;

-- Staged values older than the expiry are blanked (a batch nobody finished does not keep personal data).
create function private.purge_roster_uploads() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_days integer := (private.institution_rules() ->> 'roster_batch_expiry_days')::integer; v_n integer;
begin
  update public.roster_upload_batches set status = 'expired' where status in ('staged', 'approved') and staged_at < now() - make_interval(days => v_days);
  update public.roster_upload_rows r set norm = null from public.roster_upload_batches b where b.id = r.batch_id and b.status in ('expired', 'committed', 'cancelled') and r.norm is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.purge_roster_uploads() from public, anon, authenticated;
select cron.schedule('roster-upload-purge', '50 3 * * *', $$ select private.purge_roster_uploads(); $$);

-- ---------------------------------------------------------------------------
-- 5. One enrolment-code entry, the overlap report, and the code sheet
-- ---------------------------------------------------------------------------
-- A programme code may never equal an employer join code, and the other way round. A cohort insert that collides raises unique_violation, which
-- admin_create_sponsor_cohort already retries with a fresh code.
create function private.enrolment_code_namespace_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'sponsor_cohorts' then
    if exists (select 1 from public.employer_accounts ea where ea.join_code = new.code) then raise exception 'enrolment_code_collision' using errcode = '23505'; end if;
  else
    if new.join_code is not null and exists (select 1 from public.sponsor_cohorts c where c.code = new.join_code) then raise exception 'enrolment_code_collision' using errcode = '23505'; end if;
  end if;
  return new;
end $$;
revoke all on function private.enrolment_code_namespace_guard() from public, anon, authenticated;
create trigger sponsor_cohorts_code_namespace before insert or update of code on public.sponsor_cohorts for each row execute function private.enrolment_code_namespace_guard();
create trigger employer_accounts_code_namespace before insert or update of join_code on public.employer_accounts for each row execute function private.enrolment_code_namespace_guard();

create function public.enter_enrolment_code(p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); p public.profiles%rowtype; v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := (now() at time zone 'Africa/Lagos')::date; v_emp boolean; v_coh boolean; v_r jsonb;
begin
  perform private.assert_module_enabled('institution_console');
  if v_uid is null then raise exception 'cohort_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active and not coalesce(is_dependent_account, false);
  if not found then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.cohort_join_attempts where patient_id = v_uid and at > now() - interval '1 hour') >= 10 then return jsonb_build_object('ok', false); end if;
  select exists (select 1 from public.employer_accounts ea join public.organisations o on o.id = ea.organisation_id where ea.join_code = v_norm and ea.went_live_at is not null and o.is_active) into v_emp;
  select exists (select 1 from public.sponsor_cohorts c where c.code = v_norm and c.organisation_id = p.organisation_id and c.status = 'active' and v_today between c.valid_from and c.valid_to) into v_coh;
  if v_emp and v_coh then
    -- should be impossible once the namespace guard exists; if old data ever collides, refuse and tell operations rather than guess which one was meant
    perform private.log_audit('enrolment_code.ambiguous', 'profile', v_uid, '{}'::jsonb);
    insert into public.cohort_join_attempts (organisation_id, patient_id) values (p.organisation_id, v_uid);
    return jsonb_build_object('ok', false);
  end if;
  if v_emp then
    begin
      perform public.employer_join_with_code(v_norm);
      return jsonb_build_object('ok', true, 'kind', 'employer');
    exception when others then
      delete from public.cohort_join_attempts where patient_id = v_uid and at < now() - interval '1 day';
      insert into public.cohort_join_attempts (organisation_id, patient_id) values (p.organisation_id, v_uid);
      return jsonb_build_object('ok', false);
    end;
  end if;
  if v_coh then
    v_r := public.join_cohort(v_norm);
    return v_r || jsonb_build_object('kind', 'programme');
  end if;
  delete from public.cohort_join_attempts where patient_id = v_uid and at < now() - interval '1 day';
  insert into public.cohort_join_attempts (organisation_id, patient_id) values (p.organisation_id, v_uid);
  return jsonb_build_object('ok', false);
end $$;
revoke all on function public.enter_enrolment_code(text) from public, anon;
grant execute on function public.enter_enrolment_code(text) to authenticated;

-- Read only. Codes that exist in both tables, and organisations that run both an employer code and a live programme code.
create function public.admin_enrolment_code_overlap() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('enrolment_code.overlap_viewed', 'platform', null, '{}'::jsonb);
  return jsonb_build_object(
    'employer_codes', (select count(*) from public.employer_accounts where join_code is not null),
    'programme_codes', (select count(*) from public.sponsor_cohorts where status = 'active'),
    'collisions', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'employer_org', ea.organisation_id, 'sponsor_org', c.sponsor_org_id, 'cohort_id', c.id))
                     from public.sponsor_cohorts c join public.employer_accounts ea on ea.join_code = c.code), '[]'::jsonb),
    'organisations_with_both', coalesce((select jsonb_agg(jsonb_build_object('organisation_id', o.id, 'name', o.name, 'live_programme_codes', x.n))
                     from public.employer_accounts ea join public.organisations o on o.id = ea.organisation_id
                     join (select sponsor_org_id, count(*) n from public.sponsor_cohorts where status = 'active' group by sponsor_org_id) x on x.sponsor_org_id = ea.organisation_id
                    where ea.join_code is not null), '[]'::jsonb));
end $$;
revoke all on function public.admin_enrolment_code_overlap() from public, anon;
grant execute on function public.admin_enrolment_code_overlap() to authenticated;

-- The codes a sponsor hands out (for the printable sheet). Active only; audited.
create function public.sponsor_code_sheet() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org();
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or v_org is null then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.code_sheet_viewed', 'organisation', v_org, '{}'::jsonb);
  return jsonb_build_object('sponsor', (select name from public.organisations where id = v_org),
    'organisation_code', (select ea.join_code from public.employer_accounts ea where ea.organisation_id = v_org and ea.went_live_at is not null),
    'programmes', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'code', c.code, 'valid_to', c.valid_to) order by c.created_at desc)
                              from public.sponsor_cohorts c where c.sponsor_org_id = v_org and c.status = 'active' and not c.is_test
                               and (now() at time zone 'Africa/Lagos')::date between c.valid_from and c.valid_to), '[]'::jsonb));
end $$;
revoke all on function public.sponsor_code_sheet() from public, anon;
grant execute on function public.sponsor_code_sheet() to authenticated;

-- The admin worklist for the console: requests waiting for review, recent statements with the invoices they could be linked to.
create function public.admin_institution_console() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_module_enabled('institution_console');
  if (select auth.uid()) is null or not (private.is_admin() or private.is_finance()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  perform private.log_audit('sponsor.console_worklist_viewed', 'platform', null, '{}'::jsonb);
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sponsor', o.name, 'version', r.version, 'pathways', r.pathways, 'item_codes', r.item_codes,
                'campaigns', cardinality(r.campaign_ids), 'rewards_budget_kobo', r.rewards_budget_kobo, 'note', r.note, 'submitted_at', r.submitted_at) order by r.submitted_at)
                from public.institution_programme_configs r join public.organisations o on o.id = r.sponsor_org_id where r.status = 'submitted' and not r.is_test), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'sponsor', o.name, 'period', x.period, 'total_kobo', x.total_kobo, 'invoice_id', l.invoice_id,
                'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'period_start', i.period_start, 'period_end', i.period_end, 'amount_kobo', i.amount_kobo, 'status', i.status::text) order by i.period_start desc)
                                       from public.employer_invoices i where i.organisation_id = x.sponsor_org_id and i.status <> 'void'), '[]'::jsonb)) order by x.period desc, o.name)
                from (select * from public.usage_statements order by period desc limit 60) x join public.organisations o on o.id = x.sponsor_org_id
                left join public.usage_statement_invoice_links l on l.statement_id = x.id), '[]'::jsonb));
end $$;
revoke all on function public.admin_institution_console() from public, anon;
grant execute on function public.admin_institution_console() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['institution_config', 'institution_programme_configs', 'usage_records', 'usage_statements', 'usage_statement_invoice_links', 'roster_upload_batches', 'roster_upload_rows'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT') or has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'S79: % is readable directly', t;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('usage_records', 'usage_statements') and column_name in ('patient_id', 'beneficiary_id', 'profile_id', 'user_id')) then
    raise exception 'S79: a usage table has a person column';
  end if;
  foreach t in array array['public.institution_config_submit(text[],text[],uuid[],bigint,text)', 'public.institution_config_current()', 'public.admin_review_institution_config(uuid,boolean,text)',
      'public.sponsor_usage_statements()', 'public.admin_link_usage_statement(uuid,uuid)', 'public.sponsor_privacy_ledger()', 'public.sponsor_procurement_pack(text)',
      'public.employer_stage_roster_upload(uuid,text,jsonb,text)', 'public.employer_roster_upload_preview(uuid)', 'public.employer_roster_upload_report(uuid)',
      'public.employer_approve_roster_upload(uuid)', 'public.employer_commit_roster_upload(uuid)', 'public.employer_cancel_roster_upload(uuid)', 'public.enter_enrolment_code(text)',
      'public.admin_enrolment_code_overlap()', 'public.sponsor_code_sheet()', 'public.admin_institution_console()'] loop
    if has_function_privilege('anon', t, 'EXECUTE') then raise exception 'S79: anon can execute %', t; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.roll_up_usage(date)', 'EXECUTE') or has_function_privilege('authenticated', 'private.generate_usage_statements(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sponsor_ledger_entries(uuid)', 'EXECUTE') then
    raise exception 'S79: a private helper is callable by users';
  end if;
  if (select is_enabled from public.platform_modules where key = 'institution_console') then raise exception 'S79: the module must ship OFF'; end if;
end $$;
