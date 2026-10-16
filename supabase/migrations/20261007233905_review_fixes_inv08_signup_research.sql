-- Code review fixes (2026-10-07), as a follow-up because the migrations they correct are already applied.
--
-- 1. INV-08 (20261007214438): suppressing the final sms hop of a CRITICAL alert left it neither failed nor sent, so the escalation engine
--    (private.escalate_unconfirmed_critical_notifications) never recorded exhaustion or raised its admin alarm and an unconfirmed critical
--    alert silently ended. A critical sms/voice row now ends as FAILED, exactly as it did when no SMS provider was configured, so the alarm
--    path still fires; other sms/voice rows stay suppressed.
-- 2. Signup invite (20261007231528): a phone invite and the sponsor-paid-phone carve-out were also matched against the phone typed into user
--    metadata on the email sign-up path, which nobody has verified. Only the phone identity GoTrue itself verified (auth.users.phone) is matched now.
-- 3. Research export (20261007212611): data recorded before the person gave research consent is no longer released (only snapshots computed
--    after the day they agreed), and a month value shared by fewer participants than the protocol's minimum is released as empty so one person
--    cannot be singled out by a rare enrolment or computed month.

create or replace function private.suppress_sms_voice_notifications() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.channel in ('sms', 'voice') and new.status = 'pending' then
    if new.priority = 'critical' then
      new.status := 'failed';
      new.failed_at := now();
    else
      new.status := 'suppressed';
    end if;
    new.last_error := 'INV-08: sms and voice are not used for notifications; push, email and in-app only (verification codes use the auth hook)';
  end if;
  return new;
end $$;
revoke all on function private.suppress_sms_voice_notifications() from public, anon, authenticated;

create or replace function private.signup_permitted(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  return private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code') is not null;
end $$;

create or replace function private.signup_may_create_user(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); v_id uuid; v_claimed uuid;
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  v_id := private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code');
  if v_id is null then return false; end if;
  update public.signup_invites set uses = uses + 1, last_used_at = now()
   where id = v_id and revoked_at is null and expires_at > now() and uses < max_uses
   returning id into v_claimed;
  return v_claimed is not null;
end $$;

create or replace function public.run_research_export(p_protocol_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_p public.research_protocols%rowtype;
  v_rows jsonb;
  v_n integer; v_people integer; v_hash text; v_id uuid;
  v_all text[] := array['pathway_code', 'day', 'enrolment_month', 'bp_avg_7d_sys', 'bp_avg_7d_dia', 'bp_readings_7d', 'bp_status',
                        'target_source', 'adherence_pct', 'adherence_doses_due', 'config_version', 'computed_month'];
begin
  if not private.is_active_clinical_director() then raise exception 'not authorised: only the Chief Medical Officer runs a research export' using errcode = '42501'; end if;
  if not private.go_live_guard_on('research_export_enabled') then raise exception 'research export is switched off'; end if;
  select * into v_p from public.research_protocols where id = p_protocol_id and status = 'approved';
  if not found then raise exception 'the protocol is missing or not approved'; end if;
  if not (v_p.allowed_fields <@ v_all) then raise exception 'the protocol lists a field that is not on the allow-list'; end if;

  with elig as (
    select o.*, s.patient_id
    from analytics.v_outcome_snapshots o
    join analytics.subjects s on s.subject_key = o.subject_key
    join public.patient_consent_state c on c.patient_id = s.patient_id and c.consent_type_code = 'research' and c.granted and c.withdrawn_at is null
    -- only data recorded AFTER the person agreed: nothing collected before their consent is released (the day they agreed is left out too)
    where o.organisation_id = v_p.organisation_id
      and private.research_eligible(s.patient_id, v_p.id)
      and o.computed_on > (c.granted_at at time zone 'UTC')::date
  ), enrol_n as (
    select enrolment_month m, count(distinct subject_key) n from elig group by 1
  ), month_n as (
    select date_trunc('month', computed_on::timestamp)::date m, count(distinct subject_key) n from elig group by 1
  ), shaped as (
    select encode(extensions.digest(e.subject_key::text || ':' || v_p.id::text, 'sha256'), 'hex') as participant,
           to_jsonb(e)
             -- a month value shared by fewer participants than the protocol's minimum would single someone out: it is released as empty
             || jsonb_build_object('enrolment_month', case when en.n >= v_p.min_cell_size then to_jsonb(e.enrolment_month) else 'null'::jsonb end)
             || jsonb_build_object('computed_month', case when mn.n >= v_p.min_cell_size then to_jsonb(date_trunc('month', e.computed_on::timestamp)::date) else 'null'::jsonb end) as j
    from elig e
    join enrol_n en on en.m = e.enrolment_month
    join month_n mn on mn.m = date_trunc('month', e.computed_on::timestamp)::date
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('participant', participant) ||
           (select coalesce(jsonb_object_agg(k, sh.j -> k), '{}'::jsonb) from unnest(v_p.allowed_fields) k)
           order by participant), '[]'::jsonb),
         count(*), count(distinct participant)
  into v_rows, v_n, v_people
  from shaped sh;

  if v_people < v_p.min_cell_size then
    raise exception 'too few participants to release (% found, at least % needed): nothing was exported', v_people, v_p.min_cell_size;
  end if;
  v_hash := encode(extensions.digest(v_rows::text, 'sha256'), 'hex');
  insert into public.research_exports (protocol_id, organisation_id, requested_by, row_count, participant_count, fields, content_sha256)
  values (v_p.id, v_p.organisation_id, v_actor, v_n, v_people, v_p.allowed_fields, v_hash) returning id into v_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'research_export.created', 'research_exports', v_id,
          jsonb_build_object('protocol_id', v_p.id, 'row_count', v_n, 'participant_count', v_people, 'sha256', v_hash));
  perform private.emit_domain_event('research_export.created', v_p.organisation_id,
    jsonb_build_object('export_id', v_id, 'protocol_id', v_p.id, 'row_count', v_n),
    'research_export.created:' || v_id, null, 'research_exports', v_id);
  return jsonb_build_object('export_id', v_id, 'fields', to_jsonb(v_p.allowed_fields), 'rows', v_rows, 'sha256', v_hash);
end $$;
