-- Caregiver Proxy Access, part 4: 23.8, "your father's blood pressure
-- monitoring is overdue" — a caregiver actually told, not just able to ask.
--
-- sponsor_care_status (20260801091000) already answers this question safely
-- and well: counts and a due date, never an alert's title or reasoning, on
-- the same clinical_access consent every other caregiver read already uses.
-- What it doesn't do is reach anyone who isn't already looking at
-- /patient/supporting — CareTeamStatus is pull-only, so a review going
-- overdue while nobody happens to open the app produces silence, exactly
-- the gap the founder's own son-in-London walkthrough (that migration's
-- comment) was written to close for the number itself.
--
-- This closes it the same safe way: a sweep that reads clinician_alerts the
-- identical way sponsor_care_status does (count/min(sla_due_at), never
-- title or detail) and, only for a grant that also holds receive_alerts,
-- turns a newly-overdue review into the same in_app notification shape
-- new_care_message already uses. Nothing here touches clinician_alerts —
-- read only, and the same read a caregiver could already pull on demand.
-- "Newly" matters: a caregiver notified once for a given due date is not
-- notified again every 15 minutes for that same review, only if it clears
-- and a different one goes overdue later.

create table public.caregiver_alert_notifications (
  profile_access_id        uuid primary key references public.profile_access (id) on delete cascade,
  last_notified_review_due timestamptz not null,
  last_notified_at         timestamptz not null default now()
);

comment on table public.caregiver_alert_notifications is
  'Dedup ledger for private.notify_caregivers_of_overdue_reviews: one row per grant, remembering which overdue review a caregiver was last notified about so the same one is not re-sent every sweep. Deleted along with the grant it dedupes for, and cleared by the sweep itself once nothing is overdue any more.';

alter table public.caregiver_alert_notifications enable row level security;

create policy caregiver_alert_notifications_admin_select
  on public.caregiver_alert_notifications for select
  to authenticated
  using (private.is_admin());

create or replace function private.notify_caregivers_of_overdue_reviews()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r record;
begin
  for r in
    select
      pa.id as grant_id,
      pa.profile_id as patient_id,
      pa.grantee_user_id,
      p.organisation_id,
      min(ca.sla_due_at) filter (where ca.status = 'open') as next_review_due
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    left join public.clinician_alerts ca on ca.patient_id = pa.profile_id
    where pa.clinical_access
      and (pa.expires_at is null or pa.expires_at > now())
      and (pa.permissions is null or 'receive_alerts' = any(pa.permissions))
    group by pa.id, pa.profile_id, pa.grantee_user_id, p.organisation_id
  loop
    if r.next_review_due is not null and r.next_review_due < now() then
      if not exists (
        select 1 from public.caregiver_alert_notifications
         where profile_access_id = r.grant_id
           and last_notified_review_due = r.next_review_due
      ) then
        insert into public.notifications
          (organisation_id, recipient_id, channel, status, template, payload)
        values (
          r.organisation_id, r.grantee_user_id, 'in_app', 'pending', 'caregiver_review_overdue',
          jsonb_build_object('patient_profile_id', r.patient_id, 'review_due_at', r.next_review_due)
        );

        insert into public.caregiver_alert_notifications
          (profile_access_id, last_notified_review_due, last_notified_at)
        values (r.grant_id, r.next_review_due, now())
        on conflict (profile_access_id) do update
          set last_notified_review_due = excluded.last_notified_review_due,
              last_notified_at = excluded.last_notified_at;
      end if;
    else
      -- Nothing open, or resolved since the last sweep: clear the ledger row
      -- so a later, different overdue review notifies again rather than
      -- staying silent forever because *something* was once notified.
      delete from public.caregiver_alert_notifications where profile_access_id = r.grant_id;
    end if;
  end loop;
end;
$$;

comment on function private.notify_caregivers_of_overdue_reviews() is
  'Reads clinician_alerts the same way sponsor_care_status does (count/min(sla_due_at) where status=open, never title or detail) and notifies a clinical_access grantee holding receive_alerts once per newly-overdue review. Scheduled every 15 minutes below, same cadence as the profile_access expiry sweep.';

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and anon
-- inherits through PUBLIC — cron-only, never meant to be reachable by any
-- client-facing role. Must come before the self-test below: a fresh replay
-- runs that test the moment this migration applies, not after whatever
-- later migration might also touch this function's grants.
revoke all on function private.notify_caregivers_of_overdue_reviews() from public;

select cron.schedule(
  'caregiver-overdue-review-alerts',
  '*/15 * * * *',
  $$select private.notify_caregivers_of_overdue_reviews();$$
);

do $$
declare
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_grant uuid;
  v_count int;
begin
  -- The safety property this migration exists to hold: no path from this
  -- function to an alert's title or reasoning, ever.
  if pg_get_functiondef('private.notify_caregivers_of_overdue_reviews()'::regprocedure) ~* '\mca\.title\M'
     or pg_get_functiondef('private.notify_caregivers_of_overdue_reviews()'::regprocedure) ~* '\mca\.detail\M' then
    raise exception 'notify_caregivers_of_overdue_reviews must read counts/dates only, never an alert''s title or detail';
  end if;

  if has_function_privilege('anon', 'private.notify_caregivers_of_overdue_reviews()', 'EXECUTE') then
    raise exception 'anon must not reach the caregiver alert sweep';
  end if;

  select id into v_org from public.organisations limit 1;
  select id into v_a from public.profiles where organisation_id = v_org limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a limit 1;
  if v_org is null or v_a is null or v_b is null then
    raise warning 'skipping behavioural assertions: need an org and two profiles';
    return;
  end if;

  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;

  -- A grant that holds clinical_access but explicitly withheld receive_alerts
  -- must never be notified, even with a genuinely overdue review sitting
  -- underneath it (there may or may not be a real clinician_alerts row for
  -- v_a in this environment; either way the permissions filter alone must
  -- keep this grant out of the working set entirely).
  insert into public.profile_access
    (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values
    (v_a, v_b, 'view', v_a, true,
     array['view_appointments']::public.caregiver_permission[])
  returning id into v_grant;

  perform private.notify_caregivers_of_overdue_reviews();

  select count(*) into v_count
    from public.caregiver_alert_notifications where profile_access_id = v_grant;
  if v_count <> 0 then
    raise exception 'a grant without receive_alerts must never gain a dedup row (i.e. must never be notified)';
  end if;

  delete from public.profile_access where id = v_grant;
end $$;
