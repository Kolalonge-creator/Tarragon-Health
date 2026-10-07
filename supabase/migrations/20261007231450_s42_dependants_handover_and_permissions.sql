-- S42 (v5 Module 1, part 2): dependants, spec functions 1.17, 1.18 and 1.19. Not applied to production by this session.
-- Design: docs/design/S42.md.
--
-- Counted first (live, 2026-10-07): the proxy flow is new (proxy_setups 0 rows at the last count); dependants are few; the
-- daily 03:30 job private.refresh_dependent_transition_statuses() already steps a minor's 'manage' grant down to 'view' at 18
-- and the 07:00 sweep flags majority review; the parent (not the young person) claims the login in claimDependentAccountAction.
-- Nothing asks the young person, and the parent's grant is left in place for ever. adolescent_transition_plans no longer
-- exists (the adolescent module was removed 2026-09-14), so dependent_transition_status is the only transition concept.
--
-- What this adds:
--   1. OQ-51: one mapping from care category to caregiver permission (private.category_permissions). confirm_proxy_setup writes
--      both from it; a trigger keeps a restricted grant's permissions in step when its categories change. Least access: only
--      categories that clearly equal a permission map to one, nothing grants an acting permission (book, pay, pharmacy).
--   2. OQ-47: an elder_proxy's manager no longer reads the elder's reproductive health through the dependent bypass; it needs
--      that category granted explicitly. Written fresh (a category-scoped check), not copied from an older table.
--   3. Hand-over at 18: dependant_handovers, a daily sweep that emits dependant.handover_due 30 days before the 18th birthday,
--      my_handover(), complete_dependant_handover(): the young person chooses which guardians keep VIEW access; every other
--      guardian's access ENDS on completion. The 03:30 job now also makes sure the row exists and no longer touches an
--      elder_proxy (an adult's arrangement has no birthday).

-- ---------------------------------------------------------------------------
-- 1. OQ-51: category -> permission
-- ---------------------------------------------------------------------------
create function private.category_permissions(p_categories public.care_access_category[])
returns public.caregiver_permission[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct perm order by perm), '{}'::public.caregiver_permission[])
    from (
      select unnest(case c
        when 'appointments_care_plan' then array['view_appointments', 'view_care_plan']::public.caregiver_permission[]
        when 'medications'            then array['view_medication']::public.caregiver_permission[]
        when 'labs_results'           then array['view_results']::public.caregiver_permission[]
        when 'messaging'              then array['communicate_with_care_team']::public.caregiver_permission[]
        -- vitals_readings, vaccinations, reproductive_health, medical_history: no permission of the same meaning exists.
        else '{}'::public.caregiver_permission[] end) as perm
        from unnest(coalesce(p_categories, '{}'::public.care_access_category[])) as c
    ) s
$$;
revoke all on function private.category_permissions(public.care_access_category[]) from public, anon, authenticated;

-- confirm_proxy_setup restated: permissions come from the categories the parent ticked unless the caller passes some.
CREATE OR REPLACE FUNCTION public.confirm_proxy_setup(p_setup_id uuid, p_categories care_access_category[], p_permissions caregiver_permission[] DEFAULT '{}'::caregiver_permission[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := (select auth.uid());
  v_setup public.proxy_setups;
  v_phone text;
  v_confirmed timestamptz;
  v_grant uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_setup from public.proxy_setups where id = p_setup_id for update;
  select phone, phone_confirmed_at into v_phone, v_confirmed from auth.users where id = v_uid;

  -- One answer for every reason this cannot proceed (no such setup, someone else's number, unverified phone,
  -- already answered, expired): the caller learns nothing about which.
  if v_setup.id is null
     or v_confirmed is null
     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_setup.target_phone_e164, '\D', '', 'g')
     or v_setup.state <> 'pending_confirmation'
     or v_setup.expires_at <= now()
     or v_setup.created_by_profile_id = v_uid then
    raise exception 'this setup cannot be confirmed' using errcode = '42501';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
  values (v_uid, v_setup.created_by_profile_id, 'view', v_uid, case when coalesce(cardinality(p_permissions), 0) = 0 then private.category_permissions(p_categories) else p_permissions end)
  on conflict (profile_id, grantee_user_id)
  do update set permissions = excluded.permissions, updated_at = now()
  returning id into v_grant;

  delete from public.profile_access_categories
   where profile_access_id = v_grant
     and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));
  insert into public.profile_access_categories (profile_access_id, category)
  select v_grant, c from unnest(coalesce(p_categories, array[]::public.care_access_category[])) as c
  on conflict (profile_access_id, category) do nothing;

  update public.proxy_setups
     set state = 'confirmed', confirmed_at = now(), confirmed_profile_id = v_uid
   where id = v_setup.id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_setup.organisation_id, v_uid, 'proxy_setup.confirmed', 'proxy_setup', v_setup.id,
          jsonb_build_object('category_count', cardinality(coalesce(p_categories, array[]::public.care_access_category[]))),
          'success', v_uid);
  return v_grant;
end;
$function$;

-- A grant that restricts permissions (an array, even an empty one) keeps them in step with its categories. A grant with
-- permissions null means "no restriction" elsewhere in the model, so it is never touched here.
create function private.sync_grant_permissions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_grant uuid := coalesce(new.profile_access_id, old.profile_access_id);
begin
  update public.profile_access pa
     set permissions = private.category_permissions((select array_agg(pac.category) from public.profile_access_categories pac where pac.profile_access_id = pa.id))
   where pa.id = v_grant and pa.permissions is not null;
  return null;
end $$;
revoke all on function private.sync_grant_permissions() from public, anon, authenticated;
create trigger profile_access_categories_sync_permissions after insert or delete on public.profile_access_categories
  for each row execute function private.sync_grant_permissions();

-- Existing proxy grants (restricted, empty permissions) catch up once.
update public.profile_access pa
   set permissions = private.category_permissions((select array_agg(pac.category) from public.profile_access_categories pac where pac.profile_access_id = pa.id))
 where pa.permissions is not null and cardinality(pa.permissions) = 0
   and exists (select 1 from public.profile_access_categories pac where pac.profile_access_id = pa.id);

-- ---------------------------------------------------------------------------
-- 2. OQ-47: reproductive health is never implied for an adult's proxy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_read_clinical(p_patient uuid, p_category care_access_category)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (
        (pa.permission_level = 'manage' and p.is_dependent_account
         -- S42 (OQ-47): an adult's reproductive health is never implied by a proxy's manage grant; the category must be granted.
         and not (p_category = 'reproductive_health' and p.dependent_kind = 'elder_proxy'))
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. Hand-over at 18
-- ---------------------------------------------------------------------------
create table public.dependant_handovers (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null unique references public.profiles (id) on delete cascade,
  birthday_18       date not null,
  state             text not null default 'due' check (state in ('due', 'completed')),
  due_emitted_at    timestamptz,
  completed_at      timestamptz,
  guardians_ended   integer check (guardians_ended >= 0),
  guardians_kept    uuid[] not null default '{}',
  consent_text_key  text,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (state <> 'completed' or (completed_at is not null and guardians_ended is not null and consent_text_key is not null))
);
alter table public.dependant_handovers enable row level security;
revoke all on public.dependant_handovers from public, anon, authenticated;
grant select on public.dependant_handovers to authenticated;
-- The young person reads their own; a guardian reads the state of a dependant they hold a grant on (dates and state only).
create policy dependant_handovers_read on public.dependant_handovers for select to authenticated
  using (patient_id = (select auth.uid())
         or exists (select 1 from public.profile_access pa where pa.profile_id = dependant_handovers.patient_id and pa.grantee_user_id = (select auth.uid())));
comment on table public.dependant_handovers is
  'S42 1.18: one row per minor_child dependant from 30 days before the 18th birthday. Written only by the sweep and complete_dependant_handover. Completing it ends every guardian grant the young person does not choose to keep.';

create function private.ensure_dependant_handover(p_patient uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare p public.profiles%rowtype; v_id uuid; v_emitted timestamptz;
begin
  select * into p from public.profiles where id = p_patient;
  if not found or p.date_of_birth is null or p.organisation_id is null then return null; end if;
  insert into public.dependant_handovers (organisation_id, patient_id, birthday_18, is_test)
  values (p.organisation_id, p.id, (p.date_of_birth + interval '18 years')::date, p.is_test)
  on conflict (patient_id) do nothing;
  select id, due_emitted_at into v_id, v_emitted from public.dependant_handovers where patient_id = p_patient;
  if v_emitted is null then
    begin
      perform private.emit_domain_event('dependant.handover_due', p.organisation_id,
        jsonb_build_object('handover_id', v_id, 'birthday_18', (p.date_of_birth + interval '18 years')::date),
        'dependant.handover_due:' || p.id::text, p.id, 'dependant_handover', v_id);
      update public.dependant_handovers set due_emitted_at = now() where id = v_id;
    exception when others then
      raise warning 'dependant.handover_due not emitted: %', sqlerrm;
    end;
  end if;
  return v_id;
end $$;
revoke all on function private.ensure_dependant_handover(uuid) from public, anon, authenticated;

create function private.sweep_dependant_handovers() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n integer := 0;
begin
  for r in
    select id from public.profiles
     where is_dependent_account and dependent_kind = 'minor_child' and date_of_birth is not null
       and (date_of_birth + interval '18 years')::date <= current_date + 30
  loop
    perform private.ensure_dependant_handover(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.sweep_dependant_handovers() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'dependant-handover-sweep-daily') then
    perform cron.unschedule('dependant-handover-sweep-daily');
  end if;
end $$;
select cron.schedule('dependant-handover-sweep-daily', '40 3 * * *', $$ select private.sweep_dependant_handovers(); $$);

-- What the young person sees: whether a hand-over is waiting and who holds access. First names only.
create function public.my_handover() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); h public.dependant_handovers%rowtype;
begin
  if v_uid is null then raise exception 'handover_not_authorised' using errcode = '42501'; end if;
  select * into h from public.dependant_handovers where patient_id = v_uid;
  if not found then return jsonb_build_object('pending', false); end if;
  return jsonb_build_object(
    'pending', h.state = 'due' and current_date >= h.birthday_18,
    'state', h.state, 'birthday_18', h.birthday_18, 'completed_at', h.completed_at,
    'guardians', case when h.state = 'due' then coalesce((
        select jsonb_agg(jsonb_build_object('id', pa.grantee_user_id, 'first_name', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1)) order by pa.created_at)
          from public.profile_access pa join public.profiles g on g.id = pa.grantee_user_id
         where pa.profile_id = v_uid), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.my_handover() from public, anon;
grant execute on function public.my_handover() to authenticated;

create function public.complete_dependant_handover(p_keep uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  h public.dependant_handovers%rowtype;
  p public.profiles%rowtype;
  v_keep uuid[] := coalesce(p_keep, '{}');
  k uuid; v_ended integer;
begin
  if v_uid is null then raise exception 'handover_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid;
  select * into h from public.dependant_handovers where patient_id = v_uid for update;
  if not found or h.state <> 'due' then raise exception 'handover_not_available' using errcode = 'P0002'; end if;
  if current_date < h.birthday_18 then raise exception 'handover_not_yet' using errcode = '23514'; end if;
  -- The young person acts from their own login. A record still marked as a dependant has none.
  if p.is_dependent_account then raise exception 'handover_needs_own_login' using errcode = '23514'; end if;
  foreach k in array v_keep loop
    if not exists (select 1 from public.profile_access where profile_id = v_uid and grantee_user_id = k) then
      raise exception 'handover_unknown_guardian' using errcode = '22023';
    end if;
  end loop;

  -- Access ends for everyone not chosen. Categories go with the grant (cascade).
  delete from public.profile_access where profile_id = v_uid and grantee_user_id <> all (v_keep);
  get diagnostics v_ended = row_count;
  -- Whoever is kept keeps VIEW only (never manage over an adult), until the young person ends it.
  update public.profile_access set permission_level = 'view' where profile_id = v_uid and grantee_user_id = any (v_keep) and permission_level <> 'view';

  update public.dependant_handovers
     set state = 'completed', completed_at = now(), guardians_ended = v_ended, guardians_kept = v_keep,
         consent_text_key = 'handover.consent.draft_pending_counsel'
   where id = h.id;
  perform private.emit_domain_event('dependant.handover_completed', p.organisation_id,
    jsonb_build_object('handover_id', h.id, 'guardians_ended', v_ended, 'guardians_kept', cardinality(v_keep)),
    'dependant.handover_completed:' || p.id::text, p.id, 'dependant_handover', h.id);
  perform private.log_audit('dependant.handover_completed', 'profile', v_uid, jsonb_build_object('guardians_ended', v_ended, 'guardians_kept', cardinality(v_keep)));
  return jsonb_build_object('ok', true, 'guardians_ended', v_ended, 'guardians_kept', cardinality(v_keep));
end $$;
revoke all on function public.complete_dependant_handover(uuid[]) from public, anon;
grant execute on function public.complete_dependant_handover(uuid[]) to authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('dependant.handover_due', 'A dependant is within 30 days of their 18th birthday and a hand-over is waiting (ids and a date only)', 'S42', false),
  ('dependant.handover_completed', 'A young person completed the hand-over of their profile (counts only)', 'S42', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('dependant.handover_due', 1, array['handover_id']),
  ('dependant.handover_completed', 1, array['handover_id'])
on conflict do nothing;

-- The 03:30 job restated: ensures the hand-over row, and no longer treats an elder_proxy as a child turning 18.
CREATE OR REPLACE FUNCTION private.refresh_dependent_transition_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile record;
  v_new_state public.dependent_transition_state;
  v_old_state public.dependent_transition_state;
begin
  for v_profile in
    select id, organisation_id, date_of_birth, full_name
    from public.profiles
    where is_dependent_account and dependent_kind = 'minor_child' and date_of_birth is not null
  loop
    v_new_state := private.compute_dependent_transition_state(v_profile.date_of_birth);

    select transition_state into v_old_state
    from public.dependent_transition_status
    where patient_id = v_profile.id;

    insert into public.dependent_transition_status (patient_id, organisation_id, transition_state, computed_at)
    values (v_profile.id, v_profile.organisation_id, v_new_state, now())
    on conflict (patient_id) do update
      set transition_state = excluded.transition_state,
          organisation_id = excluded.organisation_id,
          computed_at = excluded.computed_at;

    if v_new_state = 'independent'
       and coalesce(v_old_state, 'child'::public.dependent_transition_state) <> 'independent' then
      update public.profile_access
        set permission_level = 'view'
        where profile_id = v_profile.id and permission_level = 'manage';

      perform private.ensure_dependant_handover(v_profile.id);

      if v_profile.organisation_id is not null then
        insert into public.patient_timeline
          (organisation_id, patient_id, event_type, source_table, title, summary)
        values (
          v_profile.organisation_id, v_profile.id, 'dependent_account_transitioned',
          'dependent_transition_status',
          'Turned 18 — guardian access adjusted',
          format(
            'Guardian access on this record moved automatically from full management to view-only now that %s has turned 18. The full history is kept — nothing was removed. Activating an independent login is a separate step.',
            coalesce(v_profile.full_name, 'this account holder')
          )
        );
      end if;
    end if;
  end loop;
end;
$function$;

comment on table public.dependent_transition_status is
  'Age-derived stage (child, adolescent, transition_prep, independent) for a minor_child dependant. The only transition concept: adolescent_transition_plans was removed 2026-09-14. The hand-over itself is dependant_handovers (S42).';

-- Backfill: every minor_child already at or near 18 gets its row (and its due event) now.
select private.sweep_dependant_handovers();

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.dependant_handovers', 'INSERT,UPDATE,DELETE') then raise exception 'S42: dependant_handovers writable directly'; end if;
  if has_table_privilege('anon', 'public.dependant_handovers', 'SELECT') then raise exception 'S42: anon reads dependant_handovers'; end if;
  if has_function_privilege('anon', 'public.complete_dependant_handover(uuid[])', 'EXECUTE') then raise exception 'S42: anon can complete a hand-over'; end if;
  if has_function_privilege('authenticated', 'private.sweep_dependant_handovers()', 'EXECUTE') then raise exception 'S42: sweep callable by a session'; end if;
  if not exists (select 1 from cron.job where jobname = 'dependant-handover-sweep-daily') then raise exception 'S42: hand-over cron missing'; end if;
end $$;
