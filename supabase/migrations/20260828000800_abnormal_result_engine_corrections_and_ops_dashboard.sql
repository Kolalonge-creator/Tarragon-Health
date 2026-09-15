-- Tarragon Health — Abnormal Result Engine: correction/reconciliation +
-- unified ops dashboard.
--
-- Closes two of the clearest gaps found against the RESULT -> VALIDATE ->
-- CLASSIFY -> ... -> CLOSED closed-loop spec: (1) screening_results has no
-- correction/reconciliation mechanism at all today — a lab that later
-- amends a result, or two results that disagree, simply coexist as
-- independent rows with nothing flagging it (§7.14/§7.15); (2) the
-- "Critical/Urgent/High/Routine, Unacknowledged/Overdue" ops dashboard the
-- spec describes (§7.17) doesn't exist as a single view — the numbers live
-- split across two separate analytics RPCs on two separate exec-facing
-- tabs, not one clinical-ops-facing page.
--
-- Design choices, and why:
--
-- 1. Append-only, no mutation. The abnormal-result trigger only ever fires
--    AFTER INSERT, never on UPDATE, and every other audit-relevant table on
--    this platform (patient_timeline,
--    audit_log, serology_status_transitions) is deliberately append-only.
--    A correction is therefore a NEW row linked back via corrects_result_id
--    — "Original / Correction received / Previous result retained /
--    Correction linked" (§7.15) falls out of that for free, and every
--    existing AFTER INSERT trigger on screening_results (patient_timeline,
--    care_plan_review_prompts, serology_state_machine,
--    screening_schedule_refresh_on_result, risk_reassessment_queue,
--    exposure_reopens_once_ever_serology) reacts to a correction exactly
--    like it would a fresh result — which is the clinically correct
--    behaviour: a corrected result IS the current result from every one of
--    those systems' point of view.
--
-- 2. record_result_correction() does NOT accept a clinician's own
--    classification directly. It takes an already-classified
--    result_status/result_summary/abnormal_flags exactly like the existing
--    screening_results insert path in submitScreeningResult does (both
--    trust the ML /interpret/labs output, never a raw client assertion) —
--    a clinician who disagrees with the resulting classification uses the
--    existing clinician_alerts.override_level/override_reason mechanism on
--    whatever alert comes out of it, not a second, parallel override
--    surface bolted onto correction.
--
-- 3. "Clinical review triggered if necessary" (§7.15) — the existing
--    handle_abnormal_screening_result() trigger already does this
--    unconditionally for a correction that lands as abnormal/critical (it
--    fires on every insert, reusing the fully SLA'd Priority-1 path). The
--    gap is the OTHER direction: a correction that walks a previously
--    abnormal/critical result back to normal/borderline does NOT fire that
--    trigger (it explicitly `return`s early for a non-abnormal result), so
--    nobody would otherwise be told "the result you were paged about has
--    been corrected". record_result_correction() closes that direction
--    explicitly, reusing the same screening_abnormal_result SLA tiers
--    (private.escalation_sla_minutes) rather than inventing a new one.
--
-- 4. Reconciliation (§7.14, "flag discrepancies rather than silently
--    replacing one") covers the case nobody filed an explicit correction
--    for: two results for the same patient + screen type landing within a
--    tight window with genuinely disagreeing classifications (one
--    normal/borderline, the other abnormal/critical) — e.g. two labs, or a
--    repeat sent for validation. The 14-day window is a data-hygiene
--    heuristic, not a clinical threshold: it is short enough that this
--    cannot fire on legitimate longitudinal change (chronic-disease
--    monitoring readings are protocol-spaced weeks to months apart; that
--    case is the trend engine's job, not this one's) and long enough to
--    catch "two results meant to represent the same clinical moment".
--
-- 5. Neither of the two new alert paths here invents a clinical threshold —
--    both reuse result_status values the existing, protocol-governed ML
--    classifier already produced, and both reuse the existing, seeded
--    escalation_slas config rather than a new number set by this migration.
--
-- 6. A live check before writing this migration (same discipline CLAUDE.md
--    asks for — check the live definition, not just whether a migration
--    file exists) found this is not hypothetical: screening_results has
--    carried a screening_results_update RLS policy since its very first
--    migration (20260705211237_prevention.sql, templated across five
--    prevention tables) that lets ANY org-staff session UPDATE ANY column
--    on ANY row — including result_status/abnormal_flags/result_summary —
--    with nothing beyond org membership gating it. The only thing standing
--    between that and a silent, unreviewed rewrite of a clinically
--    significant result today is that nobody happens to call .update() with
--    those columns (the one real caller, setScreeningResultFollowUpAction,
--    only ever touches follow_up_action) — "nobody happens to call it" is
--    exactly the kind of fragile guarantee CLAUDE.md's own standing lessons
--    warn about relying on. Part 1b below closes it structurally: the
--    columns that define what a result actually says become immutable via
--    UPDATE (silently pinned back to OLD.*, matching the established
--    enforce_lab_result_document_update convention for "upload-time facts
--    are immutable" rather than raising), follow_up_action stays freely
--    updatable, and record_result_correction() below becomes the only way
--    to change what a result says — which is also the only path that
--    reasons about clinical review. This is also why record_correction's
--    approach (a new linked row, never an UPDATE) was chosen over teaching
--    the platform-wide record_corrections audit trigger (capture_record_
--    correction_trg, 20260827203620) about screening_results specifically:
--    that trigger only ever logs a diff after the fact, it does not, and
--    was never meant to, decide whether a change needs clinical review.

-- ---------------------------------------------------------------------------
-- 1. Schema: correction linkage on screening_results.
-- ---------------------------------------------------------------------------
alter table public.screening_results
  add column if not exists corrects_result_id uuid references public.screening_results (id) on delete set null,
  add column if not exists correction_reason text;

comment on column public.screening_results.corrects_result_id is
  'Set only by record_result_correction(): this row supersedes the referenced row. The referenced row is never deleted or mutated — "is this result current" is derived as "no other row corrects it", never a status flag on the row itself.';
comment on column public.screening_results.correction_reason is
  'Required, clinician-entered reason for a correction — set only alongside corrects_result_id.';

-- ---------------------------------------------------------------------------
-- 1b. Lock the columns that define what a result actually says. See point 6
--     in the header: screening_results_update (RLS) has always allowed any
--     org-staff session to UPDATE any column on any row. follow_up_action
--     (setScreeningResultFollowUpAction, the one real caller) stays freely
--     updatable; everything else is pinned back to OLD.* on UPDATE, same
--     silent-revert convention as enforce_lab_result_document_update's
--     "upload-time facts are immutable". record_result_correction() below —
--     a new linked row, never an UPDATE — becomes the only way to change
--     what a result says.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_screening_result_clinical_columns_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.schedule_id        := old.schedule_id;
  new.lab_order_id       := old.lab_order_id;
  new.result_status      := old.result_status;
  new.result_summary     := old.result_summary;
  new.abnormal_flags     := old.abnormal_flags;
  new.screen_type_code   := old.screen_type_code;
  new.created_at         := old.created_at;
  new.corrects_result_id := old.corrects_result_id;
  new.correction_reason  := old.correction_reason;
  return new;
end;
$$;

comment on function private.enforce_screening_result_clinical_columns_immutable() is
  'BEFORE UPDATE on screening_results. Every column that defines what a result says is immutable after insert; follow_up_action (the one legitimate direct-update field) passes through untouched. See migration header point 6.';

drop trigger if exists screening_results_lock_clinical_columns on public.screening_results;
create trigger screening_results_lock_clinical_columns
  before update on public.screening_results
  for each row execute function private.enforce_screening_result_clinical_columns_immutable();

-- ---------------------------------------------------------------------------
-- 2. Reconciliation: flag two independently-arrived, disagreeing results
--    rather than silently trusting the latest.
-- ---------------------------------------------------------------------------
create or replace function private.flag_screening_result_discrepancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior record;
  v_new_bucket text;
  v_prior_bucket text;
  v_pair_low uuid;
  v_pair_high uuid;
  v_dedup_tag text;
  v_level public.alert_level;
begin
  -- An explicit correction has its own, more specific review path above —
  -- this is only for results that showed up with no declared relationship
  -- to each other.
  if new.corrects_result_id is not null or new.screen_type_code is null then
    return new;
  end if;

  v_new_bucket := case when new.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;

  select sr.id, sr.result_status, sr.created_at
    into v_prior
    from public.screening_results sr
    where sr.patient_id = new.patient_id
      and sr.screen_type_code = new.screen_type_code
      and sr.id <> new.id
      and sr.created_at >= new.created_at - interval '14 days'
      and sr.created_at <= new.created_at
      -- Don't compare against a prior result that has itself since been
      -- corrected — the correction is the current fact, not the original.
      and not exists (select 1 from public.screening_results nc where nc.corrects_result_id = sr.id)
    order by sr.created_at desc
    limit 1;

  if v_prior.id is null then
    return new;
  end if;

  v_prior_bucket := case when v_prior.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;
  if v_prior_bucket = v_new_bucket then
    return new;
  end if;

  v_pair_low := least(v_prior.id, new.id);
  v_pair_high := greatest(v_prior.id, new.id);
  v_dedup_tag := format('[discrepancy:%s:%s]', v_pair_low, v_pair_high);

  if exists (
    select 1 from public.clinician_alerts
    where patient_id = new.patient_id and detail like v_dedup_tag || '%'
  ) then
    return new;
  end if;

  v_level := case when new.result_status = 'critical' or v_prior.result_status = 'critical'
    then 'urgent_escalation' else 'clinician_review' end;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    v_level,
    'open',
    'Conflicting results require validation',
    format('%s %s screen: result %s (%s, %s) disagrees with result %s (%s, %s) within 14 days for the same patient — validate before relying on either.',
      v_dedup_tag, new.screen_type_code,
      v_prior.id, v_prior.result_status, v_prior.created_at::date,
      new.id, new.result_status, new.created_at::date),
    now() + (private.escalation_sla_minutes('screening_abnormal_result', v_level) * interval '1 minute'),
    new.id,
    case when v_level = 'urgent_escalation' then 3 else 2 end
  );

  return new;
end;
$$;

comment on function private.flag_screening_result_discrepancy() is
  'AFTER INSERT on screening_results — §7.14 reconciliation. Flags a discrepancy (one normal/borderline vs one abnormal/critical for the same patient + screen type within 14 days) rather than silently trusting whichever arrived last. Never fires for an explicit correction (corrects_result_id set) — that has its own path in record_result_correction(). Dedup keyed to the exact result-id pair via a [discrepancy:low:high] tag in detail, mirroring the [code] tag convention in lib/cv-risk/escalate.ts.';

drop trigger if exists flag_screening_result_discrepancy_trigger on public.screening_results;
create trigger flag_screening_result_discrepancy_trigger
  after insert on public.screening_results
  for each row execute function private.flag_screening_result_discrepancy();

-- ---------------------------------------------------------------------------
-- 3. record_result_correction() — the explicit correction path.
-- ---------------------------------------------------------------------------
create or replace function public.record_result_correction(
  p_original_result_id uuid,
  p_result_status public.result_status,
  p_result_summary text,
  p_abnormal_flags text[],
  p_correction_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.screening_results%rowtype;
  v_new_id uuid;
  v_old_bucket text;
  v_new_bucket text;
  v_level public.alert_level;
begin
  select * into v_original from public.screening_results where id = p_original_result_id;
  if v_original.id is null then
    raise exception 'Original result not found' using errcode = '22023';
  end if;

  if not private.is_org_staff(v_original.organisation_id) then
    raise exception 'not authorised';
  end if;
  if not exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active
  ) then
    raise exception 'Only an active Tarragon care-team doctor can file a result correction';
  end if;
  if p_correction_reason is null or length(btrim(p_correction_reason)) = 0 then
    raise exception 'A correction reason is required' using errcode = '22023';
  end if;

  -- Correct the head of the chain only — keeps corrects_result_id a single
  -- linear history per original result rather than silently forking it.
  if exists (select 1 from public.screening_results where corrects_result_id = p_original_result_id) then
    raise exception 'This result has already been corrected — correct the newer version instead' using errcode = '22023';
  end if;

  insert into public.screening_results
    (organisation_id, patient_id, schedule_id, screen_type_code, lab_order_id,
     result_status, result_summary, abnormal_flags, corrects_result_id, correction_reason)
  values
    (v_original.organisation_id, v_original.patient_id, v_original.schedule_id,
     v_original.screen_type_code, v_original.lab_order_id,
     p_result_status, p_result_summary, coalesce(p_abnormal_flags, '{}'), v_original.id, p_correction_reason)
  returning id into v_new_id;

  v_old_bucket := case when v_original.result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;
  v_new_bucket := case when p_result_status in ('abnormal', 'critical') then 'flagged' else 'clear' end;

  -- handle_abnormal_screening_result() already covers clear -> flagged (it
  -- fires unconditionally on this insert for an abnormal/critical row) and
  -- flagged -> flagged (same trigger, re-raises at the new severity). Only
  -- the flagged -> clear direction has nobody watching it by default: the
  -- original alert, and whatever it already set in motion, needs a human
  -- to actually reconcile it, not silently go stale.
  if v_old_bucket = 'flagged' and v_new_bucket = 'clear' then
    v_level := case when v_original.result_status = 'critical' then 'urgent_escalation' else 'clinician_review' end;

    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
    values (
      v_original.organisation_id,
      v_original.patient_id,
      v_level,
      'open',
      'Result correction: previous result stood down',
      format('Result %s was %s; correction %s revises it to %s. Reason: %s. Confirm any action already taken on the original result (patient notification, drafted care plan, referral) is reconciled.',
        v_original.id, v_original.result_status, v_new_id, p_result_status, p_correction_reason),
      now() + (private.escalation_sla_minutes('screening_abnormal_result', v_level) * interval '1 minute'),
      v_new_id,
      case when v_level = 'urgent_escalation' then 3 else 2 end
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_original.organisation_id, auth.uid(), 'screening_result.corrected', 'screening_results', v_new_id,
    jsonb_build_object(
      'original_result_id', v_original.id,
      'original_status', v_original.result_status,
      'corrected_status', p_result_status,
      'reason', p_correction_reason
    )
  );

  return v_new_id;
end;
$$;

comment on function public.record_result_correction(uuid, public.result_status, text, text[], text) is
  'Files a lab/clinical result correction — §7.15. Inserts a new screening_results row linked via corrects_result_id (original retained, never mutated); every existing AFTER INSERT trigger on screening_results reacts to it exactly like a fresh result. When the correction walks a previously abnormal/critical result back to normal/borderline (the one direction handle_abnormal_screening_result does not itself cover), also raises an explicit stand-down review alert on the same SLA tiers as a fresh abnormal result. Caller must hold an active clinical_staff row — filing a correction is a clinical judgement call, same gate as setScreeningResultFollowUpAction.';

revoke all on function public.record_result_correction(uuid, public.result_status, text, text[], text) from public, anon;
grant execute on function public.record_result_correction(uuid, public.result_status, text, text[], text) to authenticated;
revoke execute on function public.record_result_correction(uuid, public.result_status, text, text[], text) from anon;

-- ---------------------------------------------------------------------------
-- 4. Unified abnormal-result ops dashboard counts — §7.17.
--    Critical/Urgent/High/Routine map onto the existing alert_level enum
--    (emergency/urgent_escalation/clinician_review/routine); Unacknowledged
--    and Overdue mirror the exact semantics analytics_escalation_quality's
--    open_alerts/overdue_alerts already use, just scoped to one org and
--    shaped for a clinical-ops page rather than an exec analytics tab.
--    Effective level (override_level, when a clinician has recorded one)
--    is used for bucketing — the same value the clinician worklist itself
--    ranks by (lib/worklist/priority.ts's effectiveAlertLevel).
-- ---------------------------------------------------------------------------
create or replace function public.abnormal_result_dashboard_counts(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_staff(p_organisation_id) then
    return '{}'::jsonb;
  end if;

  return (
    select jsonb_build_object(
      'critical', count(*) filter (where coalesce(override_level, level) = 'emergency'),
      'urgent', count(*) filter (where coalesce(override_level, level) = 'urgent_escalation'),
      'high', count(*) filter (where coalesce(override_level, level) = 'clinician_review'),
      'routine', count(*) filter (where coalesce(override_level, level) = 'routine'),
      'unacknowledged', count(*),
      'overdue', count(*) filter (where sla_due_at is not null and sla_due_at < now()),
      'unclaimed', count(*) filter (where acknowledged_by is null)
    )
    from public.clinician_alerts
    where organisation_id = p_organisation_id and status = 'open'
  );
end;
$$;

comment on function public.abnormal_result_dashboard_counts(uuid) is
  'The Critical/Urgent/High/Routine + Unacknowledged/Overdue summary from §7.17, scoped to one org for the clinical-ops-facing worklist page (distinct from the cross-org exec analytics_escalation_quality/analytics_operations_summary RPCs). unclaimed = open with no acknowledged_by yet, i.e. still owned by the org clinical pool rather than a named clinician — see the "Result ownership" §7.9 acceptance criterion.';

revoke all on function public.abnormal_result_dashboard_counts(uuid) from public, anon;
grant execute on function public.abnormal_result_dashboard_counts(uuid) to authenticated;
revoke execute on function public.abnormal_result_dashboard_counts(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_results' and column_name = 'corrects_result_id'
  ) then
    raise exception 'screening_results.corrects_result_id was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_results' and column_name = 'correction_reason'
  ) then
    raise exception 'screening_results.correction_reason was not added';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'screening_results_lock_clinical_columns') then
    raise exception 'screening_results_lock_clinical_columns was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'flag_screening_result_discrepancy_trigger') then
    raise exception 'flag_screening_result_discrepancy_trigger was not created';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_result_correction'
  ) then
    raise exception 'record_result_correction was not created';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'abnormal_result_dashboard_counts'
  ) then
    raise exception 'abnormal_result_dashboard_counts was not created';
  end if;

  if has_function_privilege('anon', 'public.record_result_correction(uuid, public.result_status, text, text[], text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute record_result_correction';
  end if;
  if not has_function_privilege('authenticated', 'public.record_result_correction(uuid, public.result_status, text, text[], text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute record_result_correction';
  end if;
  if has_function_privilege('anon', 'public.abnormal_result_dashboard_counts(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute abnormal_result_dashboard_counts';
  end if;
  if not has_function_privilege('authenticated', 'public.abnormal_result_dashboard_counts(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute abnormal_result_dashboard_counts';
  end if;

  raise notice 'PASS: abnormal result engine corrections/reconciliation + ops dashboard all present, ACLs correct';
end $$;
