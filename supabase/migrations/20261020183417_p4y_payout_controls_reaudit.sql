-- P4y: payout controls re-audit (provider layer completion). Two gaps in the S31x maker-checker, closed:
--
--   1. OQ-338 (decided): the CMO is the second payout approver. S31x only required that the releaser was a DIFFERENT person from the maker,
--      so two admins could pass a batch between them and the CMO was not needed. Now exactly one of maker and checker must be the Chief
--      Medical Officer (an admin proposes and the CMO releases, or the CMO proposes and an admin releases). Nothing releases if neither
--      is available, which is the decided behaviour.
--   2. The maker-checker flag was a configuration control, not a guard: any admin could switch `payout_batch_maker_checker` off and send
--      payouts without a batch. Now (a) `payouts_enabled` cannot be switched on while the flag is off, and (b) while `payouts_enabled`
--      is on the flag cannot be moved off 'on'. Neither guard nor flag is touched here: both stay OFF.
--
-- Counts before (live, 2026-10-20): payout_batches 0, payouts_enabled off, payout_batch_maker_checker off. Nothing to convert, no
-- data changes. release_payout_batch is rewritten from its LIVE definition (read with pg_get_functiondef, identical to the S31x file).

create function private.is_cmo_user(p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clinical_staff where profile_id = p_uid and active and status = 'active' and doctor_tier = 'chief_medical_officer');
$$;
revoke all on function private.is_cmo_user(uuid) from public, anon, authenticated;

create or replace function public.release_payout_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_approver_org();
  v_uid uuid := (select auth.uid());
  b public.payout_batches%rowtype;
  v_ids uuid[];
begin
  if not private.provider_flag_on('payout_batch_maker_checker') then raise exception 'payout_batch_control_off' using errcode = '55000'; end if;
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into b from public.payout_batches where id = p_batch and organisation_id = v_org for update;
  if not found then raise exception 'payout_batch_unknown' using errcode = '22023'; end if;
  if b.state <> 'proposed' then raise exception 'payout_batch_not_proposed' using errcode = '23514'; end if;
  if b.made_by = v_uid then raise exception 'payout_batch_self_release' using errcode = '42501'; end if;
  -- OQ-338: the CMO is the second approver. Exactly one of the two people is the CMO.
  if private.is_cmo_user(b.made_by) = private.is_cmo_user(v_uid) then raise exception 'payout_batch_needs_cmo_pair' using errcode = '42501'; end if;
  select array_agg(i.payout_id) into v_ids from public.payout_batch_items i where i.batch_id = b.id;
  if exists (select 1 from public.payouts p where p.id = any (v_ids) and p.clinician_id = v_uid) then raise exception 'payout_batch_pays_the_checker' using errcode = '42501'; end if;
  -- Everything is read again now: a payout that is no longer approved (or whose attempt moved on) sinks the batch.
  if exists (select 1 from public.payout_batch_items i join public.payouts p on p.id = i.payout_id
              where i.batch_id = b.id and (p.state <> 'approved' or i.transfer_attempt <> (select max(attempt) from public.payout_transfers t where t.payout_id = p.id))) then
    raise exception 'payout_batch_changed' using errcode = '55000';
  end if;
  perform private.payout_limits_check(v_ids, b.id);
  update public.payout_batches set state = 'released', checked_by = v_uid, checked_at = now() where id = b.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout_batch.released', 'payout_batch', b.id, jsonb_build_object('maker', b.made_by, 'payouts', b.payout_count, 'total_kobo', b.total_kobo));
  return jsonb_build_object('batch_id', b.id, 'state', 'released');
end;
$$;

-- The flag and the money guard are tied together (both directions). Raised with 55000, after the guard table's own 42501 check.
create function private.payout_guard_requires_maker_checker() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.key = 'payouts_enabled' and new.is_on and not coalesce(old.is_on, false) and not private.provider_flag_on('payout_batch_maker_checker') then
    raise exception 'payout_guard_needs_maker_checker: switch payout_batch_maker_checker on first' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.payout_guard_requires_maker_checker() from public, anon, authenticated;
create trigger go_live_guards_payout_controls before update on public.go_live_guards
  for each row execute function private.payout_guard_requires_maker_checker();

create function private.payout_flag_held_while_guard_on() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.key = 'payout_batch_maker_checker' and new.status::text <> 'on' and private.go_live_guard_on('payouts_enabled') then
    raise exception 'payout_maker_checker_held: payouts_enabled is on, so payout_batch_maker_checker cannot be turned off' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.payout_flag_held_while_guard_on() from public, anon, authenticated;
create trigger feature_flags_payout_controls_held before update on public.feature_flags
  for each row execute function private.payout_flag_held_while_guard_on();

-- Self-check: both triggers exist, the CMO helper is closed to clients, and the guard and flag are exactly as they were (both off).
do $$
begin
  if (select count(*) from pg_trigger where tgname in ('go_live_guards_payout_controls', 'feature_flags_payout_controls_held') and not tgisinternal) <> 2 then
    raise exception 'p4y: a trigger is missing';
  end if;
  if has_function_privilege('anon', 'private.is_cmo_user(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.is_cmo_user(uuid)', 'EXECUTE') then
    raise exception 'p4y: is_cmo_user must not be callable by clients';
  end if;
  if has_function_privilege('anon', 'public.release_payout_batch(uuid)', 'EXECUTE') then
    raise exception 'p4y: release_payout_batch must not be callable by anon';
  end if;
  if private.go_live_guard_on('payouts_enabled') or private.provider_flag_on('payout_batch_maker_checker') then
    raise exception 'p4y: the payout guard and the maker-checker flag must both still be off';
  end if;
end $$;
