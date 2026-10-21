-- S47b: Today screen cards, weekly summary gates and wearable readiness (v5 4.1, 4.5, 4.6). Design: docs/design/S47b.md.
-- One governed configuration table, `home_card_config`, SEEDED UNSIGNED AND INACTIVE. Until the Chief Medical Officer signs it, `my_home_card_config()`
-- returns nothing and the phone and web keep today's Today list exactly as it is; no new card, streak, weekly summary or readiness band shows.
-- LIVE COUNT BEFORE: no table of this name exists; no data is converted. No patient data is stored here, so no patient table, RLS-by-patient or registry row.
-- Nothing is signed here and no go-live guard is touched: the signature is the gate.

create function private.home_card_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_card jsonb; v_code text; v_seen text[] := '{}';
  v_codes constant text[] := array['task_due','medicines','readings','goal','lesson','assistant_nudge','streak','weekly_summary','readiness'];
  v_action constant text[] := array['task_due','medicines','readings','goal','lesson','assistant_nudge'];
begin
  -- Every comparison is written so that a MISSING key is false, never NULL (a NULL inside an IF counts as false and would let the config through).
  if coalesce(jsonb_typeof(p_config), '') <> 'object' then return false; end if;
  -- the hard ceiling: never more than two primary actions on the Today screen, whatever is signed
  if coalesce(jsonb_typeof(p_config -> 'max_primary_actions'), '') <> 'number' or (p_config ->> 'max_primary_actions')::numeric not in (1, 2) then return false; end if;
  if coalesce(jsonb_typeof(p_config -> 'cards'), '') <> 'array' or jsonb_array_length(p_config -> 'cards') = 0 then return false; end if;
  for v_card in select * from jsonb_array_elements(p_config -> 'cards') loop
    if coalesce(jsonb_typeof(v_card), '') <> 'object' then return false; end if;
    v_code := v_card ->> 'code';
    if v_code is null or not (v_code = any (v_codes)) or v_code = any (v_seen) then return false; end if;
    v_seen := v_seen || v_code;
    if coalesce(jsonb_typeof(v_card -> 'priority'), '') <> 'number' or (v_card ->> 'priority')::numeric < 0 or (v_card ->> 'priority')::numeric <> trunc((v_card ->> 'priority')::numeric) then return false; end if;
    if coalesce(jsonb_typeof(v_card -> 'primary_eligible'), '') <> 'boolean' then return false; end if;
    if (v_card ->> 'primary_eligible')::boolean and not (v_code = any (v_action)) then return false; end if;
    if coalesce(jsonb_typeof(v_card #> '{rules,goals_any}'), '') <> 'array' or coalesce(jsonb_typeof(v_card #> '{rules,pathways_any}'), '') <> 'array'
       or coalesce(jsonb_typeof(v_card #> '{rules,requires_device}'), '') <> 'boolean' then return false; end if;
    -- the lists hold non-empty words only, as the app's parser requires
    if exists (select 1 from jsonb_array_elements(v_card #> '{rules,goals_any}') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') = '')
       or exists (select 1 from jsonb_array_elements(v_card #> '{rules,pathways_any}') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') = '') then return false; end if;
  end loop;
  if coalesce(jsonb_typeof(p_config #> '{streak,enabled}'), '') <> 'boolean' then return false; end if;
  if coalesce(jsonb_typeof(p_config #> '{weekly,min_bp_readings}'), '') <> 'number' or (p_config #>> '{weekly,min_bp_readings}')::numeric < 1
     or (p_config #>> '{weekly,min_bp_readings}')::numeric <> trunc((p_config #>> '{weekly,min_bp_readings}')::numeric) then return false; end if;
  if (p_config #>> '{weekly,window_days}') is distinct from '7' then return false; end if;
  if coalesce(jsonb_typeof(p_config #> '{readiness,enabled}'), '') <> 'boolean' then return false; end if;
  if coalesce((p_config #>> '{readiness,min_signals}')::numeric, 0) not between 1 and 3 then return false; end if;
  if coalesce((p_config #>> '{readiness,min_baseline_days}')::numeric, 0) < 1
     or coalesce((p_config #>> '{readiness,min_baseline_days}')::numeric, 0) > coalesce((p_config #>> '{readiness,baseline_days}')::numeric, 0) then return false; end if;
  if coalesce((p_config #>> '{readiness,max_age_hours}')::numeric, 0) <= 0 or coalesce((p_config #>> '{readiness,sleep_drop_pct}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{readiness,hrv_drop_pct}')::numeric, 0) <= 0 or coalesce((p_config #>> '{readiness,hrv_rise_pct}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{readiness,resting_hr_rise_bpm}')::numeric, 0) <= 0 then return false; end if;
  return true;
exception when others then
  return false; -- a non-numeric value where a number belongs is simply not valid
end $$;
grant execute on function private.home_card_config_valid(jsonb) to authenticated;

create table public.home_card_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.home_card_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index home_card_config_one_active on public.home_card_config (is_active) where is_active;
alter table public.home_card_config enable row level security;
revoke all on public.home_card_config from public, anon, authenticated;
grant select on public.home_card_config to authenticated;
-- A patient gets the signed configuration only through my_home_card_config(); staff who sign it, and admin (read only), can read the table.
create policy home_card_config_read on public.home_card_config for select to authenticated
  using (exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create trigger refuse_superseded_activation before update of is_active on public.home_card_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- home-card-config-begin
insert into public.home_card_config (version, is_active, config, notes)
values (1, false, $json${
 "max_primary_actions": 2,
 "cards": [
  {"code": "task_due", "priority": 10, "primary_eligible": true, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "medicines", "priority": 20, "primary_eligible": true, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "readings", "priority": 30, "primary_eligible": true, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "goal", "priority": 40, "primary_eligible": true, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "lesson", "priority": 50, "primary_eligible": false, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "assistant_nudge", "priority": 60, "primary_eligible": false, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "streak", "priority": 70, "primary_eligible": false, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "weekly_summary", "priority": 80, "primary_eligible": false, "rules": {"goals_any": [], "pathways_any": [], "requires_device": false}},
  {"code": "readiness", "priority": 90, "primary_eligible": false, "rules": {"goals_any": [], "pathways_any": [], "requires_device": true}}
 ],
 "streak": {"enabled": true},
 "weekly": {"min_bp_readings": 3, "window_days": 7},
 "readiness": {"enabled": true, "max_age_hours": 36, "baseline_days": 14, "min_baseline_days": 5, "min_signals": 2, "sleep_drop_pct": 15, "hrv_drop_pct": 15, "hrv_rise_pct": 5, "resting_hr_rise_bpm": 5}
}$json$::jsonb,
        'PROPOSED, unsigned and INACTIVE. Cards, the weekly-summary minimum and the wearable readiness thresholds. The Today screen shows at most two primary actions whatever is signed. Readiness compares a person with her OWN recent days, is always labelled an estimate and is never a medical claim. CMO to confirm every number, then sign_home_card_config(). Until signed nothing in S47b shows.');
-- home-card-config-end

create function public.sign_home_card_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.home_card_config where id = p_id) then raise exception 'Home card config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the home card config'; end if;
  update public.home_card_config set is_active = false where is_active and id <> p_id;
  update public.home_card_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('home_card_config.signed', 'home_card_config', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_home_card_config(uuid) from public, anon;
grant execute on function public.sign_home_card_config(uuid) to authenticated;

-- The signed configuration, or null while nothing is signed. Any signed-in person may ask; it holds no patient data.
create function public.my_home_card_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cfg public.home_card_config%rowtype;
begin
  if (select auth.uid()) is null then return null; end if;
  select * into v_cfg from public.home_card_config where is_active and approved_by is not null;
  if not found then return null; end if;
  return jsonb_build_object('version', v_cfg.version, 'config', v_cfg.config);
end $$;
revoke all on function public.my_home_card_config() from public, anon;
grant execute on function public.my_home_card_config() to authenticated;

do $$
begin
  if (select count(*) from public.home_card_config where is_active) <> 0 then raise exception 'S47b: the home card config must be born inactive'; end if;
  if (select private.home_card_config_valid(config) from public.home_card_config where version = 1) is not true then raise exception 'S47b: the seeded config fails its own validator'; end if;
  if has_function_privilege('anon', 'public.my_home_card_config()', 'EXECUTE') then raise exception 'S47b: anon can read the config'; end if;
  if has_function_privilege('anon', 'public.sign_home_card_config(uuid)', 'EXECUTE') then raise exception 'S47b: anon can sign'; end if;
  if has_table_privilege('anon', 'public.home_card_config', 'SELECT') then raise exception 'S47b: anon can read the table'; end if;
  if private.home_card_config_valid(jsonb_set((select config from public.home_card_config where version = 1), '{max_primary_actions}', '3')) then raise exception 'S47b: a ceiling of 3 primary actions was accepted'; end if;
end $$;
