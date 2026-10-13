-- S31x (S11-S15 package P4): payout reversal after success, general ledger posting for payouts, payout batch maker-checker with limits.
-- Design: docs/design/S11-S15-p4-providers.md section 5.
--
-- Founder decision OQ-97: Paystack transfer OTP stays OFF. The controls in this migration ARE the compensating controls:
--   * a payout can be sent only from a released batch (flag `payout_batch_maker_checker`, off): one approver proposes it, a DIFFERENT
--     approver releases it, nobody releases a batch that pays them, and per-payout, per-clinician (rolling 7 days) and per-batch
--     limits apply at proposal, at release and again at send. With only one approver in the system nothing can be released, on purpose.
--   * every send still needs the S31 go-live guard `payouts_enabled` (not touched here; it stays off).
-- Money safety changes, all behind off flags:
--   * apply_payout_transfer_event: on success posts Dr 5200 Clinician fees / Cr 1000 Bank, and a later transfer.reversed after that
--     success posts the exact opposite entry (flag `payout_gl_posting`). A posting that fails (closed period) never blocks the payout
--     state change: it is recorded as 'failed' in payout_gl_postings and retried by retry_failed_payout_gl_postings(). Posted entries are
--     never deleted; the reversal is a new entry keyed by (payout, attempt, kind), so a replayed webhook posts nothing twice.
--   * my_payout_overview tells the clinician when a payout was paid and then returned by the bank.
-- The state machine itself already allowed succeeded -> reversed (S31); this migration adds what that transition was missing.
--
-- Rewritten from their LIVE definitions (pg_get_functiondef, 2026-10-13): apply_payout_transfer_event, payout_prepare_send,
-- my_payout_overview. Counts before: 0 payouts, 0 payout transfers, payouts_enabled off, so nothing is converted or backfilled.
-- finance_journal_entries.source gains 'payout' and 'payout_reversal'. Another in-flight branch that also widens that check must
-- carry these two values forward (the closeout lists it).

-- ---------------------------------------------------------------------------
-- 1. Controls config (PROPOSED, mirrored as `payouts.controls`)
-- ---------------------------------------------------------------------------
create table public.payout_controls_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index payout_controls_config_one_active on public.payout_controls_config (is_active) where is_active;

-- payouts-controls-begin
insert into public.payout_controls_config (version, is_active, effective_from, rules) values (1, true, '2026-10-13', $json$
{
  "perPayoutMaxKobo": 150000000,
  "perClinicianRolling7DaysMaxKobo": 150000000,
  "perBatchMaxKobo": 1000000000,
  "perBatchMaxCount": 20
}
$json$::jsonb);
-- payouts-controls-end

alter table public.payout_controls_config enable row level security;
create policy payout_controls_config_read on public.payout_controls_config for select to authenticated using (private.is_admin() or private.credential_is_cmo());
revoke all on public.payout_controls_config from public, anon, authenticated;
grant select on public.payout_controls_config to authenticated;

create function private.payout_control(p_key text) returns bigint
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::bigint from public.payout_controls_config where is_active; $$;
revoke all on function private.payout_control(text) from public, anon, authenticated;

create function private.provider_flag_on(p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select status::text = 'on' from public.feature_flags where key = p_key), false); $$;
revoke all on function private.provider_flag_on(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. General ledger: account, source values, posting record
-- ---------------------------------------------------------------------------
insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('5200', 'Clinician fees (contracted payouts)', 'expense', 'debit', 'exempt', 84,
   'Weekly payouts to contracted clinicians, posted when the bank transfer succeeds and reversed if the bank returns it. Gross; no withholding tax is calculated here (D-09).')
on conflict (code) do nothing;

alter table public.finance_journal_entries drop constraint finance_journal_entries_source_check;
alter table public.finance_journal_entries add constraint finance_journal_entries_source_check check (
  source = any (array['payment', 'commission', 'refund', 'wallet', 'voucher', 'platform_credit', 'revenue_recognition', 'fx', 'manual', 'adjustment', 'opening',
                      'payout', 'payout_reversal']::text[]));

create table public.payout_gl_postings (
  id               uuid primary key default gen_random_uuid(),
  payout_id        uuid not null references public.payouts (id) on delete restrict,
  attempt          integer not null check (attempt >= 1),
  kind             text not null check (kind in ('sent', 'reversal')),
  status           text not null check (status in ('posted', 'failed')),
  amount_kobo      bigint not null check (amount_kobo > 0),
  journal_entry_id uuid references public.finance_journal_entries (id) on delete restrict,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (payout_id, attempt, kind),
  check ((status = 'posted') = (journal_entry_id is not null))
);
alter table public.payout_gl_postings enable row level security;
create policy payout_gl_postings_read on public.payout_gl_postings for select to authenticated using (private.is_admin());
revoke all on public.payout_gl_postings from public, anon, authenticated;
grant select on public.payout_gl_postings to authenticated;
comment on table public.payout_gl_postings is
  'S31x: which payout attempts have been posted to the general ledger. One row per (payout, attempt, kind). A failed posting never blocks the payout state change; it waits here for retry_failed_payout_gl_postings().';

-- Never raises: a posting problem is recorded, not thrown, so the webhook that carries the state change still succeeds.
create function private.payout_post_gl(p_payout uuid, p_attempt integer, p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.payouts%rowtype;
  v_entry uuid;
  v_date date := (now() at time zone 'Africa/Lagos')::date;
  v_dr text; v_cr text;
begin
  if not private.provider_flag_on('payout_gl_posting') then return; end if;
  select * into p from public.payouts where id = p_payout;
  if not found then return; end if;
  if p_kind = 'reversal' and not exists (select 1 from public.payout_gl_postings where payout_id = p_payout and attempt = p_attempt and kind = 'sent' and status = 'posted') then
    return;   -- nothing was posted for this attempt, so there is nothing to reverse
  end if;
  if exists (select 1 from public.payout_gl_postings where payout_id = p_payout and attempt = p_attempt and kind = p_kind and status = 'posted') then return; end if;
  v_dr := case p_kind when 'sent' then '5200' else '1000' end;
  v_cr := case p_kind when 'sent' then '1000' else '5200' end;
  begin
    v_entry := private.finance_post_journal(
      v_date, 'NGN'::public.currency, case p_kind when 'sent' then 'payout' else 'payout_reversal' end,
      'payout:' || p.id || ':' || p_attempt || ':' || p_kind,
      case p_kind when 'sent' then 'Clinician payout sent' else 'Clinician payout returned by the bank' end,
      jsonb_build_array(
        jsonb_build_object('account_code', v_dr, 'debit_minor', p.amount_kobo, 'credit_minor', 0, 'organisation_id', p.organisation_id, 'memo', 'payout ' || p.id),
        jsonb_build_object('account_code', v_cr, 'debit_minor', 0, 'credit_minor', p.amount_kobo, 'organisation_id', p.organisation_id, 'memo', 'payout ' || p.id)),
      null);
    insert into public.payout_gl_postings (payout_id, attempt, kind, status, amount_kobo, journal_entry_id)
    values (p.id, p_attempt, p_kind, 'posted', p.amount_kobo, v_entry)
    on conflict (payout_id, attempt, kind) do update set status = 'posted', journal_entry_id = excluded.journal_entry_id, error = null, updated_at = now();
  exception when others then
    insert into public.payout_gl_postings (payout_id, attempt, kind, status, amount_kobo, error)
    values (p.id, p_attempt, p_kind, 'failed', p.amount_kobo, left(sqlstate || ': ' || sqlerrm, 300))
    on conflict (payout_id, attempt, kind) do update set error = excluded.error, updated_at = now() where public.payout_gl_postings.status = 'failed';
  end;
end;
$$;
revoke all on function private.payout_post_gl(uuid, integer, text) from public, anon, authenticated;

create function public.retry_failed_payout_gl_postings() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n integer := 0;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  -- order: a 'sent' before its 'reversal', oldest first
  for r in select payout_id, attempt, kind from public.payout_gl_postings where status = 'failed' order by created_at, (kind = 'reversal') loop
    perform private.payout_post_gl(r.payout_id, r.attempt, r.kind);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. apply_payout_transfer_event: rewritten from the LIVE definition; adds the GL posting, the reversal-after-success record and wording
-- ---------------------------------------------------------------------------
create or replace function public.apply_payout_transfer_event(p_event text, p_reference text, p_transfer_code text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.payout_transfers%rowtype;
  p public.payouts%rowtype;
  v_to text;
  v_tstate text;
  v_current boolean;
begin
  v_to := case p_event when 'transfer.success' then 'succeeded' when 'transfer.failed' then 'failed' when 'transfer.reversed' then 'reversed' else null end;
  if v_to is null then return jsonb_build_object('result', 'ignored_event'); end if;
  select * into t from public.payout_transfers where reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_ours'); end if;
  select * into p from public.payouts where id = t.payout_id for update;
  v_tstate := case v_to when 'succeeded' then 'success' else v_to end;
  v_current := t.attempt = (select max(attempt) from public.payout_transfers where payout_id = p.id);
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payout_transfers set state = v_tstate, paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
    reason = coalesce(left(p_reason, 300), reason), updated_at = now() where id = t.id;
  if not v_current then
    perform private.payout_event(p.id, p.state, p.state, null, 'webhook', 'older attempt ' || t.attempt || ': ' || p_event);
    perform set_config('tarragon.payout_write', 'off', true);
    return jsonb_build_object('result', 'older_attempt');
  end if;
  if p.state = v_to then
    perform set_config('tarragon.payout_write', 'off', true);
    return jsonb_build_object('result', 'duplicate');
  end if;
  if (p.state, v_to) in (('approved', 'succeeded'), ('sent', 'succeeded'), ('succeeded', 'reversed'),
                         ('approved', 'failed'), ('sent', 'failed'), ('approved', 'reversed'), ('sent', 'reversed')) then
    update public.payouts set state = v_to, paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
      failure_reason = case when v_to = 'succeeded' then null else left(coalesce(p_reason, p_event), 300) end where id = p.id;
    perform private.payout_event(p.id, p.state, v_to, null, 'webhook',
      case when p.state = 'succeeded' and v_to = 'reversed' then p_event || ' (after a success)' else p_event end);
    perform set_config('tarragon.payout_write', 'off', true);
    if v_to = 'succeeded' then
      perform private.payout_post_gl(p.id, t.attempt, 'sent');
      perform private.payout_notify(p, 'Your payout has been sent', 'Your weekly payout is on its way to your bank account. The statement is under Earnings in your console.');
    elsif p.state = 'succeeded' and v_to = 'reversed' then
      -- Paid, then returned by the bank: the opposite entry goes in as a NEW entry, and a person is told through the audit log.
      perform private.payout_post_gl(p.id, t.attempt, 'reversal');
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (p.organisation_id, null, 'payout.reversed_after_success', 'payout', p.id, jsonb_build_object('amount_kobo', p.amount_kobo, 'attempt', t.attempt));
      perform private.payout_notify(p, 'A payout was returned by the bank', 'Your bank returned a weekly payout. The finance team has been told and will send it again; there is nothing for you to do.');
    else
      perform private.payout_notify(p, 'Your payout needs attention', 'We could not complete your weekly payout. The finance team has been told and will sort it out; there is nothing for you to do.');
    end if;
    return jsonb_build_object('result', 'applied', 'state', v_to);
  end if;
  -- An event that does not fit the state (a success after a reversal, for example) is recorded and left for a person.
  perform private.payout_event(p.id, p.state, p.state, null, 'webhook', 'out of order, ignored: ' || p_event);
  perform set_config('tarragon.payout_write', 'off', true);
  return jsonb_build_object('result', 'out_of_order');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Batches (maker-checker)
-- ---------------------------------------------------------------------------
create table public.payout_batches (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  state           text not null default 'proposed' check (state in ('proposed', 'released', 'rejected')),
  made_by         uuid not null references public.profiles (id) on delete restrict,
  made_at         timestamptz not null default now(),
  checked_by      uuid references public.profiles (id) on delete restrict,
  checked_at      timestamptz,
  payout_count    integer not null check (payout_count > 0),
  total_kobo      bigint not null check (total_kobo > 0),
  note            text,
  reject_reason   text,
  check (state = 'proposed' or (checked_by is not null and checked_at is not null)),
  check (checked_by is null or checked_by <> made_by),                                 -- the checker is never the maker
  check (state <> 'rejected' or char_length(btrim(coalesce(reject_reason, ''))) >= 10)
);
create table public.payout_batch_items (
  batch_id         uuid not null references public.payout_batches (id) on delete restrict,
  payout_id        uuid not null references public.payouts (id) on delete restrict,
  transfer_attempt integer not null check (transfer_attempt >= 1),
  amount_kobo      bigint not null check (amount_kobo > 0),
  primary key (batch_id, payout_id)
);
create index payout_batch_items_payout_idx on public.payout_batch_items (payout_id, transfer_attempt);

create function private.guard_payout_batches() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception '% is never deleted', tg_table_name using errcode = '42501'; end if;
  if tg_table_name = 'payout_batch_items' and tg_op = 'UPDATE' then raise exception 'a batch item never changes' using errcode = '42501'; end if;
  if tg_table_name = 'payout_batches' and tg_op = 'UPDATE' then
    if old.state <> 'proposed' then raise exception 'a released or rejected batch never changes' using errcode = '42501'; end if;
    if new.made_by <> old.made_by or new.total_kobo <> old.total_kobo or new.payout_count <> old.payout_count then
      raise exception 'the maker and the amounts of a batch never change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_batches() from public, anon, authenticated;
create trigger payout_batches_guard before update or delete on public.payout_batches for each row execute function private.guard_payout_batches();
create trigger payout_batch_items_guard before update or delete on public.payout_batch_items for each row execute function private.guard_payout_batches();
create trigger payout_batches_no_truncate before truncate on public.payout_batches for each statement execute function private.guard_payout_batches();
create trigger payout_batch_items_no_truncate before truncate on public.payout_batch_items for each statement execute function private.guard_payout_batches();

alter table public.payout_batches enable row level security;
alter table public.payout_batch_items enable row level security;
create policy payout_batches_read on public.payout_batches for select to authenticated using ((private.is_admin() or private.credential_is_cmo()) and organisation_id = private.caller_org());
create policy payout_batch_items_read on public.payout_batch_items for select to authenticated
  using (exists (select 1 from public.payout_batches b where b.id = batch_id and (private.is_admin() or private.credential_is_cmo()) and b.organisation_id = private.caller_org()));
revoke all on public.payout_batches, public.payout_batch_items from public, anon, authenticated;
grant select on public.payout_batches, public.payout_batch_items to authenticated;

-- The limits, one place, used at proposal, at release and at send. p_batch is excluded from "other open batches".
create function private.payout_limits_check(p_ids uuid[], p_batch uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_per bigint := private.payout_control('perPayoutMaxKobo');
  v_clin bigint := private.payout_control('perClinicianRolling7DaysMaxKobo');
  v_batch bigint := private.payout_control('perBatchMaxKobo');
  v_count bigint := private.payout_control('perBatchMaxCount');
  v_total bigint;
  r record;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'payout_batch_empty' using errcode = '22023'; end if;
  if array_length(p_ids, 1) > v_count then raise exception 'payout_limit_batch_count' using errcode = '23514'; end if;
  select coalesce(sum(amount_kobo), 0) into v_total from public.payouts where id = any (p_ids);
  if v_total > v_batch then raise exception 'payout_limit_batch_total' using errcode = '23514'; end if;
  if exists (select 1 from public.payouts where id = any (p_ids) and amount_kobo > v_per) then raise exception 'payout_limit_payout' using errcode = '23514'; end if;
  for r in select clinician_id, sum(amount_kobo)::bigint as this_batch from public.payouts where id = any (p_ids) group by clinician_id loop
    if r.this_batch + coalesce((
         select sum(o.amount_kobo) from public.payouts o
          where o.clinician_id = r.clinician_id and not (o.id = any (p_ids))
            and ((o.state in ('sent', 'succeeded') and o.updated_at >= now() - interval '7 days')
              or (o.state = 'approved' and exists (select 1 from public.payout_batch_items i join public.payout_batches b on b.id = i.batch_id
                                                    where i.payout_id = o.id and b.state in ('proposed', 'released') and b.id is distinct from p_batch)))), 0) > v_clin then
      raise exception 'payout_limit_clinician' using errcode = '23514';
    end if;
  end loop;
end;
$$;
revoke all on function private.payout_limits_check(uuid[], uuid) from public, anon, authenticated;

create function public.propose_payout_batch(p_payout_ids uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_approver_org();
  v_uid uuid := (select auth.uid());
  v_batch uuid;
  v_ids uuid[];
  p public.payouts%rowtype;
  v_attempt integer;
  v_total bigint := 0;
begin
  if not private.provider_flag_on('payout_batch_maker_checker') then raise exception 'payout_batch_control_off' using errcode = '55000'; end if;
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_payout_ids, '{}')) x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'payout_batch_empty' using errcode = '22023'; end if;
  perform 1 from public.payouts where id = any (v_ids) order by id for update;
  for p in select * from public.payouts where id = any (v_ids) loop
    if p.organisation_id <> v_org then raise exception 'payout_unknown' using errcode = '22023'; end if;
    if p.state <> 'approved' then raise exception 'payout_not_approved' using errcode = '23514'; end if;
    if p.is_test or exists (select 1 from public.profiles where id = p.clinician_id and is_test) then raise exception 'payout_test_account' using errcode = '55000'; end if;
    select max(attempt) into v_attempt from public.payout_transfers where payout_id = p.id;
    if exists (select 1 from public.payout_batch_items i join public.payout_batches b on b.id = i.batch_id
                where i.payout_id = p.id and i.transfer_attempt = v_attempt and b.state in ('proposed', 'released')) then
      raise exception 'payout_already_in_a_batch' using errcode = '23514';
    end if;
    v_total := v_total + p.amount_kobo;
  end loop;
  if (select count(*) from public.payouts where id = any (v_ids)) <> array_length(v_ids, 1) then raise exception 'payout_unknown' using errcode = '22023'; end if;
  perform private.payout_limits_check(v_ids, null);
  insert into public.payout_batches (organisation_id, made_by, payout_count, total_kobo, note)
  values (v_org, v_uid, array_length(v_ids, 1), v_total, left(nullif(btrim(p_note), ''), 300)) returning id into v_batch;
  insert into public.payout_batch_items (batch_id, payout_id, transfer_attempt, amount_kobo)
  select v_batch, p2.id, (select max(attempt) from public.payout_transfers t where t.payout_id = p2.id), p2.amount_kobo from public.payouts p2 where p2.id = any (v_ids);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout_batch.proposed', 'payout_batch', v_batch, jsonb_build_object('payouts', array_length(v_ids, 1), 'total_kobo', v_total));
  return jsonb_build_object('batch_id', v_batch, 'payout_count', array_length(v_ids, 1), 'total_kobo', v_total);
end;
$$;

create function public.release_payout_batch(p_batch uuid) returns jsonb
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

create function public.reject_payout_batch(p_batch uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.payout_approver_org(); v_uid uuid := (select auth.uid()); b public.payout_batches%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'payout_batch_needs_reason' using errcode = '22023'; end if;
  select * into b from public.payout_batches where id = p_batch and organisation_id = v_org for update;
  if not found then raise exception 'payout_batch_unknown' using errcode = '22023'; end if;
  if b.state <> 'proposed' then raise exception 'payout_batch_not_proposed' using errcode = '23514'; end if;
  if b.made_by = v_uid then raise exception 'payout_batch_self_release' using errcode = '42501'; end if;
  update public.payout_batches set state = 'rejected', checked_by = v_uid, checked_at = now(), reject_reason = left(btrim(p_reason), 300) where id = b.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout_batch.rejected', 'payout_batch', b.id, jsonb_build_object('maker', b.made_by));
end;
$$;

create function public.list_payout_batches(p_state text default null) returns table (
  id uuid, state text, made_by uuid, made_at timestamptz, checked_by uuid, checked_at timestamptz, payout_count integer, total_kobo bigint, note text, reject_reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.payout_approver_org();
begin
  return query select b.id, b.state, b.made_by, b.made_at, b.checked_by, b.checked_at, b.payout_count, b.total_kobo, b.note, b.reject_reason
    from public.payout_batches b where b.organisation_id = v_org and (p_state is null or b.state = p_state) order by b.made_at desc limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. payout_prepare_send: rewritten from the LIVE definition; with the flag on a payout is sent only from a released batch
-- ---------------------------------------------------------------------------
create or replace function public.payout_prepare_send(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_admin_org();
  p public.payouts%rowtype;
  t public.payout_transfers%rowtype;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state not in ('approved', 'sent') then raise exception 'payout_not_approved' using errcode = '23514'; end if;
  if p.is_test or exists (select 1 from public.profiles where id = p.clinician_id and is_test) then raise exception 'payout_test_account' using errcode = '55000'; end if;
  select * into t from public.payout_transfers where payout_id = p.id order by attempt desc limit 1;
  if t.state in ('success') then raise exception 'payout_already_paid' using errcode = '23514'; end if;
  if private.provider_flag_on('payout_batch_maker_checker') then
    if not exists (select 1 from public.payout_batch_items i join public.payout_batches b on b.id = i.batch_id
                    where i.payout_id = p.id and i.transfer_attempt = t.attempt and b.state = 'released') then
      raise exception 'payout_batch_required' using errcode = '55000';
    end if;
    if p.amount_kobo > private.payout_control('perPayoutMaxKobo') then raise exception 'payout_limit_payout' using errcode = '23514'; end if;
  end if;
  return jsonb_build_object('payout_id', p.id, 'reference', t.reference, 'amount_kobo', p.amount_kobo, 'recipient_code', p.recipient_code,
    'reason', 'Tarragon weekly payout ' || to_char(p.period_end, 'YYYY-MM-DD'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. my_payout_overview: rewritten from the LIVE definition; the clinician sees a payout that was paid and then returned
-- ---------------------------------------------------------------------------
create or replace function public.my_payout_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if private.my_contracted_org() is null then raise exception 'payout_not_a_contracted_clinician' using errcode = '42501'; end if;
  return jsonb_build_object(
    'bank', (select jsonb_build_object('bank_name', b.bank_name, 'account_last4', b.account_last4, 'resolved_name', b.resolved_name,
                'name_match', b.name_match, 'verified', b.bank_verified_at is not null, 'bank_verified_at', b.bank_verified_at)
               from public.clinician_bank_accounts b where b.clinician_id = v_uid and b.superseded_at is null order by (b.bank_verified_at is not null) desc, b.created_at desc limit 1),
    'tax', (select to_jsonb(t) - 'organisation_id' from public.clinician_tax_profiles t where t.clinician_id = v_uid),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'period_start', p.period_start, 'period_end', p.period_end, 'amount_kobo', p.amount_kobo, 'line_count', p.line_count,
        'state', p.state, 'approved_at', p.approved_at,
        'reversed_at', (select max(e.created_at) from public.payout_events e where e.payout_id = p.id and e.to_state = 'reversed'),
        'paid_then_returned', exists (select 1 from public.payout_events e where e.payout_id = p.id and e.from_state = 'succeeded' and e.to_state = 'reversed'),
        'reference', (select t.reference from public.payout_transfers t where t.payout_id = p.id order by t.attempt desc limit 1),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'earned_at', l.earned_at, 'amount_kobo', l.amount_kobo,
                   'task_type', l.calculation ->> 'task_type') order by l.earned_at)
                   from public.earnings_ledger l where l.payout_id = p.id), '[]'::jsonb)) order by p.period_end desc)
        from public.payouts p where p.clinician_id = v_uid and p.state not in ('draft', 'cancelled')), '[]'::jsonb),
    'next_payout_kobo', coalesce((select sum(l.amount_kobo) from public.earnings_ledger l where l.clinician_id = v_uid and l.payout_id is null and not l.is_test), 0),
    'minimum_payout_kobo', private.payouts_setting('minimum_payout_kobo'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants and self-check
-- ---------------------------------------------------------------------------
revoke all on function public.retry_failed_payout_gl_postings(), public.propose_payout_batch(uuid[], text), public.release_payout_batch(uuid),
  public.reject_payout_batch(uuid, text), public.list_payout_batches(text) from public, anon, authenticated;
grant execute on function public.retry_failed_payout_gl_postings(), public.propose_payout_batch(uuid[], text), public.release_payout_batch(uuid),
  public.reject_payout_batch(uuid, text), public.list_payout_batches(text) to authenticated;
-- create or replace keeps the existing grants of the three rewritten functions; state them again so the file is the whole truth.
revoke all on function public.apply_payout_transfer_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_payout_transfer_event(text, text, text, text) to service_role;
revoke all on function public.payout_prepare_send(uuid), public.my_payout_overview() from public, anon, authenticated;
grant execute on function public.payout_prepare_send(uuid), public.my_payout_overview() to authenticated;

do $$
declare v_fn text; v_n integer;
begin
  foreach v_fn in array array['public.retry_failed_payout_gl_postings()', 'public.propose_payout_batch(uuid[],text)', 'public.release_payout_batch(uuid)',
    'public.reject_payout_batch(uuid,text)', 'public.list_payout_batches(text)', 'public.payout_prepare_send(uuid)', 'public.my_payout_overview()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S31x assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S31x assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  if has_function_privilege('anon', 'public.apply_payout_transfer_event(text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.apply_payout_transfer_event(text,text,text,text)', 'EXECUTE') then
    raise exception 'S31x assertion: apply_payout_transfer_event is callable by a client';
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('apply_payout_transfer_event', 'payout_prepare_send', 'my_payout_overview');
  if v_n <> 3 then raise exception 'S31x assertion: a rewritten payout function now has an overload (% functions)', v_n; end if;
  if (select count(*) from public.payout_controls_config where is_active) <> 1 then raise exception 'S31x assertion: one active payout_controls_config row expected'; end if;
  if (select is_on from public.go_live_guards where key = 'payouts_enabled') then raise exception 'S31x assertion: the payouts guard must stay off'; end if;
end $$;
