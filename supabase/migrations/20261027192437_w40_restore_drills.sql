-- W-40: a record of timed restore drills. The founder runs the point-in-time restore and the drill (never an agent, never against the
-- live project); this table only holds what happened, so "have we ever restored, and how long did it take" has an answer with a date.
-- Nothing here enables PITR or touches a backup. Platform-level table (a drill concerns the whole project, not one organisation),
-- so it carries no organisation_id, like staff_read_scope.
-- Zero rows on creation. RTO and RPO targets are stored on each drill (PROPOSED: the founder sets them when starting a drill), not hard-coded.
--
-- Rules, enforced by a trigger that applies to EVERY role (the owner and the service role included), not just by row security:
--   a. an OPEN drill (no finished_at) can only have finished_at, achieved_rpo_minutes, checks, passed and notes changed;
--   b. a FINISHED drill cannot be changed at all;
--   c. nothing is ever deleted;
--   d. a mistaken record is VOIDED through public.void_restore_drill(id, reason): admin only, reason of at least 20 characters, written to
--      the audit log. The voided_* columns cannot be written any other way. A voided drill stays in the table and is ignored by
--      public.restore_drill_status(), which answers "when did a restore last work, and how old is that".
-- Admin only for reads and writes. Depends on: private.is_admin(), private.log_audit(). No other open PR touches these objects.

create table public.restore_drills (
  id                    uuid primary key default gen_random_uuid(),
  drill_kind            text not null check (drill_kind in ('pitr_restore', 'backup_restore', 'branch_restore')),
  environment           text not null check (environment in ('branch', 'scratch_project')),
  target_restore_point  timestamptz not null,
  started_at            timestamptz not null,
  finished_at           timestamptz,
  rto_target_minutes    integer not null check (rto_target_minutes > 0),
  rpo_target_minutes    integer not null check (rpo_target_minutes >= 0),
  achieved_rpo_minutes  integer check (achieved_rpo_minutes >= 0),
  duration_minutes      numeric generated always as (extract(epoch from (finished_at - started_at)) / 60) stored,
  checks                jsonb not null default '[]'::jsonb,
  passed                boolean,
  run_by                uuid references public.profiles (id) on delete restrict,
  notes                 text,
  voided_at             timestamptz,
  voided_by             uuid references public.profiles (id) on delete restrict,
  void_reason           text,
  created_at            timestamptz not null default now(),
  constraint restore_drills_finish_after_start check (finished_at is null or finished_at >= started_at),
  constraint restore_drills_result_only_when_finished check ((finished_at is null) = (passed is null)),
  constraint restore_drills_checks_is_array check (jsonb_typeof(checks) = 'array'),
  constraint restore_drills_void_complete check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)),
  constraint restore_drills_void_reason_length check (void_reason is null or char_length(void_reason) >= 20)
);
comment on table public.restore_drills is 'W-40: one row per timed restore drill run by the founder on a branch or scratch project (never the live project). checks is a list of {name, passed, detail}. Admin only; a finished drill is final for every role; a mistake is voided with public.void_restore_drill, never edited or deleted.';

create index restore_drills_started_idx on public.restore_drills (started_at desc);

alter table public.restore_drills enable row level security;
revoke all on public.restore_drills from public, anon, authenticated;
grant select, insert, update on public.restore_drills to authenticated;

create policy restore_drills_admin_select on public.restore_drills for select to authenticated using (private.is_admin());
create policy restore_drills_admin_insert on public.restore_drills for insert to authenticated with check (private.is_admin());
create policy restore_drills_admin_finish on public.restore_drills for update to authenticated
  using (private.is_admin() and finished_at is null and voided_at is null) with check (private.is_admin());

-- The immutability trigger. Applies to every role. The void function raises a transaction-local flag AND runs as the table owner
-- (current_user), so a service-role client cannot void by setting the flag itself.
create function private.restore_drills_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_open_writable constant text[] := array['finished_at', 'achieved_rpo_minutes', 'checks', 'passed', 'notes', 'duration_minutes'];
  c_void_cols     constant text[] := array['voided_at', 'voided_by', 'void_reason'];
  v_old jsonb; v_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'restore_drills rows are never deleted; void a mistaken one with public.void_restore_drill' using errcode = '42501';
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  -- the void path: only voided_* change, on a row not yet voided, through the owner-run function
  if (v_new - c_void_cols) = (v_old - c_void_cols) and v_new <> v_old then
    if old.voided_at is not null then
      raise exception 'restore drill % is already voided', old.id using errcode = '42501';
    end if;
    if current_setting('tarragon.restore_drill_void', true) is distinct from 'on' or current_user::regrole <> (select p.proowner from pg_catalog.pg_proc p where p.oid = 'public.void_restore_drill(uuid,text)'::regprocedure) then
      raise exception 'restore drill void columns are written only by public.void_restore_drill' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.voided_at is not null then
    raise exception 'restore drill % is voided and cannot be changed', old.id using errcode = '42501';
  end if;
  if old.finished_at is not null then
    raise exception 'restore drill % is finished and cannot be changed (void it if it is wrong)', old.id using errcode = '42501';
  end if;
  -- an open drill: only the finishing columns may change
  if (v_new - c_open_writable) <> (v_old - c_open_writable) then
    raise exception 'an open restore drill can only change finished_at, achieved_rpo_minutes, checks, passed and notes' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger restore_drills_guard before update or delete on public.restore_drills
  for each row execute function private.restore_drills_guard();

-- Void a mistaken drill. Admin only, a reason of at least 20 characters, audited.
create function public.void_restore_drill(p_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'only an admin can void a restore drill' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 then
    raise exception 'a void reason of at least 20 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.restore_drills where id = p_id) then
    raise exception 'restore drill % not found', p_id using errcode = 'P0002';
  end if;
  perform set_config('tarragon.restore_drill_void', 'on', true);
  update public.restore_drills set voided_at = now(), voided_by = v_uid, void_reason = btrim(p_reason) where id = p_id;
  perform set_config('tarragon.restore_drill_void', 'off', true);
  perform private.log_audit('restore_drill.void', 'restore_drill', p_id, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke execute on function public.void_restore_drill(uuid, text) from public, anon;
grant execute on function public.void_restore_drill(uuid, text) to authenticated;

-- The founder/CMO read: the last passed drill that is not voided, and how old it is.
create function public.restore_drill_status() returns table (
  last_good_id uuid, last_good_kind text, last_good_finished_at timestamptz, age_days numeric,
  duration_minutes numeric, rto_target_minutes integer, met_rto boolean, achieved_rpo_minutes integer, rpo_target_minutes integer,
  open_drills bigint, voided_drills bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'only an admin can read restore drill status' using errcode = '42501';
  end if;
  return query
  select g.id, g.drill_kind, g.finished_at, round(extract(epoch from (now() - g.finished_at)) / 86400, 1),
         g.duration_minutes, g.rto_target_minutes, g.duration_minutes <= g.rto_target_minutes, g.achieved_rpo_minutes, g.rpo_target_minutes,
         (select count(*) from public.restore_drills where finished_at is null and voided_at is null),
         (select count(*) from public.restore_drills where voided_at is not null)
    from (select 1) one
    left join lateral (
      select d.* from public.restore_drills d
       where d.passed and d.finished_at is not null and d.voided_at is null
       order by d.finished_at desc limit 1) g on true;
end $$;
revoke execute on function public.restore_drill_status() from public, anon;
grant execute on function public.restore_drill_status() to authenticated;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.restore_drills'::regclass) then raise exception 'W-40: row security is off on restore_drills'; end if;
  if has_table_privilege('anon', 'public.restore_drills', 'SELECT') or has_table_privilege('anon', 'public.restore_drills', 'INSERT') then raise exception 'W-40: anon can reach restore_drills'; end if;
  if not has_table_privilege('authenticated', 'public.restore_drills', 'SELECT') then raise exception 'W-40: authenticated lacks its table grant on restore_drills'; end if;
  if has_table_privilege('authenticated', 'public.restore_drills', 'DELETE') then raise exception 'W-40: authenticated can delete restore_drills'; end if;
  if has_function_privilege('anon', 'public.void_restore_drill(uuid, text)', 'EXECUTE') then raise exception 'W-40: anon can execute void_restore_drill'; end if;
  if has_function_privilege('anon', 'public.restore_drill_status()', 'EXECUTE') then raise exception 'W-40: anon can execute restore_drill_status'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.restore_drills'::regclass and tgname = 'restore_drills_guard') then raise exception 'W-40: guard trigger missing'; end if;
  if (select count(*) from public.restore_drills) <> 0 then raise exception 'W-40: restore_drills must start empty'; end if;
end $$;
