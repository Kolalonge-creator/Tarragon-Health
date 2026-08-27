-- Local/CI-only fix-forward, NOT a functional migration -- see
-- supabase/roles.sql's header for the full anon-execute background.
--
-- This function can't be pre-stubbed in roles.sql like most of its siblings,
-- because it takes a custom enum argument (public.payment_provider), and
-- roles.sql runs before EVERY migration including the one that creates any
-- custom type -- a stub referencing it there would fail with "type does not
-- exist". Placed here instead, one second before its real consumer,
-- 20260731215226_care_vouchers_purchase_and_layaway.sql. payment_provider
-- itself is long-established (created 20260705211343_b2b_billing.sql), so
-- referencing it at this point in history is safe.
--
-- MUST be a no-op on the live project, where this function already has its
-- real working body -- never overwrite that with this stub's dummy one.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_voucher_payment_intent'
  ) then
    execute $create$
      create function public.record_voucher_payment_intent(
        p_voucher uuid,
        p_amount_minor bigint,
        p_currency text,
        p_credit_kobo bigint,
        p_provider public.payment_provider,
        p_reference text
      )
      returns uuid
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        return null;
      end;
      $body$;
    $create$;

    execute 'revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public';
    execute 'revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from anon';
    execute 'grant execute on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated';
  end if;
end $$;
