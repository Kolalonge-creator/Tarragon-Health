-- Tarragon Health — Finance: make every finance_company_profile_upsert
-- parameter `default null` (behaviour unchanged — every field was already
-- nullif'd to NULL in the body). Without a SQL default, the Supabase
-- typegen types a param as strictly required/non-null even though Postgres
-- accepts an explicit NULL for any non-STRICT function — see the reference_
-- rpc_args_null_typegen_regression memory. Doing this before regenerating
-- database.types.ts keeps every field optional (`?:`) on the TypeScript
-- side instead of forcing an `as unknown as` cast onto all 19 of them.

create or replace function public.finance_company_profile_upsert(
  p_legal_name text default null, p_trading_name text default null, p_rc_number text default null,
  p_tin text default null, p_vat_registration_number text default null, p_nsitf_number text default null,
  p_itf_number text default null, p_pension_pfa_code text default null, p_registered_address text default null,
  p_principal_business_activity text default null, p_incorporation_date date default null,
  p_financial_year_end text default null, p_registered_email text default null,
  p_registered_phone text default null, p_directors_text text default null,
  p_company_secretary_name text default null, p_auditor_name text default null,
  p_bank_name text default null, p_bank_account_name text default null, p_bank_account_number text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised'; end if;

  update public.finance_company_profile set
    legal_name = nullif(p_legal_name, ''),
    trading_name = nullif(p_trading_name, ''),
    rc_number = nullif(p_rc_number, ''),
    tin = nullif(p_tin, ''),
    vat_registration_number = nullif(p_vat_registration_number, ''),
    nsitf_number = nullif(p_nsitf_number, ''),
    itf_number = nullif(p_itf_number, ''),
    pension_pfa_code = nullif(p_pension_pfa_code, ''),
    registered_address = nullif(p_registered_address, ''),
    principal_business_activity = nullif(p_principal_business_activity, ''),
    incorporation_date = p_incorporation_date,
    financial_year_end = coalesce(nullif(p_financial_year_end, ''), '31 December'),
    registered_email = nullif(p_registered_email, ''),
    registered_phone = nullif(p_registered_phone, ''),
    directors_text = nullif(p_directors_text, ''),
    company_secretary_name = nullif(p_company_secretary_name, ''),
    auditor_name = nullif(p_auditor_name, ''),
    bank_name = nullif(p_bank_name, ''),
    bank_account_name = nullif(p_bank_account_name, ''),
    bank_account_number = nullif(p_bank_account_number, ''),
    updated_at = now(),
    updated_by = (select auth.uid())
  where singleton;

  perform private.log_audit('finance.company_profile.upsert', 'finance_company_profile', null,
    jsonb_build_object('legal_name', p_legal_name, 'rc_number', p_rc_number, 'tin', p_tin));
end; $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
