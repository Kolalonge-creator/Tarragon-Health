-- S68g: deletion and retention for the maternal and child tracker data (decision B3 and C of the CMO/founder pack, 2026-10-07).
--
--   Patient-entered tracker data (the feed log, baby checks the person typed, growth measurements the person or their parent typed, a pregnancy-loss
--   note the person wrote) is DELETED on request after a short grace window, with an audit receipt.
--   Clinician-recorded or clinician-acted-on data is SEALED, not erased (kept for the retention period, 8 years PROPOSED, counsel to confirm).
--   A deletion that meets sealed rows deletes the rest and the receipt says how many were kept and why. Nothing is ever partly hidden.
--   Sealed means: source = clinician_recorded; a growth row that raised a nutrition alert; a growth row a trajectory alert was raised for; a baby check
--   linked to an appointment. Counsel to confirm the NDPA 2023 carve-out wording (OQ-357). This is NOT the "no erase of real data" rule applied to
--   everything: it is the founder's split by who recorded it.
--   Two steps so a mistake or a coerced tap can be undone: request (starts the grace window, can be cancelled), then complete after the window.
--   The lifecycle history keeps the fact that a confirmed event happened (a stage change, no note); the loss NOTE is what is deleted (OQ-358).

-- s68-config-retention.rules-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('retention.rules', 1, true, 'proposed', '2026-10-07', $json${"grace_days":7,"sealed_retention_years":8,"scopes":["feed_log","child_growth","baby_checks","pregnancy_loss"]}$json$::jsonb,
 'CMO/founder pack B3 and C (selected 2026-10-07, not signed): patient-entered tracker and pregnancy-loss notes deleted on request after the grace window; clinician-recorded or acted-on data sealed 8 years (counsel to confirm the period) then destroyed. Grace window length is a proposal.');
-- s68-config-retention.rules-end

create table public.tracker_deletion_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,   -- whose data
  requested_by     uuid not null references public.profiles (id) on delete restrict,  -- the person or the parent acting for a child
  scope            text not null check (scope in ('feed_log', 'child_growth', 'baby_checks', 'pregnancy_loss')),
  execute_after    timestamptz not null,
  status           text not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  config_version   integer not null,
  rows_deleted     integer,
  rows_sealed_kept integer,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint tracker_deletion_done_has_counts check (status <> 'executed' or (rows_deleted is not null and rows_sealed_kept is not null and completed_at is not null))
);
create unique index tracker_deletion_one_pending on public.tracker_deletion_requests (patient_id, scope) where status = 'pending';
create index tracker_deletion_patient_idx on public.tracker_deletion_requests (patient_id, created_at desc);
alter table public.tracker_deletion_requests enable row level security;
revoke all on public.tracker_deletion_requests from public, anon, authenticated;
grant select on public.tracker_deletion_requests to authenticated;
create policy tracker_deletion_select on public.tracker_deletion_requests for select to authenticated
  using (patient_id = (select auth.uid()) or requested_by = (select auth.uid()) or private.is_admin());
-- the receipt is permanent: only the two functions below may change a row, and only its status and counts
create or replace function private.tracker_deletion_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a deletion receipt is permanent' using errcode = '42501'; end if;
  if (new.id, new.patient_id, new.requested_by, new.scope, new.execute_after, new.created_at) is distinct from (old.id, old.patient_id, old.requested_by, old.scope, old.execute_after, old.created_at)
     or old.status <> 'pending' then
    raise exception 'a deletion receipt can only move from pending to executed or cancelled' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tracker_deletion_requests_guard before update or delete on public.tracker_deletion_requests
  for each row execute function private.tracker_deletion_guard();

-- who may ask for deletion of whose data: the person for themselves, or a parent with 'manage' on a dependent child for the child's growth
create or replace function private.tracker_deletion_allowed(p_actor uuid, p_patient uuid, p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor = p_patient
      or (p_scope = 'child_growth' and exists (
            select 1 from public.profile_access pa join public.profiles c on c.id = pa.profile_id
             where pa.profile_id = p_patient and pa.grantee_user_id = p_actor and pa.permission_level = 'manage' and c.is_dependent_account))
$$;
revoke all on function private.tracker_deletion_allowed(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.request_tracker_deletion(p_scope text, p_patient uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_patient uuid := coalesce(p_patient, v_uid);
  c jsonb := private.maternal_child_rules('retention.rules'); v_org uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if c is null or not (p_scope in (select jsonb_array_elements_text(c -> 'scopes'))) then raise exception 'unknown scope' using errcode = '22023'; end if;
  if not private.tracker_deletion_allowed(v_uid, v_patient, p_scope) then raise exception 'not allowed' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_patient;
  insert into public.tracker_deletion_requests (organisation_id, patient_id, requested_by, scope, execute_after, config_version)
  values (v_org, v_patient, v_uid, p_scope, now() + ((c ->> 'grace_days')::integer) * interval '1 day', private.maternal_child_config_version('retention.rules'))
  returning id into v_id;
  perform private.log_audit('tracker_deletion_requested', 'tracker_deletion_requests', v_id, jsonb_build_object('scope', p_scope));
  return v_id;
end $$;

create or replace function public.cancel_tracker_deletion(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tracker_deletion_requests set status = 'cancelled', completed_at = now(), rows_deleted = 0, rows_sealed_kept = 0
   where id = p_id and status = 'pending' and requested_by = (select auth.uid());
  if not found then raise exception 'no pending request of yours' using errcode = '42501'; end if;
  perform private.log_audit('tracker_deletion_cancelled', 'tracker_deletion_requests', p_id, '{}'::jsonb);
end $$;

-- The deletion itself. Used by the person (after the window) and by the service sweep.
create or replace function private.execute_tracker_deletion(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.tracker_deletion_requests%rowtype; v_del integer := 0; v_kept integer := 0;
begin
  select * into r from public.tracker_deletion_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending request' using errcode = '22023'; end if;
  if r.execute_after > now() then raise exception 'the grace window has not ended' using errcode = '55000'; end if;

  if r.scope = 'feed_log' then
    with d as (delete from public.breastfeeding_feed_log where patient_id = r.patient_id and source = 'patient_entered' returning 1) select count(*) into v_del from d;
    select count(*) into v_kept from public.breastfeeding_feed_log where patient_id = r.patient_id;
  elsif r.scope = 'baby_checks' then
    with d as (delete from public.postnatal_baby_checks where patient_id = r.patient_id and source = 'patient_entered' and appointment_id is null returning 1) select count(*) into v_del from d;
    select count(*) into v_kept from public.postnatal_baby_checks where patient_id = r.patient_id and (source <> 'patient_entered' or appointment_id is not null)
      and (completed_at is not null or baby_weight_kg is not null or concern_note is not null);
  elsif r.scope = 'pregnancy_loss' then
    with d as (delete from public.pregnancy_loss_records where patient_id = r.patient_id and source = 'patient_entered' returning 1) select count(*) into v_del from d;
    select count(*) into v_kept from public.pregnancy_loss_records where patient_id = r.patient_id;
  elsif r.scope = 'child_growth' then
    with d as (
      delete from public.child_growth_measurements g
       where g.patient_id = r.patient_id and g.source in ('patient_entered', 'caregiver_entered') and g.nutrition_alert_id is null
         and not exists (select 1 from public.clinician_alerts a where a.patient_id = g.patient_id and a.title like 'Growth trajectory change%'
                            and a.created_at between g.created_at - interval '1 minute' and g.created_at + interval '1 minute')
       returning 1) select count(*) into v_del from d;
    select count(*) into v_kept from public.child_growth_measurements where patient_id = r.patient_id;
  end if;

  update public.tracker_deletion_requests set status = 'executed', completed_at = now(), rows_deleted = v_del, rows_sealed_kept = v_kept where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (r.organisation_id, coalesce((select auth.uid()), r.requested_by), 'tracker_deletion_completed', 'tracker_deletion_requests', p_id,
          jsonb_build_object('scope', r.scope, 'rows_deleted', v_del, 'rows_sealed_kept', v_kept));
  return jsonb_build_object('rows_deleted', v_del, 'rows_sealed_kept', v_kept);
end $$;
revoke all on function private.execute_tracker_deletion(uuid) from public, anon, authenticated;

create or replace function public.complete_tracker_deletion(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tracker_deletion_requests where id = p_id and requested_by = (select auth.uid())) then
    raise exception 'no request of yours' using errcode = '42501';
  end if;
  return private.execute_tracker_deletion(p_id);
end $$;

-- the service sweep (nothing schedules it yet: a cron decision, OQ-359)
create or replace function public.sweep_due_tracker_deletions() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  for r in select id from public.tracker_deletion_requests where status = 'pending' and execute_after <= now() order by execute_after loop
    perform private.execute_tracker_deletion(r.id); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.request_tracker_deletion(text, uuid), public.cancel_tracker_deletion(uuid), public.complete_tracker_deletion(uuid) from public, anon;
grant execute on function public.request_tracker_deletion(text, uuid), public.cancel_tracker_deletion(uuid), public.complete_tracker_deletion(uuid) to authenticated;
revoke all on function public.sweep_due_tracker_deletions() from public, anon, authenticated;
grant execute on function public.sweep_due_tracker_deletions() to service_role;

do $$ begin
  if has_table_privilege('authenticated', 'public.tracker_deletion_requests', 'INSERT') or has_table_privilege('authenticated', 'public.breastfeeding_feed_log', 'DELETE') then
    raise exception 'S68g self-check: nobody may write receipts directly or delete tracker rows directly'; end if;
  if has_function_privilege('authenticated', 'public.sweep_due_tracker_deletions()', 'EXECUTE') then raise exception 'S68g self-check: the sweep is service-role only'; end if;
end $$;
