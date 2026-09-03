-- Proves the three sponsor-acting RPCs and the monthly report.
--
-- These exist because the founder ruled out dedicated per-patient staff on
-- 2026-07-31. The jobs a coordinator would have done that software genuinely
-- can do are done here; the authorization line is the same everywhere, and it
-- is the thing most worth pinning down: 'manage' acts, 'view' only follows,
-- and a stranger does neither.
--
-- Rolled back. Fixtures resolved at runtime so it runs anywhere.
--
--   1. sponsor_book_care with an empty wallet books a real pending order and
--      reports the exact shortfall rather than failing.
--   2. The same call with a funded wallet books AND pays in one step.
--   3. A stranger cannot book care for someone.
--   4. sponsor_set_dependent_basics writes date of birth, sex and location.
--   5. A stranger cannot edit someone's details.
--   6. queue_sponsor_monthly_reports queues exactly one report per sponsor, on
--      two channels, non_clinical, and is idempotent inside its window.
begin;

do $$
declare
  v_org uuid; v_owner uuid; v_sponsor uuid; v_stranger uuid; v_wallet uuid;
  v_code text; v_price bigint; v_res jsonb;
  v_dob date; v_sex text; v_state text;
  v_queued int; v_rows int; v_classes text;
begin
  select id, organisation_id into v_owner, v_org
    from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_sponsor
    from public.profiles where role = 'patient' and id <> v_owner order by created_at limit 1;
  select id into v_stranger
    from public.profiles where role = 'patient' and id not in (v_owner, v_sponsor)
    order by created_at limit 1;

  if v_stranger is null then raise exception 'need three patient profiles'; end if;

  -- The region trigger is real and will reject a dark state, which is correct.
  update public.profiles set state = 'Lagos' where id = v_owner;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_sponsor, 'manage', v_owner) on conflict do nothing;

  select code, price_kobo into v_code, v_price
    from public.panel_bundles where self_bookable and price_kobo > 0 order by price_kobo limit 1;

  insert into public.health_wallets (organisation_id, profile_id, balance_kobo)
  values (v_org, v_owner, 0)
  on conflict (profile_id) do update set balance_kobo = 0
  returning id into v_wallet;

  ------------------------------------------------------- 1. booked, unpaid
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.sponsor_book_care(v_owner, v_code, null) into v_res;
  perform set_config('role', 'postgres', true);

  if (v_res->>'paid')::boolean then
    raise exception 'FAIL 1: paid despite an empty wallet';
  end if;
  if (v_res->>'shortfall_kobo')::bigint <> v_price then
    raise exception 'FAIL 1: shortfall %, expected %', v_res->>'shortfall_kobo', v_price;
  end if;

  ------------------------------------------------------- 2. booked and paid
  update public.health_wallets set balance_kobo = v_price where id = v_wallet;
  perform set_config('role', 'authenticated', true);
  select public.sponsor_book_care(v_owner, v_code, null) into v_res;
  perform set_config('role', 'postgres', true);

  if not (v_res->>'paid')::boolean then
    raise exception 'FAIL 2: did not pay despite sufficient balance';
  end if;

  ------------------------------------------------------- 3. stranger blocked
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_book_care(v_owner, v_code, null);
    raise exception 'FAIL 3: a stranger booked care for someone';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ------------------------------------------------------- 4. basics written
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.sponsor_set_dependent_basics(v_owner, date '1955-03-04', 'female', 'Lagos', 'Ikeja');
  perform set_config('role', 'postgres', true);

  select date_of_birth, sex::text, state into v_dob, v_sex, v_state
    from public.profiles where id = v_owner;
  if v_dob <> date '1955-03-04' or v_sex <> 'female' or v_state <> 'Lagos' then
    raise exception 'FAIL 4: basics not written (dob=% sex=% state=%)', v_dob, v_sex, v_state;
  end if;

  ------------------------------------------------------- 5. stranger blocked
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_set_dependent_basics(v_owner, date '1900-01-01', null, null, null);
    raise exception 'FAIL 5: a stranger edited someone''s profile';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ------------------------------------------------------- 6. monthly report
  insert into public.wallet_ledger
    (organisation_id, wallet_id, entry_type, amount_kobo, balance_after_kobo, actor_profile_id)
  values (v_org, v_wallet, 'sponsor_topup', 5000000, 5000000, v_sponsor);

  select private.queue_sponsor_monthly_reports() into v_queued;
  if v_queued <> 1 then raise exception 'FAIL 6: queued % reports, expected 1', v_queued; end if;

  select count(*) into v_rows from public.notifications
   where template = 'sponsor_monthly_report' and recipient_id = v_sponsor;
  if v_rows <> 2 then raise exception 'FAIL 6: % rows, expected 2 (in_app + email)', v_rows; end if;

  select string_agg(distinct content_class::text, ',') into v_classes
    from public.notifications where template = 'sponsor_monthly_report';
  if v_classes <> 'non_clinical' then
    raise exception 'FAIL 6: content_class was %, expected non_clinical', v_classes;
  end if;

  select private.queue_sponsor_monthly_reports() into v_queued;
  if v_queued <> 0 then
    raise exception 'FAIL 6: a second run queued % reports; must be idempotent', v_queued;
  end if;

  raise notice 'PASS: booking, payment, permission gates, basics and the monthly report all behaved';
end $$;

rollback;
