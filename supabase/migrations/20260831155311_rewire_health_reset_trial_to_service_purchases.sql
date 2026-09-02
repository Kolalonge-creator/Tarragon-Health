-- Tarragon Health — Pay-per-service business model, Phase 1 (health reset trial)
--
-- public.claim_health_reset_trial() — the 30-day free Complete Care trial
-- awarded on finishing the 90-Day Health Reset — was found still inserting
-- into subscriptions/reading subscription_plans directly, another
-- duplicated-entitlement writer that would have silently granted nothing
-- (has_feature_access no longer reads those tables). Repointed at
-- service_purchases/service_products; the USD branch now falls back to the
-- NGN complete_pack since every USD service_product/subscription_plan row
-- is_active=false live (diaspora self-serve trials aren't currently
-- purchasable at all — the sponsor/voucher model replaced them 2026-07-31 —
-- so there is nothing to preserve there beyond not hard-erroring).

-- trial_subscription_id's FK pointed at subscriptions(id) — repoint at
-- service_purchases(id) so the function below can actually write to it.
alter table public.patient_health_resets
  drop constraint if exists patient_health_resets_trial_subscription_id_fkey;
alter table public.patient_health_resets
  add constraint patient_health_resets_trial_subscription_id_fkey
  foreign key (trial_subscription_id) references public.service_purchases (id) on delete set null;

create or replace function public.claim_health_reset_trial()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reset public.patient_health_resets;
  v_already_paid boolean;
  v_product_id uuid;
  v_period_end timestamptz := now() + interval '30 days';
  v_purchase_id uuid;
begin
  select * into v_reset from public.patient_health_resets where patient_id = (select auth.uid());
  if v_reset.id is null then
    raise exception 'No health reset found for this account' using errcode = 'check_violation';
  end if;
  if v_reset.completed_at is null then
    raise exception 'Your 90-Day Health Reset is not complete yet' using errcode = 'check_violation';
  end if;
  if v_reset.trial_claimed_at is not null then
    raise exception 'You have already claimed this trial' using errcode = 'check_violation';
  end if;

  select exists(
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = (select auth.uid())
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p.code <> 'free_pack'
  ) into v_already_paid;
  if v_already_paid then
    raise exception 'You already have an active paid plan' using errcode = 'check_violation';
  end if;

  select id into v_product_id from public.service_products where code = 'complete_pack' and is_active limit 1;
  if v_product_id is null then
    raise exception 'The trial plan is not currently available' using errcode = 'check_violation';
  end if;

  insert into public.service_purchases (
    organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
    amount_kobo, currency, purchased_at, expires_at
  )
  values (
    v_reset.organisation_id, (select auth.uid()), (select auth.uid()), v_product_id, 'active',
    0, 'NGN', now(), v_period_end
  )
  returning id into v_purchase_id;

  update public.patient_health_resets
    set trial_claimed_at = now(), trial_subscription_id = v_purchase_id
    where id = v_reset.id;

  return jsonb_build_object('subscription_id', v_purchase_id, 'current_period_end', v_period_end);
end;
$function$;

do $$
begin
  if pg_get_functiondef('public.claim_health_reset_trial()'::regprocedure) ~ 'from public\.subscriptions' then
    raise exception 'claim_health_reset_trial still reads the retired subscriptions table';
  end if;
  raise notice 'PASS: claim_health_reset_trial repointed to service_purchases/service_products';
end $$;
