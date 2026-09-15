-- Tarragon Health — fix private.sweep_dependent_majority_review() after
-- reconciling the Family Care Circle branch into main-dev.
--
-- A separately-shipped migration, 20260830103331_dependent_transition_to_adult_care.sql
-- (Child Health Platform §48.14), independently added its own automatic
-- behaviour on a dependent turning 18: private.refresh_dependent_transition_statuses(),
-- on its own daily cron at 03:30, steps every 'manage' grant on that
-- dependent down to 'view' the moment they cross into its 'independent'
-- transition_state. private.sweep_dependent_majority_review() (this
-- branch, 20260829082711) runs later in the day, at 07:00, and only ever
-- notified grantees who currently held 'manage' -- so by the time it runs,
-- the 03:30 job has already downgraded them to 'view', and the loop below
-- finds nobody to notify. The two migrations do not collide at the SQL
-- level (no shared table/function/cron-job name), so this was not caught by
-- a migration replay -- only by tracing what actually happens across both
-- cron schedules in the same day.
--
-- Fix: notify whoever currently holds ANY grant (manage or view) on the
-- dependent, not manage specifically. This also matches the same fix made
-- to claimDependentAccountAction (apps/web/.../claim-dependent-actions.ts,
-- reconciled in the same pass) -- the original provisioning relationship is
-- what should gate this, not whichever permission_level a separate,
-- independent process happens to have already stepped it down to.

create or replace function private.sweep_dependent_majority_review()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_grantee record;
  v_message text;
begin
  for r in
    select p.id, p.full_name, p.date_of_birth, p.organisation_id
    from public.profiles p
    where p.is_dependent_account
      and p.dependent_kind = 'minor_child'
      and p.majority_review_at is null
      and p.date_of_birth is not null
      and p.date_of_birth <= (current_date - interval '18 years')
  loop
    update public.profiles set majority_review_at = now() where id = r.id;

    v_message := format(
      '%s has turned 18. Set up their own Tarragon login, or confirm you''re still helping manage their care, from Your people.',
      coalesce(nullif(trim(r.full_name), ''), 'The child you added')
    );

    for v_grantee in
      select pa.grantee_user_id
      from public.profile_access pa
      where pa.profile_id = r.id and pa.permission_level in ('manage', 'view')
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_grantee.grantee_user_id, r.organisation_id, 'in_app', 'dependent_majority_review',
        jsonb_build_object('message', v_message, 'dependent_id', r.id),
        'pending', 'non_clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'profile.dependent_majority_review_flagged', 'profiles', r.id,
      jsonb_build_object('date_of_birth', r.date_of_birth));
  end loop;
end;
$$;

comment on function private.sweep_dependent_majority_review() is
  'Notify-only sweep (never touches is_dependent_account itself): flags a minor_child dependent whose date_of_birth implies they are now 18+, once, and notifies every current grantee in-app -- manage or view, since a separately-shipped 03:30 job (private.refresh_dependent_transition_statuses, 20260830103331) may already have stepped a manage grant down to view by the time this 07:00 sweep runs. See docs/FAMILY_CARE_CIRCLE_SPEC.md §3.1 and the reconciliation note in this migration''s header.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'sweep_dependent_majority_review'
      and pg_get_functiondef(p.oid) ilike '%permission_level in (%manage%view%'
  ) then
    raise exception 'sweep_dependent_majority_review was not fixed to notify view-level grantees too';
  end if;
  raise notice 'PASS: sweep_dependent_majority_review notifies manage-or-view grantees, resilient to the 03:30 auto-downgrade job running first';
end $$;
