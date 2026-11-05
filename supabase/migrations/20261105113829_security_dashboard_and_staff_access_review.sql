-- Security audit 2026-11-05, Phase 3: a quarterly staff access review and an internal security dashboard built only from
-- signals the platform really records. Admin only. Nothing here changes a live permission: a "remove" or "change" decision
-- is recorded, and the admin then acts on the member's own page (spec: no live permission change without a person's
-- authorisation, and that action keeps its own existing audit trail).
--
-- 1. staff_access_reviews / staff_access_review_items: one review at a time per organisation. Starting one snapshots every
--    non-patient account (role, clinician tier, active, last sign-in, verified MFA). Every account needs a decision
--    (keep / remove / change; remove and change need a note) before the review can be completed. Rows are written only by
--    the SECURITY DEFINER functions below; admins may read them. Each step writes audit_log.
-- 2. PROPOSED (registry key security.staff_access_review, owner Founder): review every 90 days; a staff account with no sign-in
--    for 90 days is shown as dormant.
-- 3. A weekly job tells the active admins in-app when no review has been completed within the interval (at most once a week).
-- 4. public.security_overview(): one admin-only summary for /admin/security. Failed sign-ins and the four security alert
--    rules come from the sign-in logging change (#1741); until that is live they read as zero, which the page says.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.staff_access_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  started_by      uuid not null references public.profiles (id) on delete restrict,
  started_at      timestamptz not null default now(),
  completed_by    uuid references public.profiles (id) on delete restrict,
  completed_at    timestamptz,
  constraint staff_access_reviews_completed_pair check ((completed_at is null) = (completed_by is null))
);
create unique index staff_access_reviews_one_open on public.staff_access_reviews (organisation_id) where completed_at is null;

create table public.staff_access_review_items (
  id                    uuid primary key default gen_random_uuid(),
  review_id             uuid not null references public.staff_access_reviews (id) on delete restrict,
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  profile_id            uuid not null references public.profiles (id) on delete restrict,
  role_at_review        text not null,
  doctor_tier_at_review text,
  active_at_review      boolean not null,
  is_test               boolean not null,
  last_sign_in_at       timestamptz,
  mfa_enrolled          boolean not null,
  decision              text check (decision in ('keep', 'remove', 'change')),
  decision_note         text,
  decided_by            uuid references public.profiles (id) on delete restrict,
  decided_at            timestamptz,
  unique (review_id, profile_id),
  constraint staff_access_review_items_decided check ((decision is null) = (decided_by is null) and (decision is null) = (decided_at is null)),
  constraint staff_access_review_items_note check (decision is null or decision = 'keep' or length(trim(coalesce(decision_note, ''))) >= 5)
);
create index staff_access_review_items_review on public.staff_access_review_items (review_id);

alter table public.staff_access_reviews enable row level security;
alter table public.staff_access_review_items enable row level security;
create policy staff_access_reviews_admin_read on public.staff_access_reviews for select to authenticated
  using ((select private.is_admin()) and organisation_id = (select private.current_org_id()));
create policy staff_access_review_items_admin_read on public.staff_access_review_items for select to authenticated
  using ((select private.is_admin()) and organisation_id = (select private.current_org_id()));
revoke all on public.staff_access_reviews, public.staff_access_review_items from anon, authenticated;
grant select on public.staff_access_reviews, public.staff_access_review_items to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The review interval and when a staff account counts as dormant (PROPOSED; mirrored by the registry key
--    security.staff_access_review and a drift test)
-- ---------------------------------------------------------------------------
-- staff-access-review-begin
create function private.staff_access_review_interval_days() returns integer language sql immutable set search_path = '' as $$ select 90 $$;
create function private.staff_dormant_after_days() returns integer language sql immutable set search_path = '' as $$ select 90 $$;
-- staff-access-review-end

-- ---------------------------------------------------------------------------
-- 3. Review functions
-- ---------------------------------------------------------------------------
create function public.start_staff_access_review() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_org uuid; v_review uuid; v_n integer;
begin
  if not private.is_admin() then raise exception 'Only an admin can start a staff access review.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_me;
  if v_org is null then raise exception 'Your account has no organisation on file, so there is nothing to review.'; end if;
  if exists (select 1 from public.staff_access_reviews where organisation_id = v_org and completed_at is null) then
    raise exception 'A staff access review is already open. Finish it first.';
  end if;
  insert into public.staff_access_reviews (organisation_id, started_by) values (v_org, v_me) returning id into v_review;
  insert into public.staff_access_review_items
    (review_id, organisation_id, profile_id, role_at_review, doctor_tier_at_review, active_at_review, is_test, last_sign_in_at, mfa_enrolled)
  select v_review, v_org, p.id, p.role::text,
         (select cs.doctor_tier::text from public.clinical_staff cs where cs.profile_id = p.id limit 1),
         p.is_active, p.is_test, u.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
    from public.profiles p left join auth.users u on u.id = p.id
   where p.organisation_id = v_org and p.role <> 'patient';
  get diagnostics v_n = row_count;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, v_me, 'staff_access_review.started', 'staff_access_review', v_review, jsonb_build_object('accounts', v_n), 'success');
  return v_review;
end;
$$;

create function public.decide_staff_access_review_item(p_item uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_item public.staff_access_review_items; v_open boolean;
begin
  if not private.is_admin() then raise exception 'Only an admin can record a review decision.' using errcode = '42501'; end if;
  if p_decision not in ('keep', 'remove', 'change') then raise exception 'Choose keep, remove or change.'; end if;
  if p_decision <> 'keep' and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say in a few words what should change and why.';
  end if;
  select * into v_item from public.staff_access_review_items where id = p_item;
  if not found or v_item.organisation_id is distinct from (select organisation_id from public.profiles where id = v_me) then
    raise exception 'That account is not in a review you can see.';
  end if;
  select completed_at is null into v_open from public.staff_access_reviews where id = v_item.review_id;
  if not v_open then raise exception 'That review is already complete.'; end if;
  update public.staff_access_review_items
     set decision = p_decision, decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = v_me, decided_at = now()
   where id = p_item;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_item.organisation_id, v_me, 'staff_access_review.item_decided', 'staff_access_review_item', p_item,
          jsonb_build_object('review_id', v_item.review_id, 'profile_id', v_item.profile_id, 'decision', p_decision), 'success');
end;
$$;

create function public.complete_staff_access_review(p_review uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_review public.staff_access_reviews; v_undecided integer; v_summary jsonb;
begin
  if not private.is_admin() then raise exception 'Only an admin can complete a staff access review.' using errcode = '42501'; end if;
  select * into v_review from public.staff_access_reviews where id = p_review;
  if not found or v_review.organisation_id is distinct from (select organisation_id from public.profiles where id = v_me) then
    raise exception 'That review is not one you can see.';
  end if;
  if v_review.completed_at is not null then raise exception 'That review is already complete.'; end if;
  select count(*) filter (where decision is null),
         jsonb_build_object('keep', count(*) filter (where decision = 'keep'), 'remove', count(*) filter (where decision = 'remove'),
                            'change', count(*) filter (where decision = 'change'))
    into v_undecided, v_summary
    from public.staff_access_review_items where review_id = p_review;
  if v_undecided > 0 then raise exception 'Every account needs a decision first (% left).', v_undecided; end if;
  update public.staff_access_reviews set completed_at = now(), completed_by = v_me where id = p_review;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_review.organisation_id, v_me, 'staff_access_review.completed', 'staff_access_review', p_review, v_summary, 'success');
end;
$$;

-- When the last review was completed, when the next is due, and whether one is open. Admin only.
create function public.staff_access_review_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid; v_last timestamptz; v_open uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can see the staff access review.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  select max(completed_at) into v_last from public.staff_access_reviews where organisation_id = v_org;
  select id into v_open from public.staff_access_reviews where organisation_id = v_org and completed_at is null;
  return jsonb_build_object(
    'last_completed_at', v_last,
    'next_due_at', coalesce(v_last + make_interval(days => private.staff_access_review_interval_days()), now()),
    'overdue', v_last is null or v_last < now() - make_interval(days => private.staff_access_review_interval_days()),
    'open_review_id', v_open,
    'interval_days', private.staff_access_review_interval_days());
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Weekly reminder
-- ---------------------------------------------------------------------------
create function private.staff_access_review_reminder() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer := 0; o_n integer; o record;
begin
  for o in
    select distinct pr.organisation_id from public.profiles pr
     where pr.role <> 'patient' and pr.organisation_id is not null and not pr.is_test
       and not exists (select 1 from public.staff_access_reviews r where r.organisation_id = pr.organisation_id
                        and r.completed_at > now() - make_interval(days => private.staff_access_review_interval_days()))
  loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority)
    select a.id, o.organisation_id, 'in_app', 'staff_access_review_due', '{}'::jsonb, 'pending', 'non_clinical', 'routine'
      from public.profiles a
     where a.organisation_id = o.organisation_id and a.role = 'admin' and a.is_active and not a.is_test
       and not exists (select 1 from public.notifications n where n.recipient_id = a.id and n.template = 'staff_access_review_due'
                        and n.created_at > now() - interval '6 days');
    get diagnostics o_n = row_count;
    v_n := v_n + o_n;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The dashboard summary. Admin only; staff names appear only for privileged changes and exports (admins see them anyway).
-- ---------------------------------------------------------------------------
create function public.security_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid; v jsonb;
begin
  if not private.is_admin() then raise exception 'Only an admin can see the security overview.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  select jsonb_build_object(
    'generated_at', now(),
    'failed_sign_ins', (
      select jsonb_build_object(
        'last_24h', count(*) filter (where a.created_at > now() - interval '24 hours'),
        'last_7d', count(*),
        'accounts_7d', count(distinct a.event ->> 'identifier_hash'))
        from public.audit_log a where a.action = 'auth.sign_in_failed' and a.created_at > now() - interval '7 days'),
    'sign_ins_7d', (
      select count(*) from public.audit_log a
       where a.action in ('clinician.logged_in', 'patient.logged_in') and a.created_at > now() - interval '7 days'),
    'open_security_alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('rule', x.rule_code, 'severity', x.severity, 'first_seen_at', x.first_seen_at,
                                                   'detail', x.detail) order by x.first_seen_at desc), '[]'::jsonb)
        from public.ops_alerts x
       where x.state = 'open' and not x.is_test
         and x.rule_code in ('failed_sign_in_spike', 'staff_bulk_record_access', 'privileged_change', 'patient_data_export')),
    'staff', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where p.is_active),
        'mfa_enrolled', count(*) filter (where p.is_active and exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')),
        'dormant', count(*) filter (where p.is_active and (u.last_sign_in_at is null
                                    or u.last_sign_in_at < now() - make_interval(days => private.staff_dormant_after_days()))),
        'dormant_after_days', private.staff_dormant_after_days())
        from public.profiles p left join auth.users u on u.id = p.id
       where p.organisation_id = v_org and p.role <> 'patient' and not p.is_test),
    'privileged_changes_30d', (
      select coalesce(jsonb_agg(c order by c ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', a.created_at,
                                  'change', case when a.action = 'profiles.updated' then 'Account role changed'
                                                 when a.action = 'clinical_staff.created' then 'Clinician added'
                                                 else 'Clinician tier or active status changed' end,
                                  'by', coalesce(by_p.full_name, 'System')) c
          from public.audit_log a left join public.profiles by_p on by_p.id = a.actor_id
         where a.created_at > now() - interval '30 days'
           and ((a.action = 'profiles.updated' and a.event -> 'changed_columns' ? 'role')
                or (a.action = 'clinical_staff.updated' and a.event -> 'changed_columns' ?| array['doctor_tier', 'active'])
                or a.action = 'clinical_staff.created')
         order by a.created_at desc limit 20) s),
    'exports_30d', (
      select coalesce(jsonb_agg(e order by e ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', a.created_at, 'export', a.action, 'by', coalesce(by_p.full_name, 'Unknown')) e
          from public.audit_log a left join public.profiles by_p on by_p.id = a.actor_id
         where a.created_at > now() - interval '30 days'
           and a.action in ('admin.patient_directory_exported', 'consultations.log_export', 'research_export.created')
         order by a.created_at desc limit 20) s),
    'staff_access_review', public.staff_access_review_status()
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. The revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------
revoke all on function public.start_staff_access_review() from public, anon;
revoke all on function public.decide_staff_access_review_item(uuid, text, text) from public, anon;
revoke all on function public.complete_staff_access_review(uuid) from public, anon;
revoke all on function public.staff_access_review_status() from public, anon;
revoke all on function public.security_overview() from public, anon;
grant execute on function public.start_staff_access_review() to authenticated;
grant execute on function public.decide_staff_access_review_item(uuid, text, text) to authenticated;
grant execute on function public.complete_staff_access_review(uuid) to authenticated;
grant execute on function public.staff_access_review_status() to authenticated;
grant execute on function public.security_overview() to authenticated;
revoke all on function private.staff_access_review_reminder() from public, anon, authenticated;

select cron.schedule('staff-access-review-reminder', '0 7 * * 1', $$ select private.staff_access_review_reminder(); $$);

-- Closing self-check.
do $c$
begin
  if has_function_privilege('anon', 'public.security_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.start_staff_access_review()', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_staff_access_review_item(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_staff_access_review(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.staff_access_review_status()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.staff_access_review_reminder()', 'EXECUTE') then
    raise exception 'staff access review: a function is executable by a role that must not run it';
  end if;
  if has_table_privilege('anon', 'public.staff_access_review_items', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_access_review_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.staff_access_review_items', 'UPDATE') then
    raise exception 'staff access review: table grants are wider than read-only for authenticated';
  end if;
end $c$;
