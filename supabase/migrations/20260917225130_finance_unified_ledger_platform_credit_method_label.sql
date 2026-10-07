-- Tarragon Health — finance_unified_ledger: label the payment method for
-- platform credit rows instead of leaving it null.
--
-- Found during manual verification of 20260917214034 (which fixed payer
-- resolution for platform_credit journal entries): `method` was left as
-- `pt.provider::text`, which is always null for these rows — pt never
-- resolves for a platform_credit entry (its source_ref names a ledger entry,
-- not a payment_transactions row; see that migration's header). Cosmetic,
-- not a correctness bug like the payer gap was, but a finance user reading
-- "how was this paid" for a platform credit line item saw a blank instead of
-- an answer. Byte-identical to the live function except this one line.

create or replace function public.finance_unified_ledger(
  p_profile_id uuid default null,
  p_organisation_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  entry_id uuid,
  payment_transaction_id uuid,
  entry_date date,
  posted_at timestamptz,
  source text,
  service_label text,
  payer_profile_id uuid,
  payer_label text,
  recipient_label text,
  direction text,
  amount_minor bigint,
  currency public.currency,
  status text,
  method text,
  memo text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile_id is null and p_organisation_id is null then
    raise exception 'finance_unified_ledger requires p_profile_id or p_organisation_id'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id is not null
     and p_profile_id is distinct from (select auth.uid())
     and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_organisation_id is not null and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      je.id as entry_id,
      pt.id as payment_transaction_id,
      je.entry_date,
      je.created_at as posted_at,
      je.source,
      coalesce(
        private.payment_transaction_service_label(pt),
        case when je.source = 'platform_credit' then
          case pce.entry_type
            when 'topup' then 'Platform credit top-up'
            when 'admin_grant' then 'Platform credit granted'
            when 'spend' then 'Platform credit spend'
            when 'admin_correction' then 'Platform credit correction'
            else 'Platform credit'
          end
        else initcap(je.source) end
      ) as service_label,
      coalesce(private.resolve_payment_payer(pt), pce.patient_id) as payer_profile_id,
      (case when je.source = 'refund' then 'money_out' else 'money_in' end) as direction,
      coalesce(
        pt.amount_minor,
        -- pt is always null for a platform_credit row (its source_ref never
        -- matches a payment_transactions.id — see the header). A 'spend' can
        -- post TWO journal entries off one ledger row, one per bucket
        -- touched (spend-paid/spend-promo) — each must show only its own
        -- bucket's amount, not pce.amount_kobo's paid+promo total, or a
        -- dual-bucket spend would double-count. topup/grant/correction-* are
        -- single-bucket by construction (see private.platform_credit_apply),
        -- so amount_kobo already equals the right bucket there.
        case
          when je.source_ref like 'spend-paid:%' then pce.paid_amount_kobo
          when je.source_ref like 'spend-promo:%' then pce.promo_amount_kobo
          when je.source_ref like 'correction-paid:%' then pce.paid_amount_kobo
          when je.source_ref like 'correction-promo:%' then pce.promo_amount_kobo
          when pce.id is not null then pce.amount_kobo
          else null
        end,
        0
      ) as amount_minor,
      je.currency,
      'completed'::text as status,
      -- The actual change: pt.provider is always null here (see above), so
      -- name the method directly for a platform_credit row rather than
      -- leaving it blank. 'platform_credit' matches the payment_provider
      -- enum value service_purchases.payment_provider already uses for a
      -- credit-funded purchase, so it reads consistently with that column.
      coalesce(pt.provider::text, case when pce.id is not null then 'platform_credit' end) as method,
      je.memo,
      coalesce(pt.organisation_id, pce.organisation_id,
        (select l.organisation_id from public.finance_journal_lines l
          where l.entry_id = je.id and l.organisation_id is not null limit 1)) as organisation_id
    from public.finance_journal_entries je
    left join public.payment_transactions pt on pt.id::text = je.source_ref
    left join public.platform_credit_ledger_entries pce
      on je.source = 'platform_credit'
      and pce.id = private.parse_platform_credit_source_ref(je.source_ref)
    where je.entry_date >= coalesce(p_from, '1900-01-01'::date)
      and je.entry_date <= coalesce(p_to, '9999-12-31'::date)

    union all

    select
      null::uuid as entry_id,
      pt.id as payment_transaction_id,
      pt.created_at::date as entry_date,
      pt.created_at as posted_at,
      'payment'::text as source,
      coalesce(private.payment_transaction_service_label(pt), 'Payment attempt') as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      'money_in'::text as direction,
      coalesce(pt.amount_minor, 0) as amount_minor,
      pt.currency,
      'failed'::text as status,
      pt.provider::text as method,
      pt.error as memo,
      pt.organisation_id
    from public.payment_transactions pt
    where pt.error is not null
      and not exists (select 1 from public.finance_journal_entries je2 where je2.source_ref = pt.id::text)
      and pt.created_at::date >= coalesce(p_from, '1900-01-01'::date)
      and pt.created_at::date <= coalesce(p_to, '9999-12-31'::date)
  )
  select
    r.entry_id, r.payment_transaction_id, r.entry_date, r.posted_at, r.source,
    r.service_label, r.payer_profile_id,
    case when r.direction = 'money_in'
      then coalesce(nullif(trim(pr.full_name), ''), 'Patient')
      else 'Tarragon Health' end as payer_label,
    case when r.direction = 'money_in'
      then 'Tarragon Health'
      else coalesce(nullif(trim(pr.full_name), ''), 'Patient') end as recipient_label,
    r.direction, r.amount_minor, r.currency, r.status, r.method, r.memo
  from rows r
  left join public.profiles pr on pr.id = r.payer_profile_id
  where (p_profile_id is null or r.payer_profile_id = p_profile_id)
    and (p_organisation_id is null or r.organisation_id = p_organisation_id)
  order by r.posted_at desc
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from public;
revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from anon;
revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) to authenticated;

do $$
declare
  v_finance_user uuid;
  v_org uuid;
  v_entry_id uuid;
  v_method text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'finance_unified_ledger'
  ) then
    raise exception 'finance_unified_ledger was not created';
  end if;

  if has_function_privilege('anon', 'public.finance_unified_ledger(uuid, uuid, date, date, integer, integer)', 'EXECUTE') then
    raise exception 'anon must never execute finance_unified_ledger';
  end if;

  select id into v_finance_user from public.profiles where role = 'finance' limit 1;
  select pce.organisation_id, je.id into v_org, v_entry_id
    from public.finance_journal_entries je
    join public.platform_credit_ledger_entries pce
      on je.source = 'platform_credit' and pce.id = private.parse_platform_credit_source_ref(je.source_ref)
    limit 1;

  if v_finance_user is null or v_org is null then
    raise notice 'SKIPPED behavioral proof: no finance user or no platform_credit journal entry exists yet';
  else
    -- Simulate a real finance session — the function itself requires
    -- auth.uid() to match p_profile_id or private.is_finance() to be true,
    -- which running as the migration's own postgres role satisfies neither.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_finance_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select method into v_method
      from public.finance_unified_ledger(p_organisation_id := v_org, p_limit := 1000)
      where entry_id = v_entry_id;
    reset role;

    if v_method is distinct from 'platform_credit' then
      raise exception 'FAIL: a platform_credit journal entry did not get method=platform_credit (got %)', v_method;
    end if;
  end if;
end $$;
