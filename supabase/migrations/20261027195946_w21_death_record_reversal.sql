-- W-21 follow-up (founder 2026-10-27; revised in place after code review because nothing here is applied yet):
-- a SUPPORT-ONLY, two-person reversal of a death record, and the sweep that sends or cancels the held sponsor messages.
--
--   * public.request_death_record_reversal(patient, reason): an active admin of the patient's organisation asks, with a written reason of at least
--     20 characters. A stale request (older than 7 days) never blocks a new one: the function expires it first.
--   * public.approve_death_record_reversal(request): a DIFFERENT admin, or the CMO, of the same organisation approves. The requester can never
--     approve their own request (function check and a table CHECK). A request older than 7 days cannot be approved; the sweep marks it 'expired'.
--   * The status stays final for everyone else (private.guard_profile_status). A reversal is the only way back, via a transaction-local flag.
--
-- What reversal restores, and what it deliberately does not:
--   restored: profile_status back to active; death_records marked reversed (never deleted). Messages, reminders and sponsor reports resume
--             because they read the status. Goodwill refund requests still waiting on finance are marked declined (the person is alive).
--   sponsor messages: a message still HELD is cancelled (reason reversed). A message already SENT gets ONE correction (template
--             sponsor_bereavement_correction, in-app): "A note we sent earlier about <first name> was sent in error. They are well. We are sorry."
--             The first name is used only if the sponsor already had the person in an active link when the first message was held (may_name);
--             otherwise "someone you support". WORDING IS PENDING CMO SIGN-OFF (the founder is CMO); it is warm, has no dashes, and names no condition.
--   NOT restored: revoked Care Circle memberships and cancelled invites. The person must grant circle access again themselves.
--             Notifications suppressed while the record stood stay suppressed.
-- The sweep (pg_cron, every 15 minutes, idempotent): expires stale requests; sends each held bereavement message whose send_after has passed
-- and whose death record still stands (otherwise cancels it); never touches a message in any other state.
-- Every step is written to death_record_reversals, bereavement_sponsor_notices and audit_log. Nothing here moves money.

create table public.death_record_reversals (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  reason             text not null check (char_length(btrim(reason)) >= 20),
  requested_by       uuid not null references public.profiles (id) on delete restrict,
  requested_at       timestamptz not null default now(),
  state              text not null default 'requested' check (state in ('requested', 'approved', 'expired')),
  approved_by        uuid references public.profiles (id) on delete restrict,
  approved_at        timestamptz,
  constraint death_record_reversal_two_people check (approved_by is null or approved_by <> requested_by),
  constraint death_record_reversal_state_fields check ((state = 'approved') = (approved_by is not null and approved_at is not null))
);
create unique index death_record_reversals_one_open on public.death_record_reversals (patient_id) where state = 'requested';
alter table public.death_record_reversals enable row level security;
grant select on public.death_record_reversals to authenticated;
select private.classify_minor_dependant_table('death_record_reversals', 'exempt', 'W-21 safety and rights record: must be writable for a deceased child');
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('death_record_reversals', 'org', 'patient_id', 'medical_history', 'W-21: read only by admin and the CMO of the same organisation; holds no clinical content')
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('death_record_reversals', 'patient_id', 'audit', 'review', false, 'W-21. A two-person request to undo a death record. Never deleted. PROPOSED class, to be confirmed by the DPO.')
on conflict (table_name) do nothing;
create policy death_record_reversals_read on public.death_record_reversals for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (private.is_admin() or private.caller_is_cmo()));

create function public.request_death_record_reversal(p_patient uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller_org uuid; v_patient_org uuid; v_id uuid;
begin
  select organisation_id into v_caller_org from public.profiles where id = v_uid and role = 'admin' and is_active;
  select organisation_id into v_patient_org from public.profiles where id = p_patient and profile_status = 'deceased';
  if v_uid is null or v_caller_org is null or v_uid = p_patient then raise exception 'reversal_not_authorised' using errcode = '42501'; end if;
  if v_patient_org is null then raise exception 'reversal_not_deceased' using errcode = 'P0002'; end if;
  if v_caller_org <> v_patient_org then raise exception 'reversal_not_authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 then raise exception 'reversal_reason_required' using errcode = '22023'; end if;
  update public.death_record_reversals set state = 'expired' where patient_id = p_patient and state = 'requested' and requested_at < now() - interval '7 days';
  insert into public.death_record_reversals (organisation_id, patient_id, reason, requested_by) values (v_patient_org, p_patient, btrim(p_reason), v_uid)
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (v_patient_org, v_uid, 'bereavement.reversal_requested', 'profile', p_patient, jsonb_build_object('request_id', v_id), p_patient);
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
  v_caller_org uuid; v_is_admin boolean; v_is_cmo boolean;
  n record; v_notif uuid; v_first text; v_corrected integer := 0;
begin
  select organisation_id into v_caller_org from public.profiles where id = v_uid and is_active and role in ('admin', 'clinician');
  select exists (select 1 from public.profiles where id = v_uid and role = 'admin' and is_active) into v_is_admin;
  v_is_cmo := private.is_cmo_user(v_uid);
  select * into r from public.death_record_reversals where id = p_request and state = 'requested' for update;
  if not found then raise exception 'reversal_not_found' using errcode = 'P0002'; end if;
  if v_uid is null or v_caller_org is null or v_caller_org <> r.organisation_id or not (v_is_admin or v_is_cmo) then
    raise exception 'reversal_not_authorised' using errcode = '42501';
  end if;
  if r.requested_by = v_uid then raise exception 'reversal_not_authorised' using errcode = '42501'; end if;   -- never your own request
  if r.requested_at < now() - interval '7 days' then raise exception 'reversal_expired' using errcode = 'P0001'; end if;

  perform set_config('tarragon.w21_reversal_path', 'on', true);
  update public.profiles set profile_status = 'active' where id = r.patient_id and profile_status = 'deceased';
  perform set_config('tarragon.w21_reversal_path', 'off', true);

  update public.death_records set state = 'reversed', reversed_at = now() where patient_id = r.patient_id and state = 'active';
  update public.goodwill_refund_requests set state = 'declined' where patient_id = r.patient_id and state = 'needs_finance';

  -- a message still held is cancelled
  update public.bereavement_sponsor_notices set state = 'cancelled', cancelled_at = now(), cancel_reason = 'reversed'
   where patient_id = r.patient_id and kind = 'bereavement' and state = 'held';
  -- a message already sent gets exactly one correction
  select split_part(btrim(coalesce(full_name, '')), ' ', 1) into v_first from public.profiles where id = r.patient_id;
  for n in select * from public.bereavement_sponsor_notices where patient_id = r.patient_id and kind = 'bereavement' and state = 'sent' loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select p.organisation_id, n.sponsor_profile_id, 'in_app', 'pending', 'sponsor_bereavement_correction',
           case when n.may_name and coalesce(v_first, '') <> '' then jsonb_build_object('first_name', v_first) else '{}'::jsonb end, 'non_clinical'
      from public.profiles p where p.id = n.sponsor_profile_id and p.is_active
    returning id into v_notif;
    if v_notif is not null then
      insert into public.bereavement_sponsor_notices (organisation_id, patient_id, sponsor_profile_id, death_record_id, kind, state, may_name, send_after, sent_at, notification_id)
      values (n.organisation_id, n.patient_id, n.sponsor_profile_id, n.death_record_id, 'correction', 'sent', n.may_name, now(), now(), v_notif)
      on conflict (death_record_id, sponsor_profile_id, kind) do nothing;
      v_corrected := v_corrected + 1;
      v_notif := null;
    end if;
  end loop;

  update public.death_record_reversals set state = 'approved', approved_by = v_uid, approved_at = now() where id = r.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (r.organisation_id, v_uid, 'bereavement.reversed', 'profile', r.patient_id,
          jsonb_build_object('request_id', r.id, 'requested_by', r.requested_by, 'approver_kind', case when v_is_admin then 'admin' else 'cmo' end,
                             'corrections_sent', v_corrected), r.patient_id);
  return jsonb_build_object('reversed', true, 'circle_restored', false, 'corrections_sent', v_corrected);
end $$;
revoke all on function public.approve_death_record_reversal(uuid) from public, anon;
grant execute on function public.approve_death_record_reversal(uuid) to authenticated;

-- the sweep: idempotent (every change is a state move guarded by the old state), safe to run twice at once (skip locked)
create function private.sweep_bereavement_notices() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n record; v_notif uuid; v_sent integer := 0; v_cancelled integer := 0; v_expired integer := 0; k integer;
begin
  update public.death_record_requests set state = 'expired' where state = 'requested' and requested_at < now() - interval '7 days';
  get diagnostics k = row_count; v_expired := v_expired + k;
  update public.death_record_reversals set state = 'expired' where state = 'requested' and requested_at < now() - interval '7 days';
  get diagnostics k = row_count; v_expired := v_expired + k;

  for n in select * from public.bereavement_sponsor_notices where kind = 'bereavement' and state = 'held' and send_after <= now() for update skip locked loop
    if exists (select 1 from public.death_records dr where dr.id = n.death_record_id and dr.state = 'active')
       and exists (select 1 from public.profiles p where p.id = n.patient_id and p.profile_status = 'deceased')
       and exists (select 1 from public.profiles s where s.id = n.sponsor_profile_id and s.is_active and s.profile_status = 'active') then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
      select s.organisation_id, n.sponsor_profile_id, 'in_app', 'pending', 'sponsor_bereavement', '{}'::jsonb, 'non_clinical'
        from public.profiles s where s.id = n.sponsor_profile_id
      returning id into v_notif;
      update public.bereavement_sponsor_notices set state = 'sent', sent_at = now(), notification_id = v_notif where id = n.id;
      v_sent := v_sent + 1;
    else
      update public.bereavement_sponsor_notices set state = 'cancelled', cancelled_at = now(), cancel_reason = 'record_no_longer_stands_or_sponsor_inactive' where id = n.id;
      v_cancelled := v_cancelled + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'cancelled', v_cancelled, 'expired', v_expired);
end $$;
revoke all on function private.sweep_bereavement_notices() from public, anon, authenticated;

select cron.schedule('bereavement-notice-sweep', '*/15 * * * *', $$ select private.sweep_bereavement_notices(); $$);

do $$
begin
  if has_function_privilege('anon', 'public.request_death_record_reversal(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_death_record_reversal(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_bereavement_notices()', 'EXECUTE') then
    raise exception 'W-21 reversal: a function has the wrong privilege';
  end if;
  raise notice 'PASS: W-21 two-person reversal and notice sweep in place';
end $$;
