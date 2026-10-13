-- S36k: follow-ups from the adversarial review of S36j (20261007114253, already applied; not edited).
--   1. payout_events.source gains 'cmo'. A Chief Medical Officer's approval is now recorded with source 'cmo', an admin's with 'admin'.
--      (Nothing reads payout_events.source: a grep of apps/web/src and supabase/functions found no reader, so a new value breaks nothing.)
--      approve_payout(uuid) is restated exactly as in S36j (same signature, no overload); only the payout_event call passes v_role.
--   2. payout_approval_queue() is dropped and recreated (new return columns need drop+create): adds is_mine (the draft's payee is the
--      caller, who cannot approve it) and total_waiting (every waiting draft for the org, same filters, repeated on each row, so the
--      page can say when the 200 row cap hid some). Same filters, no bank data, no test clinicians (INV-13).
--      The version stamp sorts after S36j: the local clock read earlier than 20261007114253, so 20261007120347 was chosen by hand.

alter table public.payout_events drop constraint if exists payout_events_source_check;
alter table public.payout_events add constraint payout_events_source_check check (source in ('system', 'admin', 'webhook', 'edge', 'cmo'));

create or replace function public.approve_payout(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_approver_org();
  v_uid uuid := (select auth.uid());
  v_role text := case when private.is_admin() then 'admin' else 'cmo' end;
  p public.payouts%rowtype;
  b public.clinician_bank_accounts%rowtype;
  v_sum bigint;
  v_n integer;
  v_linked integer;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_a_draft' using errcode = '23514'; end if;
  if p.clinician_id = v_uid then raise exception 'payout_self_approval' using errcode = '42501'; end if;
  b := private.payout_ready(p.clinician_id);
  if b.id is null then raise exception 'payout_no_verified_bank' using errcode = '55000'; end if;
  -- The ledger is read again now. If it is not exactly what the draft showed, nothing is approved.
  select coalesce(sum(l.amount_kobo), 0)::bigint, count(*)::integer into v_sum, v_n
    from public.earnings_ledger l
   where l.clinician_id = p.clinician_id and l.organisation_id = p.organisation_id and l.payout_id is null and not l.is_test
     and l.earned_at < private.payout_cutoff(p.period_end);
  if v_sum <> p.amount_kobo or v_n <> p.line_count then raise exception 'payout_ledger_changed' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', approved_by = v_uid, approved_at = now(), bank_account_id = b.id, recipient_code = b.recipient_code where id = p.id;
  perform set_config('tarragon.earnings_payout_link', 'on', true);
  update public.earnings_ledger set payout_id = p.id
   where clinician_id = p.clinician_id and organisation_id = p.organisation_id and payout_id is null and not is_test
     and earned_at < private.payout_cutoff(p.period_end);
  get diagnostics v_linked = row_count;
  perform set_config('tarragon.earnings_payout_link', 'off', true);
  if v_linked <> v_n then raise exception 'payout_link_mismatch' using errcode = '55000'; end if;
  insert into public.payout_transfers (payout_id, attempt, reference) values (p.id, 1, private.payout_reference(p.id, 1));
  perform private.payout_event(p.id, 'draft', 'approved', v_uid, v_role, null);
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.approved', 'payout', p.id, jsonb_build_object('amount_kobo', p.amount_kobo, 'lines', v_n, 'approver_role', v_role));
  return jsonb_build_object('payout_id', p.id, 'reference', private.payout_reference(p.id, 1), 'amount_kobo', p.amount_kobo);
end;
$$;

drop function public.payout_approval_queue();
create function public.payout_approval_queue() returns table (
  id uuid, period_start date, period_end date, amount_kobo bigint, line_count integer, clinician_name text, bank_ready boolean, state text,
  created_at timestamptz, is_mine boolean, total_waiting bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.payout_approver_org(); v_uid uuid := (select auth.uid());
begin
  return query
    with waiting as (
      select p.* from public.payouts p
       where p.organisation_id = v_org and p.state = 'draft' and not p.is_test
         and not exists (select 1 from public.profiles pr where pr.id = p.clinician_id and pr.is_test)
    ), total as (select count(*) as n from waiting)
    select w.id, w.period_start, w.period_end, w.amount_kobo, w.line_count,
           (select cs.full_name from public.clinical_staff cs where cs.profile_id = w.clinician_id),
           (private.payout_ready(w.clinician_id)).id is not null,
           w.state, w.created_at, w.clinician_id = v_uid, (select n from total)
      from waiting w
     order by w.created_at, w.id limit 200;
end;
$$;

revoke all on function public.approve_payout(uuid), public.payout_approval_queue() from public, anon, authenticated;
grant execute on function public.approve_payout(uuid), public.payout_approval_queue() to authenticated;

do $$
declare v_fn text; v_n integer;
begin
  foreach v_fn in array array['public.approve_payout(uuid)', 'public.payout_approval_queue()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S36k assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S36k assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'approve_payout';
  if v_n <> 1 then raise exception 'S36k assertion: approve_payout has % overloads', v_n; end if;
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'payout_approval_queue';
  if v_n <> 1 then raise exception 'S36k assertion: payout_approval_queue has % overloads', v_n; end if;
  if not exists (select 1 from pg_constraint where conname = 'payout_events_source_check' and conrelid = 'public.payout_events'::regclass
                 and pg_get_constraintdef(oid) ~ 'cmo') then
    raise exception 'S36k assertion: payout_events_source_check does not allow cmo';
  end if;
end $$;
