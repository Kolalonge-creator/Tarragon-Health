-- Care Circle Phase 4 (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, Phase 4; spec sections 11 and 13).
--
--   1. Primary and backup family contact (spec 13.1). The patient may name one person in their circle as their main family contact and one
--      as backup. It is a label for patient-authorised coordination: it grants NOTHING (every reader still checks the same permissions), and
--      it is not an emergency contact (that stays the separate emergency-contact record). Shown to the patient and to that person.
--   2. A family timeline (spec 11): public.circle_supporter_timeline, a read-time list of the last 90 days of events the supporter may
--      see, built from the same sources and permissions as the blocks: a doctor's note released, an appointment attended or missed (never
--      a sensitive one), an everyday test requested / reviewed (allow-list), a help request asked for or done (only requests the reader may
--      see). No event table, no free text, no value. Each event says whether it came from a clinician, the patient or the system.
--   3. Roles (spec 13): no new role field. The existing presets ("Can see", "Can see and help") already label each person, and a role must
--      never grant anything a permission does not; the screens show the preset.
--   4. The shared-tasks module description no longer says "no free text" (Phase 3 added the patient's 140-character note).
-- Functions redefined from their LIVE bodies (2026-11-04, after Phases 1-3 and D5); changed lines are marked "P4". Live rows: 0 members.

-- ---------------------------------------------------------------------------
-- 1. Main and backup family contact
-- ---------------------------------------------------------------------------
alter table public.care_circle_members add column contact_role text check (contact_role in ('primary', 'backup'));
create unique index care_circle_one_primary_contact on public.care_circle_members (patient_id) where state = 'active' and contact_role = 'primary';
create unique index care_circle_one_backup_contact on public.care_circle_members (patient_id) where state = 'active' and contact_role = 'backup';
comment on column public.care_circle_members.contact_role is
  'Care Circle P4: the patient''s main (primary) or backup family contact. A label only: grants nothing, and is not an emergency contact.';

alter table public.care_circle_permission_history drop constraint care_circle_permission_history_changes_check;
alter table public.care_circle_permission_history add constraint care_circle_permission_history_changes_check
  check (cardinality(changes) >= 1 and changes <@ array[
    'added', 'offered', 'accepted', 'declined', 'withdrawn', 'offer_lapsed', 'permissions_changed', 'renewed', 'revoked', 'expired',
    'monthly_report_on', 'monthly_report_off', 'missed_dose_alert_on', 'missed_dose_alert_off',
    'paused', 'resumed', 'doctor_note_shared', 'doctor_note_withdrawn',
    'contact_primary', 'contact_backup', 'contact_cleared']::text[]);

CREATE OR REPLACE FUNCTION private.care_circle_members_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_changes text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_changes := array[case when new.state = 'active' then 'added' else new.state end];
  else
    if new.state is distinct from old.state then
      v_changes := v_changes || case
        when new.state = 'active' and old.state = 'offered' then 'accepted'
        when new.state = 'expired' and old.state = 'offered' then 'offer_lapsed'
        when new.state in ('revoked', 'expired', 'declined', 'withdrawn', 'offered') then new.state
        else 'permissions_changed' end;
    end if;
    if new.permissions is distinct from old.permissions and not (new.permissions @> old.permissions and old.permissions @> new.permissions) then
      v_changes := v_changes || 'permissions_changed'::text;
    end if;
    if new.expires_at is distinct from old.expires_at and new.state = old.state and new.expires_at > old.expires_at then
      v_changes := v_changes || 'renewed'::text;
    end if;
    if new.monthly_report_shared is distinct from old.monthly_report_shared then
      v_changes := v_changes || case when new.monthly_report_shared then 'monthly_report_on' else 'monthly_report_off' end;
    end if;
    if new.missed_dose_alert is distinct from old.missed_dose_alert then
      v_changes := v_changes || case when new.missed_dose_alert then 'missed_dose_alert_on' else 'missed_dose_alert_off' end;
    end if;
    if new.contact_role is distinct from old.contact_role then                                                          -- P4
      v_changes := v_changes || case new.contact_role when 'primary' then 'contact_primary' when 'backup' then 'contact_backup' else 'contact_cleared' end;
    end if;
  end if;
  if cardinality(v_changes) = 0 then return new; end if;
  insert into public.care_circle_permission_history
    (organisation_id, patient_id, member_id, supporter_id, actor_id, actor_role, changes, permissions, previous_permissions, state, expires_at, is_test)
  values
    (new.organisation_id, new.patient_id, new.id, new.supporter_id, private.circle_history_actor(),
     private.circle_history_actor_role(new.patient_id, new.supporter_id),
     array(select distinct c from unnest(v_changes) c), new.permissions,
     case when tg_op = 'UPDATE' then old.permissions end, new.state, new.expires_at, coalesce(new.is_test, false));
  return new;
end $function$;

create function public.set_circle_contact_role(p_member uuid, p_role text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.care_circle_members%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if p_role is not null and p_role not in ('primary', 'backup') then raise exception 'contact_role_invalid' using errcode = '22023'; end if;
  select * into m from public.care_circle_members
   where id = p_member and patient_id = v_uid and state = 'active' and expires_at > now() for update;
  if m.id is null then return false; end if;
  if p_role is not null then
    -- one main and one backup: whoever held this label before loses it
    update public.care_circle_members set contact_role = null
     where patient_id = v_uid and state = 'active' and contact_role = p_role and id <> m.id;
  end if;
  update public.care_circle_members set contact_role = p_role where id = m.id;
  return true;
end $$;
revoke all on function public.set_circle_contact_role(uuid, text) from public;
grant execute on function public.set_circle_contact_role(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.my_care_circle()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at,
                'monthly_report_shared', m.monthly_report_shared, 'missed_dose_alert', m.missed_dose_alert,
                'contact_role', m.contact_role)   -- P4
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

CREATE OR REPLACE FUNCTION public.circle_supporter_view(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.care_circle_members%rowtype;
  v_name text;
  out jsonb;
begin
  -- W-11: a Care Circle is for adults; an under-18 patient's page is "not found", the same answer a stranger gets
  if private.circle_patient_is_minor(p_patient) then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  m := private.circle_member_for(p_patient);
  if m.id is null then
    -- a paused circle: only the right to pay is left, and nothing says why. Anyone else gets the same "not found" as before.
    m := private.circle_member_for(p_patient, 'pay_for_care');
    if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                              'permissions', to_jsonb(array['pay_for_care']), 'shared_until', m.expires_at, 'can_pay', true);
  end if;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at,
                            'contact_role', m.contact_role)                                                              -- P4
         || private.circle_view_blocks(p_patient, m.permissions);
  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', to_jsonb(m.permissions)), m.supporter_id);
  return out;
end $function$;

-- the patient's preview of one member stays exactly what that member sees (the S29c proof holds it to that)
CREATE OR REPLACE FUNCTION public.circle_preview_member(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.care_circle_members%rowtype; v_name text;
begin
  select * into m from public.care_circle_members
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now();
  if not found then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = m.patient_id;
  perform set_config('tarragon.circle_preview_member', m.id::text, true);
  return jsonb_build_object('patient_id', m.patient_id, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at, 'preview', true,
                            'alert_sample', 'red_alerts' = any (m.permissions),
                            'contact_role', m.contact_role)   -- P4: the preview stays exactly what the supporter sees
         || private.circle_view_blocks(m.patient_id, m.permissions);
end $function$;

-- ---------------------------------------------------------------------------
-- 2. The family timeline
-- ---------------------------------------------------------------------------
create function public.circle_supporter_timeline(p_patient uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  v_perms text[];
  v_since timestamptz := now() - interval '90 days';
  out jsonb := '[]'::jsonb;
begin
  m := private.circle_member_for(p_patient);   -- the gate: active, unexpired, adult, supporter active, not paused
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  v_perms := private.circle_consented_permissions(p_patient, m.permissions);

  select coalesce(jsonb_agg(x.e order by (x.e ->> 'at') desc), '[]'::jsonb) into out from (
    -- a doctor's note the patient released
    select jsonb_build_object('at', n.released_at, 'kind', 'doctor_note_shared', 'source', 'clinician') e
      from public.family_doctor_notes n
     where 'doctor_note' = any (v_perms) and n.patient_id = p_patient and n.released_at > v_since
    union all
    -- an appointment attended or missed (never a sensitive one)
    select jsonb_build_object('at', a.scheduled_for, 'kind', case when a.status = 'no_show' then 'appointment_missed' else 'appointment_attended' end, 'source', 'system')
      from public.appointments a
     where 'appointments' = any (v_perms) and a.patient_id = p_patient and a.scheduled_for > v_since and a.scheduled_for <= now()
       and a.status in ('completed', 'no_show') and private.circle_appointment_shareable(a.appointment_type, a.reason, a.service)
    union all
    -- an everyday test requested
    select jsonb_build_object('at', o.created_at, 'kind', 'test_requested', 'code', st.code, 'source', 'system')
      from public.lab_orders o join public.screening_schedules ss on ss.id = o.screening_schedule_id join public.screen_types st on st.id = ss.screen_type_id
     where 'investigation_status' = any (v_perms) and o.patient_id = p_patient and o.created_at > v_since and o.status <> 'cancelled'
       and private.circle_screen_shareable(st.code, st.sensitive)
    union all
    -- an everyday test a doctor reviewed and released
    select jsonb_build_object('at', r.released_at, 'kind', 'test_reviewed', 'code', st.code, 'source', 'clinician')
      from public.lab_results r join public.lab_orders o on o.id = r.lab_order_id
      join public.screening_schedules ss on ss.id = o.screening_schedule_id join public.screen_types st on st.id = ss.screen_type_id
     where 'investigation_status' = any (v_perms) and r.patient_id = p_patient and r.release_state = 'released' and r.reviewed_at is not null
       and r.released_at > v_since and r.withdrawn_at is null and private.circle_screen_shareable(st.code, st.sensitive)
    union all
    -- a help request this reader may see: asked for, and done
    select jsonb_build_object('at', t.created_at, 'kind', 'help_requested', 'code', t.kind, 'source', 'patient')
      from public.care_circle_tasks t
     where t.patient_id = p_patient and t.created_at > v_since and private.module_enabled('care_circle_tasks') and private.circle_task_access(t) is not null
    union all
    select jsonb_build_object('at', t.done_at, 'kind', 'help_done', 'code', t.kind, 'source', 'patient')
      from public.care_circle_tasks t
     where t.patient_id = p_patient and t.state = 'done' and t.done_at > v_since and private.module_enabled('care_circle_tasks')
       and private.circle_task_access(t) is not null
  ) x;
  if jsonb_array_length(out) > 50 then
    out := (select jsonb_agg(v order by o) from jsonb_array_elements(out) with ordinality s(v, o) where o <= 50);
  end if;
  if jsonb_array_length(out) > 0 then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('timeline')), m.supporter_id);
  end if;
  return out;
end $$;
revoke all on function public.circle_supporter_timeline(uuid) from public;
grant execute on function public.circle_supporter_timeline(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The module description
-- ---------------------------------------------------------------------------
update public.platform_modules
   set description = 'Help requests inside a circle: the patient asks chosen people (or everyone who helps) for practical help, with a fixed '
                     'kind, a date and an optional 140-character note written by the patient; a person can say they can help, cannot help, or '
                     'mark it done. No chat. Never an emergency route.'
 where key = 'care_circle_tasks';

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.set_circle_contact_role(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.circle_supporter_timeline(uuid)', 'EXECUTE') then
    raise exception 'P4 self-check: anon can execute a Phase 4 function';
  end if;
end $$;
