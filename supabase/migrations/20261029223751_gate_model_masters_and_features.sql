-- G-01 (founder decision 2026-10-29): one gate model. Masters and features.
--
-- WHY. Counted live on 2026-10-29: 92 go-live guards (6 on), 29 platform modules, 13 feature flags, 44 governed configuration
-- tables that refuse to go live unsigned, 90 sign/approve/activate functions, 62 sign-off panels on the CMO hub, 338 registry
-- values still marked "proposed" and 834 open-question ids. Every new feature produced a guard, a config version to sign, a hub
-- panel, a registry entry and an open question, each needing a round trip with the founder, who is also the CMO. 27 of the 86
-- dark guards could never be switched on at all: no condition branch was ever written for them (`unknown_guard`), so the switch
-- function refused every attempt. Almost all of the 86 protect something a real patient cannot reach anyway, because the master
-- switches (sign-up, checkout, clinical operations, prescribing, payouts) are off.
--
-- WHAT CHANGES. A guard now has a `kind`:
--   master  : one of nine real decisions. Exactly as before: its own role switches it on, every condition must be met, a note.
--   feature : everything else. Open when its row is on, it is not held, and its master (parent_key, if any) is on. An admin or the
--             CMO switches it either way; no condition is evaluated; switching it OFF needs a reason of at least 20 characters,
--             kept in held_reason so the go-live page can say why it is closed. Nothing on the CMO hub is created by a feature.
-- `private.go_live_guard_on` is the one lookup every other guard helper and trigger builds on (the test-pair and test-patient
-- bypasses sit above it), so the parent rule applies everywhere at once.
--
-- WHAT DOES NOT CHANGE IN THIS MIGRATION. No row is switched on here. A feature that is off today stays off until an admin or the
-- CMO opens it from the go-live page (one click, attributed, logged), so the CI replay and every existing proof keep their meaning,
-- and the live opening is a recorded human act rather than a migration. The insert rule (a guard is created switched off) is kept.
-- Masters keep their conditions, their role and the maker-checker and ops-desk triggers that name them.
--
-- HELD. A feature that genuinely cannot run yet (no content, no certificate, no scheduled job, no moderator) carries a held_reason
-- that says so in plain words. That is a readiness fact, not a governance gate: it is cleared by the person who opens the feature.
--
-- Design note and the full mapping: docs/design/GATE-MODEL.md. Proof: packages/db/tests/gate_model_masters_and_features.sql.
-- Read live with pg_get_functiondef on 2026-10-29 before replacing go_live_guard_on, set_go_live_guard, go_live_guard_status and
-- go_live_guards_guard; each repeats the live body plus the change marked "G-01".

-- ---------------------------------------------------------------------------
-- 1. The shape
-- ---------------------------------------------------------------------------
alter table public.go_live_guards
  add column kind text not null default 'feature' check (kind in ('master', 'feature')),
  add column parent_key text references public.go_live_guards (key) on delete restrict,
  add column held_reason text check (held_reason is null or length(btrim(held_reason)) >= 20);

alter table public.go_live_guards
  add constraint go_live_guards_master_has_no_parent check (kind <> 'master' or parent_key is null),
  add constraint go_live_guards_not_own_parent check (parent_key is distinct from key),
  add constraint go_live_guards_open_is_not_held check (not (is_on and held_reason is not null));

comment on column public.go_live_guards.kind is
  'G-01. master: a real decision (nine of them), switched by its role once every condition is met. feature: open when on, not held, and its parent (if any) is on; an admin or the CMO switches it, no condition is evaluated.';
comment on column public.go_live_guards.parent_key is
  'G-01. The master this feature is unreachable without. A feature whose parent is off reads closed whatever its own row says. Null for a feature that stands on its own.';
comment on column public.go_live_guards.held_reason is
  'G-01. Set only while a feature is off: why it cannot run yet, in plain words (at least 20 characters). Cleared when it is opened. Never set on a master.';

grant select (kind, parent_key, held_reason) on public.go_live_guards to authenticated;
create index go_live_guards_parent_idx on public.go_live_guards (parent_key) where parent_key is not null;

-- ---------------------------------------------------------------------------
-- 2. The nine masters
-- ---------------------------------------------------------------------------
update public.go_live_guards set kind = 'master'
 where key in ('public_signup_enabled', 'checkout_enabled', 'clinical_operations_enabled', 'prescribing_enabled', 'payouts_enabled',
               'lab_booking_enabled', 'research_export_enabled', 'assistant_enabled', 'on_call_cover_ok');

-- ---------------------------------------------------------------------------
-- 3. Parents: only where the master's own enforcement already makes the feature unreachable
-- ---------------------------------------------------------------------------
-- Clinical operations: enrolment into a doctor-run pathway or programme, anything that needs clinician cover, the consulting room.
update public.go_live_guards set parent_key = 'clinical_operations_enabled'
 where key in ('pathway_bp', 'pathway_diabetes_care', 'pathway_cardiometabolic_care', 'pathway_prediabetes_prevention', 'pathway_weight_care',
               'pathway_asthma_copd_care', 'pathway_heart_failure_care', 'pathway_ckd_care', 'pathway_post_stroke_care', 'pathway_sickle_cell_care',
               'therapy_pain_enabled', 'therapy_cbt_i_enabled', 'therapy_pulmonary_rehab_enabled', 'therapy_pelvic_floor_enabled', 'therapy_mood_enabled',
               'therapy_panic_breathing_enabled', 'therapy_ibs_hypnotherapy_enabled',
               'symptom_checker_enabled', 'community', 'live_redflag_prompts_enabled', 'mental_health_worklist_enabled',
               'wellbeing_summary_share_enabled', 'post_consult_checkins_enabled', 'low_carb_t2d_programme', 'fasting_safety', 'maternal_enabled');
-- Laboratory booking: a laboratory service a patient buys or a laboratory pushes into.
update public.go_live_guards set parent_key = 'lab_booking_enabled'
 where key in ('home_kit_sensitive_enabled', 'lab_structured_push_enabled', 'hpv_dna_enabled');

-- ---------------------------------------------------------------------------
-- 4. Held: features that genuinely cannot run yet (a fact, not a signature). Only rows that are off.
-- ---------------------------------------------------------------------------
update public.go_live_guards set held_reason = v.reason
  from (values
    ('sms_emergency_contact_enabled', 'Live SMS delivery (sender ID, DND route, a real handset) has never been proven; the one emergency-contact text would go nowhere.'),
    ('wallet_pass', 'No Apple Pass Type ID certificate or Google Wallet issuer account is configured, so the generator cannot issue a pass.'),
    ('settlement_tieout_daily', 'The settlement-reconcile function is not scheduled with its secret; a daily job would raise an ops incident every day with nobody owning it.'),
    ('directory_partner_stale_email', 'Partner contact addresses on the listings are not yet confirmed real; a daily chase email would go to placeholders.'),
    ('directory_hide_stale_partners', 'Operations has not worked through the chase list; switching this on could hide the one contracted laboratory.'),
    ('therapy_pain_enabled', 'Scaffold only: no programme content exists yet, so enrolment would open an empty programme.'),
    ('therapy_cbt_i_enabled', 'Scaffold only: no programme content exists yet, so enrolment would open an empty programme.'),
    ('therapy_mood_enabled', 'Scaffold only: no programme content exists yet, so enrolment would open an empty programme.'),
    ('therapy_pulmonary_rehab_enabled', 'Held until the COPD pathway runs: the programme has no entry list and admits nobody.'),
    ('pathway_post_stroke_care', 'Scaffold only: no thresholds, no programme and no enrolment path exist yet.'),
    ('pathway_sickle_cell_care', 'Scaffold only: no thresholds, no programme and no enrolment path exist yet.'),
    ('community', 'No moderator or safety reviewer is named yet; a members-only group cannot run unmoderated.')
  ) as v(key, reason)
 where public.go_live_guards.key = v.key and not public.go_live_guards.is_on;

-- ---------------------------------------------------------------------------
-- 5. The one lookup (G-01: a feature is open only when on, not held, and its parent is on)
-- ---------------------------------------------------------------------------
create or replace function private.go_live_guard_on(p_key text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((
    select g.is_on
       and g.held_reason is null
       and (g.parent_key is null or coalesce((select p.is_on from public.go_live_guards p where p.key = g.parent_key), false))
      from public.go_live_guards g where g.key = p_key), false)
$$;
comment on function private.go_live_guard_on(text) is
  'The one guard lookup. Fail closed: unknown key is off. G-01: a feature reads open only when its own row is on, it is not held, and its parent master (if any) is on. A master reads its own row.';

-- ---------------------------------------------------------------------------
-- 6. The switch (live body + G-01: the feature branch)
-- ---------------------------------------------------------------------------
create or replace function public.set_go_live_guard(p_key text, p_on boolean, p_note text default null::text)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  g public.go_live_guards;
  v_role text;
  v_conditions jsonb;
  v_unmet text;
  v_feature boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_role := private.go_live_actor_role();
  if v_role is null then raise exception 'only an admin or the Chief Medical Officer can switch a go-live guard' using errcode = '42501'; end if;
  select * into g from public.go_live_guards where key = p_key for update;
  if g.key is null then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  if p_on is null then raise exception 'say whether to switch it on or off' using errcode = '22023'; end if;
  if g.is_on = p_on then
    return jsonb_build_object('ok', true, 'key', g.key, 'is_on', g.is_on, 'changed', false);
  end if;
  v_feature := g.kind = 'feature';
  -- a person who is both the admin and the CMO acts in the role the guard names, so the permanent record is not mislabelled
  v_role := case when g.switch_role = 'cmo' and private.credential_is_cmo() then 'cmo' when private.is_admin() then 'admin' else 'cmo' end;
  v_conditions := private.go_live_conditions_safe(p_key, private.caller_org());

  if p_on then
    if nullif(btrim(p_note), '') is null then
      raise exception 'switching on % needs a note saying why', g.label using errcode = '22023';
    end if;
    if not v_feature then
      -- A MASTER switching ON is the consequential direction: the right person, a reason, and every condition met right now.
      if g.switch_role = 'cmo' and not private.credential_is_cmo() then
        raise exception 'only the Chief Medical Officer can switch on %', g.label using errcode = '42501';
      end if;
      if g.switch_role = 'admin' and not private.is_admin() then
        raise exception 'only an admin can switch on %', g.label using errcode = '42501';
      end if;
      select string_agg(c ->> 'label', '; ') into v_unmet from jsonb_array_elements(v_conditions) c where not (c ->> 'met')::boolean;
      if v_unmet is not null then
        raise exception 'cannot switch on %: not yet met: %', g.label, v_unmet using errcode = '22023';
      end if;
    end if;
    -- G-01: a FEATURE is not a governance decision. An admin or the CMO opens it; its conditions are recorded in the log for the
    -- reader but never block. A feature whose parent master is off stays closed whatever this row says.
  else
    -- Switching OFF is the stop button and is never held up by paperwork: an admin or the CMO. A master needs no note. A feature
    -- needs the reason it is being held, so the go-live page can say why it is closed (G-01).
    if v_feature and length(btrim(coalesce(p_note, ''))) < 20 then
      raise exception 'holding % needs a reason of at least 20 characters, so the go-live page can say why it is closed', g.label using errcode = '22023';
    end if;
  end if;

  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values (p_key, case when p_on then 'switched_on' else 'switched_off' end, v_uid, v_role, nullif(btrim(p_note), ''), v_conditions);
  update public.go_live_guards
     set is_on = p_on,
         changed_at = now(),
         changed_by = v_uid,
         change_note = case when p_on then btrim(p_note) else nullif(btrim(p_note), '') end,
         held_reason = case when v_feature and not p_on then btrim(p_note) else null end
   where key = p_key;
  -- Switching the scribe OFF is a stop, not only a closed door: a granted scribe consent is what the scribe-draft function checks, so end
  -- every consent still open (revoked_at is the existing "no longer active" mark; the rows stay as the audit record). When the guard is
  -- switched on again a patient has to be asked again.
  if p_key = 'scribe_enabled' and not p_on then
    update public.scribe_consents set revoked_at = now() where granted and revoked_at is null;
    -- and the patient's own in-app ALLOW on a consultation still open goes back to "asked, not answered" (a decline stays a decline), so
    -- switching the scribe on again never restarts it on an answer given under the earlier switch-on
    update public.consultation_scribe_consents c set granted = null, answered_at = null
     where c.granted is true and c.encounter_id in (select e.id from public.encounters e where e.status in ('scheduled', 'waiting', 'in_progress'));
  end if;
  perform private.log_audit(case when p_on then 'go_live_guard.switched_on' else 'go_live_guard.switched_off' end, 'go_live_guard', null,
    jsonb_build_object('key', p_key, 'role', v_role, 'kind', g.kind));
  return jsonb_build_object('ok', true, 'key', p_key, 'is_on', p_on, 'changed', true, 'kind', g.kind,
    'open', private.go_live_guard_on(p_key));
end $function$;

-- ---------------------------------------------------------------------------
-- 7. The table guard (live body + G-01: a parent must be a master; a master never carries a parent or a hold)
-- ---------------------------------------------------------------------------
create or replace function private.go_live_guards_guard()
returns trigger
language plpgsql set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a go-live guard is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.is_on or new.changed_at is not null or new.changed_by is not null or new.change_note is not null then
      raise exception 'a go-live guard is created switched off' using errcode = '42501';
    end if;
  end if;
  -- G-01: a parent is always a master; a master has no parent and is never held
  if new.parent_key is not null and not exists (select 1 from public.go_live_guards p where p.key = new.parent_key and p.kind = 'master') then
    raise exception 'parent_key must name a master guard (%)', new.parent_key using errcode = '22023';
  end if;
  if new.kind = 'master' and new.held_reason is not null then
    raise exception 'a master guard is never held; switch it off instead' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.key is distinct from old.key then
    raise exception 'a go-live guard cannot be renamed' using errcode = '42501';
  end if;
  if (new.is_on, new.changed_at, new.changed_by, new.change_note) is distinct from (old.is_on, old.changed_at, old.changed_by, old.change_note) then
    if not exists (
      select 1 from public.go_live_guard_log l
       where l.guard_key = new.key
         and l.txid = txid_current()
         and l.action = case when new.is_on then 'switched_on' else 'switched_off' end
    ) then
      raise exception 'a go-live guard changes only through set_go_live_guard()' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 8. The dashboard read (live body + G-01: kind, parent, hold and the effective answer)
-- ---------------------------------------------------------------------------
create or replace function public.go_live_guard_status()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_org uuid := private.caller_org();
begin
  if private.go_live_actor_role() is null and not private.has_permission('ops.console.view') then raise exception 'only an admin, the Chief Medical Officer or an operations user can see this' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', g.key, 'label', g.label, 'blocks', g.blocks, 'condition_text', g.condition_text, 'switch_role', g.switch_role,
      'enforced_in', to_jsonb(g.enforced_in), 'not_enforced_in', g.not_enforced_in, 'is_on', g.is_on,
      'changed_at', g.changed_at, 'changed_by_name', (select p.full_name from public.profiles p where p.id = g.changed_by), 'change_note', g.change_note,
      -- G-01
      'kind', g.kind, 'parent_key', g.parent_key, 'held_reason', g.held_reason, 'open', private.go_live_guard_on(g.key),
      'parent_on', case when g.parent_key is null then null else coalesce((select p.is_on from public.go_live_guards p where p.key = g.parent_key), false) end,
      'conditions', c.conds,
      'all_met', not exists (select 1 from jsonb_array_elements(c.conds) x where not (x ->> 'met')::boolean),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'role', l.actor_role, 'note', l.note,
                  'by', (select p2.full_name from public.profiles p2 where p2.id = l.actor_id)) order by l.id desc)
                from (select * from public.go_live_guard_log where guard_key = g.key order by id desc limit 5) l), '[]'::jsonb)
    ) order by case g.kind when 'master' then 0 else 1 end, g.created_at, g.key)
    from public.go_live_guards g
    cross join lateral (select private.go_live_conditions_safe(g.key, v_org) as conds) c
  ), '[]'::jsonb);
end $function$;

-- ---------------------------------------------------------------------------
-- 9. Provable
-- ---------------------------------------------------------------------------
do $$
declare v_n integer; v_txt text;
begin
  select count(*) into v_n from public.go_live_guards where kind = 'master';
  if v_n <> 9 then raise exception 'G-01: expected 9 masters, found %', v_n; end if;
  if exists (select 1 from public.go_live_guards g join public.go_live_guards p on p.key = g.parent_key where p.kind <> 'master') then
    raise exception 'G-01: a feature names a non-master parent';
  end if;
  if exists (select 1 from public.go_live_guards where kind = 'master' and (parent_key is not null or held_reason is not null)) then
    raise exception 'G-01: a master carries a parent or a hold';
  end if;
  if exists (select 1 from public.go_live_guards where is_on and held_reason is not null) then
    raise exception 'G-01: an open guard carries a hold';
  end if;
  -- nothing switched on by this migration: the on-set is exactly what it was (the six the CMO opened before, if present)
  select string_agg(key, ',' order by key) into v_txt from public.go_live_guards where is_on
    and key not in ('mental_health_follow_up_enabled', 'sleep_apnoea_screen_enabled', 'reproductive_content_enabled', 'screening_scheduler_enabled',
                    'screening_request_automation_enabled', 'screening_sensitive_request_optin_enabled');
  if v_txt is not null then raise exception 'G-01: unexpected guards on after this migration: %', v_txt; end if;
  -- a feature whose row is off reads closed; an unknown key reads closed; the six open features (standalone) still read open
  if private.go_live_guard_on('no_such_guard_g01') then raise exception 'G-01: unknown key reads open'; end if;
  if exists (select 1 from public.go_live_guards g where g.is_on and g.parent_key is null and not private.go_live_guard_on(g.key)) then
    raise exception 'G-01: an open standalone guard reads closed';
  end if;
  if exists (select 1 from public.go_live_guards g where not g.is_on and private.go_live_guard_on(g.key)) then
    raise exception 'G-01: a closed row reads open';
  end if;
  if has_function_privilege('anon', 'public.set_go_live_guard(text, boolean, text)', 'EXECUTE') then raise exception 'G-01: anon can execute set_go_live_guard'; end if;
  if has_function_privilege('anon', 'public.go_live_guard_status()', 'EXECUTE') then raise exception 'G-01: anon can execute go_live_guard_status'; end if;
end $$;
