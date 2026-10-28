-- D3 (gap 71): hypertension control, split by whether a doctor adjusted the person's medicine in a window. Admin and CMO only; descriptive, not causal.
-- Design: docs/design/S75-outcome-measures.md (D3 addendum). Pattern: WP3 (20261024201705): PROPOSED definition, born UNSIGNED and INACTIVE, only the Chief
-- Medical Officer signs, the single minimum-cell rule, a fixed "descriptive, not causal" note.
--
-- WHAT THIS ADDS (nothing here changes a stored patient row):
--   1. outcome_adjustment_config: a versioned, immutable definition of "a doctor adjusted the medicine": the window in days and which records count.
--      PROPOSED, UNSIGNED, INACTIVE. Mirrored in the code registry as `outcomes.adjustment_rules`; a test compares the two. Until the CMO signs it, the
--      report returns {withheld: true, reason: awaiting_cmo_signature} and no figure.
--   2. public.bp_control_by_adjustment_report(from, to): among Members the WP3 cascade counts as ON A RECORDED MEDICINE for hypertension, how many have
--      their blood pressure controlled / uncontrolled / unknown, split into "a doctor adjusted the medicine in the window" and "no adjustment in the window".
--      It reads the nightly cascade snapshot (so the control state and the person list are exactly the cascade's, under the cascade's SIGNED definitions) and
--      looks up adjustment evidence only for those people. Until the CMO has signed the cascade definitions too, it says so and shows nothing.
--
-- WHAT COUNTS AS ADJUSTED (PROPOSED, in the config): in the window ending on the snapshot day, (a) a clinician amended the person's hypertension medicine
-- (a new version of a clinician-issued prescription: medications.previous_version_id is set and source is clinician), or (b) a signed plan change of kind
-- medication, with an action listed in the config, was confirmed by the person and applied (care_plan_changes.state = confirmed). A medicine the person
-- added themselves, a refill with no change, and a change that was proposed, rejected, declined or expired do not count.
--
-- SEPARATE, NEVER MIXED IN: people diagnosed but NOT on a recorded medicine (they cannot be adjusted) are shown as their own figure; people on a medicine
-- with no usable readings in the last 7 days are "control unknown" inside each group, never controlled, never uncontrolled and never dropped.
-- No clinician is named, counted or ranked anywhere. Adjustment is more likely when blood pressure is high, so the groups are not comparable: the output
-- says so and carries comparison_group none.
--
-- Counts before this migration (live): no outcome_adjustment_config table; nothing to convert.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned, unsigned)
-- ---------------------------------------------------------------------------
create table public.outcome_adjustment_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint outcome_adjustment_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index outcome_adjustment_config_one_active on public.outcome_adjustment_config (is_active) where is_active;
create index outcome_adjustment_config_approved_by_idx on public.outcome_adjustment_config (approved_by) where approved_by is not null;
alter table public.outcome_adjustment_config enable row level security;
revoke all on public.outcome_adjustment_config from public, anon, authenticated;
grant select on public.outcome_adjustment_config to authenticated;
create policy outcome_adjustment_config_read on public.outcome_adjustment_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.outcome_adjustment_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outcome_adjustment_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'an adjustment config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'an adjustment config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.outcome_adjustment_config_guard() from public, anon, authenticated;
create trigger outcome_adjustment_config_guard before insert or update or delete on public.outcome_adjustment_config
  for each row execute function private.outcome_adjustment_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.outcome_adjustment_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- adjustment-rules-v1-begin
insert into public.outcome_adjustment_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-28', $json$
{
  "condition": "hypertension",
  "adjustment_window_days": 90,
  "signals": {
    "medication_amendment": {
      "enabled": true,
      "definition": "A clinician amended the person's hypertension medicine in the window: the prescription has a newer version written by a clinician."
    },
    "confirmed_plan_change": {
      "enabled": true,
      "actions": ["change", "start"],
      "definition": "A signed medication change on the hypertension care plan, to change a medicine or to start one, was confirmed by the person and applied in the window."
    }
  },
  "groups": [
    { "code": "adjusted", "label": "Medicine adjusted by a doctor in the window", "definition": "On a recorded medicine, and at least one of the records above falls in the window ending on the day of the figures." },
    { "code": "not_adjusted", "label": "No adjustment in the window", "definition": "On a recorded medicine, and none of the records above falls in the window." }
  ],
  "shown_separately": [
    { "code": "not_on_recorded_medicine", "label": "Hypertension on record, not on a recorded medicine", "definition": "Diagnosed Members with no active medicine recorded under the hypertension care plan. They cannot be adjusted, so they are in neither group." },
    { "code": "control_unknown", "label": "Control unknown", "definition": "On a recorded medicine, with fewer than the minimum number of cleared home readings in the last 7 days. Shown in each group as unknown, never as controlled or uncontrolled." }
  ],
  "limitations": "People who are not on a recorded medicine are shown separately and are in neither group. People on a medicine with no usable readings in the last 7 days are shown as control unknown, and stay in the figure. Doctors adjust medicine more often when blood pressure is high, so the two groups are not alike to start with and the figures cannot be compared as if they were. The record shows that a change was made, not whether the person took it.",
  "note": "These figures are descriptive, not causal. They show how many people in each group have blood pressure under control on the day of the figures. They do not show that adjusting a medicine changed anyone's blood pressure, and no clinician is named or compared."
}
$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE (D3). Owner: CMO. What counts as a doctor adjusting a hypertension medicine, and the window. Nothing shows until the CMO signs.');
-- adjustment-rules-v1-end

create function public.sign_outcome_adjustment_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.outcome_adjustment_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the medicine adjustment definition' using errcode = '42501'; end if;
  select * into c from public.outcome_adjustment_config where version = p_version for update;
  if not found then raise exception 'no such adjustment configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.outcome_adjustment_config set is_active = false where is_active and version <> p_version;
  update public.outcome_adjustment_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'outcome_adjustment_config.signed',
            'outcome_adjustment_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_outcome_adjustment_config(integer) from public, anon, authenticated;
grant execute on function public.sign_outcome_adjustment_config(integer) to authenticated;

create function private.adjustment_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config || jsonb_build_object('_version', version) from public.outcome_adjustment_config where is_active and approved_at is not null order by version desc limit 1 $$;
revoke all on function private.adjustment_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. "A doctor adjusted this person's hypertension medicine in the window": one place, used by the report (and pinned by the proof)
-- ---------------------------------------------------------------------------
-- The window is the p_days Lagos days ending on p_on (inclusive). Reads only whether a record exists; returns no clinician, no drug, no dose.
create function private.hypertension_medicine_adjusted(p_patient uuid, p_cfg jsonb, p_on date) returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (coalesce((p_cfg #>> '{signals,medication_amendment,enabled}')::boolean, false)
     and exists (select 1 from public.medications m join public.care_plans cp on cp.id = m.care_plan_id
                  where m.patient_id = p_patient and cp.patient_id = p_patient and cp.condition::text = 'hypertension'
                    and m.previous_version_id is not null and m.source = 'clinician'
                    and (m.created_at at time zone 'Africa/Lagos')::date >  p_on - (p_cfg ->> 'adjustment_window_days')::integer
                    and (m.created_at at time zone 'Africa/Lagos')::date <= p_on))
    or
    (coalesce((p_cfg #>> '{signals,confirmed_plan_change,enabled}')::boolean, false)
     and exists (select 1 from public.care_plan_changes c join public.care_plans cp on cp.id = c.care_plan_id
                  where c.patient_id = p_patient and cp.patient_id = p_patient and cp.condition::text = 'hypertension'
                    and c.kind = 'medication' and c.state = 'confirmed' and not c.is_test
                    and (p_cfg #> '{signals,confirmed_plan_change,actions}') ? (c.proposal ->> 'action')
                    and (c.applied_at at time zone 'Africa/Lagos')::date >  p_on - (p_cfg ->> 'adjustment_window_days')::integer
                    and (c.applied_at at time zone 'Africa/Lagos')::date <= p_on))
$$;
revoke all on function private.hypertension_medicine_adjusted(uuid, jsonb, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The report (admin or CMO; aggregate only; audited)
-- ---------------------------------------------------------------------------
-- One group as a figure: control among the group's people. The three control states partition the group and go through the one rule with the group itself.
create function private.adjustment_group_json(p_label text, p_group jsonb, p_marked jsonb, p_min integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare x jsonb; n bigint := (p_group ->> 'n')::bigint;
begin
  if n = 0 then
    return jsonb_build_object('code', p_group ->> 'key', 'label', p_label, 'suppressed', false, 'n', 0);
  end if;
  select g into x from jsonb_array_elements(p_marked) g where g ->> 'key' = p_group ->> 'key';
  if (x ->> 'suppressed')::boolean then
    return jsonb_build_object('code', p_group ->> 'key', 'label', p_label, 'suppressed', true, 'reason', x ->> 'reason', 'minimum', p_min);
  end if;
  return jsonb_build_object('code', p_group ->> 'key', 'label', p_label, 'suppressed', false, 'n', n,
    'controlled', (p_group #>> '{cats,0}')::bigint, 'uncontrolled', (p_group #>> '{cats,1}')::bigint, 'control_unknown', (p_group #>> '{cats,2}')::bigint,
    'rate_strict_pct', round(100.0 * (p_group #>> '{cats,0}')::bigint / n, 1),
    'rate_among_known_pct', round(100.0 * (p_group #>> '{cats,0}')::bigint / nullif((p_group #>> '{cats,0}')::bigint + (p_group #>> '{cats,1}')::bigint, 0), 1),
    'missing_pct', round(100.0 * (p_group #>> '{cats,2}')::bigint / n, 1));
end $$;
revoke all on function private.adjustment_group_json(text, jsonb, jsonb, integer) from public, anon, authenticated;

create function public.bp_control_by_adjustment_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb; v_casc jsonb; v_date date; v_min integer; v_ver integer;
  a record; v_groups jsonb := '[]'::jsonb; v_marked jsonb; v_adj jsonb; v_not jsonb; v_treated jsonb; v_notmed jsonb; v_shown boolean;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  v_cfg := private.adjustment_config();
  if v_cfg is null then
    return jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature', 'condition', 'hypertension');
  end if;
  v_casc := private.cascade_config();
  if v_casc is null then
    return jsonb_build_object('withheld', true, 'reason', 'cascade_not_signed', 'condition', 'hypertension');
  end if;
  v_ver := (v_casc ->> '_version')::integer;
  v_date := private.cascade_snapshot_date('hypertension', v_ver);
  if v_date is null then
    return jsonb_build_object('withheld', true, 'reason', 'snapshot_pending', 'condition', 'hypertension');
  end if;
  v_min := private.min_cell_floor();
  -- whole calendar months of joining, so two ranges a day apart cannot be subtracted
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  -- One pass over the snapshot rows of the people the cascade already counts; adjustment evidence is looked up only for people on a recorded medicine.
  select count(*) filter (where e.diagnosed and not e.treated) as not_med,
         count(*) filter (where e.treated and e.adj) as a_n,
         count(*) filter (where e.treated and e.adj and e.control_state = 'controlled') as a_c,
         count(*) filter (where e.treated and e.adj and e.control_state = 'uncontrolled') as a_u,
         count(*) filter (where e.treated and e.adj and e.control_state = 'unknown') as a_k,
         count(*) filter (where e.treated and not e.adj) as n_n,
         count(*) filter (where e.treated and not e.adj and e.control_state = 'controlled') as n_c,
         count(*) filter (where e.treated and not e.adj and e.control_state = 'uncontrolled') as n_u,
         count(*) filter (where e.treated and not e.adj and e.control_state = 'unknown') as n_k
    into a
    from (select s.diagnosed, s.treated, s.control_state,
                 s.treated and private.hypertension_medicine_adjusted(s.patient_id, v_cfg, v_date) as adj
            from public.cascade_snapshots s
           where s.snapshot_date = v_date and s.condition = 'hypertension' and s.config_version = v_ver
             and (p_from is null or s.anchor >= p_from) and (p_to is null or s.anchor <= p_to)) e;

  -- the two groups partition "on a recorded medicine": zero is shown as zero; a small non-zero one is withheld with a neighbour
  if a.a_n > 0 then v_groups := v_groups || jsonb_build_object('key', 'adjusted', 'n', a.a_n, 'cats', jsonb_build_array(a.a_c, a.a_u, a.a_k)); end if;
  if a.n_n > 0 then v_groups := v_groups || jsonb_build_object('key', 'not_adjusted', 'n', a.n_n, 'cats', jsonb_build_array(a.n_c, a.n_u, a.n_k)); end if;
  v_marked := private.suppress_groups(v_groups, v_min);
  v_adj := private.adjustment_group_json(v_cfg #>> '{groups,0,label}', jsonb_build_object('key', 'adjusted', 'n', a.a_n, 'cats', jsonb_build_array(a.a_c, a.a_u, a.a_k)), v_marked, v_min);
  v_not := private.adjustment_group_json(v_cfg #>> '{groups,1,label}', jsonb_build_object('key', 'not_adjusted', 'n', a.n_n, 'cats', jsonb_build_array(a.n_c, a.n_u, a.n_k)), v_marked, v_min);
  -- the total on a medicine is shown only when both groups are, so a withheld group cannot be recovered by subtraction
  v_shown := not coalesce((v_adj ->> 'suppressed')::boolean, false) and not coalesce((v_not ->> 'suppressed')::boolean, false);
  v_treated := case when v_shown then jsonb_build_object('suppressed', false, 'n', a.a_n + a.n_n)
                    else jsonb_build_object('suppressed', true, 'reason', 'a_group_is_withheld', 'minimum', v_min) end;
  -- people not on a recorded medicine: their own figure
  v_notmed := case when a.not_med = 0 then jsonb_build_object('suppressed', false, 'n', 0)
                   when private.suppress_cell(a.not_med, null, v_min) is not null
                     then jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(a.not_med, null, v_min), 'minimum', v_min)
                   else jsonb_build_object('suppressed', false, 'n', a.not_med) end;

  perform private.log_audit('outcomes.bp_control_by_adjustment_report', 'outcome_report', null, jsonb_build_object('from', p_from, 'to', p_to));
  return jsonb_build_object(
    'condition', 'hypertension', 'config_version', (v_cfg ->> '_version')::integer, 'cascade_config_version', v_ver, 'minimum_cell', v_min, 'as_at', v_date,
    'window_days', (v_cfg ->> 'adjustment_window_days')::integer,
    'adjusted', v_adj, 'not_adjusted', v_not, 'on_recorded_medicine', v_treated,
    'not_on_recorded_medicine', v_notmed,
    'definitions', v_cfg -> 'signals', 'shown_separately', v_cfg -> 'shown_separately',
    'limitations', v_cfg ->> 'limitations', 'note', v_cfg ->> 'note',
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'comparison_group', 'none', 'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.bp_control_by_adjustment_report(date, date) from public, anon;
grant execute on function public.bp_control_by_adjustment_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.outcome_adjustment_config where is_active or approved_at is not null) then
    raise exception 'D3: the adjustment config must be born unsigned and inactive';
  end if;
  if has_function_privilege('anon', 'public.bp_control_by_adjustment_report(date,date)', 'EXECUTE') then
    raise exception 'D3: anon can run the report';
  end if;
end $$;
