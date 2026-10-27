-- Duplicate-result safety: the same lab value reaching a person's record twice must be counted once, never silently.
-- Design: docs/design/DUP-1.md. Research: docs/research/DUP-1.md.
--
-- FOUND (read from the live definitions of private.biomarker_points and private.hr_biomarker_points, 2026-10-20): both UNION ALL the structured
-- results (lab_result_items, from the S27 writer and the S44 partner push) with lab_analyte_readings (a clinician filing a photo or PDF of the paper
-- report). Nothing matched the two, so the same HbA1c arriving by both routes was two points on the trend, two readings in the Health Report's
-- "readings this year" count and two rows in its trend series. (The S43 photo capture on patient_documents.extracted is NOT a path in: it is
-- suggestions only and nothing reads it, so it cannot double count.) Counted first, live: lab_analyte_readings 0, lab_result_items 0, lab_results 0,
-- so this is a structural change with no data conversion.
--
-- WHAT THIS DOES (no AI, deterministic):
--   1. lab_value_match_config: the match rule as versioned data (window in days, relative value tolerance, same unit required). Version 1 is
--      PROPOSED (the CMO or lab liaison confirms the numbers); mirrored in packages/shared proposed-config and a test fails on drift.
--   2. lab_value_links: append-only evidence of a pair (a structured item and a legacy reading for the same patient and code inside the window).
--      relation 'duplicate' (same unit, value inside tolerance) or 'disagreement' (value outside tolerance or unit differs; never converted).
--      Nothing is deleted or edited; both source rows stay as they were.
--   3. Triggers on both source tables write the links. A link failure never blocks a result insert (a critical value must reach the record); it is
--      written to lab_value_link_failures and raised as a warning, and the safe consequence is that the value shows twice until re-linked.
--   4. The two readers show a duplicate ONCE (biomarker_points keeps its nine-column return type; the labels come from biomarker_point_labels) (the structured result, labelled with both sources). A legacy reading is hidden only while the
--      structured result it duplicates is itself visible (released, not withdrawn, not replaced), so withdrawing the structured one brings the
--      paper value back. A disagreement shows BOTH values, each marked as disagreeing, in the trend; the Health Report leaves a disputed analyte
--      out of its facts (it never picks one) until a clinician settles it.
--   5. lab_value_disagreements(): the clinician-visible note. Self, or staff through the tie with a reason and an audit row (INV-10, INV-12).
--   Sensitive results (INV-04) are never linked: no code or flag on them is touched here.
-- INV-04 / OQ-S43m-5: main-dev (20261020184127, 20261020201833) added `not l.sensitive_positive` to the legacy branch of both readers. This migration
-- sorts AFTER them and re-creates the two functions, so the bodies below are built FROM those patched definitions and keep the filter on the
-- exact text the OQ-S43m-5 proofs search for; a body written from the older text would have silently reverted the exclusion.
-- Red-flag logic is deliberately NOT de-duplicated: a critical value arriving twice may page twice. Two pages are safe, a suppressed one is not.

-- ---------------------------------------------------------------------------
-- 1. Versioned match rule
-- ---------------------------------------------------------------------------
create table public.lab_value_match_config (
  version        integer primary key,
  config         jsonb not null,
  status         text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  confirmed_by   uuid references public.profiles (id) on delete set null,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  check (status = 'proposed' or (confirmed_by is not null and confirmed_at is not null)),
  check (jsonb_typeof(config) = 'object' and (config ->> 'window_days') ~ '^[0-9]{1,2}$' and (config ->> 'value_tolerance_pct') ~ '^[0-9]+(\.[0-9]+)?$')
);
alter table public.lab_value_match_config enable row level security;
revoke all on public.lab_value_match_config from public, anon, authenticated;
comment on table public.lab_value_match_config is
  'Duplicate lab value match rule, versioned (INV-16). No client reads or writes it; private.lab_value_match_active() is the only reader. Version 1 is PROPOSED.';

-- lab-match-config-begin
insert into public.lab_value_match_config (version, config) values
  (1, $json${"window_days": 2, "value_tolerance_pct": 0.5, "require_same_unit": true}$json$::jsonb);
-- lab-match-config-end

-- The rule in force: the latest CONFIRMED version, else the seeded version 1 baseline. A later draft that nobody confirmed is inert, so an
-- unreviewed number can never start hiding a clinical value.
create function private.lab_value_match_active() returns public.lab_value_match_config
language sql stable security definer set search_path = '' as
$$ select m from public.lab_value_match_config m where m.status = 'confirmed' or m.version = 1 order by m.version desc limit 1 $$;
revoke all on function private.lab_value_match_active() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Links (append-only evidence)
-- ---------------------------------------------------------------------------
create table public.lab_value_links (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  analyte_code       text not null,
  structured_item_id uuid not null references public.lab_result_items (id) on delete cascade,
  legacy_reading_id  uuid not null references public.lab_analyte_readings (id) on delete cascade,
  relation           text not null check (relation in ('duplicate', 'disagreement')),
  reason             text not null check (reason in ('same_value', 'value_differs', 'unit_differs')),
  structured_value   numeric not null,
  structured_unit    text,
  legacy_value       numeric not null,
  legacy_unit        text,
  config_version     integer not null references public.lab_value_match_config (version),
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (structured_item_id, legacy_reading_id),
  check ((relation = 'duplicate') = (reason = 'same_value'))
);
create index lab_value_links_patient_code_idx on public.lab_value_links (patient_id, lower(analyte_code));
create index lab_value_links_legacy_idx on public.lab_value_links (legacy_reading_id);
alter table public.lab_value_links enable row level security;
-- NO client read at all. A link is written when a result arrives, before any release decision, and carries a copy of the structured value, so a
-- direct read would show a held result early (INV-03). People and staff read only through the functions below, which apply the release rules.
-- RLS is on with no policy as a second wall.
revoke all on public.lab_value_links from public, anon, authenticated;

create function private.lab_value_links_append_only() returns trigger
language plpgsql set search_path = '' as
$$ begin raise exception 'lab_value_links is append-only evidence' using errcode = '55000'; end $$;
revoke all on function private.lab_value_links_append_only() from public, anon, authenticated;
create trigger lab_value_links_no_update before update on public.lab_value_links
  for each row execute function private.lab_value_links_append_only();

-- ---------------------------------------------------------------------------
-- 3. The matcher and its triggers
-- ---------------------------------------------------------------------------
create function private.link_lab_value_pairs(p_patient uuid, p_code text) returns integer
language plpgsql security definer set search_path = '' as
$$
declare
  v_m public.lab_value_match_config := private.lab_value_match_active();
  v_ver integer := v_m.version;
  v_window integer := (v_m.config ->> 'window_days')::integer;
  v_tol numeric := (v_m.config ->> 'value_tolerance_pct')::numeric;
  v_same boolean := coalesce((v_m.config ->> 'require_same_unit')::boolean, true);
  v_test boolean := coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), false);
  v_n integer := 0;
  rw record;
  v_rel text;
  v_reason text;
begin
  -- a sensitive code is never linked (INV-04): the link would carry a value and a unit. (The legacy table's own sensitive flag is checked in its trigger.)
  if p_code is null or private.report_excluded_code(p_code) then return 0; end if;
  -- one writer per (patient, code): a paper report filed in one transaction and a lab push in another each see the other once it commits
  perform pg_advisory_xact_lock(hashtextextended('lab_value_link:' || p_patient::text || ':' || lower(p_code), 0));
  -- closest values first, so a reading that already has a same-value partner is never also called a disagreement with a different, genuine repeat test
  for rw in
    select i.id as item_id, l.id as legacy_id, i.organisation_id, i.analyte_code, i.value_numeric as sv, i.unit as su, l.value as lv, l.unit as lu,
           (regexp_replace(lower(coalesce(i.unit, '')), '\s+', '', 'g') = regexp_replace(lower(coalesce(l.unit, '')), '\s+', '', 'g')
            or btrim(coalesce(i.unit, '')) = '' or btrim(coalesce(l.unit, '')) = '') as same_unit,   -- a missing unit is unknown, not different
           (abs(i.value_numeric - l.value) <= greatest(abs(i.value_numeric), abs(l.value)) * v_tol / 100.0) as near
      from public.lab_result_items i
      join public.lab_results r on r.id = i.lab_result_id
      left join public.lab_orders lo on lo.id = r.lab_order_id
      join private.lab_analyte_readings_current l on l.patient_id = i.patient_id and lower(l.code) = lower(i.analyte_code)
     where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code)
       and i.value_numeric is not null and l.value is not null
       and not i.sensitive_positive and not l.sensitive_positive
       and abs((timezone('Africa/Lagos', coalesce(lo.sample_collected_at, r.received_at, r.created_at)))::date
             - (timezone('Africa/Lagos', coalesce(l.specimen_collected_at, l.taken_at)))::date) <= v_window
       and not exists (select 1 from public.lab_value_links k where k.structured_item_id = i.id and k.legacy_reading_id = l.id)
     order by abs(i.value_numeric - l.value) asc
  loop
    if rw.near and (rw.same_unit or not v_same) then
      v_rel := 'duplicate'; v_reason := 'same_value';
    else
      -- a disagreement only between two readings that have no same-value partner yet
      if exists (select 1 from public.lab_value_links k where k.relation = 'duplicate' and (k.structured_item_id = rw.item_id or k.legacy_reading_id = rw.legacy_id)) then
        continue;
      end if;
      v_rel := 'disagreement';
      v_reason := case when not rw.same_unit and v_same then 'unit_differs' else 'value_differs' end;
    end if;
    insert into public.lab_value_links (organisation_id, patient_id, analyte_code, structured_item_id, legacy_reading_id, relation, reason,
                                        structured_value, structured_unit, legacy_value, legacy_unit, config_version, is_test)
    values (rw.organisation_id, p_patient, rw.analyte_code, rw.item_id, rw.legacy_id, v_rel, v_reason, rw.sv, rw.su, rw.lv, rw.lu, v_ver, v_test)
    on conflict (structured_item_id, legacy_reading_id) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.link_lab_value_pairs(uuid, text) from public, anon, authenticated;

-- A failure to link must NEVER stop a lab result or a filed reading being stored (a critical value must reach the record and its escalation). The
-- failure is written to lab_value_link_failures and raised as a warning; the safe consequence is that the value shows twice until it is re-linked.
create table public.lab_value_link_failures (
  id           uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id    uuid not null,
  error        text not null,
  created_at   timestamptz not null default now()
);
alter table public.lab_value_link_failures enable row level security;
revoke all on public.lab_value_link_failures from public, anon, authenticated;
comment on table public.lab_value_link_failures is 'DUP-1: a duplicate-link attempt that failed. Ids and the SQLSTATE only (an error text can echo a failing row, which would carry patient data). Nothing reads it yet (OQ-DUP-1-6); re-link by calling private.link_lab_value_pairs(patient, code).';

create function private.lab_value_link_trigger_item() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  begin
    perform private.link_lab_value_pairs(new.patient_id, new.analyte_code);
  exception when others then
    insert into public.lab_value_link_failures (source_table, source_id, error) values ('lab_result_items', new.id, 'sqlstate ' || sqlstate);
    raise warning 'DUP-1 link failed for lab_result_items %: sqlstate %', new.id, sqlstate;
  end;
  return null;
end $$;
create function private.lab_value_link_trigger_legacy() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  begin
    if not coalesce(new.sensitive_positive, false) and new.correction_status is null then perform private.link_lab_value_pairs(new.patient_id, new.code); end if;
  exception when others then
    insert into public.lab_value_link_failures (source_table, source_id, error) values ('lab_analyte_readings', new.id, 'sqlstate ' || sqlstate);
    raise warning 'DUP-1 link failed for lab_analyte_readings %: sqlstate %', new.id, sqlstate;
  end;
  return null;
end $$;
revoke all on function private.lab_value_link_trigger_item() from public, anon, authenticated;
revoke all on function private.lab_value_link_trigger_legacy() from public, anon, authenticated;
create trigger lab_value_link_after_item after insert on public.lab_result_items
  for each row execute function private.lab_value_link_trigger_item();
create trigger lab_value_link_after_legacy after insert on public.lab_analyte_readings
  for each row execute function private.lab_value_link_trigger_legacy();

-- ---------------------------------------------------------------------------
-- 4. Readers
-- ---------------------------------------------------------------------------
-- Is the structured item behind a link visible to the person right now (released, not withdrawn, not replaced, not sensitive)?
create function private.lab_item_visible(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
                  where i.id = p_item and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null and not i.sensitive_positive)
$$;
revoke all on function private.lab_item_visible(uuid) from public, anon, authenticated;

-- A disagreement link counts only while BOTH its readings are still shown and neither has since been found to have a same-value partner (a later
-- duplicate link retires an older disagreement involving the same reading, whatever order the rows arrived in).
create function private.live_disagreement(p_link uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from public.lab_value_links k
      join private.lab_analyte_readings_current c on c.id = k.legacy_reading_id
     where k.id = p_link and k.relation = 'disagreement'
       and c.report_status in ('final', 'corrected', 'amended')
       and private.lab_item_visible(k.structured_item_id)
       and not exists (select 1 from public.lab_value_links d
                        where d.relation = 'duplicate' and (d.structured_item_id = k.structured_item_id or d.legacy_reading_id = k.legacy_reading_id)
                          and private.lab_item_visible(d.structured_item_id)))
$$;
revoke all on function private.live_disagreement(uuid) from public, anon, authenticated;

-- Trend points. The RETURN TYPE IS UNCHANGED (nine columns): the OQ-S43m-5 proofs re-create this function with that exact signature as their
-- sabotage step, and a changed return type would make that CREATE OR REPLACE fail. A duplicate is collapsed here (the paper row is hidden while the
-- structured result it duplicates is visible); the two labels the screen shows (also_from, disagrees) come from private.biomarker_point_labels below.
-- The legacy side reads the _current view (a superseded row is not a reading) and keeps main-dev's sensitive_positive filter (INV-04, OQ-S43m-5).
create or replace function private.biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, ref_text text, flag text, source text, laboratory text)
language sql stable security definer set search_path = '' as
$$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high,
         case when i.ref_low is not null or i.ref_high is not null then concat_ws(' to ', i.ref_low::text, i.ref_high::text) end,
         i.flag, 'lab_result'::text, null::text
    from public.lab_result_items i
    join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
     and not i.sensitive_positive
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.reference_range_text, l.abnormal_flag::text, 'legacy_report'::text, l.laboratory
    from private.lab_analyte_readings_current l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended') and not l.sensitive_positive
     and not exists (select 1 from public.lab_value_links k where k.legacy_reading_id = l.id and k.relation = 'duplicate' and private.lab_item_visible(k.structured_item_id))
$$;
revoke all on function private.biomarker_points(uuid, text) from public, anon, authenticated;

-- The two labels for a trend point, keyed by (taken_at, value, source): also_from = the second source behind a collapsed duplicate; disagrees = a
-- disagreement link with both sides still shown. A left join from the points, so a point with no label row simply has none.
create function private.biomarker_point_labels(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, source text, also_from text, disagrees boolean)
language sql stable security definer set search_path = '' as
$$
  select r.released_at, i.value_numeric, 'lab_result'::text,
         case when exists (select 1 from public.lab_value_links k join private.lab_analyte_readings_current c on c.id = k.legacy_reading_id
                            where k.structured_item_id = i.id and k.relation = 'duplicate' and c.report_status in ('final', 'corrected', 'amended') and not c.sensitive_positive)
              then 'legacy_report' end,
         exists (select 1 from public.lab_value_links k where k.structured_item_id = i.id and k.relation = 'disagreement' and private.live_disagreement(k.id))
    from public.lab_result_items i
    join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null and not i.sensitive_positive
  union all
  select l.taken_at, l.value, 'legacy_report'::text, null::text,
         exists (select 1 from public.lab_value_links k where k.legacy_reading_id = l.id and k.relation = 'disagreement' and private.live_disagreement(k.id))
    from private.lab_analyte_readings_current l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null and not l.sensitive_positive
$$;
revoke all on function private.biomarker_point_labels(uuid, text) from public, anon, authenticated;

-- Is any reading of this analyte currently disputed (a disagreement link whose two sides are both visible)?
create function private.lab_code_disputed(p_patient uuid, p_code text) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.lab_value_links k
                  where k.patient_id = p_patient and lower(k.analyte_code) = lower(p_code) and k.relation = 'disagreement' and private.live_disagreement(k.id))
$$;
revoke all on function private.lab_code_disputed(uuid, text) from public, anon, authenticated;

-- Health Report series: a duplicate counts once; an analyte with a DISPUTED reading (a disagreement link with both sides visible) is left out of the
-- report's facts entirely: neither value is picked, and an older undisputed reading is not promoted to "latest" in its place. The clinician note
-- (lab_value_disagreements) says why the analyte is missing; it is settled by the existing correction or withdrawal paths (OQ-DUP-1-2).
create or replace function private.hr_biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, flag text)
language sql stable security definer set search_path = '' as
$$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high, i.flag
    from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
     and not i.sensitive_positive and not private.report_excluded_code(i.analyte_code)
     and not (select private.lab_code_disputed(p_patient, p_code))
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.abnormal_flag::text
    from private.lab_analyte_readings_current l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended') and not private.report_excluded_code(l.code) and not l.sensitive_positive
     and not (select private.lab_code_disputed(p_patient, p_code))
     and not exists (select 1 from public.lab_value_links k where k.legacy_reading_id = l.id and k.relation = 'duplicate' and private.lab_item_visible(k.structured_item_id))
$$;
revoke all on function private.hr_biomarker_points(uuid, text) from public, anon, authenticated;

-- patient_biomarker_trend: carry the two new fields through to the screen. Restated from the S43 body with only the point object widened.
create or replace function public.patient_biomarker_trend(p_code text, p_patient uuid default null, p_since date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  c_max_points constant integer := 500;                -- technical cap
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_points jsonb;
  v_units integer;
  v_target jsonb;
  v_disputed boolean;
begin
  if not private.may_read_biomarkers(v_patient) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_code is null or btrim(p_code) = '' or char_length(p_code) > 80 then
    raise exception 'say which result' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('taken_at', x.taken_at, 'value', x.value, 'unit', x.unit, 'ref_low', x.ref_low, 'ref_high', x.ref_high,
                   'ref_text', x.ref_text, 'flag', x.flag, 'source', x.source, 'laboratory', x.laboratory, 'also_from', x.also_from, 'disagrees', x.disagrees) order by x.taken_at), '[]'::jsonb),
         count(distinct nullif(lower(btrim(x.unit)), '')),
         coalesce(bool_or(x.disagrees), false)
    into v_points, v_units, v_disputed
    from (select q.*, lb.also_from, coalesce(lb.disagrees, false) as disagrees
            from private.biomarker_points(v_patient, p_code) q
            left join lateral (select l2.also_from, l2.disagrees from private.biomarker_point_labels(v_patient, p_code) l2
                                where l2.taken_at = q.taken_at and l2.value = q.value and l2.source = q.source limit 1) lb on true
           where p_since is null or q.taken_at >= p_since::timestamptz order by q.taken_at desc limit c_max_points) x;

  select jsonb_build_object('min', (cp.target_ranges -> k.key ->> 'min')::numeric, 'max', (cp.target_ranges -> k.key ->> 'max')::numeric,
                            'condition', cp.condition::text, 'set_by', 'care_team')
    into v_target
    from public.care_plans cp
    cross join lateral (select key from jsonb_object_keys(coalesce(cp.target_ranges, '{}'::jsonb)) key where lower(key) = lower(p_code) limit 1) k
   where cp.patient_id = v_patient and cp.status = 'active'
   order by cp.updated_at desc limit 1;

  return jsonb_build_object('code', p_code, 'points', v_points, 'unit_mixed', coalesce(v_units, 0) > 1, 'target', v_target, 'disputed', v_disputed);
end;
$$;
revoke all on function public.patient_biomarker_trend(text, uuid, date) from public, anon;
grant execute on function public.patient_biomarker_trend(text, uuid, date) to authenticated;

-- patient_biomarker_list: the latest value is NOT shown when the series is disputed (two points that disagree would otherwise let an arbitrary one
-- stand as "latest"). Restated from the S43 body with the disputed flag added.
create or replace function public.patient_biomarker_list(p_patient uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
begin
  if not private.may_read_biomarkers(v_patient) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.code, 'readings', c.n, 'first_at', c.first_at, 'last_at', c.last_at,
             'disputed', c.disputed,
             'latest_value', case when c.disputed then null else c.latest_value end, 'latest_unit', c.latest_unit,
             'latest_flag', case when c.disputed then null else c.latest_flag end,
             'latest_ref_low', c.latest_ref_low, 'latest_ref_high', c.latest_ref_high, 'latest_ref_text', c.latest_ref_text) order by c.last_at desc)
      from (
        select codes.code, count(*) n, min(p.taken_at) first_at, max(p.taken_at) last_at, coalesce(bool_or(private.lab_code_disputed(v_patient, codes.code)), false) disputed,
               (array_agg(p.value order by p.taken_at desc))[1] latest_value,
               (array_agg(p.unit order by p.taken_at desc))[1] latest_unit,
               (array_agg(p.flag order by p.taken_at desc))[1] latest_flag,
               (array_agg(p.ref_low order by p.taken_at desc))[1] latest_ref_low,
               (array_agg(p.ref_high order by p.taken_at desc))[1] latest_ref_high,
               (array_agg(p.ref_text order by p.taken_at desc))[1] latest_ref_text
          from (select lower(i.analyte_code) code from public.lab_result_items i where i.patient_id = v_patient
                union select lower(l.code) from private.lab_analyte_readings_current l where l.patient_id = v_patient) codes
          cross join lateral private.biomarker_points(v_patient, codes.code) p
         group by codes.code) c), '[]'::jsonb);
end;
$$;
revoke all on function public.patient_biomarker_list(uuid) from public, anon;
grant execute on function public.patient_biomarker_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The clinician-visible note
-- ---------------------------------------------------------------------------
-- Self: own disagreements, no audit (it is the person's own record). Staff: only through the tie, with a reason, always audited; a refusal
-- returns {denied:true} and its audit row survives (it does not raise); a caller who is not active staff is refused before anything is written. Both values are returned side by side: nothing is picked.
create function public.lab_value_disagreements(p_patient uuid default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, v_uid);
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if v_patient is distinct from v_uid then
    -- only an active clinician can ask about someone else: no audit rows are written for anyone else's call and no existence oracle is offered
    if not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
    end if;
    if not private.can_staff_read_clinical(v_patient, 'labs_results'::public.care_access_category) then
      perform private.audit_chart_read(v_patient, array['lab_value_disagreements'], p_reason, 'denied');
      return jsonb_build_object('denied', true);
    end if;
    perform private.audit_chart_read(v_patient, array['lab_value_disagreements'], p_reason, 'success');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', k.analyte_code, 'reason', k.reason,
           'structured', jsonb_build_object('value', k.structured_value, 'unit', k.structured_unit, 'at', r.received_at),
           'paper_report', jsonb_build_object('value', k.legacy_value, 'unit', k.legacy_unit, 'at', coalesce(l.specimen_collected_at, l.taken_at)),
           'config_version', k.config_version, 'noted_at', k.created_at) order by k.created_at desc), '[]'::jsonb)
    into v_out
    from public.lab_value_links k
    join public.lab_result_items i on i.id = k.structured_item_id
    join public.lab_results r on r.id = i.lab_result_id
    join private.lab_analyte_readings_current l on l.id = k.legacy_reading_id
   where k.patient_id = v_patient and k.relation = 'disagreement' and private.live_disagreement(k.id)
     and l.report_status in ('final', 'corrected', 'amended') and not l.sensitive_positive
     -- staff never see a reproductive or mental health analyte through this note (the person does, it is their own record)
     and (v_patient = v_uid or (private.confidential_domain_of_text(k.analyte_code) is null
                              and k.analyte_code !~* '(^|[^a-z])(hcg|amh|fsh|lh|estradiol|estrogen|oestr|progesterone|prolactin|testosterone|shbg|dhea|inhibin|semen|sperm|pregnan|ovar|cervic|hpv)'));
  return jsonb_build_object('disagreements', v_out);
end;
$$;
revoke all on function public.lab_value_disagreements(uuid, text) from public, anon;
grant execute on function public.lab_value_disagreements(uuid, text) to authenticated;

-- Register the new patient-keyed table in the S39d data registry (PROPOSED classification, same rule as every other row).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'lab_value_links', 'patient_id', private.retention_class_for('lab_value_links'),
       case when private.retention_class_for('lab_value_links') = 'operational' then 'delete' else 'review' end,
       false,   -- derived from rows that are themselves exported; a copy of an unreleased value must not leave through the export
       'DUP-1 2026-10-20: PROPOSED, to be confirmed by the CMO and DPO. Evidence that two source rows are one value; no clinical value of its own beyond a copy of the two.'
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.lab_value_disagreements(uuid, text)', 'public.patient_biomarker_trend(text, uuid, date)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'authenticated cannot execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.link_lab_value_pairs(uuid, text)', 'private.biomarker_points(uuid, text)', 'private.biomarker_point_labels(uuid, text)', 'private.hr_biomarker_points(uuid, text)', 'private.lab_item_visible(uuid)', 'private.live_disagreement(uuid)', 'private.lab_code_disputed(uuid, text)', 'private.lab_value_match_active()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'a client can execute %', v_fn; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.lab_value_match_config', 'SELECT') or has_table_privilege('authenticated', 'public.lab_value_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.lab_value_links', 'UPDATE') or has_table_privilege('authenticated', 'public.lab_value_links', 'DELETE')
     or has_table_privilege('authenticated', 'public.lab_value_links', 'SELECT') or has_table_privilege('anon', 'public.lab_value_links', 'SELECT') then
    raise exception 'a client can reach the match config or write links';
  end if;
  if (select count(*) from public.lab_value_match_config) < 1 then raise exception 'no match config seeded'; end if;
  if (select prosrc from pg_proc where oid = 'private.biomarker_points(uuid,text)'::regprocedure) not like '%and not l.sensitive_positive%'
     or (select prosrc from pg_proc where oid = 'private.biomarker_points(uuid,text)'::regprocedure) not like '%not i.sensitive_positive%' then
    raise exception 'biomarker_points lost its sensitive_positive filter (OQ-S43m-5)';
  end if;
  if (select prosrc from pg_proc where oid = 'private.hr_biomarker_points(uuid,text)'::regprocedure) not like '%and not l.sensitive_positive%' then
    raise exception 'hr_biomarker_points lost its sensitive_positive filter (OQ-S43m-5)';
  end if;
end $$;
