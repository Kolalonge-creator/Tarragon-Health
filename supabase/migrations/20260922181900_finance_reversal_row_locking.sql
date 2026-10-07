-- Finance reversal maker-checker (20260917235414) hardened its threshold
-- check but left the underlying reversal itself unlocked — a code-review
-- pass (2026-09-18) on that migration found two concurrent-transaction
-- races, both rooted in the same missing lock. A second, deeper review pass
-- (also 2026-09-18, multi-angle) then corrected part of the first pass's own
-- write-up before this landed — see the correction below.
--
-- 1. private.finance_reverse_entry (pre-existing, unmodified by the
--    2026-09-17 migration) reads finance_journal_entries with a plain
--    SELECT and only later sets is_reversed = true. Two concurrent calls —
--    two officers, one officer double-clicking, or a client retry after a
--    slow response — both read is_reversed = false before either commits.
--    CORRECTION: the first pass's write-up here claimed this "doubles the
--    financial effect in the general ledger". That is not what actually
--    happens, and the regression test this migration originally shipped
--    with asserted the wrong thing as a result. finance_reverse_entry posts
--    its contra entry through private.finance_post_journal with a
--    DETERMINISTIC source_ref ('reversal:'||p_entry — the same string for
--    every attempt at reversing the same original entry), and
--    finance_journal_entries_source_uniq (20260725225616) is a UNIQUE INDEX
--    on (source, source_ref). So a second, genuinely-concurrent contra
--    INSERT for the same entry cannot actually succeed: it either blocks on
--    that index until the first commits and then fails with a raw
--    `duplicate key value violates unique constraint
--    "finance_journal_entries_source_uniq"`, or — if it arrives after the
--    first has already committed — finance_post_journal's own idempotency
--    check (SELECT before INSERT, matching the same source_ref) finds the
--    existing row and returns it, silently reporting success to the second
--    caller without creating anything new. Two GL entries for one reversal
--    was never actually reachable. What the race really produced, depending
--    on timing, was either a confusing raw Postgres constraint-violation
--    error surfacing instead of a clean business message, or a second
--    caller being told "reversed" when their specific call did nothing.
--    The FOR UPDATE fix below is still correct and still worth having —
--    relying on an incidental uniqueness constraint that exists for a
--    different reason (idempotent event posting) as your ONLY concurrency
--    control is fragile, not a substitute for locking the row the
--    check-then-act logic actually reads — but the severity claim here is
--    corrected: this is a reliability/clarity fix for this specific caller
--    today, not a ledger-correctness one. (It remains a real
--    ledger-correctness fix for any future caller of finance_reverse_entry
--    that doesn't happen to build the same deterministic source_ref.)
--    public.finance_reverse_journal inherits this on its synchronous
--    (under-threshold) path, and so does public.finance_approve_request's
--    journal_reversal branch on its approval path — the race is in the
--    shared primitive, not either caller.
--
-- 2. finance_approve_request's journal_reversal branch called
--    private.finance_reverse_entry with no prior check that the target
--    entry isn't already reversed, and nothing caught the exception that
--    call could raise. If two over-threshold reversal requests get created
--    for the same entry (nothing stops a second finance_reverse_journal
--    call from queuing a second pending request before the first is
--    actioned — this part is unaffected by the correction above, since
--    queuing a request doesn't touch finance_journal_entries at all) and a
--    reviewer approves both, the second approval's call into
--    finance_reverse_entry raises, which rolls back the ENTIRE approval
--    transaction — leaving that finance_approval_requests row stuck at
--    status='pending' forever, with no automatic resolution path. This
--    finding is fully independent of the correction above and stands as
--    originally described: a real, reachable, severe bug.
--
-- Fix, part A: SELECT ... FOR UPDATE the target finance_journal_entries row
-- at the point each function reads it, so a concurrent attempt on the same
-- entry serializes instead of racing (the loser re-reads the committed
-- is_reversed = true and gets a clean, expected "already reversed" error —
-- never the raw constraint violation or the misleading false-success
-- described above). finance_reverse_journal gets the same lock+check up
-- front too: it can't set is_reversed itself, but locking early avoids
-- routing an already-reversed entry into a brand-new approval request, and
-- means the synchronous path's "already reversed" error surfaces before any
-- wasted threshold/approval-routing work.
--
-- Fix, part B: finance_approve_request's journal_reversal branch now locks
-- the target entry and checks its state BEFORE calling finance_reverse_entry,
-- inside a nested exception block. Two outcomes are treated as an expected,
-- clean rejection rather than a crash: the entry was already reversed by
-- another approved request (SELECT ... FOR UPDATE finds is_reversed = true),
-- or the entry no longer exists at all (FOUND is false — e.g. deleted by an
-- unrelated data-correction flow between the request being queued and being
-- reviewed). Both, and any other failure raised while attempting the
-- reversal (a locked accounting period, for instance), are caught by a
-- single `exception when others` around the whole attempt, so this closes
-- the WHOLE class of "any failure here strands the request at pending"
-- rather than the one specific cause originally identified — a
-- narrower catch would leave the same failure mode reachable through a
-- different exception. The rejection's review_note always keeps the
-- system's own explanation (previously a reviewer's optional note would
-- silently replace it via `coalesce`, so a rejection could carry a note
-- that reads like an approval); a reviewer's own note is appended, not
-- substituted.
--
-- Also fixes an unrelated but load-bearing bug the same review turned up:
-- finance_approval_requests_request_type_check (added 2026-07-26, before
-- 'journal_reversal' existed) still only allows ('manual_journal',
-- 'period_lock') — the 2026-09-17 migration's comment claims "no ALTER TYPE
-- dance" needed because request_type is plain text, but never widened the
-- CHECK constraint that actually restricts it. Confirmed live: any
-- over-threshold reversal attempt has been raising a check-constraint
-- violation in production since that migration shipped, i.e. the entire
-- maker-checker path for reversals (the feature migration 20260917235414
-- exists to add) has never actually worked. Without this, finding 2's
-- scenario above cannot even occur — there is no way to get a real pending
-- 'journal_reversal' request row at all. `drop constraint if exists` so a
-- replay against a database where this was already widened out of band
-- doesn't abort the whole migration; closed with a DO-block assertion per
-- this repo's own removal/verification convention.
--
-- Standing regression coverage: packages/db/tests/finance_reversal_concurrent_lock.sh
-- (a real two-connection proof — see that file's header for why this one
-- can't be a single-session BEGIN/ROLLBACK .sql script like the rest of
-- this directory), registered in ci.manifest.
--
-- Also fixes the display side of the same gap, found by the same review:
-- request_type is queried by finance_pending_approvals/finance_approval_history
-- (20260726120000), but their result never carried anything about a
-- journal_reversal request's target (just the raw {entry_id, reason}
-- payload) — and apps/web's Zod schemas (apps/web/src/lib/finance/schemas.ts)
-- only accepted request_type in ('manual_journal', 'period_lock'), so the
-- Approvals page would throw on the whole query the moment a real
-- journal_reversal row existed, not just mis-render that one row. Both RPCs
-- below now include a reversal_target (entry_no/currency/amount_minor,
-- looked up from the target entry) for journal_reversal rows; the schemas
-- and UI are fixed in the same PR (apps/web/src/lib/finance/schemas.ts,
-- apps/web/src/app/(dashboard)/finance/_components/approvals.tsx).

alter table public.finance_approval_requests
  drop constraint if exists finance_approval_requests_request_type_check;
alter table public.finance_approval_requests
  add constraint finance_approval_requests_request_type_check
  check (request_type in ('manual_journal', 'period_lock', 'journal_reversal'));

do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'finance_approval_requests_request_type_check'
      and constraint_schema = 'public'
      and check_clause like '%journal_reversal%'
  ) then
    raise exception 'finance_approval_requests_request_type_check does not admit journal_reversal after widening';
  end if;
end $$;

create or replace function private.finance_reverse_entry(
  p_entry uuid, p_reason text, p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_orig public.finance_journal_entries%rowtype;
  v_new uuid;
  v_lines jsonb;
begin
  -- FOR UPDATE: serializes a concurrent reversal of the same entry instead
  -- of racing (see this migration's header for the corrected account of
  -- what that race could actually produce). The loser blocks here, then
  -- re-reads the committed is_reversed = true below and gets a clean
  -- "already reversed" error.
  select * into v_orig from public.finance_journal_entries where id = p_entry for update;
  if v_orig.id is null then raise exception 'entry not found'; end if;
  if v_orig.is_reversed then raise exception 'entry already reversed'; end if;

  select jsonb_agg(jsonb_build_object(
    'account_code', account_code,
    'debit_minor', credit_minor,     -- swap sides
    'credit_minor', debit_minor,
    'organisation_id', organisation_id,
    'counterparty', counterparty,
    'cost_center_code', cost_center_code,
    'memo', 'Reversal: ' || coalesce(memo,'')))
  into v_lines
  from public.finance_journal_lines where entry_id = p_entry;

  v_new := private.finance_post_journal(
    current_date, v_orig.currency, 'adjustment', 'reversal:' || p_entry::text,
    coalesce(p_reason, 'Reversal of #' || v_orig.entry_no), v_lines, p_created_by);

  update public.finance_journal_entries set reversal_of = p_entry where id = v_new;
  update public.finance_journal_entries set is_reversed = true where id = p_entry;
  return v_new;
end; $$;

create or replace function public.finance_reverse_journal(p_entry uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_req uuid;
  v_max bigint;
  v_threshold bigint;
  v_currency public.currency;
  v_entry_no bigint;
  v_is_reversed boolean;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;

  -- FOR UPDATE here too: without it, two concurrent calls at/above the
  -- threshold would both see is_reversed = false and both queue a pending
  -- approval request for the same entry before either is actioned (nothing
  -- sets is_reversed until an approval actually posts — see
  -- finance_approve_request below for how that specific case now resolves
  -- cleanly instead of stranding a request). Locking here doesn't prevent
  -- that duplicate-request case, but it does close the synchronous
  -- (under-threshold) path outright and gives an immediate, clean error
  -- instead of doing pointless threshold/routing work on an entry that's
  -- already reversed.
  select currency, entry_no, is_reversed into v_currency, v_entry_no, v_is_reversed
    from public.finance_journal_entries where id = p_entry for update;
  if v_currency is null then raise exception 'entry not found'; end if;
  if v_is_reversed then raise exception 'entry already reversed'; end if;

  select coalesce(max(greatest(debit_minor, credit_minor)), 0) into v_max
    from public.finance_journal_lines where entry_id = p_entry;
  select threshold_minor into v_threshold from public.finance_approval_settings
    where currency = v_currency;

  if v_threshold is not null and v_max >= v_threshold then
    v_req := private.finance_request_approval('journal_reversal',
      jsonb_build_object('entry_id', p_entry, 'reason', p_reason),
      p_reason);
    perform private.log_audit('finance.journal.reverse_request_approval', 'finance_journal_entries', p_entry,
      jsonb_build_object('amount_minor', v_max, 'currency', v_currency, 'reason', p_reason, 'request_id', v_req));
    return jsonb_build_object('status', 'pending_approval', 'request_id', v_req);
  end if;

  v_id := private.finance_reverse_entry(p_entry, p_reason, (select auth.uid()));
  perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', p_entry,
    jsonb_build_object('reason', p_reason, 'reversal_entry_id', v_id));
  return jsonb_build_object('status', 'reversed', 'entry_id', v_id);
end; $function$;

create or replace function public.finance_approve_request(p_id uuid, p_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.finance_approval_requests%rowtype;
  v_entry uuid;
  v_month date;
  v_already_reversed boolean;
  v_reject_reason text;
begin
  if not private.finance_can('finance.approvals.manage') then raise exception 'not authorised'; end if;
  select * into r from public.finance_approval_requests where id = p_id for update;
  if r.id is null then raise exception 'approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if r.requested_by = (select auth.uid()) then
    raise exception 'a different finance officer must approve this request' using errcode = 'check_violation';
  end if;

  if r.request_type = 'manual_journal' then
    v_entry := private.finance_post_journal(
      (r.payload->>'entry_date')::date, coalesce(r.payload->>'currency', 'NGN')::public.currency,
      'manual', null, r.payload->>'memo', r.payload->'lines', r.requested_by);
    perform private.log_audit('finance.journal.post', 'finance_journal_entries', v_entry,
      jsonb_build_object('via_approval', p_id, 'memo', r.payload->>'memo'));
  elsif r.request_type = 'journal_reversal' then
    -- Lock the target entry and re-check its state before calling into
    -- finance_reverse_entry, which would otherwise raise and abort this
    -- whole approval transaction, leaving THIS request stuck at 'pending'
    -- forever (finding 2 above). Two pending journal_reversal requests can
    -- legitimately exist for the same entry — when a reviewer approves the
    -- second one after the first already posted, that's a real, expected
    -- outcome, not an error. `exception when others` around the whole
    -- attempt (not just the "already reversed" case) closes the same
    -- failure class for every other reason a reversal can fail — a missing
    -- entry, a locked accounting period, anything — rather than one
    -- specific cause.
    -- Deliberately narrow: only the attempt itself (lock + state check +
    -- finance_reverse_entry) is inside the exception-guarded block. The
    -- success-path audit log call is OUTSIDE it (below), on purpose -- if
    -- private.log_audit itself ever failed, catching that here would roll
    -- back the reversal that had already succeeded and misreport it as a
    -- clean "rejected" to the reviewer, exactly the kind of quiet
    -- mislabeling this fix exists to prevent elsewhere. A post-reversal
    -- audit failure should abort loudly (the normal, unguarded exception
    -- path), not disappear into a business-looking rejection.
    begin
      select is_reversed into v_already_reversed
        from public.finance_journal_entries where id = (r.payload->>'entry_id')::uuid for update;
      if not found then raise exception 'entry not found'; end if;
      if v_already_reversed then raise exception 'entry already reversed'; end if;

      v_entry := private.finance_reverse_entry((r.payload->>'entry_id')::uuid, r.payload->>'reason', r.requested_by);
    exception when others then
      -- A deadlock, a serialization failure, or a lock that couldn't be
      -- acquired is a TRANSIENT condition -- retrying the same approval
      -- would likely succeed. Converting one of those into a permanent
      -- status='rejected' (as every other branch below does) would trade
      -- "stuck at pending forever" for "wrongly terminated forever", which
      -- is not an improvement; re-raise so the caller sees a normal error
      -- and can retry, exactly as it always could before this whole
      -- exception block existed. Only the failures this branch actually
      -- anticipates -- already reversed, entry not found, or another
      -- genuine business-rule failure surfaced by finance_reverse_entry/
      -- finance_post_journal (e.g. a locked accounting period) -- resolve
      -- to a clean rejection. Dispatching on the exact sqlerrm text is a
      -- known, accepted fragility (not a localisation risk -- a plain
      -- `raise exception '...'` is never translated -- but a future reword
      -- of either message would silently fall through to the generic
      -- 'reversal_failed' bucket); packages/db/tests/finance_reversal_concurrent_lock.sh
      -- asserts the resulting reason/review_note, not just the outcome
      -- count, specifically so that drift is caught by CI rather than
      -- discovered later.
      if sqlstate in ('40001', '40P01', '55P03') then raise; end if;
      v_reject_reason := case sqlerrm
        when 'entry already reversed' then 'entry_already_reversed'
        when 'entry not found' then 'entry_not_found'
        else 'reversal_failed'
      end;
      update public.finance_approval_requests set
        status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now(),
        review_note = trim(both ' ' from
          format('Auto-rejected (%s): %s.', v_reject_reason, sqlerrm)
          || case when p_note is not null and trim(p_note) <> '' then ' Reviewer note: ' || p_note else '' end)
      where id = p_id;
      perform private.log_audit('finance.approval.reject', 'finance_approval_requests', p_id,
        jsonb_build_object('request_type', r.request_type, 'reason', v_reject_reason,
          'detail', sqlerrm, 'entry_id', nullif(r.payload->>'entry_id', '')));
      return jsonb_build_object('status', 'rejected', 'reason', v_reject_reason, 'request_id', p_id);
    end;
    perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', (r.payload->>'entry_id')::uuid,
      jsonb_build_object('via_approval', p_id, 'reversal_entry_id', v_entry, 'reason', r.payload->>'reason'));
  elsif r.request_type = 'period_lock' then
    v_month := (r.payload->>'period_month')::date;
    insert into public.finance_periods (period_month, status, closed_at, closed_by, locked_at, locked_by)
    values (v_month, 'locked', now(), (select auth.uid()), now(), (select auth.uid()))
    on conflict (period_month) do update set
      status = 'locked',
      closed_at = coalesce(public.finance_periods.closed_at, now()),
      closed_by = coalesce(public.finance_periods.closed_by, (select auth.uid())),
      locked_at = now(), locked_by = (select auth.uid());
    perform private.log_audit('finance.period.lock', 'finance_periods', null,
      jsonb_build_object('period_month', v_month, 'via_approval', p_id));
  else
    -- No branch above matched: this constraint (finance_approval_requests_
    -- request_type_check) already only admits the three values handled
    -- above, but WITHOUT this else, a future value added to that
    -- constraint without a matching branch here would stamp
    -- status='approved'/reviewed_by/reviewed_at on the request while
    -- performing no action at all -- a maker-checker control silently
    -- reporting success on work it never did. Fail loudly instead.
    raise exception 'unsupported approval request type: %', r.request_type;
  end if;

  update public.finance_approval_requests set
    status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(),
    review_note = p_note, result_entry_id = v_entry
  where id = p_id;

  perform private.log_audit('finance.approval.approve', 'finance_approval_requests', p_id,
    jsonb_build_object('request_type', r.request_type, 'note', p_note));
  return jsonb_build_object('status', 'approved', 'entry_id', v_entry);
end; $function$;

-- reversal_target: null for manual_journal/period_lock rows, and also null
-- (rather than erroring the whole query) if a journal_reversal row's target
-- entry no longer exists — the approve-time fix above already handles that
-- case cleanly, this is just display, so it degrades gracefully too. That
-- includes a MALFORMED entry_id, not just a missing one: `e.id::text =
-- r.payload->>'entry_id'` casts the known-valid uuid column to text and
-- compares, rather than casting the untrusted payload text to uuid — a
-- payload.entry_id that isn't valid uuid syntax at all (nothing enforces
-- the shape of finance_approval_requests.payload) then just fails to match
-- any row instead of raising `invalid input syntax for type uuid` and
-- aborting this whole RPC for every pending/reviewed request, not only the
-- malformed one — the exact blast radius the Zod-schema fix in this same
-- PR closes on the client side.
-- amount_minor is sum(debit_minor), not max(greatest(debit,credit)):
-- finance_post_journal enforces debits = credits on every entry, so the sum
-- of one side is the entry's real total value; the max-single-line reading
-- (correct for finance_reverse_journal's own threshold check, which only
-- needs to know the largest line, not render an amount) would understate a
-- multi-line entry on the one screen whose job is showing a reviewer what
-- they're actually authorising.
create or replace function public.finance_pending_approvals()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'payload', r.payload, 'reason', r.reason,
      'requested_by_name', p.full_name, 'requested_at', r.requested_at,
      'is_own_request', r.requested_by = (select auth.uid()),
      'reversal_target', case when r.request_type = 'journal_reversal' then (
        select jsonb_build_object('entry_no', e.entry_no, 'currency', e.currency,
          'amount_minor', (select coalesce(sum(l.debit_minor), 0)
                            from public.finance_journal_lines l where l.entry_id = e.id))
        from public.finance_journal_entries e where e.id::text = r.payload->>'entry_id'
      ) else null end)
      order by r.requested_at)
    from public.finance_approval_requests r
    left join public.profiles p on p.id = r.requested_by
    where r.status = 'pending'), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

-- Pre-existing bug (20260726120000), in this diff's blast radius because
-- this function's body is rewritten here anyway: `limit` was applied AFTER
-- jsonb_agg had already collapsed every matching row into the single
-- aggregate row it returns, so it truncated a one-row result to one row --
-- p_limit never bounded anything. Fixed with an inner ordered/limited
-- subquery that jsonb_agg then wraps, so p_limit actually caps how many
-- approval_requests rows (payload included) get serialised per call.
create or replace function public.finance_approval_history(p_limit int default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'status', r.status, 'payload', r.payload,
      'reason', r.reason, 'requested_by_name', rp.full_name, 'requested_at', r.requested_at,
      'reviewed_by_name', vp.full_name, 'reviewed_at', r.reviewed_at, 'review_note', r.review_note,
      'result_entry_id', r.result_entry_id,
      'reversal_target', case when r.request_type = 'journal_reversal' then (
        select jsonb_build_object('entry_no', e.entry_no, 'currency', e.currency,
          'amount_minor', (select coalesce(sum(l.debit_minor), 0)
                            from public.finance_journal_lines l where l.entry_id = e.id))
        from public.finance_journal_entries e where e.id::text = r.payload->>'entry_id'
      ) else null end)
      order by coalesce(r.reviewed_at, r.requested_at) desc)
    from (
      select * from public.finance_approval_requests
      where status <> 'pending'
      order by coalesce(reviewed_at, requested_at) desc
      limit greatest(p_limit, 1)
    ) r
    left join public.profiles rp on rp.id = r.requested_by
    left join public.profiles vp on vp.id = r.reviewed_by
    ), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
