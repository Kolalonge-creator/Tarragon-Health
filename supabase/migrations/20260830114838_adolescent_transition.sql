-- Tarragon Health — Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §82.12)
-- Adolescent transition: "Parent-managed -> Shared access -> Increasing patient autonomy ->
-- Independent account." Confirmed nothing existed for this before this migration — a child
-- dependant (profiles.is_dependent_account, provisioned via addChildDependentAction with a
-- synthetic no-login email) stayed under full parental 'manage' access indefinitely, with no
-- age-triggered change of any kind.
--
-- Scope decision (no founder answer existed for this — see the gap-analysis doc's open questions;
-- documenting the default taken here rather than blocking, same posture as the emergency-access
-- migration): a synthetic-email, no-password dependant account cannot be handed "their own login"
-- by a backend sweep alone — that needs real phone/email capture, verification, and a deliberate
-- consent UX this migration does not invent under time pressure. So the two milestones below are
-- scoped to what a backend sweep CAN safely and reversibly do:
--
--   age 13 -- "shared access" is not automated. The sweep only NOTIFIES the managing parent that
--             their child has reached an age where many platforms start offering the child their
--             own account; actually provisioning one stays a manual, parent-initiated action
--             (there is no independent-signup flow for a dependant to convert into today — that
--             is real, separate, future scope, not something this migration silently half-builds).
--   age 18 -- "increasing patient autonomy" IS automated, because it's DB-enforceable and
--             reversible: every 'manage' grant on the (now-adult) dependant's record is downgraded
--             to 'view', and is_dependent_account is cleared (they are a legal adult, not a
--             dependant, in the identity model). The parent is notified of exactly what changed.
--             This does not — cannot — give the now-adult a login of their own; that remains a
--             separate, manual step (flagged in the notification copy itself, not silently
--             glossed over) until a real independent-account-creation flow exists.
--
-- One-time-per-milestone, not once-per-day like the indemnity-lapse notify pattern: turning 13 or
-- 18 is a single life event, not an ongoing condition to keep flagging, so the dedup table has no
-- date component in its uniqueness — each milestone fires at most once per profile, ever.

create type public.adolescent_transition_milestone as enum (
  'shared_access_nudge_13',
  'independence_downgrade_18'
);

create table public.adolescent_transition_events (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  milestone    public.adolescent_transition_milestone not null,
  created_at   timestamptz not null default now(),
  unique (profile_id, milestone)
);

comment on table public.adolescent_transition_events is
  'Dedup + audit trail for private.transition_adolescent_dependents(): one row per dependant per milestone, ever (not per day) — turning 13/18 is a single event, not an ongoing condition.';

alter table public.adolescent_transition_events enable row level security;

create policy adolescent_transition_events_select on public.adolescent_transition_events
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = profile_id
        and p.organisation_id is not null
        and private.is_org_staff(p.organisation_id)
    )
  );

grant select on public.adolescent_transition_events to authenticated;

create or replace function private.transition_adolescent_dependents()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_grantee record;
  v_org uuid;
  v_child_name text;
begin
  for r in
    select id, full_name, organisation_id,
      extract(year from age(current_date, date_of_birth))::int as age_years
    from public.profiles
    where is_dependent_account
      and merged_into_profile_id is null
      and date_of_birth is not null
  loop
    v_child_name := coalesce(r.full_name, 'Your child');
    v_org := r.organisation_id;

    if r.age_years >= 13 and not exists (
      select 1 from public.adolescent_transition_events
      where profile_id = r.id and milestone = 'shared_access_nudge_13'
    ) then
      for v_grantee in
        select grantee_user_id from public.profile_access
        where profile_id = r.id and permission_level = 'manage'
      loop
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
        values (
          v_org, v_grantee.grantee_user_id, 'in_app', 'pending', 'adolescent_shared_access_nudge_13',
          jsonb_build_object('profile_id', r.id, 'child_name', v_child_name)
        );
      end loop;

      insert into public.adolescent_transition_events (profile_id, milestone)
      values (r.id, 'shared_access_nudge_13');
    end if;

    if r.age_years >= 18 and not exists (
      select 1 from public.adolescent_transition_events
      where profile_id = r.id and milestone = 'independence_downgrade_18'
    ) then
      for v_grantee in
        select grantee_user_id from public.profile_access
        where profile_id = r.id and permission_level = 'manage'
      loop
        update public.profile_access
        set permission_level = 'view'
        where profile_id = r.id and grantee_user_id = v_grantee.grantee_user_id;

        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
        values (
          v_org, v_grantee.grantee_user_id, 'in_app', 'pending', 'adolescent_independence_downgrade_18',
          jsonb_build_object('profile_id', r.id, 'child_name', v_child_name)
        );
      end loop;

      update public.profiles
      set is_dependent_account = false
      where id = r.id;

      insert into public.adolescent_transition_events (profile_id, milestone)
      values (r.id, 'independence_downgrade_18');

      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (
        v_org, null, 'profiles.adolescent_independence_downgrade', 'profiles', r.id,
        jsonb_build_object('age_years', r.age_years)
      );
    end if;
  end loop;
end;
$$;

comment on function private.transition_adolescent_dependents() is
  'Notify-only at 13 (parent nudged to consider a real login for their child; nothing automated), DB-enforced downgrade at 18 (every manage grant on the now-adult dependant is set to view, is_dependent_account cleared, parent notified). Deduplicated per profile per milestone forever, not per day. See migration header for the scope decision this defaults to absent a founder answer.';

revoke all on function private.transition_adolescent_dependents() from public;

select cron.schedule(
  'adolescent-transition-sweep',
  '30 6 * * *',
  $$select private.transition_adolescent_dependents()$$
);

-- Proof, not hope.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'adolescent_transition_events'
  ) then
    raise exception 'FAIL: adolescent_transition_events table missing';
  end if;

  if not exists (select 1 from cron.job where jobname = 'adolescent-transition-sweep') then
    raise exception 'FAIL: adolescent-transition-sweep cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.transition_adolescent_dependents()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.transition_adolescent_dependents';
  end if;

  raise notice 'PASS: adolescent_transition_events table + sweep function + cron job all in place';
end $$;
