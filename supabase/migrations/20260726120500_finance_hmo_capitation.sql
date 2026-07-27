-- Tarragon Health — Finance: HMO capitation register.
--
-- Nigeria's HMO capitation model (per-member-per-month, distinct from
-- fee-for-service) is a Non-Negotiable Business Rule item with no dedicated
-- GL treatment until now. A capitation contract belongs to an `organisations`
-- row of type 'hmo' — the same org record the /dashboard/hmo portal and
-- employer_roster_members already use, so this reuses that identity rather
-- than inventing a parallel partner directory. Each monthly receipt posts
-- Dr Bank / Cr Capitation revenue (4300), distinct from booking/subscription
-- revenue. `estimated_cost_of_care_minor` is an OPTIONAL, manually-entered,
-- honestly-labelled figure for a loss-ratio-style view — never a real claims
-- feed (Tarragon has no claims ledger), matching the "modeled estimate, not a
-- real claims feed" disclaimer already used on the HMO risk-dashboard.

insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('4300','Capitation revenue (HMO)','revenue','credit','exempt',64,'Per-member-per-month capitation receipts from HMO partners.')
on conflict (code) do nothing;

insert into public.permissions (key, label, category, description) values
  ('finance.capitation.manage', 'Manage HMO capitation', 'Finance', 'Create capitation contracts and record monthly capitation receipts.')
on conflict (key) do nothing;

create table public.finance_capitation_contracts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  contract_name   text not null,
  pmpm_rate_minor bigint not null check (pmpm_rate_minor > 0),
  currency        public.currency not null default 'NGN',
  effective_from  date not null,
  effective_to    date,
  is_active       boolean not null default true,
  notes           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.finance_capitation_contracts enable row level security;

create trigger finance_capitation_contracts_set_updated_at
  before update on public.finance_capitation_contracts
  for each row execute function private.set_updated_at();

create table public.finance_capitation_receipts (
  id                           uuid primary key default gen_random_uuid(),
  contract_id                  uuid not null references public.finance_capitation_contracts (id),
  period_month                 date not null,
  enrolled_members             integer not null check (enrolled_members >= 0),
  amount_minor                 bigint not null check (amount_minor > 0),
  received_date                date not null,
  bank_account_code            text references public.finance_accounts (code),
  estimated_cost_of_care_minor bigint,
  notes                        text,
  journal_entry_id             uuid references public.finance_journal_entries (id) on delete set null,
  created_by                   uuid references public.profiles (id) on delete set null,
  created_at                   timestamptz not null default now(),
  unique (contract_id, period_month)
);
alter table public.finance_capitation_receipts enable row level security;
create index finance_capitation_receipts_contract_idx on public.finance_capitation_receipts (contract_id);

create or replace function public.finance_upsert_capitation_contract(
  p_id uuid, p_organisation_id uuid, p_contract_name text, p_pmpm_rate_minor bigint,
  p_currency text, p_effective_from date, p_effective_to date, p_is_active boolean, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org_type public.organisation_type;
begin
  if not private.finance_can('finance.capitation.manage') then raise exception 'not authorised'; end if;
  select type into v_org_type from public.organisations where id = p_organisation_id;
  if v_org_type is null then raise exception 'organisation not found'; end if;
  if v_org_type <> 'hmo' then raise exception 'capitation contracts are for hmo-type organisations only' using errcode = 'check_violation'; end if;

  if p_id is null then
    insert into public.finance_capitation_contracts
      (organisation_id, contract_name, pmpm_rate_minor, currency, effective_from, effective_to, is_active, notes)
    values (p_organisation_id, p_contract_name, p_pmpm_rate_minor, coalesce(p_currency,'NGN')::public.currency,
            p_effective_from, p_effective_to, coalesce(p_is_active,true), p_notes)
    returning id into v_id;
  else
    update public.finance_capitation_contracts set
      organisation_id=p_organisation_id, contract_name=p_contract_name, pmpm_rate_minor=p_pmpm_rate_minor,
      currency=coalesce(p_currency,'NGN')::public.currency, effective_from=p_effective_from,
      effective_to=p_effective_to, is_active=coalesce(p_is_active,true), notes=p_notes, updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  perform private.log_audit('finance.capitation_contract.upsert', 'finance_capitation_contracts', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'pmpm_rate_minor', p_pmpm_rate_minor));
  return v_id;
end; $$;

create or replace function public.finance_record_capitation_receipt(
  p_contract_id uuid, p_period_month date, p_enrolled_members integer, p_amount_minor bigint,
  p_received_date date, p_bank_account_code text, p_estimated_cost_of_care_minor bigint, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.finance_capitation_contracts%rowtype; v_id uuid; v_entry uuid; v_month date := date_trunc('month', p_period_month)::date;
begin
  if not private.finance_can('finance.capitation.manage') then raise exception 'not authorised'; end if;
  select * into c from public.finance_capitation_contracts where id = p_contract_id;
  if c.id is null then raise exception 'capitation contract not found'; end if;
  if coalesce(p_amount_minor,0) <= 0 then raise exception 'receipt amount must be positive'; end if;

  insert into public.finance_capitation_receipts
    (contract_id, period_month, enrolled_members, amount_minor, received_date, bank_account_code,
     estimated_cost_of_care_minor, notes, created_by)
  values (p_contract_id, v_month, coalesce(p_enrolled_members,0), p_amount_minor, p_received_date,
          coalesce(p_bank_account_code,'1000'), p_estimated_cost_of_care_minor, p_notes, (select auth.uid()))
  returning id into v_id;

  v_entry := private.finance_post_journal(
    p_received_date, c.currency, 'manual', 'capitation:' || v_id::text,
    'Capitation receipt — ' || c.contract_name || ' (' || to_char(v_month,'YYYY-MM') || ')',
    jsonb_build_array(
      jsonb_build_object('account_code', coalesce(p_bank_account_code,'1000'), 'debit_minor', p_amount_minor, 'credit_minor', 0,
                         'organisation_id', c.organisation_id, 'cost_center_code', 'CORP_HMO'),
      jsonb_build_object('account_code', '4300', 'debit_minor', 0, 'credit_minor', p_amount_minor,
                         'organisation_id', c.organisation_id, 'cost_center_code', 'CORP_HMO')),
    (select auth.uid()));

  update public.finance_capitation_receipts set journal_entry_id = v_entry where id = v_id;
  perform private.log_audit('finance.capitation_receipt.record', 'finance_capitation_receipts', v_id,
    jsonb_build_object('contract_id', p_contract_id, 'period_month', v_month, 'amount_minor', p_amount_minor));
  return v_id;
end; $$;

-- Register: contracts + receipts + a PMPM-math and (optional, honestly-labelled)
-- loss-ratio view. roster_active_members is Tarragon's own claimed-roster count
-- for that org, shown only as context — HMOs may enrol members who never
-- claim a Tarragon account, so it will typically differ from the billed count.
create or replace function public.finance_capitation_register()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'organisation_id', c.organisation_id, 'organisation_name', o.name,
      'contract_name', c.contract_name, 'pmpm_rate_minor', c.pmpm_rate_minor, 'currency', c.currency,
      'effective_from', c.effective_from, 'effective_to', c.effective_to, 'is_active', c.is_active,
      'roster_active_members', (select count(*) from public.employer_roster_members m
        where m.organisation_id = c.organisation_id and m.status = 'claimed'),
      'receipts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'period_month', to_char(r.period_month,'YYYY-MM'), 'enrolled_members', r.enrolled_members,
          'amount_minor', r.amount_minor, 'received_date', r.received_date,
          'implied_pmpm_minor', case when r.enrolled_members > 0 then round(r.amount_minor::numeric / r.enrolled_members) else null end,
          'rate_variance_minor', case when r.enrolled_members > 0 then round(r.amount_minor::numeric / r.enrolled_members) - c.pmpm_rate_minor else null end,
          'estimated_cost_of_care_minor', r.estimated_cost_of_care_minor,
          'estimated_loss_ratio_pct', case when r.estimated_cost_of_care_minor is not null and r.amount_minor > 0
            then round((r.estimated_cost_of_care_minor::numeric / r.amount_minor) * 100, 1) else null end)
          order by r.period_month desc)
        from public.finance_capitation_receipts r where r.contract_id = c.id), '[]'::jsonb))
      order by c.is_active desc, o.name)
    from public.finance_capitation_contracts c join public.organisations o on o.id = c.organisation_id
  ), '[]'::jsonb);
end; $$;

create or replace function public.finance_hmo_organisations_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
    from public.organisations where type = 'hmo' and is_active), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
