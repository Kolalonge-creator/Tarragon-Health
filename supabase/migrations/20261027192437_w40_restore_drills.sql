-- W-40: a record of timed restore drills. The founder runs the point-in-time restore and the drill (never an agent, never against the
-- live project); this table only holds what happened, so "have we ever restored, and how long did it take" has an answer with a date.
-- Nothing here enables PITR or touches a backup. Platform-level table (a drill concerns the whole project, not one organisation),
-- so it carries no organisation_id, like staff_read_scope.
-- Zero rows on creation. RTO and RPO targets are stored on each drill (PROPOSED: the founder sets them when starting a drill), not hard-coded.
-- Admin only. Completed drills are not editable and none can be deleted: the record is the point.
-- Depends on: private.is_admin(). No other migration in an open PR touches this table.

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
  created_at            timestamptz not null default now(),
  constraint restore_drills_finish_after_start check (finished_at is null or finished_at >= started_at),
  constraint restore_drills_result_only_when_finished check ((finished_at is null) = (passed is null)),
  constraint restore_drills_checks_is_array check (jsonb_typeof(checks) = 'array')
);
comment on table public.restore_drills is 'W-40: one row per timed restore drill run by the founder on a branch or scratch project (never the live project). checks is a list of {name, passed, detail}. Admin only; a finished drill is final.';

create index restore_drills_started_idx on public.restore_drills (started_at desc);

alter table public.restore_drills enable row level security;
revoke all on public.restore_drills from public, anon;
grant select, insert, update on public.restore_drills to authenticated;

create policy restore_drills_admin_select on public.restore_drills for select to authenticated using (private.is_admin());
create policy restore_drills_admin_insert on public.restore_drills for insert to authenticated with check (private.is_admin());
-- an open drill can be finished; a finished one cannot be changed
create policy restore_drills_admin_finish on public.restore_drills for update to authenticated
  using (private.is_admin() and finished_at is null) with check (private.is_admin());

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.restore_drills'::regclass) then raise exception 'W-40: row security is off on restore_drills'; end if;
  if has_table_privilege('anon', 'public.restore_drills', 'SELECT') or has_table_privilege('anon', 'public.restore_drills', 'INSERT') then raise exception 'W-40: anon can reach restore_drills'; end if;
  if not has_table_privilege('authenticated', 'public.restore_drills', 'SELECT') then raise exception 'W-40: authenticated lacks its table grant on restore_drills'; end if;
  if has_table_privilege('authenticated', 'public.restore_drills', 'DELETE') then raise exception 'W-40: authenticated can delete restore_drills'; end if;
  if (select count(*) from public.restore_drills) <> 0 then raise exception 'W-40: restore_drills must start empty'; end if;
end $$;
