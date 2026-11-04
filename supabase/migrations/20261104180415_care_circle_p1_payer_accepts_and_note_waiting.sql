-- Care Circle Phase 1, part 2 (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, items 1.7 and 1.13).
--
-- Live rows when this was written: 0 care_circle_members (so 0 gift-payer memberships) and 0 family_doctor_notes. Structural only.
-- Functions redefined from their LIVE bodies (2026-11-04), local replay confirmed identical first; changed lines are marked "P1".
--
--   1. The gift payer accepts first (founder decision D3, 2026-11-04). share_circle_with_gift_payer used to create an active membership
--      directly: the person who paid was added to someone's circle without ever saying yes. Every other way into a circle is an invite the
--      supporter accepts, so this one now is too. A new member row starts in state 'offered' (it grants nothing: every reader and the gate
--      require state = 'active'), the payer is told "you have been invited", and they accept or decline with
--      respond_to_circle_share_offer. Widening an EXISTING active membership is unchanged: that supporter already said yes once, and the
--      patient may always change what an existing supporter sees.
--   2. "A note from your doctor is waiting" (item 1.7). The patient was never told a doctor had written a line for their family; it only
--      showed if they happened to open the Care Circle page. A neutral notice now goes to the patient (in-app and push, no content), and
--      only when they have someone in their circle who could receive it.

-- ---------------------------------------------------------------------------
-- 1. Offered and declined states
-- ---------------------------------------------------------------------------
alter table public.care_circle_members drop constraint care_circle_members_state_check;
alter table public.care_circle_members add constraint care_circle_members_state_check
  check (state = any (array['active', 'revoked', 'expired', 'offered', 'declined']));
create unique index care_circle_one_offered_member on public.care_circle_members (patient_id, supporter_id) where state = 'offered';
comment on column public.care_circle_members.state is
  'active: can see what permissions allow. offered (P1, D3): the patient chose to share with a person who paid for their care, who has not '
  'yet accepted; grants nothing, expires_at is the deadline to answer. declined: that person said no. revoked / expired: ended.';

CREATE OR REPLACE FUNCTION public.share_circle_with_gift_payer(p_payer uuid, p_permissions text[], p_monthly_report boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      return jsonb_build_object('ok', true, 'member_id', ex.id, 'created', false, 'changed', false, 'offered', false, 'permissions', to_jsonb(ex.permissions));
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
    return jsonb_build_object('ok', true, 'member_id', m.id, 'created', false, 'changed', true, 'offered', false, 'permissions', to_jsonb(m.permissions));
  end if;

  -- P1 (D3): no active membership, so this is an OFFER the payer must accept. Nothing is visible to them until they do.
  v_perms := array(select distinct x from unnest(p_permissions) x order by x);
  select * into ex from public.care_circle_members
   where patient_id = v_uid and supporter_id = p_payer and state = 'offered' for update;
  if ex.id is not null and ex.expires_at <= now() then
    update public.care_circle_members set state = 'expired' where id = ex.id;   -- an unanswered offer that ran out
    ex := null;
  end if;
  if ex.id is not null then
    -- an open offer: the patient's latest choice replaces it, and the payer is not told twice
    update public.care_circle_members
       set permissions = v_perms, monthly_report_shared = v_monthly, monthly_report_shared_at = case when v_monthly then now() end
     where id = ex.id returning * into m;
    return jsonb_build_object('ok', true, 'member_id', m.id, 'created', false, 'changed', true, 'offered', true, 'permissions', to_jsonb(m.permissions));
  end if;

  if (select count(*) from public.care_circle_members where patient_id = v_uid and state = 'active' and expires_at > now())
       >= (cfg ->> 'max_members')::integer then
    raise exception 'circle_full' using errcode = 'P0001';
  end if;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, state, expires_at,
                                          monthly_report_shared, monthly_report_shared_at, is_test)
  values (pr.organisation_id, v_uid, p_payer, 'Supporter', v_perms, 'offered',
          now() + make_interval(days => (cfg ->> 'gift_decide_days')::integer),        -- the deadline to answer, not the length of access
          v_monthly, case when v_monthly then now() end, coalesce(pr.is_test, false))
  returning * into m;
  perform private.circle_notify(p_payer, m.organisation_id, 'circle_shared_with_you', 'care_circle_members', m.id, array['in_app', 'push'], 'routine', m.is_test);
  return jsonb_build_object('ok', true, 'member_id', m.id, 'created', true, 'changed', true, 'offered', true, 'permissions', to_jsonb(m.permissions));
end $function$;

-- the payer's list of open offers (first name only, the same as every other supporter screen)
create function public.my_circle_share_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', m.id, 'patient_id', m.patient_id,
           'name', coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'Someone'),
           'permissions', to_jsonb(m.permissions), 'monthly_report', m.monthly_report_shared,
           'offered_at', m.created_at, 'answer_by', m.expires_at) order by m.created_at desc), '[]'::jsonb)
    from public.care_circle_members m
    join public.profiles p on p.id = m.patient_id and p.is_active
    join public.profiles s on s.id = m.supporter_id and s.is_active
   where m.supporter_id = (select auth.uid()) and m.state = 'offered' and m.expires_at > now()
     and not private.circle_patient_is_minor(m.patient_id)
$$;
revoke all on function public.my_circle_share_offers() from public;
grant execute on function public.my_circle_share_offers() to authenticated;

create function public.respond_to_circle_share_offer(p_member uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  cfg jsonb := private.circle_rules();
  m public.care_circle_members%rowtype;
  pr public.profiles%rowtype;
begin
  if v_uid is null or p_accept is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into m from public.care_circle_members
   where id = p_member and supporter_id = v_uid and state = 'offered' and expires_at > now() for update;
  -- one answer for "not yours", "no such offer", "already answered" and "ran out"
  if m.id is null or private.circle_patient_is_minor(m.patient_id)
     or not exists (select 1 from public.profiles where id = v_uid and is_active) then
    raise exception 'circle_offer_not_found' using errcode = 'P0002';
  end if;
  if not p_accept then
    update public.care_circle_members set state = 'declined' where id = m.id;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  if (select count(*) from public.care_circle_members where patient_id = m.patient_id and state = 'active' and expires_at > now())
       >= (cfg ->> 'max_members')::integer then
    raise exception 'circle_full' using errcode = 'P0001';
  end if;
  update public.care_circle_members
     set state = 'active', expires_at = now() + make_interval(days => (cfg ->> 'default_grant_days')::integer)
   where id = m.id returning * into m;
  -- the same consent record an accepted invite creates (private.grant_circle_consent_on_member fires on INSERT only)
  select * into pr from public.profiles where id = m.patient_id;
  if pr.organisation_id is not null then
    perform private.record_consent_cell(m.patient_id, pr.organisation_id, pr.is_test, 'vitals', 'care_circle_sharing', true, 'circle_invite', null, m.patient_id);
  end if;
  perform private.log_care_access(m.patient_id, 'granted', 'care_circle',
    jsonb_build_object('permissions', to_jsonb(m.permissions), 'monthly_report_shared', m.monthly_report_shared, 'via', 'gift_offer'), v_uid);
  perform private.circle_notify(m.patient_id, m.organisation_id, 'circle_joined', 'care_circle_members', m.id, array['in_app'], 'routine', m.is_test);
  return jsonb_build_object('ok', true, 'accepted', true, 'patient_id', m.patient_id);
end $$;
revoke all on function public.respond_to_circle_share_offer(uuid, boolean) from public;
grant execute on function public.respond_to_circle_share_offer(uuid, boolean) to authenticated;

-- the patient's view: payers with an open offer are shown as waiting, not offered again
CREATE OR REPLACE FUNCTION public.circle_gift_payers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.circle_patient_is_minor(v_uid) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('payer_id', g.payer, 'first_name', g.first_name, 'entitlement_ids', to_jsonb(g.ents),
                                        'last_gift_at', g.last_at, 'is_member', g.is_member,
                                        'offer_pending', g.offer_pending) order by g.last_at desc)          -- P1 (D3)
      from (
        select o.buyer_profile_id as payer,
               nullif(split_part(btrim(coalesce(bp.full_name, '')), ' ', 1), '') as first_name,
               array_agg(e.id order by e.decided_at) as ents,
               max(e.decided_at) as last_at,
               exists (select 1 from public.care_circle_members m where m.patient_id = v_uid and m.supporter_id = o.buyer_profile_id
                          and m.state = 'active' and m.expires_at > now()) as is_member,
               exists (select 1 from public.care_circle_members m where m.patient_id = v_uid and m.supporter_id = o.buyer_profile_id
                          and m.state = 'offered' and m.expires_at > now()) as offer_pending                 -- P1 (D3)
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
end $function$;

-- the patient's circle page lists open offers next to invites, as "waiting"
CREATE OR REPLACE FUNCTION public.my_care_circle()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at,
                'monthly_report_shared', m.monthly_report_shared, 'missed_dose_alert', m.missed_dose_alert)
                order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.id, 'hint', i.invitee_hint, 'kind', i.invitee_kind,
                'relationship', i.relationship, 'permissions', to_jsonb(i.permissions), 'expires_at', i.expires_at, 'state', 'waiting') order by i.created_at)
              from public.care_circle_invites i
             where i.patient_id = (select auth.uid()) and i.state = 'pending' and i.expires_at > now()), '[]'::jsonb),
    -- P1 (D3): a share with a person who paid, waiting for them to accept
    'offers', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id,
                'name', coalesce(nullif(split_part(btrim(coalesce(s.full_name, '')), ' ', 1), ''), 'A supporter'),
                'permissions', to_jsonb(m.permissions), 'answer_by', m.expires_at, 'state', 'waiting') order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'offered' and m.expires_at > now()), '[]'::jsonb),
    'pause', (select jsonb_build_object('paused_until', p.paused_until, 'pause_alerts', p.pause_alerts)
                from public.care_circle_pauses p where p.patient_id = (select auth.uid()) and p.paused_until > now()),
    'pause_days', (private.circle_rules() ->> 'pause_days')::integer)
$function$;

-- the patient may withdraw an offer before it is answered (the same control they have over a pending invite)
create function public.withdraw_circle_share_offer(p_member uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  update public.care_circle_members set state = 'expired'
   where id = p_member and patient_id = (select auth.uid()) and state = 'offered'
   returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.withdraw_circle_share_offer(uuid) from public;
grant execute on function public.withdraw_circle_share_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "A note from your doctor is waiting"
-- ---------------------------------------------------------------------------
create function private.family_note_tell_patient() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- only worth saying when someone in their circle could receive it; otherwise the note simply waits on their Care Circle page
  if exists (select 1 from public.care_circle_members m
              where m.patient_id = new.patient_id and m.state = 'active' and m.expires_at > now() and 'doctor_note' = any (m.permissions)) then
    begin
      perform private.circle_notify(new.patient_id, new.organisation_id, 'family_note_waiting', 'family_doctor_notes', new.id,
                                    array['in_app', 'push'], 'routine', new.is_test);
    exception when others then
      -- a failed notice must never undo the doctor's note; the card on the Care Circle page still shows it
      raise warning 'family note % saved, but telling the patient failed: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
create trigger family_doctor_notes_tell_patient after insert on public.family_doctor_notes
  for each row execute function private.family_note_tell_patient();

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.respond_to_circle_share_offer(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_circle_share_offers()', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_circle_share_offer(uuid)', 'EXECUTE') then
    raise exception 'P1 self-check: anon can execute a gift-offer function';
  end if;
  if position('''offered''' in pg_get_functiondef('public.share_circle_with_gift_payer(uuid, text[], boolean)'::regprocedure)) = 0 then
    raise exception 'P1 self-check: share_circle_with_gift_payer still creates an active membership';
  end if;
end $$;
