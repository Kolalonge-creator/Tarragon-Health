-- S09x2: staff identity in the patient's access log (founder decision 2026-10-13, resolves OQ-S09x-1; supersedes the OQ-281 hold).
--   A patient may now see THAT a staff member opened their record: the staff member's name and role, and when. Nothing else.
--   NOT shown: the reason, the basis ('tied'/'open'), the window end, after-hours, any category (reproductive_health or otherwise: a routine open
--   is the single generic category 'record_opened'), the staff id, contact details, organisation-internal fields, IP or device.
--   Break-glass (emergency_record_access_grants) keeps its existing rows and now also names the role when the actor is staff.
--   The access_log.show_staff_opens config key is no longer read (v1 is CMO-signed and says false; an agent never signs a new version).
--   It stays in the stored config as inert history. The live switch is access_log.show_staff_identity (see below).
--   Null-gate: a name comes ONLY from clinical_staff (never a bare profile, so an admin or support account is never named); no name -> role only; no
--   clinical_staff row -> 'Tarragon staff member' with no name. 'Care team' is NOT claimed: an 'open'-basis row is a clinician with no tie to the patient.
--   Role comes from clinical_staff.doctor_tier, never free text. Role/name are resolved as they are NOW, not snapshotted (follow-up: OQ-S09x-6).
--   Kill switch: my_health_config.access_log.show_staff_identity=false (absent = shown) hides the staff rows; show_staff_opens is ignored.
-- Live definition md5 of my_access_log read 2026-10-13 and matched the S09x file before this replacement. Signature, paging and grants unchanged.

create or replace function private.staff_public_profile(p_staff uuid) returns table (display_name text, role_label text)
language sql stable security definer set search_path = ''
as $$
  select nullif(btrim(cs.full_name), ''),
         case cs.doctor_tier
           when 'care_coordinator' then 'Care Coordinator'
           when 'senior_medical_officer' then 'Senior Medical Officer'
           when 'chief_medical_officer' then 'Chief Medical Officer'
           else null end
    from (select 1) one
    left join lateral (select s.full_name, s.doctor_tier from public.clinical_staff s where s.profile_id = p_staff order by s.active desc, s.created_at desc limit 1) cs on true
$$;
revoke all on function private.staff_public_profile(uuid) from public, anon, authenticated;

create or replace function public.my_access_log(p_limit integer default null, p_before timestamptz default null, p_before_id text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_cfg   jsonb := private.my_health_cfg('access_log');
  v_size  integer;
  -- Governed kill switch: absent means shown (founder decision 2026-10-13). A future CMO-signed my_health_config version can set show_staff_identity to false
  -- (for example if counsel's NDPA answer, OQ-S09x-2, goes against it) without a migration.
  v_show_staff boolean := case when jsonb_typeof(v_cfg -> 'show_staff_identity') = 'boolean' then (v_cfg ->> 'show_staff_identity')::boolean else true end;  -- a malformed value never breaks the whole log
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_size := least(greatest(coalesce(p_limit, (v_cfg ->> 'page_size')::integer, 50), 1), coalesce((v_cfg ->> 'max_page_size')::integer, 100));

  -- Keyset paging on (at, rid): rid is unique per source row, so rows sharing a timestamp (a wrong PIN and the lock it caused are written in one
  -- transaction) are never lost at a page boundary. Each source applies the cursor and its own limit first, so a long history is never scanned whole.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', e.at, 'rid', e.rid, 'kind', e.kind, 'actor_label', e.actor_label, 'actor_name', e.actor_name,
             'categories', e.categories, 'status', e.status, 'ends_at', e.ends_at) order by e.at desc, e.rid desc)
    from (
      select * from (
        (select l.looked_up_at as at, 'l:' || l.id::text as rid,
               case l.outcome when 'opened' then 'share_opened' when 'pin_wrong' then 'share_pin_wrong' else 'share_locked' end as kind,
               'Someone with your share link'::text as actor_label, null::text as actor_name,
               s.sections as categories, null::text as status, null::timestamptz as ends_at
          from public.record_share_lookups l join public.record_shares s on s.id = l.share_id
         where s.patient_id = v_uid and (p_before is null or l.looked_up_at < p_before or (p_before_id is not null and l.looked_up_at = p_before and ('l:' || l.id::text) < p_before_id))
         order by l.looked_up_at desc, l.id desc limit v_size)
        union all
        (select l.looked_up_at, 'c:' || l.id::text, 'emergency_card_opened', 'Someone with your emergency card link', null, array['emergency_card']::text[], null, null
          from public.emergency_card_lookups l join public.emergency_cards c on c.id = l.card_id
         where c.patient_id = v_uid and (p_before is null or l.looked_up_at < p_before or (p_before_id is not null and l.looked_up_at = p_before and ('c:' || l.id::text) < p_before_id))
         order by l.looked_up_at desc, l.id desc limit v_size)
        union all
        (select g.granted_at, 'g:' || g.id::text, 'emergency_access_grant', 'Person you allowed to use emergency access', p.full_name, array['emergency_access']::text[],
               case when g.revoked_at is not null then 'revoked' when g.expires_at <= now() then 'expired' else 'active' end,
               coalesce(g.revoked_at, g.expires_at)
          from public.emergency_access_grants g left join public.profiles p on p.id = g.grantee_user_id
         where g.profile_id = v_uid and (p_before is null or g.granted_at < p_before or (p_before_id is not null and g.granted_at = p_before and ('g:' || g.id::text) < p_before_id))
         order by g.granted_at desc, g.id desc limit v_size)
        union all
        (select g.granted_at, 'b:' || g.id::text, 'emergency_record_access',
               case when sp.role_label is not null then sp.role_label || ' using emergency access' else 'Clinician using emergency access' end,
               nullif(concat_ws(', ', coalesce(sp.display_name, p.full_name), o.name), ''), array['emergency_record']::text[],
               case when g.ended_at is not null then 'ended' when g.expires_at <= now() then 'expired' else 'active' end,
               coalesce(g.ended_at, g.expires_at)
          from public.emergency_record_access_grants g
          left join public.profiles p on p.id = g.requester_id
          left join public.organisations o on o.id = g.requester_org_id
          left join lateral private.staff_public_profile(g.requester_id) sp on true
         where g.patient_id = v_uid and (p_before is null or g.granted_at < p_before or (p_before_id is not null and g.granted_at = p_before and ('b:' || g.id::text) < p_before_id))
         order by g.granted_at desc, g.id desc limit v_size)
        union all
        (select e2.occurred_at, 'd:' || e2.id::text, 'delegated_access', 'Person you gave access to', p.full_name, array[coalesce(e2.scope, 'record')]::text[], null, null
          from public.care_access_events e2 left join public.profiles p on p.id = e2.actor_profile_id
         where e2.patient_id = v_uid and e2.kind in ('record_viewed', 'receipt_generated', 'acted_for') and (p_before is null or e2.occurred_at < p_before or (p_before_id is not null and e2.occurred_at = p_before and ('d:' || e2.id::text) < p_before_id))
         order by e2.occurred_at desc, e2.id desc limit v_size)
        union all
        (select o2.opened_at, 's:' || o2.id::text, 'staff_record_opened', coalesce(sp.role_label, 'Tarragon staff member'), sp.display_name,
               array['record_opened']::text[], null, null
          from public.staff_record_opens o2
          left join lateral private.staff_public_profile(o2.staff_id) sp on true
         where v_show_staff and o2.patient_id = v_uid and (p_before is null or o2.opened_at < p_before or (p_before_id is not null and o2.opened_at = p_before and ('s:' || o2.id::text) < p_before_id))
         order by o2.opened_at desc, o2.id desc limit v_size)
      ) u
      order by u.at desc, u.rid desc
      limit v_size
    ) e
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_access_log(integer, timestamptz, text) from public, anon;
grant execute on function public.my_access_log(integer, timestamptz, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_access_log(integer, timestamptz, text)', 'EXECUTE') then raise exception 'S09x2: anon can read the access log'; end if;
  if has_function_privilege('authenticated', 'private.staff_public_profile(uuid)', 'EXECUTE') then raise exception 'S09x2: staff_public_profile is callable by a client'; end if;
end $$;

comment on table public.staff_record_opens is 'S39c: append-only log of every staff opening of a patient record, and the window it grants for untied clinicians. Readable by the CMO and admins directly; the patient sees only the staff name, role and time through public.my_access_log() (S09x2).';
