-- Invite the payer into the Care Circle at gift acceptance (2026-11-03).
--
-- When a patient accepts a care pack or Membership someone else paid for (public.respond_to_gifted_pack), the screen now offers a next
-- step: "Would you like [first name] to see how you are doing?", every permission as an unticked box, one "Share the usual" button and
-- "Not now". Nothing is shared until the patient taps. The same offer stays on the patient's Care Circle page for any payer of an
-- accepted gift who does not yet see anything.
--
--   * public.circle_gift_payers(): the signed-in patient's payers of ACCEPTED gifts (orders paid by someone else for this patient whose
--     entitlement the patient accepted) who are not yet in the circle with any view permission. First name only. An under-18 patient
--     gets an empty list. This deliberately names the payer to the patient (S29 said "someone has paid"); the founder's brief for this
--     feature asks for the first name, and the payer already holds pay_for_care or a manage_payments grant to have paid at all.
--   * public.share_circle_with_gift_payer(p_payer, p_permissions, p_monthly_report): SECURITY DEFINER. The patient is auth.uid(), never a
--     parameter. Refuses: not signed in, not an active adult patient who receives care (circle_patient_is_minor), a permission outside the
--     gift-share list (attend_consultation is a per-call invitation and is never offered here), and anyone who did not pay for a gift
--     this patient accepted (one answer, circle_payer_not_found, for a stranger, a declined gift, a pending gift or the patient). An
--     existing active membership is widened, never narrowed (union of permissions; the monthly report is switched on, never off), so a
--     second tap with the same choice changes nothing and is not re-logged. A new membership respects max_members and lasts
--     default_grant_days. Every change writes a care_access_events row through private.log_care_access; the payer is told in-app once
--     per membership with the neutral template circle_shared_with_you (private.circle_notify dedupes on the member row).
--   * "Not now" is remembered per payer (public.care_circle_gift_payer_dismissals, written by dismiss_gift_payer_offer, patient-only RLS,
--     registered in data_registry reviewed=false and staff_read_scope): circle_gift_payers never offers that payer again, even after a
--     later accepted gift from them.
--   * Changing or removing it later is the existing Care Circle settings (update_care_circle_member, set_circle_monthly_report_share,
--     revoke_care_circle_member). No new table, no guard, no module.
-- Row counts at writing (live, read-only): care_circle_members 0, entitlements accepted 0. No data is converted.

create function private.circle_gift_share_permissions() returns text[]
language sql immutable set search_path = ''
as $$ select array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'doctor_note', 'pay_for_care']::text[] $$;
revoke all on function private.circle_gift_share_permissions() from public, anon, authenticated;

-- the one test of "this person paid for a gift this patient accepted"
create function private.circle_is_accepted_gift_payer(p_patient uuid, p_payer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_patient is not null and p_payer is not null and p_payer <> p_patient and exists (
    select 1 from public.entitlements e
      join public.orders o on o.id = e.order_id
     where e.patient_id = p_patient and e.acceptance = 'accepted'
       and o.beneficiary_patient_id = p_patient and o.buyer_profile_id = p_payer and o.state = 'paid')
$$;
revoke all on function private.circle_is_accepted_gift_payer(uuid, uuid) from public, anon, authenticated;

-- "Not now" is remembered per payer (review fix): one row per (patient, payer), written only by dismiss_gift_payer_offer, read only by the
-- patient. A later accepted gift from the same payer does NOT bring the offer back; the patient can still invite them from the normal Care
-- Circle settings (an invite) or call share_circle_with_gift_payer directly, which is unaffected.
create table public.care_circle_gift_payer_dismissals (
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  payer_id         uuid not null references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  is_test          boolean not null default false,
  dismissed_at     timestamptz not null default now(),
  primary key (patient_id, payer_id),
  check (patient_id <> payer_id)
);
comment on table public.care_circle_gift_payer_dismissals is
  'The patient said "Not now" to sharing with someone who paid for their care. Never asked again about that payer. Patient-only.';
alter table public.care_circle_gift_payer_dismissals enable row level security;
-- written fresh for this table: the patient reads their own rows; nobody writes directly
create policy care_circle_gift_payer_dismissals_patient_read on public.care_circle_gift_payer_dismissals for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on public.care_circle_gift_payer_dismissals from public, anon, authenticated;
grant select on public.care_circle_gift_payer_dismissals to authenticated;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('care_circle_gift_payer_dismissals', 'patient_id', 'consent', 'review', true, false,
        'The patient chose not to be asked again about sharing with a person who paid for their care. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('care_circle_gift_payer_dismissals', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;

create function public.dismiss_gift_payer_offer(p_payer uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); pr public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  -- only a real payer of an accepted gift can be dismissed; anything else is a quiet false (nothing to remember)
  if not private.circle_is_accepted_gift_payer(v_uid, p_payer) then return false; end if;
  select * into pr from public.profiles where id = v_uid;
  insert into public.care_circle_gift_payer_dismissals (patient_id, payer_id, organisation_id, is_test)
  values (v_uid, p_payer, pr.organisation_id, coalesce(pr.is_test, false))
  on conflict (patient_id, payer_id) do nothing;
  return true;
end $$;
revoke all on function public.dismiss_gift_payer_offer(uuid) from public, anon;
grant execute on function public.dismiss_gift_payer_offer(uuid) to authenticated;

create function public.circle_gift_payers() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.circle_patient_is_minor(v_uid) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('payer_id', g.payer, 'first_name', g.first_name, 'entitlement_ids', to_jsonb(g.ents),
                                        'last_gift_at', g.last_at, 'is_member', g.is_member) order by g.last_at desc)
      from (
        select o.buyer_profile_id as payer,
               nullif(split_part(btrim(coalesce(bp.full_name, '')), ' ', 1), '') as first_name,
               array_agg(e.id order by e.decided_at) as ents,
               max(e.decided_at) as last_at,
               exists (select 1 from public.care_circle_members m where m.patient_id = v_uid and m.supporter_id = o.buyer_profile_id
                          and m.state = 'active' and m.expires_at > now()) as is_member
          from public.entitlements e
          join public.orders o on o.id = e.order_id
          join public.profiles bp on bp.id = o.buyer_profile_id and bp.is_active
         where e.patient_id = v_uid and e.acceptance = 'accepted' and o.state = 'paid'
           and o.beneficiary_patient_id = v_uid and o.buyer_profile_id <> v_uid
         group by o.buyer_profile_id, bp.full_name
      ) g
     where not exists (select 1 from public.care_circle_members m
                        where m.patient_id = v_uid and m.supporter_id = g.payer and m.state = 'active' and m.expires_at > now()
                          and not (m.permissions <@ array['pay_for_care', 'attend_consultation']::text[]))
       -- "Not now" is remembered: a dismissed payer is never offered again, whatever they pay for later
       and not exists (select 1 from public.care_circle_gift_payer_dismissals d where d.patient_id = v_uid and d.payer_id = g.payer)
  ), '[]'::jsonb);
end $$;

create function public.share_circle_with_gift_payer(p_payer uuid, p_permissions text[], p_monthly_report boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  cfg jsonb := private.circle_rules();
  ex public.care_circle_members%rowtype;
  m public.care_circle_members%rowtype;
  v_perms text[];
  v_monthly boolean := coalesce(p_monthly_report, false);
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles
   where id = v_uid and role = 'patient' and is_active and receives_care and not coalesce(is_dependent_account, false);
  if not found then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  -- a Care Circle is for adults (W-11)
  if private.circle_patient_is_minor(v_uid) then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if p_permissions is null or not private.circle_permissions_valid(p_permissions)
     or not (p_permissions <@ private.circle_gift_share_permissions()) then
    raise exception 'invite_permissions_invalid' using errcode = '22023';
  end if;
  -- only someone who paid for a gift THIS patient accepted; one answer for everyone else
  if not private.circle_is_accepted_gift_payer(v_uid, p_payer)
     or not exists (select 1 from public.profiles where id = p_payer and is_active) then
    raise exception 'circle_payer_not_found' using errcode = '42501';
  end if;

  select * into ex from public.care_circle_members
   where patient_id = v_uid and supporter_id = p_payer and state = 'active' for update;
  if ex.id is not null and ex.expires_at <= now() then
    -- lapsed but not yet swept: close it the way the hourly sweep would, then start a fresh membership below
    update public.care_circle_members set state = 'expired' where id = ex.id;
    perform private.log_care_access(v_uid, 'expired', 'care_circle', '{}'::jsonb, p_payer);
    ex := null;
  end if;

  if ex.id is not null then
    -- widen, never narrow: removing anything is the patient's existing settings
    v_perms := array(select distinct x from unnest(ex.permissions || p_permissions) x order by x);
    if v_perms @> ex.permissions and ex.permissions @> v_perms and (ex.monthly_report_shared or not v_monthly) then
      return jsonb_build_object('ok', true, 'member_id', ex.id, 'created', false, 'changed', false, 'permissions', to_jsonb(ex.permissions));
    end if;
    update public.care_circle_members
       set permissions = v_perms,
           monthly_report_shared = monthly_report_shared or v_monthly,
           monthly_report_shared_at = case when not monthly_report_shared and v_monthly then now() else monthly_report_shared_at end
     where id = ex.id
     returning * into m;
    perform private.log_care_access(v_uid, 'permission_changed', 'care_circle',
      jsonb_build_object('permissions', to_jsonb(m.permissions), 'monthly_report_shared', m.monthly_report_shared, 'by_patient', true, 'via', 'gift'), p_payer);
    perform private.circle_notify(p_payer, m.organisation_id, 'circle_shared_with_you', 'care_circle_members', m.id, array['in_app'], 'routine', m.is_test);
    return jsonb_build_object('ok', true, 'member_id', m.id, 'created', false, 'changed', true, 'permissions', to_jsonb(m.permissions));
  end if;

  if (select count(*) from public.care_circle_members where patient_id = v_uid and state = 'active' and expires_at > now())
       >= (cfg ->> 'max_members')::integer then
    raise exception 'circle_full' using errcode = 'P0001';
  end if;
  v_perms := array(select distinct x from unnest(p_permissions) x order by x);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at,
                                          monthly_report_shared, monthly_report_shared_at, is_test)
  values (pr.organisation_id, v_uid, p_payer, 'Supporter', v_perms, now() + make_interval(days => (cfg ->> 'default_grant_days')::integer),
          v_monthly, case when v_monthly then now() end, coalesce(pr.is_test, false))
  returning * into m;
  perform private.log_care_access(v_uid, 'granted', 'care_circle',
    jsonb_build_object('permissions', to_jsonb(m.permissions), 'monthly_report_shared', m.monthly_report_shared, 'by_patient', true, 'via', 'gift'), p_payer);
  perform private.circle_notify(p_payer, m.organisation_id, 'circle_shared_with_you', 'care_circle_members', m.id, array['in_app'], 'routine', m.is_test);
  return jsonb_build_object('ok', true, 'member_id', m.id, 'created', true, 'changed', true, 'permissions', to_jsonb(m.permissions));
end $$;

revoke all on function public.circle_gift_payers() from public, anon;
revoke all on function public.share_circle_with_gift_payer(uuid, text[], boolean) from public, anon;
grant execute on function public.circle_gift_payers() to authenticated;
grant execute on function public.share_circle_with_gift_payer(uuid, text[], boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.circle_gift_payers()', 'EXECUTE')
     or has_function_privilege('anon', 'public.share_circle_with_gift_payer(uuid, text[], boolean)', 'EXECUTE') then
    raise exception 'gift share: anon can execute a function';
  end if;
  if has_function_privilege('anon', 'public.dismiss_gift_payer_offer(uuid)', 'EXECUTE')
     or has_table_privilege('anon', 'public.care_circle_gift_payer_dismissals', 'SELECT')
     or has_table_privilege('authenticated', 'public.care_circle_gift_payer_dismissals', 'INSERT')
     or not (select relrowsecurity from pg_class where oid = 'public.care_circle_gift_payer_dismissals'::regclass) then
    raise exception 'gift share: the dismissal table or function is reachable by the wrong role';
  end if;
  if has_function_privilege('authenticated', 'private.circle_is_accepted_gift_payer(uuid, uuid)', 'EXECUTE') then
    raise exception 'gift share: the payer test is callable directly';
  end if;
  if 'attend_consultation' = any (private.circle_gift_share_permissions())
     or not private.circle_gift_share_permissions() <@ array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care', 'attend_consultation', 'doctor_note']::text[] then
    raise exception 'gift share: the permission list is wrong';
  end if;
end $$;
