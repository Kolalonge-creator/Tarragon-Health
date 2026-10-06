-- S36f: payout DRAFTS and APPROVAL (spec 7.7, roles table: ops prepares payout drafts, admin approves payouts).
-- Design note: docs/design/S36.md (S36f section). This migration moves NO money and calls no payment provider. Sending is S31, behind the
-- `payouts_enabled` go-live guard, which this migration only READS.
--
-- What this adds
--   * permission payouts.prepare: the ops door. Prepares drafts and reads unpaid totals. It can never approve.
--   * payouts: one row per clinician per period (a unique index over the non-cancelled ones), integer kobo, the fee schedule versions
--     used (INV-16), who prepared it, who approved it and the note they gave. State: draft, approved, sent, succeeded, failed,
--     reversed, cancelled. A payable to the clinician, never a patient balance (INV-09).
--   * payout_lines: the link from a payout to the ledger lines it covers. A line sits in at most ONE non-cancelled payout (a partial
--     unique index). Cancelling a payout releases its lines. earnings_ledger.payout_id (S30) is set only when a payout is recorded as
--     sent, so statements keep calling a drafted line "unpaid".
--   * prepare_payout_drafts(start, end): ops or admin. Idempotent per period. Takes only unpaid, non-test earnings of CONTRACTED
--     clinicians (employed doctors are paid by salary, F-03). A zero-fee line still waiting for an admin correction is left out.
--   * approve_payout(id, note): MAKER-CHECKER IN THE DATABASE. Admin only, a different person from the preparer, a note of 10+
--     characters, the lines re-checked at the moment of approval. An approved payout can only be marked sent or cancelled.
--   * cancel_payout(id, reason), mark_payout_sent(id, transfer code): the second is refused while the payouts_enabled guard is off.
--   * payout_unpaid_summary, list_payouts, payout_lines_of, payouts_guard_is_on: the reads for the two screens.
--
-- Counts before this migration (local proof database and live, 2026-10-06): no payouts table exists, earnings_ledger has no
-- payout_id value set anywhere (S30 left it null), so there is no data to convert.

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('payouts.prepare', 'Prepare payout drafts', 'Finance',
   'Build payout drafts from unpaid earnings of contracted clinicians and see unpaid totals. Cannot approve, send or edit an approved payout.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. payouts
-- ---------------------------------------------------------------------------
create table public.payouts (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  clinician_id             uuid not null references public.profiles (id) on delete restrict,
  period_start             date not null,
  period_end               date not null,
  amount_kobo              bigint not null check (amount_kobo > 0),
  line_count               integer not null check (line_count > 0),
  fee_schedule_version_ids uuid[] not null default '{}',
  state                    text not null default 'draft'
                             check (state in ('draft', 'approved', 'sent', 'succeeded', 'failed', 'reversed', 'cancelled')),
  prepared_by              uuid not null references public.profiles (id) on delete restrict,
  prepared_at              timestamptz not null default now(),
  approved_by              uuid references public.profiles (id) on delete restrict,
  approved_at              timestamptz,
  approval_note            text,
  cancelled_by             uuid references public.profiles (id) on delete restrict,
  cancelled_at             timestamptz,
  cancel_reason            text,
  sent_at                  timestamptz,
  paystack_transfer_code   text,
  created_at               timestamptz not null default now(),
  check (period_end >= period_start),
  check ((approved_by is null) = (approved_at is null)),
  check (state in ('draft', 'cancelled') or (approved_by is not null and char_length(btrim(coalesce(approval_note, ''))) >= 10)),
  check (state <> 'cancelled' or (cancelled_by is not null and cancelled_at is not null and char_length(btrim(coalesce(cancel_reason, ''))) >= 10)),
  check (state not in ('sent', 'succeeded', 'failed', 'reversed') or (paystack_transfer_code is not null and sent_at is not null)),
  -- Defence in depth for the maker-checker rule; approve_payout checks it first and gives the clear message.
  constraint payouts_maker_checker check (approved_by is null or approved_by <> prepared_by)
);
create unique index payouts_one_per_clinician_period on public.payouts (clinician_id, period_start, period_end) where state <> 'cancelled';
create index payouts_org_state_idx on public.payouts (organisation_id, state, created_at desc);
comment on table public.payouts is
  'S36f (spec 7.7): what the business pays a contracted clinician for a period. A payable, never a patient balance (INV-09). Written only by the payout functions; an approved payout never changes except to be marked sent or cancelled. Sending money is S31, behind the payouts_enabled guard.';

create table public.payout_lines (
  id                      uuid primary key default gen_random_uuid(),
  payout_id               uuid not null references public.payouts (id) on delete restrict,
  ledger_id               uuid not null references public.earnings_ledger (id) on delete restrict,
  amount_kobo             bigint not null,
  fee_schedule_version_id uuid references public.fee_schedules (id) on delete restrict,
  released_at             timestamptz,
  created_at              timestamptz not null default now()
);
-- An earning is in at most one non-cancelled payout: the nothing-double-counted rule, enforced by the table itself.
create unique index payout_lines_one_active_per_ledger_line on public.payout_lines (ledger_id) where released_at is null;
create index payout_lines_payout_idx on public.payout_lines (payout_id);
comment on table public.payout_lines is
  'S36f: the link between a payout and the earnings_ledger lines it covers. released_at is set when the payout is cancelled, which frees the line for a later draft.';

alter table public.earnings_ledger
  add constraint earnings_ledger_payout_fk foreign key (payout_id) references public.payouts (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 3. Guards: only the functions below write; an approved payout is immutable
-- ---------------------------------------------------------------------------
create function private.guard_payouts() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_on boolean := coalesce(current_setting('tarragon.payout_write', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'payouts are never deleted: cancel one instead' using errcode = '23514'; end if;
  if not v_on then raise exception 'payouts are written only by the payout functions' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'a payout is born a draft' using errcode = '23514'; end if;
    return new;
  end if;
  if (new.id, new.organisation_id, new.clinician_id, new.period_start, new.period_end, new.prepared_by, new.prepared_at, new.created_at)
     is distinct from (old.id, old.organisation_id, old.clinician_id, old.period_start, old.period_end, old.prepared_by, old.prepared_at, old.created_at) then
    raise exception 'a payout''s clinician, period and preparer never change' using errcode = '23514';
  end if;
  if old.state = 'draft' and new.state = 'draft' then
    return new;  -- a draft may take new lines (amount, line count, versions)
  end if;
  if (new.amount_kobo, new.line_count, new.fee_schedule_version_ids) is distinct from (old.amount_kobo, old.line_count, old.fee_schedule_version_ids) then
    raise exception 'an approved payout cannot be edited' using errcode = '23514';
  end if;
  if old.approved_by is not null and (new.approved_by, new.approved_at, new.approval_note) is distinct from (old.approved_by, old.approved_at, old.approval_note) then
    raise exception 'an approved payout cannot be edited' using errcode = '23514';
  end if;
  if not ((old.state = 'draft' and new.state in ('approved', 'cancelled'))
       or (old.state = 'approved' and new.state in ('sent', 'cancelled'))
       or (old.state = 'sent' and new.state in ('succeeded', 'failed', 'reversed'))
       or (old.state = 'succeeded' and new.state = 'reversed')) then
    raise exception 'a payout cannot move from % to %', old.state, new.state using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payouts() from public, anon, authenticated;
create trigger payouts_guard before insert or update or delete on public.payouts
  for each row execute function private.guard_payouts();
create function private.payouts_no_truncate() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception 'payouts and their lines are never truncated' using errcode = '23514'; end; $$;
revoke all on function private.payouts_no_truncate() from public, anon, authenticated;
create trigger payouts_no_truncate before truncate on public.payouts for each statement execute function private.payouts_no_truncate();
create trigger payout_lines_no_truncate before truncate on public.payout_lines for each statement execute function private.payouts_no_truncate();

create function private.guard_payout_lines() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_state text;
begin
  if tg_op = 'DELETE' then raise exception 'payout lines are never deleted: cancel the payout to release them' using errcode = '23514'; end if;
  if coalesce(current_setting('tarragon.payout_write', true), '') <> 'on' then
    raise exception 'payout lines are written only by the payout functions' using errcode = '42501';
  end if;
  select state into v_state from public.payouts where id = new.payout_id;
  if tg_op = 'INSERT' then
    if v_state is distinct from 'draft' then raise exception 'lines can only be added to a draft payout' using errcode = '23514'; end if;
    return new;
  end if;
  -- UPDATE: the only change is releasing a line, and only once its payout is cancelled.
  if old.released_at is null and new.released_at is not null and v_state = 'cancelled'
     and to_jsonb(new) - 'released_at' = to_jsonb(old) - 'released_at' then
    return new;
  end if;
  raise exception 'payout lines cannot be edited' using errcode = '23514';
end;
$$;
revoke all on function private.guard_payout_lines() from public, anon, authenticated;
create trigger payout_lines_guard before insert or update or delete on public.payout_lines
  for each row execute function private.guard_payout_lines();

-- ---------------------------------------------------------------------------
-- 4. Helpers (not callable by clients)
-- ---------------------------------------------------------------------------
-- Ops (payouts.prepare) or the admin. The permission function already passes an active super admin.
create function private.payouts_org() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_permission('payouts.prepare') then
    raise exception 'payout_not_authorised' using errcode = '42501';
  end if;
  return private.caller_org();
end;
$$;
revoke all on function private.payouts_org() from public, anon, authenticated;

-- A ledger line that is waiting for a payout: unpaid, not in any non-cancelled payout, contracted clinician (employed doctors are on
-- salary, F-03), no test account on either side (INV-13), earned on or before the period end (Lagos date), and not a zero line still
-- waiting for an admin correction.
create function private.payout_eligible_lines(p_org uuid, p_end date)
returns table (id uuid, clinician_id uuid, amount_kobo bigint, fee_schedule_version_id uuid)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.clinician_id, l.amount_kobo, l.fee_schedule_version_id
    from public.earnings_ledger l
    join public.clinical_staff cs on cs.profile_id = l.clinician_id and cs.organisation_id = l.organisation_id
    join public.profiles p on p.id = l.clinician_id
   where l.organisation_id = p_org
     and l.payout_id is null
     and not l.is_test and not cs.is_test and not coalesce(p.is_test, false)
     and cs.employment_type::text = 'contracted' and l.employment_type = 'contracted'
     and (l.earned_at at time zone 'Africa/Lagos')::date <= p_end
     and not exists (select 1 from public.payout_lines pl where pl.ledger_id = l.id and pl.released_at is null)
     and not (l.calculation ? 'needs_review'
              and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text));
$$;
revoke all on function private.payout_eligible_lines(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Prepare drafts (ops or admin)
-- ---------------------------------------------------------------------------
create function public.prepare_payout_drafts(p_period_start date, p_period_end date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payouts_org();
  v_uid uuid := (select auth.uid());
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  c record;
  v_existing public.payouts%rowtype;
  v_new_sum bigint;
  v_new_count integer;
  v_pid uuid;
  v_versions uuid[];
  v_created integer := 0;
  v_topped integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
  v_ids uuid[] := '{}';
  v_has boolean;
begin
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'payout_bad_period' using errcode = '22023'; end if;
  if p_period_end >= v_today then raise exception 'payout_period_not_ended' using errcode = '22023'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  for c in select distinct e.clinician_id from private.payout_eligible_lines(v_org, p_period_end) e order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('payout:' || c.clinician_id::text, 0));
    select * into v_existing from public.payouts
     where clinician_id = c.clinician_id and period_start = p_period_start and period_end = p_period_end and state <> 'cancelled';
    v_has := found;
    if v_has and v_existing.state <> 'draft' then v_unchanged := v_unchanged + 1; continue; end if;
    -- Re-read under the lock: another run may have linked lines since the loop began.
    select coalesce(sum(e.amount_kobo), 0), count(*), coalesce(array_agg(distinct e.fee_schedule_version_id) filter (where e.fee_schedule_version_id is not null), '{}')
      into v_new_sum, v_new_count, v_versions
      from private.payout_eligible_lines(v_org, p_period_end) e where e.clinician_id = c.clinician_id;
    if v_new_count = 0 then v_unchanged := v_unchanged + 1; continue; end if;
    if v_new_sum + coalesce(v_existing.amount_kobo, 0) <= 0 then v_skipped := v_skipped + 1; continue; end if;
    if v_has then
      v_pid := v_existing.id;
      insert into public.payout_lines (payout_id, ledger_id, amount_kobo, fee_schedule_version_id)
        select v_pid, e.id, e.amount_kobo, e.fee_schedule_version_id from private.payout_eligible_lines(v_org, p_period_end) e where e.clinician_id = c.clinician_id;
      update public.payouts set amount_kobo = amount_kobo + v_new_sum, line_count = line_count + v_new_count,
             fee_schedule_version_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(fee_schedule_version_ids || v_versions) x)
       where id = v_pid;
      v_topped := v_topped + 1;
    else
      insert into public.payouts (organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, fee_schedule_version_ids, prepared_by)
      values (v_org, c.clinician_id, p_period_start, p_period_end, v_new_sum, v_new_count, v_versions, v_uid) returning id into v_pid;
      insert into public.payout_lines (payout_id, ledger_id, amount_kobo, fee_schedule_version_id)
        select v_pid, e.id, e.amount_kobo, e.fee_schedule_version_id from private.payout_eligible_lines(v_org, p_period_end) e where e.clinician_id = c.clinician_id;
      v_created := v_created + 1;
    end if;
    v_ids := v_ids || v_pid;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, v_uid, 'payout.prepared', 'payout', v_pid,
            jsonb_build_object('clinician_id', c.clinician_id, 'period_start', p_period_start, 'period_end', p_period_end,
                               'added_kobo', v_new_sum, 'added_lines', v_new_count, 'topped_up', v_has));
  end loop;
  perform set_config('tarragon.payout_write', 'off', true);
  return jsonb_build_object('created', v_created, 'topped_up', v_topped, 'unchanged', v_unchanged, 'skipped_not_positive', v_skipped, 'payout_ids', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Approve: maker-checker in the database
-- ---------------------------------------------------------------------------
create function public.approve_payout(p_payout uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  p public.payouts%rowtype;
  v_sum bigint;
  v_cnt integer;
begin
  if v_uid is null or not private.is_admin() then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'payout_note_needed' using errcode = '22023'; end if;
  select * into p from public.payouts where id = p_payout and organisation_id = v_org for update;
  if not found then raise exception 'payout_not_found' using errcode = 'P0002'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_draft' using errcode = '22023'; end if;
  if p.prepared_by = v_uid then raise exception 'payout_same_person' using errcode = '42501'; end if;
  -- Re-check at the moment of approval: the lines are still the ones counted, and the clinician is still on a contract.
  select coalesce(sum(pl.amount_kobo), 0), count(*) into v_sum, v_cnt from public.payout_lines pl where pl.payout_id = p.id and pl.released_at is null;
  if v_sum <> p.amount_kobo or v_cnt <> p.line_count then raise exception 'payout_lines_changed' using errcode = '22023'; end if;
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.clinician_id and cs.employment_type::text = 'contracted' and not cs.is_test) then
    raise exception 'payout_not_contracted' using errcode = '22023';
  end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', approved_by = v_uid, approved_at = now(), approval_note = btrim(p_note) where id = p.id;
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.approved', 'payout', p.id,
          jsonb_build_object('clinician_id', p.clinician_id, 'amount_kobo', p.amount_kobo, 'lines', p.line_count, 'prepared_by', p.prepared_by,
                             'fee_schedule_version_ids', to_jsonb(p.fee_schedule_version_ids), 'note', btrim(p_note)));
  return jsonb_build_object('ok', true, 'payout_id', p.id, 'state', 'approved');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Cancel and mark sent
-- ---------------------------------------------------------------------------
create function public.cancel_payout(p_payout uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  p public.payouts%rowtype;
begin
  if v_uid is null or not private.has_permission('payouts.prepare') then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'payout_reason_needed' using errcode = '22023'; end if;
  select * into p from public.payouts where id = p_payout and organisation_id = v_org for update;
  if not found then raise exception 'payout_not_found' using errcode = 'P0002'; end if;
  -- Ops may withdraw a draft; only the admin cancels one that has been approved.
  if p.state = 'approved' and not private.is_admin() then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  if p.state not in ('draft', 'approved') then raise exception 'payout_not_cancellable' using errcode = '22023'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p.id;
  update public.payout_lines set released_at = now() where payout_id = p.id and released_at is null;
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.cancelled', 'payout', p.id,
          jsonb_build_object('clinician_id', p.clinician_id, 'amount_kobo', p.amount_kobo, 'was', p.state, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'payout_id', p.id, 'state', 'cancelled');
end;
$$;

-- Records that a transfer was made. It calls no payment provider and moves no money; S31 owns the transfer. Refused while the
-- payouts_enabled go-live guard is off, which is how the database stays closed until the founder opens it.
create function public.mark_payout_sent(p_payout uuid, p_transfer_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  p public.payouts%rowtype;
begin
  if v_uid is null or not private.is_admin() then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payouts_guard_off' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_transfer_code, ''))) < 3 then raise exception 'payout_transfer_code_needed' using errcode = '22023'; end if;
  select * into p from public.payouts where id = p_payout and organisation_id = v_org for update;
  if not found then raise exception 'payout_not_found' using errcode = 'P0002'; end if;
  if p.state <> 'approved' then raise exception 'payout_not_approved' using errcode = '22023'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'sent', sent_at = now(), paystack_transfer_code = btrim(p_transfer_code) where id = p.id;
  perform set_config('tarragon.payout_write', 'off', true);
  -- The one allowed change to a ledger line (S30): link it to the payout that paid it.
  perform set_config('tarragon.earnings_payout_link', 'on', true);
  update public.earnings_ledger set payout_id = p.id
   where id in (select ledger_id from public.payout_lines where payout_id = p.id and released_at is null);
  perform set_config('tarragon.earnings_payout_link', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.sent_recorded', 'payout', p.id, jsonb_build_object('clinician_id', p.clinician_id, 'amount_kobo', p.amount_kobo));
  return jsonb_build_object('ok', true, 'payout_id', p.id, 'state', 'sent');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reads
-- ---------------------------------------------------------------------------
create function public.payout_unpaid_summary(p_through date default null)
returns table (clinician_id uuid, full_name text, lines bigint, unpaid_kobo bigint, waiting_for_correction bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := private.payouts_org();
  v_end date := coalesce(p_through, (now() at time zone 'Africa/Lagos')::date);
begin
  return query
    select e.clinician_id, cs.full_name, count(*)::bigint, coalesce(sum(e.amount_kobo), 0)::bigint,
           (select count(*) from public.earnings_ledger l
             join public.clinical_staff c2 on c2.profile_id = l.clinician_id
            where l.clinician_id = e.clinician_id and l.organisation_id = v_org and l.payout_id is null and not l.is_test and not c2.is_test
              and c2.employment_type::text = 'contracted'
              and l.calculation ? 'needs_review'
              and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text))::bigint
      from private.payout_eligible_lines(v_org, v_end) e
      join public.clinical_staff cs on cs.profile_id = e.clinician_id
     group by e.clinician_id, cs.full_name
     order by cs.full_name;
end;
$$;

create function public.list_payouts(p_state text default null)
returns table (id uuid, clinician_id uuid, clinician_name text, period_start date, period_end date, amount_kobo bigint, line_count integer,
               state text, fee_schedule_versions integer[], prepared_by uuid, prepared_by_name text, prepared_at timestamptz,
               approved_by_name text, approved_at timestamptz, approval_note text, cancel_reason text, can_approve boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := private.payouts_org();
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
begin
  return query
    select p.id, p.clinician_id, cs.full_name, p.period_start, p.period_end, p.amount_kobo, p.line_count, p.state,
           coalesce((select array_agg(f.version order by f.version) from public.fee_schedules f where f.id = any (p.fee_schedule_version_ids)), '{}'::integer[]),
           p.prepared_by, pb.full_name, p.prepared_at, ab.full_name, p.approved_at, p.approval_note, p.cancel_reason,
           (v_admin and p.state = 'draft' and p.prepared_by <> v_uid)
      from public.payouts p
      left join public.clinical_staff cs on cs.profile_id = p.clinician_id
      left join public.profiles pb on pb.id = p.prepared_by
      left join public.profiles ab on ab.id = p.approved_by
     where p.organisation_id = v_org and (p_state is null or p.state = p_state)
     order by p.created_at desc, p.id
     limit 200;
end;
$$;

-- The state of the payouts_enabled guard, readable by whoever can prepare or approve (the dashboard function needs other permissions).
create function public.payouts_guard_is_on() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.payouts_org();
  return private.go_live_guard_on('payouts_enabled');
end;
$$;

create function public.payout_lines_of(p_payout uuid)
returns table (ledger_id uuid, kind text, earned_at timestamptz, amount_kobo bigint, fee_schedule_version integer, released boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.payouts_org();
begin
  return query
    select l.id, l.kind, l.earned_at, pl.amount_kobo, f.version, pl.released_at is not null
      from public.payout_lines pl
      join public.payouts p on p.id = pl.payout_id and p.organisation_id = v_org
      join public.earnings_ledger l on l.id = pl.ledger_id
      left join public.fee_schedules f on f.id = pl.fee_schedule_version_id
     where pl.payout_id = p_payout
     order by l.earned_at, l.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.payouts enable row level security;
alter table public.payout_lines enable row level security;
create policy payouts_select on public.payouts for select to authenticated
  using ((private.has_permission('payouts.prepare') and organisation_id = private.caller_org())
         or (clinician_id = (select auth.uid()) and state in ('approved', 'sent', 'succeeded', 'failed', 'reversed')));
create policy payout_lines_select on public.payout_lines for select to authenticated
  using (exists (select 1 from public.payouts p where p.id = payout_id
                  and ((private.has_permission('payouts.prepare') and p.organisation_id = private.caller_org())
                       or (p.clinician_id = (select auth.uid()) and p.state in ('approved', 'sent', 'succeeded', 'failed', 'reversed')))));
revoke all on public.payouts, public.payout_lines from anon, public, authenticated;
grant select on public.payouts, public.payout_lines to authenticated;

revoke all on function
  public.prepare_payout_drafts(date, date), public.approve_payout(uuid, text), public.cancel_payout(uuid, text),
  public.mark_payout_sent(uuid, text), public.payout_unpaid_summary(date), public.list_payouts(text), public.payout_lines_of(uuid), public.payouts_guard_is_on()
  from public, anon;
grant execute on function
  public.prepare_payout_drafts(date, date), public.approve_payout(uuid, text), public.cancel_payout(uuid, text),
  public.mark_payout_sent(uuid, text), public.payout_unpaid_summary(date), public.list_payouts(text), public.payout_lines_of(uuid), public.payouts_guard_is_on()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.prepare_payout_drafts(date,date)', 'public.approve_payout(uuid,text)', 'public.cancel_payout(uuid,text)',
                           'public.mark_payout_sent(uuid,text)', 'public.payout_unpaid_summary(date)', 'public.list_payouts(text)', 'public.payout_lines_of(uuid)', 'public.payouts_guard_is_on()'] loop
    if has_function_privilege('anon', f::regprocedure, 'EXECUTE') then raise exception 'S36f: anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') then raise exception 'S36f: authenticated cannot execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.payouts', 'INSERT') or has_table_privilege('authenticated', 'public.payouts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.payouts', 'DELETE') or has_table_privilege('authenticated', 'public.payout_lines', 'INSERT')
     or has_table_privilege('anon', 'public.payouts', 'SELECT') or has_table_privilege('anon', 'public.payout_lines', 'SELECT') then
    raise exception 'S36f: table privileges are wrong';
  end if;
  if (select count(*) from public.payouts) <> 0 then raise exception 'S36f: payouts should start empty'; end if;
end $$;
