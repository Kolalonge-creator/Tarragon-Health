-- S30b: earnings completeness.
--
-- 1. Per-line dispute. A contracted clinician disputes one earnings_ledger line with one tap (a reason code and an optional note). The
--    dispute has a response clock (PROPOSED config `earnings.disputes`). While it is open the line is held out of the payout draft and
--    out of approval, and the rest of the week still pays. Finance resolves it: either an adjustment line that points at the disputed
--    line (the ledger stays append only) or a rejection with a note; either way the line is released.
-- 2. A payout statement shows gross, a withholding amount that is STORED and never calculated (D-09, OQ-193), and net. A payout with a
--    non-zero withholding is refused at send time until counsel decides how it is remitted and posted (OQ-193, OQ-194).
-- 3. A per-line pay status (pending, approved, paid, failed, plus disputed) joined to the S31 payout state. Retry of a failed transfer is
--    the existing `retry_payout`; nothing new moves money.
-- 4. Pilot minimum: an activity check before a top-up posts (OQ-180) and late-line netting (OQ-185). A suspicious run is HELD for a
--    person, never silently dropped and never paid unchecked.
--
-- Not built, by instruction: instant cash-out, rating deductions, clawbacks, acquisition-linked pay. The refund reversal of a consultation
-- share is S26b; this migration only keeps the shared `adjustment` line kind compatible with it.
--
-- Live counts when written: 0 ledger lines, 0 payouts (payouts_enabled off), so no data conversion step exists. Payouts stay behind
-- `payouts_enabled`; no fee schedule is seeded.
-- NOTE: live list_migrations was read at 2026-10-16 21:4x UTC (latest live version 20261016194828; nothing live redefines the payout or
-- earnings functions after S31x). Live function DEFINITIONS were not re-read (the connection timed out earlier in the session), so the
-- bodies copied below (approve_payout, payout_prepare_send, my_payout_overview, post_minimum_topups) come from the latest migration in the
-- repository that defines each one; check pg_get_functiondef for those four before applying.

-- ---------------------------------------------------------------------------
-- 1. A system-posted adjustment (late-line netting) has no human author. Allow it only when the line says why.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.earnings_ledger'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%adjustment%' and pg_get_constraintdef(oid) like '%created_by IS NOT NULL%'
              and pg_get_constraintdef(oid) not like '%system_reason%' loop
    execute format('alter table public.earnings_ledger drop constraint %I', c.conname);
    alter table public.earnings_ledger add constraint earnings_ledger_adjustment_shape check (
      (kind = 'adjustment' and amount_kobo <> 0 and char_length(btrim(coalesce(note, ''))) >= 10
        and (created_by is not null or (calculation ? 'system_reason' and char_length(btrim(calculation ->> 'system_reason')) >= 5)))
      or (kind <> 'adjustment' and amount_kobo >= 0));
  end loop;
  -- Never leave a ledger that would refuse a system adjustment: either the loop rewrote the constraint, or another migration already did.
  if not exists (select 1 from pg_constraint where conrelid = 'public.earnings_ledger'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%system_reason%') then
    raise exception 'S30b assertion: the ledger adjustment constraint does not allow a system adjustment';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Config (PROPOSED, mirrored as `earnings.disputes`)
-- ---------------------------------------------------------------------------
create table public.earnings_disputes_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index earnings_disputes_config_one_active on public.earnings_disputes_config (is_active) where is_active;

-- earnings-disputes-rules-begin
insert into public.earnings_disputes_config (version, is_active, effective_from, rules) values (1, true, '2026-10-16', $json$
{
  "dispute": {
    "response_sla_hours": 72,
    "window_days": 60,
    "reason_codes": ["wrong_amount", "missing_work", "duplicate", "wrong_type", "other"]
  },
  "pilot_minimum": {
    "activity_check": true,
    "hold_when_no_claims_and_work_waited": true,
    "hold_when_expired_claims_and_no_completed": true
  }
}
$json$::jsonb);
-- earnings-disputes-rules-end

create function private.disputes_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.earnings_disputes_config where is_active; $$;
revoke all on function private.disputes_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. earnings_disputes
-- ---------------------------------------------------------------------------
create table public.earnings_disputes (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  ledger_id            uuid not null references public.earnings_ledger (id) on delete restrict,
  clinician_id         uuid not null references public.profiles (id) on delete restrict,
  reason_code          text not null check (reason_code in ('wrong_amount', 'missing_work', 'duplicate', 'wrong_type', 'other')),
  note                 text check (note is null or char_length(note) <= 1000),
  request_id           uuid not null,
  state                text not null default 'open' check (state in ('open', 'adjusted', 'rejected', 'withdrawn')),
  opened_at            timestamptz not null default now(),
  response_due_at      timestamptz not null,
  resolved_at          timestamptz,
  resolved_by          uuid references public.profiles (id) on delete set null,
  resolution_note      text,
  adjustment_ledger_id uuid references public.earnings_ledger (id) on delete restrict,
  is_test              boolean not null default false,
  unique (clinician_id, request_id),
  check ((state = 'open') = (resolved_at is null)),
  check (state <> 'adjusted' or adjustment_ledger_id is not null),
  check (state not in ('adjusted', 'rejected') or (resolved_by is not null and char_length(btrim(coalesce(resolution_note, ''))) >= 10))
);
-- One open dispute per line; this index is also what the payout queries probe.
create unique index earnings_disputes_one_open on public.earnings_disputes (ledger_id) where state = 'open';
create index earnings_disputes_clinician_idx on public.earnings_disputes (clinician_id, opened_at desc);
create index earnings_disputes_open_due_idx on public.earnings_disputes (organisation_id, response_due_at) where state = 'open';
comment on table public.earnings_disputes is
  'S30b: a clinician disputes one earnings_ledger line. Open disputes hold that line out of the payout draft and approval. Resolved into an adjustment line (ledger stays append only) or rejected with a note. Written only by the dispute functions.';

create function private.guard_earnings_disputes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'earnings_disputes is never deleted' using errcode = '42501'; end if;
  if coalesce(current_setting('tarragon.dispute_write', true), '') <> 'on' then
    raise exception 'earnings_disputes is written only by the dispute functions' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.state <> 'open' then raise exception 'a resolved dispute never changes' using errcode = '23514'; end if;
    if to_jsonb(new) - 'state' - 'resolved_at' - 'resolved_by' - 'resolution_note' - 'adjustment_ledger_id'
       <> to_jsonb(old) - 'state' - 'resolved_at' - 'resolved_by' - 'resolution_note' - 'adjustment_ledger_id' then
      raise exception 'only the resolution of a dispute can be written' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_earnings_disputes() from public, anon, authenticated;
create trigger earnings_disputes_guard before insert or update or delete on public.earnings_disputes
  for each row execute function private.guard_earnings_disputes();
create trigger earnings_disputes_no_truncate before truncate on public.earnings_disputes
  for each statement execute function private.guard_earnings_disputes();

-- ---------------------------------------------------------------------------
-- 4. Pilot minimum holds
-- ---------------------------------------------------------------------------
create table public.earnings_topup_holds (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete restrict,
  run_start       timestamptz not null,
  run_end         timestamptz not null check (run_end > run_start),
  reason          text not null check (reason in ('no_claims_while_work_waited', 'expired_claims_and_no_completed')),
  evidence        jsonb not null,
  state           text not null default 'held' check (state in ('held', 'released', 'denied')),
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (clinician_id, run_start, run_end),
  check ((state = 'held') = (decided_at is null)),
  check (state = 'held' or (decided_by is not null and char_length(btrim(coalesce(decision_note, ''))) >= 10))
);
comment on table public.earnings_topup_holds is
  'S30b (OQ-180): a pilot-minimum top-up that the activity check flagged. Held for a person to release or deny; never paid unchecked and never silently dropped. Written only by the earnings functions.';

create function private.guard_earnings_topup_holds() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'earnings_topup_holds is never deleted' using errcode = '42501'; end if;
  if coalesce(current_setting('tarragon.dispute_write', true), '') <> 'on' then
    raise exception 'earnings_topup_holds is written only by the earnings functions' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.state <> 'held' or to_jsonb(new) - 'state' - 'decided_by' - 'decided_at' - 'decision_note' <> to_jsonb(old) - 'state' - 'decided_by' - 'decided_at' - 'decision_note') then
    raise exception 'a decided hold never changes' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_earnings_topup_holds() from public, anon, authenticated;
create trigger earnings_topup_holds_guard before insert or update or delete on public.earnings_topup_holds
  for each row execute function private.guard_earnings_topup_holds();
create trigger earnings_topup_holds_no_truncate before truncate on public.earnings_topup_holds
  for each statement execute function private.guard_earnings_topup_holds();

-- ---------------------------------------------------------------------------
-- 5. Withholding on a payout: stored, never calculated
-- ---------------------------------------------------------------------------
alter table public.payouts
  add column withholding_kobo bigint not null default 0,
  add column withholding_note text;
alter table public.payouts add constraint payouts_withholding_range check (withholding_kobo >= 0 and withholding_kobo < amount_kobo);
comment on column public.payouts.withholding_kobo is
  'S30b / D-09: an amount entered by a person, in kobo. Nothing in the database calculates it (OQ-193). Gross is amount_kobo, net is amount_kobo minus this. A payout with a value above zero is refused at send until the remittance and posting are decided.';

create function private.guard_payout_withholding() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.withholding_kobo is distinct from old.withholding_kobo or new.withholding_note is distinct from old.withholding_note then
    if old.state <> 'draft' then raise exception 'withholding can be changed only while a payout is a draft' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_withholding() from public, anon, authenticated;
create trigger payouts_withholding_guard before update on public.payouts for each row execute function private.guard_payout_withholding();

-- ---------------------------------------------------------------------------
-- 6. Draft builder and approval: a disputed line is held out, the rest pays
-- ---------------------------------------------------------------------------
-- Same function with an optional single clinician, so a dispute change rebuilds only that clinician's draft.
drop function private.build_payout_drafts(uuid, date, boolean);
create function private.build_payout_drafts(p_org uuid, p_period_end date, p_force boolean default false, p_clinician uuid default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg uuid;
  v_min bigint := coalesce((private.payouts_setting('minimum_payout_kobo'))::bigint, 0);
  v_cutoff timestamptz := private.payout_cutoff(p_period_end);
  v_built integer := 0;
  r record;
  v_id uuid;
  v_old_wh bigint;
  v_old_note text;
begin
  select id into v_cfg from public.payouts_config where is_active;
  if v_cfg is null then raise exception 'payouts_config_missing' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  for r in
    select l.clinician_id, sum(l.amount_kobo)::bigint as total, count(*)::integer as n, min(l.earned_at) as first_at
      from public.earnings_ledger l
      join public.profiles p on p.id = l.clinician_id
      join public.clinical_staff cs on cs.profile_id = l.clinician_id and cs.employment_type::text = 'contracted'
     where l.organisation_id = p_org and l.payout_id is null and not l.is_test and not p.is_test and not cs.is_test
       and l.earned_at < v_cutoff
       and (p_clinician is null or l.clinician_id = p_clinician)
       and not exists (select 1 from public.earnings_disputes d where d.ledger_id = l.id and d.state = 'open')   -- S30b: held out
     group by l.clinician_id
  loop
    if r.total <= 0 or r.total < v_min then continue; end if;   -- carried over to a later week
    if exists (select 1 from public.payouts where clinician_id = r.clinician_id and period_end = p_period_end and state <> 'cancelled') then
      if not p_force then continue; end if;
      if exists (select 1 from public.payouts where clinician_id = r.clinician_id and period_end = p_period_end and state <> 'draft' and state <> 'cancelled') then continue; end if;
    end if;
    select coalesce(max(withholding_kobo), 0), max(withholding_note) into v_old_wh, v_old_note
      from public.payouts where clinician_id = r.clinician_id and state = 'draft';
    update public.payouts set state = 'cancelled', failure_reason = 'replaced by a newer draft'
     where clinician_id = r.clinician_id and state = 'draft';
    insert into public.payouts (organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, payouts_config_id,
                                withholding_kobo, withholding_note)
    values (p_org, r.clinician_id, (r.first_at at time zone 'Africa/Lagos')::date, p_period_end, r.total, r.n, 'draft', v_cfg,
            case when v_old_wh > 0 and v_old_wh < r.total then v_old_wh else 0 end, case when v_old_wh > 0 and v_old_wh < r.total then v_old_note end)
    returning id into v_id;
    if v_old_wh > 0 and v_old_wh >= r.total then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (p_org, 'payout.withholding_dropped', 'payout', v_id, jsonb_build_object('withholding_kobo', v_old_wh, 'why', 'the replacement draft is not larger than the withholding'));
    end if;
    perform private.payout_event(v_id, null, 'draft', null, 'system', 'weekly draft');
    v_built := v_built + 1;
  end loop;
  perform set_config('tarragon.payout_write', 'off', true);
  return v_built;
end;
$$;
revoke all on function private.build_payout_drafts(uuid, date, boolean, uuid) from public, anon, authenticated;

-- A draft was built from the lines that were free at the time. When a dispute opens or closes the set of free lines changes, and approval
-- would (rightly) refuse the stale draft. So the clinician's draft is thrown away and rebuilt, and the rest of the week still pays.
-- A rebuilt draft that falls under the minimum is simply not drafted (those lines carry over); because the cancelled row stays behind with
-- its reason, the NEXT change (a withdrawn or answered dispute) rebuilds it, so a draft a dispute removed comes back when it is released.
create function private.refresh_payout_draft(p_clinician uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare d record; v_rows integer;
begin
  perform 1 from public.payouts where clinician_id = p_clinician and state = 'draft' for update;
  for d in
    select distinct on (p.period_end) p.id, p.organisation_id, p.period_end, p.state, p.withholding_kobo, p.withholding_note
      from public.payouts p
     where p.clinician_id = p_clinician
       and (p.state = 'draft' or (p.state = 'cancelled' and p.failure_reason like 'rebuilt:%'))
       and p.period_end >= (now() at time zone 'Africa/Lagos')::date - 21
       and not exists (select 1 from public.payouts x where x.clinician_id = p_clinician and x.period_end = p.period_end and x.state not in ('draft', 'cancelled'))
     order by p.period_end, case when p.state = 'draft' then 0 else 1 end, p.created_at desc
  loop
    if d.state = 'draft' then
      perform set_config('tarragon.payout_write', 'on', true);
      update public.payouts set state = 'cancelled', failure_reason = 'rebuilt: a dispute changed which lines are free' where id = d.id and state = 'draft';
      perform private.payout_event(d.id, 'draft', 'cancelled', null, 'system', 'rebuilt after a dispute change');
      perform set_config('tarragon.payout_write', 'off', true);
    end if;
    perform private.build_payout_drafts(d.organisation_id, d.period_end, false, p_clinician);
    -- a withholding a person already typed is carried to the rebuilt draft, never silently dropped; if it no longer fits, that is recorded
    if d.withholding_kobo > 0 then
      perform set_config('tarragon.payout_write', 'on', true);
      update public.payouts set withholding_kobo = d.withholding_kobo, withholding_note = d.withholding_note
       where clinician_id = p_clinician and state = 'draft' and period_end = d.period_end and amount_kobo > d.withholding_kobo;
      get diagnostics v_rows = row_count;
      perform set_config('tarragon.payout_write', 'off', true);
      if v_rows = 0 and d.state = 'draft' then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (d.organisation_id, 'payout.withholding_dropped', 'payout', d.id,
                jsonb_build_object('withholding_kobo', d.withholding_kobo, 'why', 'the rebuilt draft is smaller than the withholding or was not drafted'));
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.refresh_payout_draft(uuid) from public, anon, authenticated;

-- Copied from the latest definition (S36k). The only change: lines under an open dispute are not summed and not linked.
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
  -- A payout with a withholding can never be sent (OQ-193), and once approved it can no longer be edited or cancelled: refuse it here, while it can still be fixed.
  if p.withholding_kobo > 0 then raise exception 'payout_withholding_undecided' using errcode = '55000'; end if;
  b := private.payout_ready(p.clinician_id);
  if b.id is null then raise exception 'payout_no_verified_bank' using errcode = '55000'; end if;
  -- The ledger is read again now. If it is not exactly what the draft showed, nothing is approved.
  select coalesce(sum(l.amount_kobo), 0)::bigint, count(*)::integer into v_sum, v_n
    from public.earnings_ledger l
   where l.clinician_id = p.clinician_id and l.organisation_id = p.organisation_id and l.payout_id is null and not l.is_test
     and l.earned_at < private.payout_cutoff(p.period_end)
     and not exists (select 1 from public.earnings_disputes d where d.ledger_id = l.id and d.state = 'open');
  if v_sum <> p.amount_kobo or v_n <> p.line_count then raise exception 'payout_ledger_changed' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', approved_by = v_uid, approved_at = now(), bank_account_id = b.id, recipient_code = b.recipient_code where id = p.id;
  perform set_config('tarragon.earnings_payout_link', 'on', true);
  update public.earnings_ledger l set payout_id = p.id
   where l.clinician_id = p.clinician_id and l.organisation_id = p.organisation_id and l.payout_id is null and not l.is_test
     and l.earned_at < private.payout_cutoff(p.period_end)
     and not exists (select 1 from public.earnings_disputes d where d.ledger_id = l.id and d.state = 'open');
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

-- Copied from S31x. The only change: a payout with a withholding amount is refused, because what is sent (net), how the withholding
-- is remitted and how it is posted to the books are all undecided (OQ-193, OQ-194). Sending gross while the statement says net would be wrong.
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
  if p.withholding_kobo > 0 then raise exception 'payout_withholding_undecided' using errcode = '55000'; end if;
  if p.is_test or exists (select 1 from public.profiles where id = p.clinician_id and is_test) then raise exception 'payout_test_account' using errcode = '55000'; end if;
  select * into t from public.payout_transfers where payout_id = p.id order by attempt desc limit 1;
  if t.state in ('success') then raise exception 'payout_already_paid' using errcode = '23514'; end if;
  if private.provider_flag_on('payout_batch_maker_checker') then
    if not exists (select 1 from public.payout_batch_items i join public.payout_batches b on b.id = i.batch_id
                    where i.payout_id = p.id and i.transfer_attempt = t.attempt and b.state = 'released') then
      raise exception 'payout_batch_required' using errcode = '55000';
    end if;
    perform private.payout_limits_check(array[p.id], null);
  end if;
  return jsonb_build_object('payout_id', p.id, 'reference', t.reference, 'amount_kobo', p.amount_kobo, 'recipient_code', p.recipient_code,
    'reason', 'Tarragon weekly payout ' || to_char(p.period_end, 'YYYY-MM-DD'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Clinician: open and withdraw a dispute, read my lines with status, the statement
-- ---------------------------------------------------------------------------
create function public.open_earnings_dispute(p_ledger uuid, p_reason_code text, p_note text default null, p_request_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.my_contracted_org();
  l public.earnings_ledger%rowtype;
  v_id uuid;
  v_sla integer := coalesce((private.disputes_setting('dispute') ->> 'response_sla_hours')::integer, 72);
  v_window integer := coalesce((private.disputes_setting('dispute') ->> 'window_days')::integer, 60);
begin
  if v_org is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'dispute_request_needed' using errcode = '22023'; end if;
  if not coalesce((private.disputes_setting('dispute') -> 'reason_codes') ? p_reason_code, false) then raise exception 'dispute_bad_reason' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'dispute_note_too_long' using errcode = '22023'; end if;
  -- a double tap returns the same dispute
  select id into v_id from public.earnings_disputes where clinician_id = v_uid and request_id = p_request_id;
  if found then return v_id; end if;
  -- Lock this clinician's draft first. approve_payout locks the same row, so a dispute and an approval for the same clinician run one
  -- after the other, and the line is read below after any approval in progress has committed.
  perform 1 from public.payouts where clinician_id = v_uid and state = 'draft' for update;
  select * into l from public.earnings_ledger where id = p_ledger and clinician_id = v_uid and organisation_id = v_org;
  if not found then raise exception 'dispute_unknown_line' using errcode = '22023'; end if;
  if l.earned_at < now() - make_interval(days => v_window) then raise exception 'dispute_window_closed' using errcode = '23514'; end if;
  -- a deduction cannot be held out of a payout by questioning it, and a line already answered is not re-opened (ask operations instead)
  if l.amount_kobo <= 0 then raise exception 'dispute_negative_line' using errcode = '23514'; end if;
  if exists (select 1 from public.earnings_disputes where ledger_id = l.id and state in ('adjusted', 'rejected')) then raise exception 'dispute_already_answered' using errcode = '23514'; end if;
  -- A line in a payout that is approved, being sent, failed or returned cannot be held back (the money may already be on its way).
  -- Once the payout has been paid, a question still works: it resolves into a correction in a later payout.
  if l.payout_id is not null and (select p.state from public.payouts p where p.id = l.payout_id) <> 'succeeded' then
    raise exception 'dispute_line_in_flight' using errcode = '23514';
  end if;
  if exists (select 1 from public.earnings_disputes where ledger_id = l.id and state = 'open') then raise exception 'dispute_already_open' using errcode = '23505'; end if;
  perform set_config('tarragon.dispute_write', 'on', true);
  insert into public.earnings_disputes (organisation_id, ledger_id, clinician_id, reason_code, note, request_id, response_due_at, is_test)
  values (v_org, l.id, v_uid, p_reason_code, nullif(btrim(p_note), ''), p_request_id, now() + make_interval(hours => v_sla), l.is_test)
  returning id into v_id;
  perform set_config('tarragon.dispute_write', 'off', true);
  perform private.refresh_payout_draft(v_uid);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'earnings.dispute_opened', 'earnings_dispute', v_id, jsonb_build_object('ledger_id', l.id, 'reason_code', p_reason_code));
  -- Finance is told straight away (in the inbox; nothing clinical or personal in it). A notice failing never blocks the question.
  begin
    perform private.credential_notify_reviewers(v_org, 'A clinician asked about an earnings line',
      'A contracted clinician asked about one line on their earnings statement. The line is on hold. Please answer it under Earnings questions.',
      jsonb_build_object('dispute_id', v_id), 'finance');
  exception when others then null;
  end;
  return v_id;
end;
$$;

create function public.withdraw_earnings_dispute(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.earnings_disputes%rowtype;
begin
  if private.my_contracted_org() is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  select * into d from public.earnings_disputes where id = p_id and clinician_id = v_uid for update;
  if not found then raise exception 'dispute_unknown' using errcode = '22023'; end if;
  if d.state <> 'open' then raise exception 'dispute_not_open' using errcode = '23514'; end if;
  perform set_config('tarragon.dispute_write', 'on', true);
  update public.earnings_disputes set state = 'withdrawn', resolved_at = now() where id = d.id;
  perform set_config('tarragon.dispute_write', 'off', true);
  perform private.refresh_payout_draft(v_uid);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (d.organisation_id, v_uid, 'earnings.dispute_withdrawn', 'earnings_dispute', d.id, '{}'::jsonb);
end;
$$;

-- The pay status of a line, one definition used by every read: pending (not in a payout), approved (in an approved or sent payout),
-- paid (payout succeeded), failed (payout failed or the bank returned it), disputed (held while a dispute is open).
create function private.earnings_line_status(p_payout_id uuid, p_payout_state text, p_dispute_open boolean) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_dispute_open and p_payout_id is null then 'disputed'
    when p_payout_id is null then 'pending'
    when p_payout_state in ('approved', 'sent') then 'approved'
    when p_payout_state = 'succeeded' then 'paid'
    when p_payout_state in ('failed', 'reversed') then 'failed'
    else 'pending'
  end;
$$;
revoke all on function private.earnings_line_status(uuid, text, boolean) from public, anon, authenticated;

create function public.my_earnings_lines(p_from date default null, p_to date default null, p_limit integer default 300)
returns table (id uuid, kind text, amount_kobo bigint, earned_at timestamptz, payout_id uuid, calculation jsonb, pay_status text,
               dispute_id uuid, dispute_state text, dispute_due_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if private.my_contracted_org() is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  return query
    select l.id, l.kind, l.amount_kobo, l.earned_at, l.payout_id, l.calculation,
           private.earnings_line_status(l.payout_id, p.state, od.id is not null),
           coalesce(od.id, ld.id), coalesce(od.state, ld.state), od.response_due_at
      from public.earnings_ledger l
      left join public.payouts p on p.id = l.payout_id
      left join public.earnings_disputes od on od.ledger_id = l.id and od.state = 'open'
      left join lateral (select d2.id, d2.state from public.earnings_disputes d2 where d2.ledger_id = l.id order by d2.opened_at desc limit 1) ld on true
     where l.clinician_id = v_uid
       and (p_from is null or (l.earned_at at time zone 'Africa/Lagos')::date >= p_from)
       and (p_to is null or (l.earned_at at time zone 'Africa/Lagos')::date <= p_to)
     order by l.earned_at desc
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;

-- Gross, withholding (as entered), net, and every line, for one of my payouts. The PDF is drawn from exactly this.
create function public.my_payout_statement(p_payout uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.payouts%rowtype;
begin
  if private.my_contracted_org() is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  select * into p from public.payouts where id = p_payout and clinician_id = v_uid and state not in ('draft', 'cancelled');
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  return jsonb_build_object(
    'payout_id', p.id,
    'clinician_name', (select cs.full_name from public.clinical_staff cs where cs.profile_id = v_uid),
    'tin', (select t.tin from public.clinician_tax_profiles t where t.clinician_id = v_uid),
    'period_start', p.period_start, 'period_end', p.period_end, 'state', p.state,
    'reference', (select t.reference from public.payout_transfers t where t.payout_id = p.id order by t.attempt desc limit 1),
    'gross_kobo', p.amount_kobo, 'withholding_kobo', p.withholding_kobo, 'withholding_note', p.withholding_note,
    'net_kobo', p.amount_kobo - p.withholding_kobo,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'earned_at', l.earned_at, 'amount_kobo', l.amount_kobo,
                'task_type', l.calculation ->> 'task_type', 'pay_status', private.earnings_line_status(l.payout_id, p.state, false)) order by l.earned_at)
              from public.earnings_ledger l where l.payout_id = p.id), '[]'::jsonb));
end;
$$;

-- Copied from S31x. Adds withholding and net per payout, and keeps a disputed (held) line out of the next-payout figure.
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
        'withholding_kobo', p.withholding_kobo, 'net_kobo', p.amount_kobo - p.withholding_kobo,
        'state', p.state, 'approved_at', p.approved_at,
        'reversed_at', (select max(e.created_at) from public.payout_events e where e.payout_id = p.id and e.to_state = 'reversed'),
        'paid_then_returned', exists (select 1 from public.payout_events e where e.payout_id = p.id and e.from_state = 'succeeded' and e.to_state = 'reversed'),
        'reference', (select t.reference from public.payout_transfers t where t.payout_id = p.id order by t.attempt desc limit 1),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'earned_at', l.earned_at, 'amount_kobo', l.amount_kobo,
                   'task_type', l.calculation ->> 'task_type') order by l.earned_at)
                   from public.earnings_ledger l where l.payout_id = p.id), '[]'::jsonb)) order by p.period_end desc)
        from public.payouts p where p.clinician_id = v_uid and p.state not in ('draft', 'cancelled')), '[]'::jsonb),
    'next_payout_kobo', coalesce((select sum(l.amount_kobo) from public.earnings_ledger l
                                   where l.clinician_id = v_uid and l.payout_id is null and not l.is_test
                                     and not exists (select 1 from public.earnings_disputes d where d.ledger_id = l.id and d.state = 'open')), 0),
    'held_kobo', coalesce((select sum(l.amount_kobo) from public.earnings_ledger l
                            where l.clinician_id = v_uid and l.payout_id is null and not l.is_test
                              and exists (select 1 from public.earnings_disputes d where d.ledger_id = l.id and d.state = 'open')), 0),
    'minimum_payout_kobo', private.payouts_setting('minimum_payout_kobo'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Admin / finance: resolve disputes, withholding, holds
-- ---------------------------------------------------------------------------
create function public.list_earnings_disputes(p_state text default 'open', p_include_test boolean default false)
returns table (id uuid, ledger_id uuid, clinician_id uuid, clinician_name text, reason_code text, note text, state text, opened_at timestamptz,
               response_due_at timestamptz, overdue boolean, resolved_at timestamptz, resolution_note text, line_kind text, line_amount_kobo bigint,
               line_earned_at timestamptz, task_type text, adjustment_ledger_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  return query
    select d.id, d.ledger_id, d.clinician_id, (select cs.full_name from public.clinical_staff cs where cs.profile_id = d.clinician_id),
           d.reason_code, d.note, d.state, d.opened_at, d.response_due_at, (d.state = 'open' and d.response_due_at < now()), d.resolved_at, d.resolution_note,
           l.kind, l.amount_kobo, l.earned_at, l.calculation ->> 'task_type', d.adjustment_ledger_id
      from public.earnings_disputes d
      join public.earnings_ledger l on l.id = d.ledger_id
     where d.organisation_id = v_org and (p_state is null or p_state = 'all' or d.state = p_state) and (p_include_test or not d.is_test)
     order by case when d.state = 'open' then 0 else 1 end,
              case when d.state = 'open' then d.response_due_at end asc,
              coalesce(d.resolved_at, d.opened_at) desc
     limit 300;
end;
$$;

-- Resolves into an adjustment (positive or negative, pointing at the disputed line) or a rejection. Either way the line is released from the hold.
create function public.resolve_earnings_dispute(p_id uuid, p_resolution text, p_amount_kobo bigint default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_uid uuid := (select auth.uid());
  d public.earnings_disputes%rowtype;
  l public.earnings_ledger%rowtype;
  v_adj uuid;
begin
  if p_resolution not in ('adjusted', 'rejected') then raise exception 'dispute_bad_resolution' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'earnings_reason_needed' using errcode = '22023'; end if;
  select * into d from public.earnings_disputes where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'dispute_unknown' using errcode = '22023'; end if;
  if d.state <> 'open' then raise exception 'dispute_not_open' using errcode = '23514'; end if;
  select * into l from public.earnings_ledger where id = d.ledger_id;
  perform set_config('tarragon.dispute_write', 'on', true);
  if p_resolution = 'adjusted' then
    if p_amount_kobo is null or p_amount_kobo = 0 or abs(p_amount_kobo) > 1000000000 then raise exception 'earnings_bad_amount' using errcode = '22023'; end if;
    -- the dispute id is the reference, so a retry returns the same adjustment line (the shared adjustment pattern of the ledger)
    v_adj := private.ledger_insert(d.organisation_id, d.clinician_id, 'adjustment', 'dispute', d.id, p_amount_kobo, null,
      jsonb_build_object('reason', btrim(p_note), 'corrects', d.ledger_id, 'dispute_id', d.id, 'reason_code', d.reason_code, 'posted_at', now()),
      -- dated like the line it corrects, so it falls in the same payout period as that line and never waits a week behind it
      l.earned_at, d.is_test, btrim(p_note), v_uid);
  elsif p_amount_kobo is not null then
    raise exception 'dispute_rejection_has_no_amount' using errcode = '22023';
  end if;
  update public.earnings_disputes set state = p_resolution, resolved_at = now(), resolved_by = v_uid, resolution_note = btrim(p_note), adjustment_ledger_id = v_adj
   where id = d.id;
  perform set_config('tarragon.dispute_write', 'off', true);
  perform private.refresh_payout_draft(d.clinician_id);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'earnings.dispute_resolved', 'earnings_dispute', d.id, jsonb_build_object('resolution', p_resolution, 'adjustment_ledger_id', v_adj));
  -- the notice never blocks a money state change (same as payout_notify)
  begin
    perform private.credential_notify(d.clinician_id, d.organisation_id, 'Your earnings question was answered',
      'Finance has answered your question about a line on your earnings statement. You can read the answer under Earnings in your console.',
      jsonb_build_object('dispute_id', d.id), false);
  exception when others then null;
  end;
  return jsonb_build_object('dispute_id', d.id, 'resolution', p_resolution, 'adjustment_ledger_id', v_adj);
end;
$$;

-- Withholding is typed in by a person while a payout is a draft. Nothing calculates it.
create function public.set_payout_withholding(p_id uuid, p_withholding_kobo bigint, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_admin_org();
  p public.payouts%rowtype;
begin
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_a_draft' using errcode = '23514'; end if;
  if p_withholding_kobo is null or p_withholding_kobo < 0 or p_withholding_kobo >= p.amount_kobo then raise exception 'payout_bad_withholding' using errcode = '22023'; end if;
  if p_withholding_kobo > 0 and char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'earnings_reason_needed' using errcode = '22023'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set withholding_kobo = p_withholding_kobo, withholding_note = nullif(btrim(p_note), '') where id = p.id;
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'payout.withholding_entered', 'payout', p.id, jsonb_build_object('withholding_kobo', p_withholding_kobo));
end;
$$;

create function public.list_topup_holds(p_state text default 'held', p_include_test boolean default false)
returns table (id uuid, clinician_id uuid, clinician_name text, run_start timestamptz, run_end timestamptz, reason text, evidence jsonb, state text,
               decided_at timestamptz, decision_note text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  return query
    select h.id, h.clinician_id, (select cs.full_name from public.clinical_staff cs where cs.profile_id = h.clinician_id),
           h.run_start, h.run_end, h.reason, h.evidence, h.state, h.decided_at, h.decision_note
      from public.earnings_topup_holds h
     where h.organisation_id = v_org and (p_state is null or p_state = 'all' or h.state = p_state) and (p_include_test or not h.is_test)
     order by h.run_end desc limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Pilot minimum: the calculation, the activity check, release/deny, and late-line netting
-- ---------------------------------------------------------------------------
-- Evidence for a run of declared hours. Approximate by design: a hold goes to a person, who decides.
create function private.run_activity(p_org uuid, p_clinician uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'claims', (select count(*) from public.task_claims c where c.clinician_id = p_clinician and c.claimed_at > p_start and c.claimed_at <= p_end),
    'completed_claims', (select count(*) from public.task_claims c where c.clinician_id = p_clinician and c.claimed_at > p_start and c.claimed_at <= p_end and c.end_reason = 'completed'),
    'expired_claims', (select count(*) from public.task_claims c where c.clinician_id = p_clinician and c.claimed_at > p_start and c.claimed_at <= p_end and c.end_reason = 'expired'),
    -- tasks that existed before the run ended and were not taken by this clinician: work that was waiting
    'tasks_waiting', (select count(*) from public.clinical_tasks t
                       where t.organisation_id = p_org and t.created_at < p_end
                         -- a test clinician is compared with test tasks, a real one with real tasks (INV-13)
                         and t.is_test = coalesce((select cs.is_test from public.clinical_staff cs where cs.profile_id = p_clinician), false)
                         and coalesce(t.completed_at, 'infinity'::timestamptz) > p_start
                         and (t.claimed_at is null or t.claimed_at > p_start)
                         and t.claimed_by is distinct from p_clinician));
$$;
revoke all on function private.run_activity(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- What a run of declared hours is owed, from the schedule in force when it ended (S30's calculation, in one place).
-- Null when the clinician is not contracted or no schedule or minimum applies.
create function private.topup_calc(p_org uuid, p_clinician uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  fs public.fee_schedules%rowtype;
  v_counted text[] := coalesce(array(select jsonb_array_elements_text(private.earnings_setting('minimum_guarantee') -> 'counted_kinds')), '{}');
  v_test boolean;
  v_earned bigint;
  v_seconds numeric;
begin
  select cs.is_test into v_test from public.clinical_staff cs where cs.profile_id = p_clinician and cs.employment_type::text = 'contracted';
  if v_test is null then return null; end if;
  fs := private.fee_schedule_at(p_org, p_end);
  if fs.id is null or (fs.items ->> 'pilot_minimum_per_declared_hour_kobo')::bigint <= 0 then return null; end if;
  select coalesce(sum(l.amount_kobo), 0) into v_earned from public.earnings_ledger l
   where l.clinician_id = p_clinician and l.kind = any (v_counted) and l.earned_at > p_start and l.earned_at <= p_end;
  v_seconds := extract(epoch from (p_end - p_start));
  return jsonb_build_object('schedule_id', fs.id, 'schedule_version', fs.version, 'calc', private.fee_minimum_calc(fs.items, v_seconds, v_earned),
    'earned', v_earned, 'seconds', v_seconds, 'counted', to_jsonb(v_counted), 'is_test', v_test,
    'ref', private.earnings_ref(p_clinician || '|' || p_start || '|' || p_end));
end;
$$;
revoke all on function private.topup_calc(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Posts the top-up for one run if it is due and not already there. Returns 'no_schedule', 'nothing_due', 'exists' or 'posted'.
create function private.post_topup_for_run(p_org uuid, p_clinician uuid, p_start timestamptz, p_end timestamptz) returns text
language plpgsql security definer set search_path = ''
as $$
declare c jsonb := private.topup_calc(p_org, p_clinician, p_start, p_end);
begin
  if c is null then return 'no_schedule'; end if;
  if (c -> 'calc' ->> 'top_up_kobo')::bigint <= 0 then return 'nothing_due'; end if;
  if exists (select 1 from public.earnings_ledger l where l.clinician_id = p_clinician and l.kind = 'minimum_topup' and l.reference_id = (c ->> 'ref')::uuid) then return 'exists'; end if;
  perform private.ledger_insert(p_org, p_clinician, 'minimum_topup', 'declared_hours', (c ->> 'ref')::uuid, (c -> 'calc' ->> 'top_up_kobo')::bigint, (c ->> 'schedule_id')::uuid,
    (c -> 'calc') || jsonb_build_object('run_start', p_start, 'run_end', p_end, 'declared_seconds', (c ->> 'seconds')::numeric,
                                        'earned_in_run_kobo', (c ->> 'earned')::bigint, 'counted_kinds', c -> 'counted', 'schedule_version', (c ->> 'schedule_version')::integer),
    p_end, (c ->> 'is_test')::boolean);
  return 'posted';
end;
$$;
revoke all on function private.post_topup_for_run(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- A person releases or denies a held top-up. A release posts the top-up in the same step, so it can never be lost to the 60 day look-back
-- of the daily job; if it cannot be posted (no schedule), the release is refused rather than stored and forgotten.
create function public.decide_topup_hold(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_uid uuid := (select auth.uid());
  h public.earnings_topup_holds%rowtype;
  v_result text;
begin
  if p_decision not in ('released', 'denied') then raise exception 'hold_bad_decision' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'earnings_reason_needed' using errcode = '22023'; end if;
  select * into h from public.earnings_topup_holds where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'hold_unknown' using errcode = '22023'; end if;
  if h.state <> 'held' then raise exception 'hold_already_decided' using errcode = '23514'; end if;
  if p_decision = 'released' then
    v_result := private.post_topup_for_run(h.organisation_id, h.clinician_id, h.run_start, h.run_end);
    if v_result = 'no_schedule' then raise exception 'hold_no_fee_schedule' using errcode = '55000'; end if;
    perform private.refresh_payout_draft(h.clinician_id);
  end if;
  perform set_config('tarragon.dispute_write', 'on', true);
  update public.earnings_topup_holds set state = p_decision, decided_by = v_uid, decided_at = now(), decision_note = btrim(p_note) where id = h.id;
  perform set_config('tarragon.dispute_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'earnings.topup_hold_decided', 'earnings_topup_hold', h.id, jsonb_build_object('decision', p_decision, 'posting', v_result));
end;
$$;

-- Copied from S30. Changes: each run is isolated (one bad run no longer aborts the day's top-ups for everyone), the activity check before a
-- top-up posts (a flagged run is held and finance is told; a released hold is already posted; a denied one never is), the calculation
-- moved into the helpers above, and the late-line netting pass at the end.
create or replace function private.post_minimum_topups() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  h public.earnings_topup_holds%rowtype;
  fs public.fee_schedules%rowtype;
  c jsonb;
  v_counted text[] := coalesce(array(select jsonb_array_elements_text(private.earnings_setting('minimum_guarantee') -> 'counted_kinds')), '{}');
  v_cfg jsonb := coalesce(private.disputes_setting('pilot_minimum'), '{}'::jsonb);
  v_earned bigint;
  v_n integer := 0;
  v_act jsonb;
  v_reason text;
  t record;
  v_desired bigint;
  v_already bigint;
begin
  for r in
    select b.organisation_id, b.clinician_id, lower(m.rng) as run_start, upper(m.rng) as run_end
      from (select organisation_id, clinician_id, range_agg(tstzrange(starts_at, ends_at)) as agg
              from public.availability_blocks
             where state = 'confirmed' and minimum_guarantee_eligible
             group by organisation_id, clinician_id) b,
           lateral (select unnest(b.agg) as rng) m
     where upper(m.rng) <= now() - interval '2 hours' and upper(m.rng) > now() - interval '60 days'
  loop
    begin
      c := private.topup_calc(r.organisation_id, r.clinician_id, r.run_start, r.run_end);
      continue when c is null or (c -> 'calc' ->> 'top_up_kobo')::bigint <= 0;
      continue when exists (select 1 from public.earnings_ledger l where l.clinician_id = r.clinician_id and l.kind = 'minimum_topup' and l.reference_id = (c ->> 'ref')::uuid);

      -- S30b activity check (OQ-180)
      if coalesce((v_cfg ->> 'activity_check')::boolean, false) then
        select * into h from public.earnings_topup_holds where clinician_id = r.clinician_id and run_start = r.run_start and run_end = r.run_end;
        if found then
          continue when h.state in ('held', 'denied');
        else
          v_act := private.run_activity(r.organisation_id, r.clinician_id, r.run_start, r.run_end);
          v_reason := case
            when coalesce((v_cfg ->> 'hold_when_no_claims_and_work_waited')::boolean, false)
                 and (v_act ->> 'claims')::integer = 0 and (v_act ->> 'tasks_waiting')::integer > 0
                 and (c ->> 'earned')::bigint = 0 then 'no_claims_while_work_waited'
            when coalesce((v_cfg ->> 'hold_when_expired_claims_and_no_completed')::boolean, false)
                 and (v_act ->> 'expired_claims')::integer > 0 and (v_act ->> 'completed_claims')::integer = 0 then 'expired_claims_and_no_completed'
            else null end;
          if v_reason is not null then
            perform set_config('tarragon.dispute_write', 'on', true);
            insert into public.earnings_topup_holds (organisation_id, clinician_id, run_start, run_end, reason, evidence, is_test)
            values (r.organisation_id, r.clinician_id, r.run_start, r.run_end, v_reason,
                    v_act || jsonb_build_object('top_up_kobo', (c -> 'calc' ->> 'top_up_kobo')::bigint), (c ->> 'is_test')::boolean)
            on conflict (clinician_id, run_start, run_end) do nothing;
            perform set_config('tarragon.dispute_write', 'off', true);
            insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (r.organisation_id, 'earnings.topup_held', 'profile', r.clinician_id, jsonb_build_object('reason', v_reason, 'run_start', r.run_start, 'run_end', r.run_end));
            if not (c ->> 'is_test')::boolean then
              begin
                perform private.credential_notify_reviewers(r.organisation_id, 'A pilot minimum top-up is held for a check',
                  'A pilot minimum top-up was held because the declared hours show no sign of work. Please release or deny it under Earnings questions.',
                  jsonb_build_object('clinician_id', r.clinician_id), 'finance');
              exception when others then null;
              end;
            end if;
            continue;
          end if;
        end if;
      end if;

      if private.post_topup_for_run(r.organisation_id, r.clinician_id, r.run_start, r.run_end) = 'posted' then v_n := v_n + 1; end if;
    exception when others then
      perform set_config('tarragon.dispute_write', 'off', true);
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'earnings.sweep_error', 'profile', r.clinician_id, jsonb_build_object('step', 'minimum_topup', 'error', sqlerrm, 'run_start', r.run_start));
      if not exists (select 1 from public.ops_incidents where external_reference = 'earnings_topups' and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values ('technical', 'sev2', 'Pilot minimum top-ups could not be worked out',
                'private.post_minimum_topups() failed for at least one run; see audit_log action earnings.sweep_error. A contracted clinician may be missing a top-up.',
                'earnings_topups', now(), now());
      end if;
    end;
  end loop;

  -- S30b late-line netting (OQ-185). A line posted after a top-up, for work inside its run, can push the clinician past the guarantee.
  -- The top-up is recomputed with the schedule it used; any excess is taken back with an adjustment that points at the top-up.
  -- Idempotent: the reference carries the desired amount, so the same excess never posts twice. It only ever reduces.
  for t in select l.* from public.earnings_ledger l
            where l.kind = 'minimum_topup' and l.payout_id is null and l.earned_at > now() - interval '60 days' and l.calculation ? 'run_start' and l.fee_schedule_version_id is not null loop
    begin
      select * into fs from public.fee_schedules where id = t.fee_schedule_version_id;
      continue when not found;
      select coalesce(sum(l.amount_kobo), 0) into v_earned from public.earnings_ledger l
       where l.clinician_id = t.clinician_id and l.kind = any (v_counted)
         and l.earned_at > (t.calculation ->> 'run_start')::timestamptz and l.earned_at <= (t.calculation ->> 'run_end')::timestamptz;
      v_desired := (private.fee_minimum_calc(fs.items, (t.calculation ->> 'declared_seconds')::numeric, v_earned) ->> 'top_up_kobo')::bigint;
      select t.amount_kobo + coalesce(sum(a.amount_kobo), 0) into v_already from public.earnings_ledger a
       where a.clinician_id = t.clinician_id and a.kind = 'adjustment' and a.calculation ->> 'netting_for' = t.id::text;
      if v_desired < v_already then
        perform private.ledger_insert(t.organisation_id, t.clinician_id, 'adjustment', 'topup_netting',
          private.earnings_ref('topup-netting|' || t.id || '|' || v_desired), v_desired - v_already, null,
          jsonb_build_object('system_reason', 'late_line_netting', 'netting_for', t.id, 'corrects', t.id, 'earned_in_run_kobo', v_earned, 'desired_top_up_kobo', v_desired,
                             'reason', 'Late line inside the declared hours: the pilot minimum top-up reduced to the shortfall that remains.'),
          now(), t.is_test, 'Late line inside the declared hours: the pilot minimum top-up reduced to the shortfall that remains.', null);
        perform private.refresh_payout_draft(t.clinician_id);
        v_n := v_n + 1;
      end if;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (t.organisation_id, 'earnings.sweep_error', 'earnings_ledger', t.id, jsonb_build_object('step', 'topup_netting', 'error', sqlerrm));
    end;
  end loop;
  return v_n;
end;
$$;

-- Once a day, finance is reminded of anything left waiting: an unanswered question past its clock, or a held top-up older than a day.
create function private.earnings_overdue_check() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n integer := 0;
begin
  for r in
    select o.organisation_id,
           (select count(*) from public.earnings_disputes d where d.organisation_id = o.organisation_id and d.state = 'open' and not d.is_test and d.response_due_at < now()) as overdue,
           (select count(*) from public.earnings_topup_holds h where h.organisation_id = o.organisation_id and h.state = 'held' and not h.is_test and h.created_at < now() - interval '1 day') as old_holds
      from (select organisation_id from public.earnings_disputes union select organisation_id from public.earnings_topup_holds) o
  loop
    if r.overdue + r.old_holds > 0 then
      begin
        perform private.credential_notify_reviewers(r.organisation_id, 'Earnings questions are waiting for an answer',
          format('%s earnings question(s) are past their response time and %s held pilot minimum top-up(s) are waiting. Please see Earnings questions.', r.overdue, r.old_holds),
          jsonb_build_object('overdue', r.overdue, 'held', r.old_holds), 'finance');
        v_n := v_n + 1;
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'earnings.sweep_error', 'organisation', r.organisation_id, jsonb_build_object('step', 'overdue_check', 'error', sqlerrm));
      end;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.earnings_overdue_check() from public, anon, authenticated;
select cron.schedule('earnings-overdue-check', '0 7 * * *', $$ select private.earnings_overdue_check(); $$);

-- ---------------------------------------------------------------------------
-- 10. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.earnings_disputes_config enable row level security;
alter table public.earnings_disputes enable row level security;
alter table public.earnings_topup_holds enable row level security;

create policy earnings_disputes_config_select on public.earnings_disputes_config for select to authenticated using (private.is_admin());
create policy earnings_disputes_select on public.earnings_disputes for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.is_admin() and organisation_id = private.caller_org()));
create policy earnings_topup_holds_select on public.earnings_topup_holds for select to authenticated
  using (private.is_admin() and organisation_id = private.caller_org());

revoke all on public.earnings_disputes_config, public.earnings_disputes, public.earnings_topup_holds from anon, public, authenticated;
grant select on public.earnings_disputes_config, public.earnings_disputes, public.earnings_topup_holds to authenticated;

revoke all on function
  public.open_earnings_dispute(uuid, text, text, uuid), public.withdraw_earnings_dispute(uuid), public.my_earnings_lines(date, date, integer),
  public.my_payout_statement(uuid), public.list_earnings_disputes(text, boolean), public.resolve_earnings_dispute(uuid, text, bigint, text),
  public.set_payout_withholding(uuid, bigint, text), public.list_topup_holds(text, boolean), public.decide_topup_hold(uuid, text, text)
  from public, anon;
grant execute on function
  public.open_earnings_dispute(uuid, text, text, uuid), public.withdraw_earnings_dispute(uuid), public.my_earnings_lines(date, date, integer),
  public.my_payout_statement(uuid), public.list_earnings_disputes(text, boolean), public.resolve_earnings_dispute(uuid, text, bigint, text),
  public.set_payout_withholding(uuid, bigint, text), public.list_topup_holds(text, boolean), public.decide_topup_hold(uuid, text, text)
  to authenticated;
-- create or replace keeps grants; state them again so this file is the whole truth.
revoke all on function public.approve_payout(uuid), public.payout_prepare_send(uuid), public.my_payout_overview() from public, anon;
grant execute on function public.approve_payout(uuid), public.payout_prepare_send(uuid), public.my_payout_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Self-check (the migration fails if any of this is wrong)
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.open_earnings_dispute(uuid,text,text,uuid)', 'public.withdraw_earnings_dispute(uuid)', 'public.my_earnings_lines(date,date,integer)',
    'public.my_payout_statement(uuid)', 'public.list_earnings_disputes(text,boolean)', 'public.resolve_earnings_dispute(uuid,text,bigint,text)',
    'public.set_payout_withholding(uuid,bigint,text)', 'public.list_topup_holds(text,boolean)', 'public.decide_topup_hold(uuid,text,text)',
    'public.approve_payout(uuid)', 'public.payout_prepare_send(uuid)', 'public.my_payout_overview()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S30b assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S30b assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.refresh_payout_draft(uuid)', 'private.build_payout_drafts(uuid,date,boolean,uuid)', 'private.run_activity(uuid,uuid,timestamptz,timestamptz)',
    'private.post_minimum_topups()', 'private.earnings_line_status(uuid,text,boolean)', 'private.disputes_setting(text)',
    'private.topup_calc(uuid,uuid,timestamptz,timestamptz)', 'private.post_topup_for_run(uuid,uuid,timestamptz,timestamptz)', 'private.earnings_overdue_check()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S30b assertion: % is callable from outside', v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.earnings_disputes', 'INSERT') or has_table_privilege('authenticated', 'public.earnings_disputes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.earnings_topup_holds', 'INSERT') or has_table_privilege('authenticated', 'public.earnings_topup_holds', 'UPDATE')
     or has_table_privilege('anon', 'public.earnings_disputes', 'SELECT') or has_table_privilege('anon', 'public.earnings_topup_holds', 'SELECT') then
    raise exception 'S30b assertion: a table grant is too wide';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname = 'build_payout_drafts') <> 1 then
    raise exception 'S30b assertion: build_payout_drafts has an overload left behind';
  end if;
  if (select is_on from public.go_live_guards where key = 'payouts_enabled') then raise exception 'S30b assertion: the payouts guard must stay off'; end if;
  if (select count(*) from public.earnings_disputes_config where is_active) <> 1 then raise exception 'S30b assertion: one active dispute config expected'; end if;
  if (select count(*) from cron.job where jobname = 'earnings-overdue-check') <> 1 then raise exception 'S30b assertion: the overdue check is not scheduled'; end if;
end $$;
