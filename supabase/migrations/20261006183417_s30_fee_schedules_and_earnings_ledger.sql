-- S30: Fee schedules and the earnings ledger (spec 7.7). Design: docs/design/S30.md. Research: docs/research/S30.md.
--
-- Depends on S15 (clinical_staff, credential_notify, credential_is_cmo), S16 (clinical_tasks, task_types), S17 (queue_summary,
-- queue_candidates, availability_blocks), S18 (on_call_rota, lead_assignments, lead_config) and S21 (encounters).
--
-- What this adds
--   * fee_schedules: versioned (INV-16), draft -> approved -> superseded. An approved schedule can never change. The founder sets
--     every amount in the admin console; NOTHING is seeded here (zeros are for staging and tests only).
--   * earnings_config: the few rules that are not money (days a patient must be led for a lead fee, the backup on-call share,
--     which ledger kinds count toward the pilot minimum). PROPOSED, mirrored as `earnings.rules` in the code registry.
--   * earnings_ledger: append only. One line per task, consultation, shift, lead month, minimum top-up or adjustment, recording the
--     fee schedule version used and every input of the calculation. payout_id stays null until S31 links it (the one allowed change).
--   * Posting: an AFTER UPDATE trigger on clinical_tasks (every completion path), a trigger on encounters, and three pg_cron jobs
--     (sweep every 15 minutes, lead months and minimum top-ups daily). Contracted clinicians only: employed doctors are paid by
--     salary (F-03), so no line is written for them.
--   * public.queue_summary() now returns next_fee_kobo for a contracted clinician (S17 left it null).
--   * clinical_tasks.fee_schedule_version_id gets its foreign key; the two fee columns S16 left empty are filled at completion.
--
-- Counts before this migration (live, 2026-10-06): no fee_schedules, earnings_ledger or earnings_config exist, and
-- clinical_tasks.fee_kobo_at_completion is null on every row (no task has been completed through S16/S17 in production), so there
-- is nothing to convert or backfill. Nothing here moves money: payouts and Paystack transfers are S31.
--
-- INV-07: nothing here puts a reading, condition or result in a notice, event or ledger line; a line names a task type and a date.

-- ---------------------------------------------------------------------------
-- 1. Events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('fee_schedule.approved', 'A fee schedule was approved and now applies to new earnings', 'S30', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('fee_schedule.approved', 1, array['fee_schedule_id', 'version']);

-- ---------------------------------------------------------------------------
-- 2. Validation of a schedule's items (the same rule as validateFeeItems in packages/queue/fees.ts)
-- ---------------------------------------------------------------------------
create function private.fee_is_int(p_v jsonb, p_lo numeric, p_hi numeric) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_v) = 'number'
     and (p_v #>> '{}')::numeric = trunc((p_v #>> '{}')::numeric)
     and (p_v #>> '{}')::numeric between p_lo and p_hi, false);
$$;
revoke all on function private.fee_is_int(jsonb, numeric, numeric) from public, anon, authenticated;

create function private.fee_items_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  code text;
  e jsonb;
  s jsonb;
  v_last numeric;
  v_share jsonb;
  v_ref jsonb;
  v_max constant numeric := 1000000000;
begin
  if jsonb_typeof(r) is distinct from 'object' then return false; end if;
  for k in select jsonb_object_keys(r) loop
    if k not in ('task_types', 'on_call_shift_fee_kobo', 'lead_fee_per_patient_month_kobo', 'consultation_share_pct',
                 'consultation_reference_price_kobo', 'pilot_minimum_per_declared_hour_kobo') then
      return false;
    end if;
  end loop;
  foreach k in array array['on_call_shift_fee_kobo', 'lead_fee_per_patient_month_kobo', 'pilot_minimum_per_declared_hour_kobo'] loop
    if not private.fee_is_int(r -> k, 0, v_max) then return false; end if;
  end loop;
  v_share := r -> 'consultation_share_pct';
  if jsonb_typeof(v_share) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_share)) <> 3 then return false; end if;
  foreach k in array array['video', 'audio', 'phone'] loop
    if not private.fee_is_int(v_share -> k, 0, 100) then return false; end if;
  end loop;
  if r ? 'consultation_reference_price_kobo' then
    v_ref := r -> 'consultation_reference_price_kobo';
    if jsonb_typeof(v_ref) is distinct from 'object' then return false; end if;
    for k in select jsonb_object_keys(v_ref) loop
      if k not in ('video', 'audio', 'phone') or not private.fee_is_int(v_ref -> k, 0, v_max) then return false; end if;
    end loop;
  end if;
  if jsonb_typeof(r -> 'task_types') is distinct from 'object' then return false; end if;
  for code in select jsonb_object_keys(r -> 'task_types') loop
    if code !~ '^[a-z][a-z0-9_]*$' then return false; end if;
    e := r -> 'task_types' -> code;
    if jsonb_typeof(e) is distinct from 'object' or not private.fee_is_int(e -> 'base_fee_kobo', 0, v_max)
       or jsonb_typeof(e -> 'wait_multiplier_steps') is distinct from 'array' then
      return false;
    end if;
    v_last := 0;
    for s in select value from jsonb_array_elements(e -> 'wait_multiplier_steps') loop
      if jsonb_typeof(s) is distinct from 'object' or not private.fee_is_int(s -> 'at_pct', 1, 1000)
         or not private.fee_is_int(s -> 'add_pct', 0, 300) or (s ->> 'at_pct')::numeric <= v_last then
        return false;
      end if;
      v_last := (s ->> 'at_pct')::numeric;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.fee_items_valid(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. earnings_config (PROPOSED, mirrored as `earnings.rules`)
-- ---------------------------------------------------------------------------
create table public.earnings_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index earnings_config_one_active on public.earnings_config (is_active) where is_active;

-- earnings-rules-begin
insert into public.earnings_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "lead_month": { "min_active_days": 15 },
  "on_call": { "backup_fee_pct": 0 },
  "minimum_guarantee": { "counted_kinds": ["task", "consultation", "on_call_shift"] }
}
$json$::jsonb);
-- earnings-rules-end

create function private.earnings_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.earnings_config where is_active; $$;
revoke all on function private.earnings_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. fee_schedules
-- ---------------------------------------------------------------------------
create table public.fee_schedules (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  version         integer not null check (version >= 1),
  status          text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  items           jsonb not null check (private.fee_items_valid(items)),
  note            text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz,
  superseded_at   timestamptz,
  unique (organisation_id, version),
  check ((status = 'draft') = (approved_at is null)),
  check ((status = 'superseded') = (superseded_at is not null)),
  check (status = 'draft' or approved_by is not null)
);
create unique index fee_schedules_one_approved on public.fee_schedules (organisation_id) where status = 'approved';
create index fee_schedules_in_force_idx on public.fee_schedules (organisation_id, approved_at) where status in ('approved', 'superseded');
comment on table public.fee_schedules is
  'S30: versioned fee schedules (INV-16). Amounts are set by the founder in the admin console; none is seeded. An approved row never changes; a correction is a new version. Written only by the S30 functions.';

create function private.guard_fee_schedules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_on boolean := coalesce(current_setting('tarragon.fee_write', true), '') = 'on';
begin
  if not v_on then raise exception 'fee_schedules are written only by the fee functions' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'a schedule starts as a draft' using errcode = '23514'; end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'only a draft can be discarded' using errcode = '23514'; end if;
    return old;
  end if;
  if old.status = 'draft' then
    if new.status = 'superseded' then raise exception 'a draft cannot be superseded' using errcode = '23514'; end if;
    return new;
  elsif old.status = 'approved' and new.status = 'superseded'
        and to_jsonb(new) - 'status' - 'superseded_at' = to_jsonb(old) - 'status' - 'superseded_at' then
    return new;
  end if;
  raise exception 'an approved fee schedule never changes; make a new version' using errcode = '23514';
end;
$$;
revoke all on function private.guard_fee_schedules() from public, anon, authenticated;
create trigger fee_schedules_guard before insert or update or delete on public.fee_schedules
  for each row execute function private.guard_fee_schedules();

-- The schedule in force at a moment. Before the first approval there is none; the first approved schedule then applies
-- (the caller records that), so work done in the days before the founder approved anything is not lost.
create function private.fee_schedule_at(p_org uuid, p_at timestamptz) returns public.fee_schedules
language plpgsql stable security definer set search_path = ''
as $$
declare s public.fee_schedules%rowtype;
begin
  select * into s from public.fee_schedules
   where organisation_id = p_org and status in ('approved', 'superseded') and approved_at <= p_at
     and (superseded_at is null or superseded_at > p_at)
   order by approved_at desc limit 1;
  if found then return s; end if;
  select * into s from public.fee_schedules
   where organisation_id = p_org and status in ('approved', 'superseded') order by approved_at asc limit 1;
  return s;
end;
$$;
revoke all on function private.fee_schedule_at(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. earnings_ledger (append only)
-- ---------------------------------------------------------------------------
create table public.earnings_ledger (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  clinician_id            uuid not null references public.profiles (id) on delete restrict,
  kind                    text not null check (kind in ('task', 'consultation', 'on_call_shift', 'lead_month', 'minimum_topup', 'adjustment')),
  reference_type          text not null,
  reference_id            uuid not null,
  amount_kobo             bigint not null,
  fee_schedule_version_id uuid references public.fee_schedules (id) on delete restrict,
  calculation             jsonb not null check (jsonb_typeof(calculation) = 'object'),
  earned_at               timestamptz not null,
  employment_type         text not null check (employment_type = 'contracted'),
  note                    text,
  created_by              uuid references public.profiles (id) on delete set null,
  -- Null until S31 builds a payout and links the line, once. The only column that may ever change.
  payout_id               uuid,
  is_test                 boolean not null default false,
  created_at              timestamptz not null default now(),
  check ((kind = 'adjustment' and amount_kobo <> 0 and char_length(btrim(coalesce(note, ''))) >= 10 and created_by is not null)
      or (kind <> 'adjustment' and amount_kobo >= 0)),
  check (kind <> 'minimum_topup' or amount_kobo > 0),
  -- INV-16: every calculated line names the fee version it used. Only a hand-made adjustment has none.
  check (kind = 'adjustment' or fee_schedule_version_id is not null)
);
create unique index earnings_ledger_one_per_reference on public.earnings_ledger (clinician_id, kind, reference_id);
create index earnings_ledger_clinician_idx on public.earnings_ledger (clinician_id, earned_at desc);
create index earnings_ledger_unpaid_idx on public.earnings_ledger (organisation_id, clinician_id) where payout_id is null;
create index earnings_ledger_review_idx on public.earnings_ledger (organisation_id, earned_at) where calculation ? 'needs_review';
comment on table public.earnings_ledger is
  'S30: what the business owes a contracted clinician, one immutable line each (spec 7.7). Gross kobo; no tax is calculated (D-09). payout_id is linked once by S31 (set tarragon.earnings_payout_link = on). A mistake is fixed by an adjustment that points at the line it corrects.';
comment on column public.earnings_ledger.calculation is
  'Every input of the calculation, so the line can be recomputed. needs_review (no_fee_for_task_type, no_price_basis) marks a zero line an admin must correct with an adjustment.';

alter table public.clinical_tasks
  add constraint clinical_tasks_fee_schedule_fk foreign key (fee_schedule_version_id) references public.fee_schedules (id) on delete restrict;

create function private.guard_earnings_ledger() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('tarragon.earnings_write', true), '') <> 'on' then
      raise exception 'earnings_ledger lines are written only by the earnings functions' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.payout_id is null and new.payout_id is not null
       and coalesce(current_setting('tarragon.earnings_payout_link', true), '') = 'on'
       and to_jsonb(new) - 'payout_id' = to_jsonb(old) - 'payout_id' then
      return new;
    end if;
  end if;
  raise exception 'earnings_ledger is append only: post an adjustment instead' using errcode = '23514';
end;
$$;
revoke all on function private.guard_earnings_ledger() from public, anon, authenticated;
create trigger earnings_ledger_guard before insert or update or delete on public.earnings_ledger
  for each row execute function private.guard_earnings_ledger();
create function private.earnings_ledger_no_truncate() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'earnings_ledger is append only' using errcode = '23514'; end; $$;
revoke all on function private.earnings_ledger_no_truncate() from public, anon, authenticated;
create trigger earnings_ledger_no_truncate before truncate on public.earnings_ledger
  for each statement execute function private.earnings_ledger_no_truncate();

-- The one door every line goes through. Idempotent: a retry of the same reference returns the first line.
create function private.ledger_insert(
  p_org uuid, p_clinician uuid, p_kind text, p_ref_type text, p_ref_id uuid, p_amount bigint, p_schedule uuid,
  p_calc jsonb, p_earned_at timestamptz, p_is_test boolean, p_note text default null, p_created_by uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  perform set_config('tarragon.earnings_write', 'on', true);
  insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo,
    fee_schedule_version_id, calculation, earned_at, employment_type, note, created_by, is_test)
  values (p_org, p_clinician, p_kind, p_ref_type, p_ref_id, p_amount, p_schedule, p_calc, p_earned_at, 'contracted', p_note, p_created_by, p_is_test)
  on conflict (clinician_id, kind, reference_id) do nothing
  returning id into v_id;
  perform set_config('tarragon.earnings_write', 'off', true);
  if v_id is null then
    select id into v_id from public.earnings_ledger where clinician_id = p_clinician and kind = p_kind and reference_id = p_ref_id;
  end if;
  return v_id;
end;
$$;
revoke all on function private.ledger_insert(uuid, uuid, text, text, uuid, bigint, uuid, jsonb, timestamptz, boolean, text, uuid) from public, anon, authenticated;

-- A stable uuid for lines that have no row of their own (a lead month, a run of declared hours).
create function private.earnings_ref(p_key text) returns uuid
language sql immutable set search_path = ''
as $$ select md5(p_key)::uuid; $$;
revoke all on function private.earnings_ref(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The arithmetic (mirrors packages/queue/fees.ts; the same cases run through both)
-- ---------------------------------------------------------------------------
create function private.fee_elapsed_pct(p_created timestamptz, p_due timestamptz, p_claimed timestamptz) returns integer
language sql immutable set search_path = ''
as $$
  select case
    when p_claimed >= p_due then 100
    when p_due <= p_created or p_claimed <= p_created then 0
    else floor(100 * extract(epoch from (p_claimed - p_created)) / extract(epoch from (p_due - p_created)))::integer
  end;
$$;
revoke all on function private.fee_elapsed_pct(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create function private.fee_task_calc(p_items jsonb, p_type text, p_created timestamptz, p_due timestamptz, p_claimed timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb := p_items -> 'task_types' -> p_type;
  s jsonb;
  v_base bigint;
  v_el integer;
  v_step integer;
  v_add integer := 0;
  v_up bigint;
begin
  if e is null then return jsonb_build_object('ok', false, 'needs_review', 'no_fee_for_task_type'); end if;
  v_base := (e ->> 'base_fee_kobo')::bigint;
  v_el := private.fee_elapsed_pct(p_created, p_due, p_claimed);
  for s in select value from jsonb_array_elements(e -> 'wait_multiplier_steps') loop
    if (s ->> 'at_pct')::integer <= v_el and (v_step is null or (s ->> 'at_pct')::integer > v_step) then
      v_step := (s ->> 'at_pct')::integer;
      v_add := (s ->> 'add_pct')::integer;
    end if;
  end loop;
  v_up := (v_base * v_add) / 100;
  return jsonb_build_object('ok', true, 'amount_kobo', v_base + v_up, 'base_kobo', v_base, 'elapsed_pct', v_el,
                            'step_at_pct', v_step, 'add_pct', v_add, 'uplift_kobo', v_up);
end;
$$;
revoke all on function private.fee_task_calc(jsonb, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create function private.fee_consultation_calc(p_items jsonb, p_type text, p_purchase bigint) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_pct integer := (p_items -> 'consultation_share_pct' ->> p_type)::integer;
  v_ref bigint := (p_items -> 'consultation_reference_price_kobo' ->> p_type)::bigint;
  v_price bigint := coalesce(p_purchase, v_ref);
begin
  if v_price is null then return jsonb_build_object('ok', false, 'needs_review', 'no_price_basis'); end if;
  return jsonb_build_object('ok', true, 'amount_kobo', (v_price * v_pct) / 100, 'price_kobo', v_price, 'pct', v_pct,
                            'basis', case when p_purchase is null then 'reference_price' else 'purchase' end);
end;
$$;
revoke all on function private.fee_consultation_calc(jsonb, text, bigint) from public, anon, authenticated;

create function private.fee_minimum_calc(p_items jsonb, p_seconds numeric, p_earned bigint) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'guarantee_kobo', floor(((p_items ->> 'pilot_minimum_per_declared_hour_kobo')::numeric * p_seconds) / 3600)::bigint,
    'top_up_kobo', greatest(0, floor(((p_items ->> 'pilot_minimum_per_declared_hour_kobo')::numeric * p_seconds) / 3600)::bigint - p_earned));
$$;
revoke all on function private.fee_minimum_calc(jsonb, numeric, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Posting: tasks and consultations (triggers), shifts, lead months, minimum top-ups (jobs)
-- ---------------------------------------------------------------------------
-- Returns true when the task needs no further attention (a line exists, or it earns none), false when it must wait for a schedule.
create function private.post_task_earning(p_task uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype;
  cs public.clinical_staff%rowtype;
  fs public.fee_schedules%rowtype;
  v_calc jsonb;
  v_amount bigint := 0;
  v_flag text;
  v_claimed timestamptz;
begin
  select * into t from public.clinical_tasks where id = p_task and state = 'completed';
  if not found or t.claimed_by is null then return true; end if;
  select * into cs from public.clinical_staff where profile_id = t.claimed_by;
  if not found or cs.employment_type::text <> 'contracted' then return true; end if;
  if exists (select 1 from public.earnings_ledger where clinician_id = t.claimed_by and kind = 'task' and reference_id = t.id) then return true; end if;
  -- a task that produced a paid live consultation is paid once, by the consultation share, not twice
  if exists (select 1 from public.encounters e where e.task_id = t.id and e.type in ('video', 'audio', 'phone')) then return true; end if;
  fs := private.fee_schedule_at(t.organisation_id, t.completed_at);
  if fs.id is null then return false; end if;
  v_claimed := coalesce(t.claimed_at, t.completed_at);
  v_calc := private.fee_task_calc(fs.items, t.type, t.created_at, t.due_at, v_claimed);
  if (v_calc ->> 'ok')::boolean then
    v_amount := (v_calc ->> 'amount_kobo')::bigint;
  else
    v_flag := v_calc ->> 'needs_review';
  end if;
  v_calc := v_calc || jsonb_build_object('task_type', t.type, 'task_type_version', t.task_type_version, 'schedule_version', fs.version,
    'created_at', t.created_at, 'due_at', t.due_at, 'claimed_at', v_claimed)
    || case when fs.approved_at > t.completed_at then jsonb_build_object('retroactive_first_schedule', true) else '{}'::jsonb end;
  perform private.ledger_insert(t.organisation_id, t.claimed_by, 'task', 'clinical_task', t.id, v_amount, fs.id, v_calc,
                                t.completed_at, t.is_test or cs.is_test);
  update public.clinical_tasks set fee_kobo_at_completion = v_amount, fee_schedule_version_id = fs.id where id = t.id;
  return true;
end;
$$;
revoke all on function private.post_task_earning(uuid) from public, anon, authenticated;

create function private.post_consultation_earning(p_encounter uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  e public.encounters%rowtype;
  cs public.clinical_staff%rowtype;
  fs public.fee_schedules%rowtype;
  v_purchase bigint;
  v_calc jsonb;
  v_amount bigint := 0;
  v_at timestamptz;
begin
  select * into e from public.encounters
   where id = p_encounter and status = 'completed' and type in ('video', 'audio', 'phone') and clinician_id is not null;
  if not found then return true; end if;
  select * into cs from public.clinical_staff where profile_id = e.clinician_id;
  if not found or cs.employment_type::text <> 'contracted' then return true; end if;
  if exists (select 1 from public.earnings_ledger where clinician_id = e.clinician_id and kind = 'consultation' and reference_id = e.id) then return true; end if;
  v_at := coalesce(e.ended_at, e.updated_at);
  fs := private.fee_schedule_at(e.organisation_id, v_at);
  if fs.id is null then return false; end if;
  select sp.amount_kobo into v_purchase from public.service_purchases sp
   where sp.id = e.service_purchase_id and sp.status in ('active', 'expired')
     -- only a purchase this very consultation used up is a price for it; a Membership or pack that covers many is not
     and sp.redeemed_entity_id in (e.id, e.appointment_id, e.video_consultation_id);
  v_calc := private.fee_consultation_calc(fs.items, e.type, v_purchase);
  if (v_calc ->> 'ok')::boolean then v_amount := (v_calc ->> 'amount_kobo')::bigint; end if;
  v_calc := v_calc || jsonb_build_object('consultation_type', e.type, 'schedule_version', fs.version)
    || case when fs.approved_at > v_at then jsonb_build_object('retroactive_first_schedule', true) else '{}'::jsonb end;
  perform private.ledger_insert(e.organisation_id, e.clinician_id, 'consultation', 'encounter', e.id, v_amount, fs.id, v_calc, v_at, e.is_test or cs.is_test);
  return true;
end;
$$;
revoke all on function private.post_consultation_earning(uuid) from public, anon, authenticated;

-- A failure here must never block a clinician finishing a task or a consultation. It is logged; the sweep retries and raises an incident.
create function private.earnings_on_task_completed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.post_task_earning(new.id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    values (new.organisation_id, 'earnings.post_error', 'clinical_task', new.id, jsonb_build_object('step', 'task', 'error', sqlerrm));
  end;
  return null;
end;
$$;
revoke all on function private.earnings_on_task_completed() from public, anon, authenticated;
create trigger clinical_tasks_earnings after update of state on public.clinical_tasks
  for each row when (old.state is distinct from 'completed' and new.state = 'completed')
  execute function private.earnings_on_task_completed();

create function private.earnings_on_encounter_completed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.post_consultation_earning(new.id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    values (new.organisation_id, 'earnings.post_error', 'encounter', new.id, jsonb_build_object('step', 'consultation', 'error', sqlerrm));
  end;
  return null;
end;
$$;
revoke all on function private.earnings_on_encounter_completed() from public, anon, authenticated;
create trigger encounters_earnings after update of status on public.encounters
  for each row when (old.status is distinct from 'completed' and new.status = 'completed')
  execute function private.earnings_on_encounter_completed();

-- On-call shifts: one line for the primary (and the backup at the configured percent, default none) once the shift has ended.
create function private.post_on_call_earnings() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  fs public.fee_schedules%rowtype;
  v_n integer := 0;
  v_pct integer := coalesce((private.earnings_setting('on_call') ->> 'backup_fee_pct')::integer, 0);
  v_role text;
  v_who uuid;
  v_amount bigint;
  v_test boolean;
begin
  for r in select * from public.on_call_rota
            where cancelled_at is null and ends_at <= now() and ends_at > now() - interval '60 days' loop
    fs := private.fee_schedule_at(r.organisation_id, r.ends_at);
    continue when fs.id is null;
    foreach v_role in array array['primary', 'backup'] loop
      v_who := case when v_role = 'primary' then r.primary_clinician_id else r.backup_clinician_id end;
      continue when v_who is null;
      v_amount := case when v_role = 'primary' then (fs.items ->> 'on_call_shift_fee_kobo')::bigint
                       else ((fs.items ->> 'on_call_shift_fee_kobo')::bigint * v_pct) / 100 end;
      continue when v_amount <= 0;
      select (cs.is_test or r.is_test) into v_test from public.clinical_staff cs where cs.profile_id = v_who and cs.employment_type::text = 'contracted';
      continue when v_test is null;
      continue when exists (select 1 from public.earnings_ledger where clinician_id = v_who and kind = 'on_call_shift' and reference_id = r.id);
      perform private.ledger_insert(r.organisation_id, v_who, 'on_call_shift', 'on_call_rota', r.id, v_amount, fs.id,
        jsonb_build_object('role', v_role, 'shift_fee_kobo', (fs.items ->> 'on_call_shift_fee_kobo')::bigint, 'backup_fee_pct', case when v_role = 'backup' then v_pct else null end,
                           'starts_at', r.starts_at, 'ends_at', r.ends_at, 'schedule_version', fs.version)
          || case when fs.approved_at > r.ends_at then jsonb_build_object('retroactive_first_schedule', true) else '{}'::jsonb end,
        r.ends_at, v_test);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.post_on_call_earnings() from public, anon, authenticated;

-- Lead months: the lead fee for each patient a clinician led for at least min_active_days (any part of a Lagos day counts)
-- of a completed Lagos calendar month. Looks back three months so a missed run is caught up; the unique key stops a repeat.
create function private.post_lead_month_earnings(p_months integer default 3) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  fs public.fee_schedules%rowtype;
  v_first date;
  v_last date;
  v_end timestamptz;
  v_days integer;
  v_min integer := coalesce((private.earnings_setting('lead_month') ->> 'min_active_days')::integer, 15);
  v_n integer := 0;
  v_i integer;
  v_amount bigint;
  v_test boolean;
begin
  for v_i in 1..greatest(p_months, 1) loop
    v_first := (private.lagos_month(now()) - make_interval(months => v_i))::date;
    v_last := (v_first + interval '1 month' - interval '1 day')::date;
    v_end := ((v_last + 1)::timestamp) at time zone 'Africa/Lagos';
    for r in
      select distinct la.organisation_id, la.clinician_id, la.patient_id
        from public.lead_assignments la
       where la.clinician_id is not null and la.state in ('active', 'ended')
         and (la.started_at at time zone 'Africa/Lagos')::date <= v_last
         and (coalesce(la.ended_at, now()) at time zone 'Africa/Lagos')::date >= v_first
    loop
      select (cs.is_test) into v_test from public.clinical_staff cs where cs.profile_id = r.clinician_id and cs.employment_type::text = 'contracted';
      continue when v_test is null;
      fs := private.fee_schedule_at(r.organisation_id, v_end);
      continue when fs.id is null;
      v_amount := (fs.items ->> 'lead_fee_per_patient_month_kobo')::bigint;
      continue when v_amount <= 0;
      continue when exists (select 1 from public.earnings_ledger l where l.clinician_id = r.clinician_id and l.kind = 'lead_month'
                             and l.reference_id = private.earnings_ref(r.clinician_id || '|' || r.patient_id || '|' || v_first));
      select count(*) into v_days
        from generate_series(v_first, v_last, interval '1 day') g(d)
       where exists (select 1 from public.lead_assignments x
                      where x.clinician_id = r.clinician_id and x.patient_id = r.patient_id and x.state in ('active', 'ended')
                        and (x.started_at at time zone 'Africa/Lagos')::date <= g.d::date
                        and (coalesce(x.ended_at, now()) at time zone 'Africa/Lagos')::date >= g.d::date);
      continue when v_days < v_min;
      perform private.ledger_insert(r.organisation_id, r.clinician_id, 'lead_month', 'lead_patient_month',
        private.earnings_ref(r.clinician_id || '|' || r.patient_id || '|' || v_first), v_amount, fs.id,
        jsonb_build_object('month', v_first, 'active_days', v_days, 'min_active_days', v_min, 'lead_fee_kobo', v_amount, 'schedule_version', fs.version)
          || case when fs.approved_at > v_end then jsonb_build_object('retroactive_first_schedule', true) else '{}'::jsonb end,
        v_end, v_test or coalesce((select p.is_test from public.profiles p where p.id = r.patient_id), false));
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.post_lead_month_earnings(integer) from public, anon, authenticated;

-- Pilot minimum: for each merged run of confirmed, eligible declared hours that ended at least two hours ago, pay only the
-- shortfall between the guarantee and what the ledger already shows inside the run. The patient is never named; neither is a task.
create function private.post_minimum_topups() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  fs public.fee_schedules%rowtype;
  v_counted text[] := coalesce(array(select jsonb_array_elements_text(private.earnings_setting('minimum_guarantee') -> 'counted_kinds')), '{}');
  v_earned bigint;
  v_calc jsonb;
  v_seconds numeric;
  v_n integer := 0;
  v_test boolean;
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
    select cs.is_test into v_test from public.clinical_staff cs where cs.profile_id = r.clinician_id and cs.employment_type::text = 'contracted';
    continue when v_test is null;
    fs := private.fee_schedule_at(r.organisation_id, r.run_end);
    continue when fs.id is null or (fs.items ->> 'pilot_minimum_per_declared_hour_kobo')::bigint <= 0;
    select coalesce(sum(l.amount_kobo), 0) into v_earned from public.earnings_ledger l
     where l.clinician_id = r.clinician_id and l.kind = any (v_counted) and l.earned_at > r.run_start and l.earned_at <= r.run_end;
    v_seconds := extract(epoch from (r.run_end - r.run_start));
    v_calc := private.fee_minimum_calc(fs.items, v_seconds, v_earned);
    continue when (v_calc ->> 'top_up_kobo')::bigint <= 0;
    continue when exists (select 1 from public.earnings_ledger l where l.clinician_id = r.clinician_id and l.kind = 'minimum_topup'
                           and l.reference_id = private.earnings_ref(r.clinician_id || '|' || r.run_start || '|' || r.run_end));
    perform private.ledger_insert(r.organisation_id, r.clinician_id, 'minimum_topup', 'declared_hours',
      private.earnings_ref(r.clinician_id || '|' || r.run_start || '|' || r.run_end), (v_calc ->> 'top_up_kobo')::bigint, fs.id,
      v_calc || jsonb_build_object('run_start', r.run_start, 'run_end', r.run_end, 'declared_seconds', v_seconds, 'earned_in_run_kobo', v_earned,
                                   'counted_kinds', to_jsonb(v_counted), 'schedule_version', fs.version),
      r.run_end, v_test);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.post_minimum_topups() from public, anon, authenticated;

-- The sweep: catches anything a trigger missed (an error, or a task finished before any schedule was approved), and posts shifts.
-- Each item is isolated; any error raises one open incident for operations, never a silent skip.
create function private.earnings_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_posted integer := 0;
  v_deferred integer := 0;
  v_errors integer := 0;
  v_shifts integer := 0;
begin
  for r in select ct.id from public.clinical_tasks ct
            where ct.state = 'completed' and ct.claimed_by is not null and ct.completed_at > now() - interval '365 days'
              and not exists (select 1 from public.earnings_ledger l where l.kind = 'task' and l.reference_id = ct.id and l.clinician_id = ct.claimed_by) loop
    begin
      if private.post_task_earning(r.id) then v_posted := v_posted + 1; else v_deferred := v_deferred + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('earnings.sweep_error', 'clinical_task', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  for r in select e.id from public.encounters e
            where e.status = 'completed' and e.type in ('video', 'audio', 'phone') and e.clinician_id is not null and e.updated_at > now() - interval '365 days'
              and not exists (select 1 from public.earnings_ledger l where l.kind = 'consultation' and l.reference_id = e.id and l.clinician_id = e.clinician_id) loop
    begin
      if private.post_consultation_earning(r.id) then v_posted := v_posted + 1; else v_deferred := v_deferred + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event) values ('earnings.sweep_error', 'encounter', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  begin
    v_shifts := private.post_on_call_earnings();
  exception when others then
    v_errors := v_errors + 1;
    insert into public.audit_log (action, entity_type, entity_id, event) values ('earnings.sweep_error', 'on_call_rota', gen_random_uuid(), jsonb_build_object('error', sqlerrm));
  end;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'earnings_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Earnings lines could not be posted',
            format('%s earnings item(s) could not be written by private.earnings_sweep(); see audit_log action earnings.sweep_error. A contracted clinician may be missing a line.', v_errors),
            'earnings_sweep', now(), now());
  end if;
  return jsonb_build_object('posted', v_posted, 'deferred', v_deferred, 'shifts', v_shifts, 'errors', v_errors);
end;
$$;
revoke all on function private.earnings_sweep() from public, anon, authenticated;
select cron.schedule('earnings-sweep', '*/15 * * * *', $$ select private.earnings_sweep(); $$);
select cron.schedule('earnings-lead-months', '30 1 * * *', $$ select private.post_lead_month_earnings(3); $$);
select cron.schedule('earnings-minimum-topups', '0 2 * * *', $$ select private.post_minimum_topups(); $$);

-- ---------------------------------------------------------------------------
-- 8. Admin: fee schedule drafts, approval, adjustments
-- ---------------------------------------------------------------------------
create function private.fee_admin_org() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'fee_not_authorised' using errcode = '42501'; end if;
  return private.caller_org();
end;
$$;
revoke all on function private.fee_admin_org() from public, anon, authenticated;

create function private.fee_check_codes(p_items jsonb) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_bad text;
begin
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_items -> 'task_types') k
   where not exists (select 1 from public.task_types t where t.code = k);
  if v_bad is not null then raise exception 'fee_unknown_task_type: %', v_bad using errcode = '22023'; end if;
end;
$$;
revoke all on function private.fee_check_codes(jsonb) from public, anon, authenticated;

create function public.create_fee_schedule_draft(p_items jsonb default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_items jsonb := p_items;
  v_id uuid;
begin
  if v_items is null then
    select items into v_items from public.fee_schedules where organisation_id = v_org and status = 'approved';
    if v_items is null then raise exception 'fee_items_needed: no approved schedule to copy' using errcode = '22023'; end if;
  end if;
  if not private.fee_items_valid(v_items) then raise exception 'fee_items_invalid' using errcode = '22023'; end if;
  perform private.fee_check_codes(v_items);
  perform set_config('tarragon.fee_write', 'on', true);
  insert into public.fee_schedules (organisation_id, version, items, note, created_by)
  values (v_org, coalesce((select max(version) from public.fee_schedules where organisation_id = v_org), 0) + 1, v_items, nullif(btrim(p_note), ''), (select auth.uid()))
  returning id into v_id;
  perform set_config('tarragon.fee_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'fee_schedule.draft_created', 'fee_schedule', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.update_fee_schedule_draft(p_id uuid, p_items jsonb, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  s public.fee_schedules%rowtype;
begin
  select * into s from public.fee_schedules where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'fee_unknown_schedule' using errcode = '22023'; end if;
  if s.status <> 'draft' then raise exception 'fee_not_a_draft' using errcode = '23514'; end if;
  if not private.fee_items_valid(p_items) then raise exception 'fee_items_invalid' using errcode = '22023'; end if;
  perform private.fee_check_codes(p_items);
  perform set_config('tarragon.fee_write', 'on', true);
  update public.fee_schedules set items = p_items, note = coalesce(nullif(btrim(p_note), ''), note) where id = s.id;
  perform set_config('tarragon.fee_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'fee_schedule.draft_updated', 'fee_schedule', s.id, '{}'::jsonb);
end;
$$;

create function public.discard_fee_schedule_draft(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  perform 1 from public.fee_schedules where id = p_id and organisation_id = v_org and status = 'draft' for update;
  if not found then raise exception 'fee_not_a_draft' using errcode = '23514'; end if;
  perform set_config('tarragon.fee_write', 'on', true);
  delete from public.fee_schedules where id = p_id;
  perform set_config('tarragon.fee_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'fee_schedule.draft_discarded', 'fee_schedule', p_id, '{}'::jsonb);
end;
$$;

-- Approval makes a draft the schedule in force from now and supersedes the previous one. It reports which creatable task types have
-- no fee (their lines will be flagged for review) so the founder sees the gap before it matters.
create function public.approve_fee_schedule(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_uid uuid := (select auth.uid());
  s public.fee_schedules%rowtype;
  v_missing text[];
  r record;
begin
  select * into s from public.fee_schedules where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'fee_unknown_schedule' using errcode = '22023'; end if;
  if s.status <> 'draft' then raise exception 'fee_not_a_draft' using errcode = '23514'; end if;
  if not private.fee_items_valid(s.items) then raise exception 'fee_items_invalid' using errcode = '22023'; end if;
  perform private.fee_check_codes(s.items);
  select coalesce(array_agg(t.code order by t.code), '{}') into v_missing from public.task_types t
   where t.is_active and t.creatable and not (s.items -> 'task_types' ? t.code);
  perform set_config('tarragon.fee_write', 'on', true);
  update public.fee_schedules set status = 'superseded', superseded_at = now()
   where organisation_id = v_org and status = 'approved';
  update public.fee_schedules set status = 'approved', approved_by = v_uid, approved_at = now(), note = coalesce(nullif(btrim(p_note), ''), note)
   where id = s.id;
  perform set_config('tarragon.fee_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'fee_schedule.approved', 'fee_schedule', s.id, jsonb_build_object('version', s.version, 'task_types_without_fee', to_jsonb(v_missing)));
  perform private.emit_domain_event('fee_schedule.approved', v_org, jsonb_build_object('fee_schedule_id', s.id, 'version', s.version),
    'fee_schedule.approved:' || s.id);
  for r in select cs.profile_id from public.clinical_staff cs
            where cs.organisation_id = v_org and cs.profile_id is not null and cs.active and cs.employment_type::text = 'contracted' loop
    perform private.credential_notify(r.profile_id, v_org, 'Your fee schedule has changed',
      'A new fee schedule applies to the work you finish from now on. You can read it under Earnings in your console.',
      jsonb_build_object('fee_schedule_id', s.id), false);
  end loop;
  return jsonb_build_object('fee_schedule_id', s.id, 'version', s.version, 'task_types_without_fee', to_jsonb(v_missing));
end;
$$;

create function public.list_fee_schedules() returns table (id uuid, version integer, status text, items jsonb, note text,
  created_at timestamptz, approved_at timestamptz, superseded_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  return query select s.id, s.version, s.status, s.items, s.note, s.created_at, s.approved_at, s.superseded_at
                 from public.fee_schedules s where s.organisation_id = v_org order by s.version desc;
end;
$$;

-- The one way money is corrected. A positive or negative amount, a reason, optionally the line it corrects, and a request id so a
-- double click posts once. Only for a contracted clinician (an employed doctor is on salary).
create function public.post_earnings_adjustment(p_clinician uuid, p_amount_kobo bigint, p_reason text, p_corrects uuid default null,
                                                p_request_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_uid uuid := (select auth.uid());
  cs public.clinical_staff%rowtype;
  v_id uuid;
begin
  if p_amount_kobo is null or p_amount_kobo = 0 or abs(p_amount_kobo) > 1000000000 then raise exception 'earnings_bad_amount' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'earnings_reason_needed' using errcode = '22023'; end if;
  select * into cs from public.clinical_staff where profile_id = p_clinician and organisation_id = v_org;
  if not found or cs.employment_type::text <> 'contracted' then raise exception 'earnings_not_contracted' using errcode = '22023'; end if;
  if p_corrects is not null and not exists (select 1 from public.earnings_ledger where id = p_corrects and clinician_id = p_clinician and organisation_id = v_org) then
    raise exception 'earnings_unknown_line' using errcode = '22023';
  end if;
  v_id := private.ledger_insert(v_org, p_clinician, 'adjustment', 'adjustment', p_request_id, p_amount_kobo, null,
    jsonb_build_object('reason', btrim(p_reason), 'corrects', p_corrects), now(), cs.is_test, btrim(p_reason), v_uid);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'earnings.adjustment', 'earnings_ledger', v_id, jsonb_build_object('corrects', p_corrects));
  perform private.credential_notify(p_clinician, v_org, 'A correction was added to your earnings',
    'A correction was added to your earnings statement. You can read it under Earnings in your console.', jsonb_build_object('ledger_id', v_id), false);
  return v_id;
end;
$$;

-- Admin reads. Test accounts are excluded unless asked for (INV-13).
create function public.earnings_admin_summary(p_from date default null, p_to date default null, p_include_test boolean default false)
returns table (clinician_id uuid, full_name text, lines bigint, total_kobo bigint, unpaid_kobo bigint, needs_review bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  return query
    select l.clinician_id, cs.full_name, count(*), coalesce(sum(l.amount_kobo), 0)::bigint,
           coalesce(sum(l.amount_kobo) filter (where l.payout_id is null), 0)::bigint,
           count(*) filter (where l.calculation ? 'needs_review'
                              and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text))
      from public.earnings_ledger l
      left join public.clinical_staff cs on cs.profile_id = l.clinician_id
     where l.organisation_id = v_org and (p_include_test or not l.is_test)
       and (p_from is null or (l.earned_at at time zone 'Africa/Lagos')::date >= p_from)
       and (p_to is null or (l.earned_at at time zone 'Africa/Lagos')::date <= p_to)
     group by l.clinician_id, cs.full_name
     order by cs.full_name nulls last;
end;
$$;

create function public.earnings_needing_review(p_include_test boolean default false) returns table (id uuid, clinician_id uuid, kind text, reference_id uuid, earned_at timestamptz, needs_review text, task_type text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.fee_admin_org();
begin
  return query
    select l.id, l.clinician_id, l.kind, l.reference_id, l.earned_at, l.calculation ->> 'needs_review', l.calculation ->> 'task_type'
      from public.earnings_ledger l
     where l.organisation_id = v_org and l.calculation ? 'needs_review' and (p_include_test or not l.is_test)
       and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text)
     order by l.earned_at;
end;
$$;

-- For the go-live guard dashboard (S37) and the admin page: is there a schedule, and is work waiting for one?
create function public.earnings_health(p_include_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := private.fee_admin_org();
  v_deferred bigint;
  v_oldest timestamptz;
begin
  select count(*), min(ct.completed_at) into v_deferred, v_oldest
    from public.clinical_tasks ct
    join public.clinical_staff cs on cs.profile_id = ct.claimed_by and cs.employment_type::text = 'contracted'
   where ct.organisation_id = v_org and ct.state = 'completed' and (p_include_test or (not ct.is_test and not cs.is_test))
     and not exists (select 1 from public.earnings_ledger l where l.kind = 'task' and l.reference_id = ct.id and l.clinician_id = ct.claimed_by);
  return jsonb_build_object(
    'approved_version', (select version from public.fee_schedules where organisation_id = v_org and status = 'approved'),
    'tasks_waiting_for_a_schedule', v_deferred,
    'oldest_waiting_at', v_oldest,
    'lines_needing_review', (select count(*) from public.earnings_ledger l
                              where l.organisation_id = v_org and l.calculation ? 'needs_review' and (p_include_test or not l.is_test)
                                and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Clinician: my schedule, my statement
-- ---------------------------------------------------------------------------
create function private.my_contracted_org() returns uuid
language sql stable security definer set search_path = ''
as $$
  select cs.organisation_id from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.employment_type::text = 'contracted';
$$;
revoke all on function private.my_contracted_org() from public, anon, authenticated;

create function public.my_fee_schedule() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := private.my_contracted_org();
  s public.fee_schedules%rowtype;
begin
  if v_org is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  select * into s from public.fee_schedules where organisation_id = v_org and status = 'approved';
  if not found then return jsonb_build_object('approved', false); end if;
  return jsonb_build_object('approved', true, 'version', s.version, 'approved_at', s.approved_at, 'items', s.items,
                            'rules', jsonb_build_object('lead_month_min_days', private.earnings_setting('lead_month') -> 'min_active_days',
                                                        'backup_on_call_pct', private.earnings_setting('on_call') -> 'backup_fee_pct'));
end;
$$;

create function public.my_earnings_summary(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.my_contracted_org();
begin
  if v_org is null then raise exception 'earnings_not_contracted' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'lines', count(*),
      'total_kobo', coalesce(sum(l.amount_kobo), 0),
      'unpaid_kobo', coalesce(sum(l.amount_kobo) filter (where l.payout_id is null), 0),
      'paid_kobo', coalesce(sum(l.amount_kobo) filter (where l.payout_id is not null), 0),
      'needs_review', count(*) filter (where l.calculation ? 'needs_review'
                                         and not exists (select 1 from public.earnings_ledger a where a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text)),
      'by_kind', coalesce((select jsonb_object_agg(k.kind, k.total) from (
                  select l2.kind, sum(l2.amount_kobo) as total from public.earnings_ledger l2
                   where l2.clinician_id = v_uid
                     and (p_from is null or (l2.earned_at at time zone 'Africa/Lagos')::date >= p_from)
                     and (p_to is null or (l2.earned_at at time zone 'Africa/Lagos')::date <= p_to)
                   group by l2.kind) k), '{}'::jsonb))
      from public.earnings_ledger l
     where l.clinician_id = v_uid
       and (p_from is null or (l.earned_at at time zone 'Africa/Lagos')::date >= p_from)
       and (p_to is null or (l.earned_at at time zone 'Africa/Lagos')::date <= p_to));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. queue_summary: the fee of the next task, for a contracted clinician (S17 returned null). An estimate: the fee is fixed
-- when the task is claimed, so a task that waits longer can step up before then.
-- ---------------------------------------------------------------------------
create or replace function public.queue_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate text := private.queue_gate(v_uid);
  v_block boolean;
  v_employed boolean;
  v_fee bigint;
  v_org uuid;
  fs public.fee_schedules%rowtype;
  nt public.clinical_tasks%rowtype;
begin
  if v_gate is not null then
    return jsonb_build_object('open', false, 'blocked', v_gate, 'by_class', '{}'::jsonb, 'next_fee_kobo', null);
  end if;
  v_block := private.queue_has_block(v_uid);
  select employment_type = 'employed', organisation_id into v_employed, v_org from public.clinical_staff where profile_id = v_uid;
  if not v_block and not coalesce(v_employed, false) then
    return jsonb_build_object('open', false, 'blocked', 'queue_no_availability', 'by_class', '{}'::jsonb, 'next_fee_kobo', null);
  end if;
  if not coalesce(v_employed, true) then
    select * into fs from public.fee_schedules where organisation_id = v_org and status = 'approved';
    if found then
      select ct.* into nt from private.queue_candidates(v_uid, not v_block) c join public.clinical_tasks ct on ct.id = c.id
       order by c.priority_class, c.due_at, c.created_at limit 1;
      if found then
        v_fee := (private.fee_task_calc(fs.items, nt.type, nt.created_at, nt.due_at, now()) ->> 'amount_kobo')::bigint;
      end if;
    end if;
  end if;
  return jsonb_build_object('open', true, 'blocked', null, 'next_fee_kobo', v_fee,
    'by_class', coalesce((select jsonb_object_agg(k, n) from (
        select priority_class::text as k, count(*) as n from private.queue_candidates(v_uid, not v_block) group by priority_class) x), '{}'::jsonb));
end;
$$;
revoke all on function public.queue_summary() from public, anon;
grant execute on function public.queue_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.earnings_config enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.earnings_ledger enable row level security;

create policy earnings_config_select on public.earnings_config for select to authenticated using (private.is_admin());
create policy fee_schedules_select on public.fee_schedules for select to authenticated
  using (private.is_admin() and organisation_id = private.caller_org());
-- A clinician reads their own lines. Finance (admin accounts) reads the organisation's. Not the clinical lead.
create policy earnings_ledger_select on public.earnings_ledger for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.is_admin() and organisation_id = private.caller_org()));

revoke all on public.earnings_config, public.fee_schedules, public.earnings_ledger from anon, public, authenticated;
grant select on public.earnings_config, public.fee_schedules, public.earnings_ledger to authenticated;

revoke all on function
  public.create_fee_schedule_draft(jsonb, text), public.update_fee_schedule_draft(uuid, jsonb, text), public.discard_fee_schedule_draft(uuid),
  public.approve_fee_schedule(uuid, text), public.list_fee_schedules(), public.post_earnings_adjustment(uuid, bigint, text, uuid, uuid),
  public.earnings_admin_summary(date, date, boolean), public.earnings_needing_review(boolean), public.earnings_health(boolean),
  public.my_fee_schedule(), public.my_earnings_summary(date, date)
  from public, anon;
grant execute on function
  public.create_fee_schedule_draft(jsonb, text), public.update_fee_schedule_draft(uuid, jsonb, text), public.discard_fee_schedule_draft(uuid),
  public.approve_fee_schedule(uuid, text), public.list_fee_schedules(), public.post_earnings_adjustment(uuid, bigint, text, uuid, uuid),
  public.earnings_admin_summary(date, date, boolean), public.earnings_needing_review(boolean), public.earnings_health(boolean),
  public.my_fee_schedule(), public.my_earnings_summary(date, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Self-check (the migration fails if any of this is wrong)
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.create_fee_schedule_draft(jsonb,text)', 'public.update_fee_schedule_draft(uuid,jsonb,text)', 'public.discard_fee_schedule_draft(uuid)',
    'public.approve_fee_schedule(uuid,text)', 'public.list_fee_schedules()', 'public.post_earnings_adjustment(uuid,bigint,text,uuid,uuid)',
    'public.earnings_admin_summary(date,date,boolean)', 'public.earnings_needing_review(boolean)', 'public.earnings_health(boolean)',
    'public.my_fee_schedule()', 'public.my_earnings_summary(date,date)', 'public.queue_summary()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S30 assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S30 assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.post_task_earning(uuid)', 'private.post_consultation_earning(uuid)', 'private.post_on_call_earnings()',
    'private.post_lead_month_earnings(integer)', 'private.post_minimum_topups()', 'private.earnings_sweep()', 'private.ledger_insert(uuid,uuid,text,text,uuid,bigint,uuid,jsonb,timestamptz,boolean,text,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S30 assertion: % is callable from outside', v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.earnings_ledger', 'INSERT') or has_table_privilege('authenticated', 'public.earnings_ledger', 'UPDATE')
     or has_table_privilege('authenticated', 'public.earnings_ledger', 'DELETE') or has_table_privilege('authenticated', 'public.fee_schedules', 'INSERT')
     or has_table_privilege('anon', 'public.earnings_ledger', 'SELECT') or has_table_privilege('anon', 'public.fee_schedules', 'SELECT') then
    raise exception 'S30 assertion: a table grant is too wide';
  end if;
  if exists (select 1 from public.fee_schedules) then raise exception 'S30 assertion: a fee schedule was seeded'; end if;
  if (select count(*) from cron.job where jobname in ('earnings-sweep', 'earnings-lead-months', 'earnings-minimum-topups')) <> 3 then
    raise exception 'S30 assertion: a job is not scheduled';
  end if;
end $$;
