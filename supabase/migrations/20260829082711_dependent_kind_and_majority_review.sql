-- Tarragon Health — Family Care Circle gap closure, part 1 of 5
-- (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.1: "no age-of-majority transition for a
-- provisioned child account").
--
-- profiles.is_dependent_account has meant exactly one thing since
-- 20260730025553 (addChildDependentAction): a child with no login of their
-- own, provisioned by a parent. This migration adds a second, narrower fact —
-- WHY the account has no login of its own — because part 2 of this gap
-- closure (a companion migration) adds a second provisioning path for a
-- consenting adult who cannot self-onboard (§3.2, "my father does not use
-- smartphones"), and that path must never be swept for majority review: an
-- adult proxy account has no birthday after which the arrangement should
-- lapse the way a child's does.
--
-- dependent_kind is nullable and only meaningful where is_dependent_account
-- is true — it does not replace that column, every existing RLS check
-- (private.can_read_clinical, vaccination_schedules_select, etc.) keeps
-- reading is_dependent_account exactly as before and needs no change here.

create type public.dependent_kind as enum ('minor_child', 'elder_proxy');

alter table public.profiles
  add column dependent_kind public.dependent_kind,
  add column majority_review_at timestamptz;

comment on column public.profiles.dependent_kind is
  'Only set when is_dependent_account is true. minor_child: provisioned via addChildDependentAction, subject to the majority-review sweep below. elder_proxy: provisioned via the adult proxy path (companion migration), never swept for majority — see 20260829082711.';
comment on column public.profiles.majority_review_at is
  'Set once, by private.sweep_dependent_majority_review(), the first time a minor_child dependent is found to be 18 or older. Never cleared automatically; claimDependentAccountAction (companion TS change) reads it to gate the claim flow. Always null for an elder_proxy account or a non-dependent.';

-- Backfill: every dependent account created before this migration was
-- provisioned through the one path that existed, addChildDependentAction.
update public.profiles set dependent_kind = 'minor_child' where is_dependent_account;

alter table public.profiles
  add constraint profiles_dependent_kind_requires_dependent
  check (dependent_kind is null or is_dependent_account);

-- ---------------------------------------------------------------------------
-- The sweep. Notify-only, same discipline as
-- private.notify_clinical_staff_indemnity_lapses (20260826224913): this never
-- revokes the parent's manage grant or touches is_dependent_account itself —
-- it only flags the record, once, so the family can see the flag and act
-- through claimDependentAccountAction. Idempotent by construction: the WHERE
-- clause only ever selects rows where majority_review_at is still null, so a
-- record is notified exactly once no matter how many times the cron fires.
--
-- 18 is this codebase's own existing threshold, not a new number introduced
-- here — see apps/web/src/lib/validation/add-child-dependent.ts's own
-- "This form is for children under 18" check.
-- ---------------------------------------------------------------------------

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
      where pa.profile_id = r.id and pa.permission_level = 'manage'
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
  'Notify-only sweep (never touches is_dependent_account or the manage grant): flags a minor_child dependent whose date_of_birth implies they are now 18+, once, and notifies every manage grantee in-app. See docs/FAMILY_CARE_CIRCLE_SPEC.md §3.1.';

-- anon inherits EXECUTE through the PUBLIC pseudo-role — this revoke is the
-- one that actually matters, per feedback_supabase_anon_execute_gotcha.
revoke all on function private.sweep_dependent_majority_review() from public;

select cron.schedule(
  'dependent-majority-review-sweep',
  '0 7 * * *',
  $$select private.sweep_dependent_majority_review()$$
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'dependent_kind'
  ) then
    raise exception 'profiles.dependent_kind missing after migration';
  end if;

  if exists (
    select 1 from public.profiles where is_dependent_account and dependent_kind is null
  ) then
    raise exception 'a dependent account survived the backfill with no dependent_kind';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'sweep_dependent_majority_review'
  ) then
    raise exception 'private.sweep_dependent_majority_review missing after migration';
  end if;

  if not exists (select 1 from cron.job where jobname = 'dependent-majority-review-sweep') then
    raise exception 'dependent-majority-review-sweep cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.sweep_dependent_majority_review()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.sweep_dependent_majority_review';
  end if;
  if has_function_privilege('authenticated', 'private.sweep_dependent_majority_review()', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute private.sweep_dependent_majority_review directly';
  end if;

  raise notice 'PASS: dependent_kind + majority review sweep in place, anon/authenticated denied direct execute';
end $$;
