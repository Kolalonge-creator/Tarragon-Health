-- W-21 follow-up (founder 2026-10-27): a SUPPORT-ONLY way to reverse a death record that was made by mistake. Needs two different people.
--
--   * public.request_death_record_reversal(patient, reason): an active admin asks, with a written reason (at least 20 characters).
--   * public.approve_death_record_reversal(request): a DIFFERENT active admin, or the Chief Medical Officer, approves. The requester can never
--     approve their own request (function check and a table CHECK). A request lapses after 7 days.
--   * The status stays final for everyone else: private.guard_profile_status still refuses every other write, and a reversal is the only
--     path through, via a transaction-local flag set only inside the approve function.
--
-- What reversal restores, and what it deliberately does not:
--   restored: profile_status back to active (deceased_at, recorder and basis cleared). Because the notification stop and the sponsor
--             monthly report both read the status, messages, reminders and sponsor reports resume by themselves from that moment.
--             Goodwill refund requests still waiting on finance (needs_finance) are marked declined, since the person is alive.
--             The sponsor-notice records for the person are removed, so a later, correct record would again tell sponsors once.
--   NOT restored (by design): revoked Care Circle memberships stay revoked and cancelled invites stay cancelled. The person must grant
--             circle access again themselves. Notifications dropped while the record stood are gone. Sponsors are not told anything.
-- Every step is written to death_record_reversals and to audit_log. Nothing here moves money.

create table public.death_record_reversals (
  id                     uuid primary key default gen_random_uuid(),
  beneficiary_profile_id uuid not null references public.profiles (id) on delete cascade,
  requested_by           uuid not null references public.profiles (id) on delete restrict,
  reason                 text not null check (char_length(btrim(reason)) >= 20),
  state                  text not null default 'requested' check (state in ('requested', 'approved')),
  requested_at           timestamptz not null default now(),
  approved_by            uuid references public.profiles (id) on delete restrict,
  approved_at            timestamptz,
  constraint death_record_reversal_two_people check (approved_by is null or approved_by <> requested_by),
  constraint death_record_reversal_state_fields check ((state = 'approved') = (approved_by is not null and approved_at is not null))
);
create unique index death_record_reversals_one_open on public.death_record_reversals (beneficiary_profile_id) where state = 'requested';
alter table public.death_record_reversals enable row level security;
create policy death_record_reversals_admin_read on public.death_record_reversals for select to authenticated using (private.is_admin());
grant select on public.death_record_reversals to authenticated;

-- the guard: identical to the one in 20261027194430 plus the one reversal path
create or replace function private.guard_profile_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.profile_status <> 'active' then raise exception 'profile_status_not_writable' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.profile_status, new.deceased_at, new.deceased_basis)
       is distinct from (old.profile_status, old.deceased_at, old.deceased_basis)
     or (old.profile_status = 'active' and new.deceased_recorded_by is distinct from old.deceased_recorded_by) then
    if old.profile_status = 'deceased' then
      -- W-21 follow-up: the only way out is an approved reversal, fully restoring the active state
      if coalesce(current_setting('tarragon.w21_reversal_path', true), '') = 'on'
         and new.profile_status = 'active' and new.deceased_at is null and new.deceased_basis is null and new.deceased_recorded_by is null then
        return new;
      end if;
      raise exception 'profile_status_final' using errcode = '42501';
    end if;
    if coalesce(current_setting('tarragon.w21_deceased_path', true), '') <> 'on' then
      raise exception 'profile_status_not_writable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_profile_status() from public, anon, authenticated;

create function public.request_death_record_reversal(p_patient uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'admin' and is_active) then
    raise exception 'reversal_not_authorised' using errcode = '42501';
  end if;
  if not private.profile_is_deceased(p_patient) then raise exception 'reversal_not_deceased' using errcode = 'P0002'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 then raise exception 'reversal_reason_required' using errcode = '22023'; end if;
  insert into public.death_record_reversals (beneficiary_profile_id, requested_by, reason) values (p_patient, v_uid, btrim(p_reason))
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values ((select organisation_id from public.profiles where id = p_patient), v_uid, 'bereavement.reversal_requested', 'profile', p_patient,
          jsonb_build_object('request_id', v_id), p_patient);
  return v_id;
end $$;
revoke all on function public.request_death_record_reversal(uuid, text) from public, anon;
grant execute on function public.request_death_record_reversal(uuid, text) to authenticated;

create function public.approve_death_record_reversal(p_request uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.death_record_reversals%rowtype;
  v_is_admin boolean; v_is_cmo boolean;
begin
  select exists (select 1 from public.profiles where id = v_uid and role = 'admin' and is_active) into v_is_admin;
  select exists (select 1 from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
                  where cs.profile_id = v_uid and cs.doctor_tier = 'chief_medical_officer' and cs.active and p.is_active) into v_is_cmo;
  if v_uid is null or not (v_is_admin or v_is_cmo) then raise exception 'reversal_not_authorised' using errcode = '42501'; end if;
  select * into r from public.death_record_reversals where id = p_request and state = 'requested' for update;
  if not found then raise exception 'reversal_not_found' using errcode = 'P0002'; end if;
  if r.requested_by = v_uid then raise exception 'reversal_not_authorised' using errcode = '42501'; end if;   -- never your own request
  if r.requested_at < now() - interval '7 days' then raise exception 'reversal_expired' using errcode = 'P0001'; end if;

  perform set_config('tarragon.w21_reversal_path', 'on', true);
  update public.profiles set profile_status = 'active', deceased_at = null, deceased_basis = null, deceased_recorded_by = null
   where id = r.beneficiary_profile_id and profile_status = 'deceased';
  perform set_config('tarragon.w21_reversal_path', 'off', true);

  update public.goodwill_refund_requests set state = 'declined' where beneficiary_profile_id = r.beneficiary_profile_id and state = 'needs_finance';
  delete from public.bereavement_sponsor_notices where beneficiary_profile_id = r.beneficiary_profile_id;
  update public.death_record_reversals set state = 'approved', approved_by = v_uid, approved_at = now() where id = r.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values ((select organisation_id from public.profiles where id = r.beneficiary_profile_id), v_uid, 'bereavement.reversed', 'profile', r.beneficiary_profile_id,
          jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'approver_kind', case when v_is_admin then 'admin' else 'cmo' end), r.beneficiary_profile_id);
  return jsonb_build_object('reversed', true, 'circle_restored', false);
end $$;
revoke all on function public.approve_death_record_reversal(uuid) from public, anon;
grant execute on function public.approve_death_record_reversal(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.request_death_record_reversal(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_death_record_reversal(uuid)', 'EXECUTE') then
    raise exception 'W-21 reversal: a function is callable by anon';
  end if;
  raise notice 'PASS: W-21 two-person reversal in place';
end $$;
