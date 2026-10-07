-- S47 (decisions applied, chat selections 2026-10-07; decisions 3 of the S45 list and share-link defaults). NOT signatures.
--
-- What this does:
--   1. Share links (S43): record_share_config v2 (PROPOSED) adds default_max_views = 10 (a link is view-capped by default; the person may choose up to
--      1000), keeps 72 h default expiry, 720 h (30 day) ceiling, optional PIN, instant revoke. create_record_share restated to apply the default cap.
--      Sensitive sections stay excluded unless chosen: the closed set never contained mental or reproductive health, and no section is pre-selected.
--   2. S45 risk band actions as UNSIGNED versioned config: risk_instrument_versions v2 for who_cvd_2019_wssa = v1 config plus bandActions. The
--      instrument itself stays held (coefficients missing, sign_risk_instrument refuses it). The app never prescribes (INV-02): the actions say
--      "review", never "start a medicine". Thresholds are NOT verified against WHO PEN / HEARTS.

alter table public.record_share_config add column if not exists default_max_views integer check (default_max_views is null or default_max_views between 1 and 1000);

update public.record_share_config set is_active = false where is_active and version <> 2;
insert into public.record_share_config (version, default_hours, max_hours, max_pin_attempts, min_pin_length, default_max_views, status, is_active, note)
values (2, 72, 720, 5, 4, 10, 'proposed', true, 'S47 chat selections 2026-10-07 (not a signature): 72 hour default expiry, optional PIN, default view cap 10, 30 day maximum lifetime, instant revoke.')
on conflict (version) do nothing;

create or replace function public.create_record_share(
  p_sections text[],
  p_expires_in_hours integer default null,
  p_pin text default null,
  p_max_views integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id uuid := (select auth.uid());
  v_org_id uuid;
  v_cfg public.record_share_config;
  v_hours integer;
  v_views integer;
  v_token text;
  v_share public.record_shares;
  v_allowed text[] := array['vitals', 'medications', 'conditions', 'allergies', 'lab_results', 'vaccinations', 'emergency_info', 'procedures', 'family_history'];
begin
  if v_patient_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select organisation_id into v_org_id from public.profiles where id = v_patient_id;
  if v_org_id is null then
    raise exception 'profile not found';
  end if;
  v_cfg := private.record_share_setting();
  if v_cfg.version is null then
    raise exception 'record sharing has no active configuration' using errcode = '55000';
  end if;
  if p_sections is null or cardinality(p_sections) = 0 then
    raise exception 'at least one section must be selected';
  end if;
  if not (p_sections <@ v_allowed) then
    raise exception 'invalid section in list: allowed are %', array_to_string(v_allowed, ', ');
  end if;
  v_hours := coalesce(p_expires_in_hours, v_cfg.default_hours);
  if v_hours < 1 or v_hours > v_cfg.max_hours then
    raise exception 'expires_in_hours must be between 1 and %', v_cfg.max_hours;
  end if;
  if p_pin is not null then
    if p_pin !~ '^[0-9]+$' or char_length(p_pin) < v_cfg.min_pin_length or char_length(p_pin) > 8 then
      raise exception 'the PIN must be % to 8 digits', v_cfg.min_pin_length;
    end if;
  end if;
  -- S47 (decision 4): a link is capped by default (record_share_config.default_max_views, 10); the person may pick a different number up to 1000.
  v_views := coalesce(p_max_views, v_cfg.default_max_views);
  if v_views is not null and (v_views < 1 or v_views > 1000) then
    raise exception 'the view limit must be between 1 and 1000';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.record_shares
    (organisation_id, patient_id, token, token_hash, sections, expires_at, pin_hash, max_views, config_version)
  values
    (v_org_id, v_patient_id, null, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_sections,
     now() + make_interval(hours => v_hours),
     case when p_pin is null then null else extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) end,
     v_views, v_cfg.version)
  returning * into v_share;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (v_org_id, v_patient_id, 'record_share.created', 'record_shares', v_share.id,
          jsonb_build_object('sections', to_jsonb(p_sections), 'expires_at', v_share.expires_at, 'has_pin', p_pin is not null, 'max_views', v_views),
          v_patient_id);

  -- the token is shown to the patient once, here, and exists nowhere in the database after this call
  return jsonb_build_object('id', v_share.id, 'token', v_token, 'sections', v_share.sections, 'expires_at', v_share.expires_at,
                            'created_at', v_share.created_at, 'has_pin', p_pin is not null, 'max_views', v_views);
end;
$$;


-- risk-band-actions-begin
insert into public.risk_instrument_versions (code, version, notes, config)
select 'who_cvd_2019_wssa', 2,
  'PROPOSED, UNSIGNED. v1 plus bandActions (S47, chat selections 2026-10-07, not a signature). Coefficients are still missing, so this version cannot be signed. The action thresholds are not verified against WHO PEN / HEARTS. The app never prescribes: every action says review.',
  v1.config || jsonb_build_object('bandActions', $json${
 "appPrescribes": false,
 "thresholdsStatus": "unverified_against_who_pen_hearts",
 "bands": {
  "lt5": {
   "copyKey": "risk.action.lt5",
   "lifestyleAdvice": true,
   "reassessMonths": 12
  },
  "5to10": {
   "copyKey": "risk.action.5to10",
   "lifestyleAdvice": true,
   "bpCheckEveryMonths": 6
  },
  "10to20": {
   "copyKey": "risk.action.10to20",
   "careTeamReviewWithinWeeks": 4,
   "recheckEveryMonths": 3,
   "doctorDecidesAboutMedicines": true
  },
  "20to30": {
   "copyKey": "risk.action.20to30",
   "doctorReviewWithinWeeks": 2,
   "recheckEveryMonths": 3
  },
  "ge30": {
   "copyKey": "risk.action.ge30",
   "doctorReviewWithinWeeks": 1
  }
 }
}$json$::jsonb)
from public.risk_instrument_versions v1 where v1.code = 'who_cvd_2019_wssa' and v1.version = 1;
-- risk-band-actions-end

do $$
begin
  if (select default_max_views from public.record_share_config where is_active) is distinct from 10 then raise exception 'S47 self-check: the active share config must cap views at 10'; end if;
  if (select count(*) from public.record_share_config where is_active) <> 1 then raise exception 'S47 self-check: exactly one share config must be active'; end if;
  if exists (select 1 from public.risk_instrument_versions where version = 2 and (is_active or approved_by is not null)) then raise exception 'S47 self-check: instrument v2 must be unsigned'; end if;
  if private.risk_instrument_signed('who_cvd_2019_wssa') then raise exception 'S47 self-check: the instrument must stay unsigned'; end if;
end $$;
