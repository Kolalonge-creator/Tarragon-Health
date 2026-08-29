-- Tarragon Health — Provider Quality & Performance Management, part 1/6:
-- taxonomy + governance policy.
--
-- §29's opening line is the whole design constraint: "Provider performance is
-- not the same thing as provider popularity." Everything downstream of this
-- migration is built so that a provider's record is a SET of separately-
-- reported domain figures, never one blended number a reader can rank a
-- roster by. §29.10 states that outright ("Commercial performance and clinical
-- quality should not be mixed into one simplistic provider score. A clinician
-- who sees fewer patients should not automatically be classified as worse"),
-- and it is enforced here in three concrete ways rather than left as a
-- comment:
--   1. provider_quality_domain is an enum, and every metric belongs to
--      exactly one domain. There is no cross-domain roll-up anywhere in
--      parts 1-6, and no column, RPC key, or UI element named "score".
--   2. Every metric carries min_denominator. Below it, part 6 returns the
--      raw counts and an explicit `insufficient_volume` flag instead of a
--      rate — a doctor with 3 appointments cannot be shown as "67%".
--   3. clinical_quality metrics carry `clinically_governed`, and part 6
--      refuses to compute any metric whose governed flag is false. §29.1's
--      "Clinical quality: only where validated and clinically governed" is
--      therefore a data gate an unsigned policy version fails, not a promise.
--
-- The volume metrics that WOULD make a crude ranking possible (appointments
-- seen, prescriptions written) are deliberately absent from
-- provider_quality_metric entirely. §29.3's warning — "avoid crude metrics
-- such as: 'Doctor with most prescriptions = best doctor'" — is honoured by
-- there being no such metric to select, not by a policy asking readers not to
-- use one.
--
-- Shape follows the two established governance ledgers in this codebase,
-- escalation_slas (20260730105131) and alert_rules (20260828013011): one
-- versioned jsonb config document, is_active marks the live one, no per-row
-- organisation_id (platform-wide clinical governance), first version ships
-- active-but-unsigned with approved_by/approved_at null for a Clinical
-- Director to sign later via a dedicated gated RPC. Verified against those
-- two before writing rather than inventing a fourth pattern.

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------

create type public.provider_quality_domain as enum (
  'operational',
  'documentation',
  'patient_experience',
  'clinical_quality'
);

comment on type public.provider_quality_domain is
  '§29.1 performance domains. Reported separately, always — there is deliberately no roll-up across domains anywhere in the provider quality module (§29.10).';

create type public.provider_quality_metric as enum (
  -- §29.1 Operational: punctuality, cancellations, no-shows, response time,
  -- appointment completion.
  'appointment_completion_rate',
  'provider_cancellation_rate',
  'patient_no_show_rate',
  'appointment_punctuality_rate',
  'alert_response_minutes',
  'escalation_resolution_hours',
  'alert_sla_met_rate',
  -- §29.1 Documentation: notes completed, referrals documented, results
  -- acknowledged.
  'encounter_note_completion_rate',
  'referral_documentation_rate',
  'result_acknowledgement_rate',
  -- §29.1 Patient experience: communication, professionalism, satisfaction
  -- (plus punctuality-as-experienced, which is a different fact from the
  -- operational punctuality rate above — one is the clock, one is how it
  -- felt).
  'experience_punctuality',
  'experience_communication',
  'experience_professionalism',
  'experience_overall',
  -- §29.3 Clinical quality indicators. Every one of these is gated on
  -- clinically_governed in the active policy; see part 6.
  'abnormal_result_response_hours',
  'follow_up_completion_rate',
  'care_gap_resolution_rate',
  'guideline_adherence_rate'
);

comment on type public.provider_quality_metric is
  '§29.1/§29.3 metrics. Note what is NOT here: no appointment-volume, prescription-count, or revenue metric exists in this enum, so §29.3''s "doctor with most prescriptions = best doctor" cannot be expressed by this module at all.';

create type public.provider_quality_direction as enum ('higher_is_better', 'lower_is_better');

-- ---------------------------------------------------------------------------
-- Governance ledger
-- ---------------------------------------------------------------------------

create table public.provider_quality_policy (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint provider_quality_policy_version_unique unique (version),
  constraint provider_quality_policy_signature_paired
    check ((approved_by is null) = (approved_at is null))
);

comment on table public.provider_quality_policy is
  'Governed jsonb-document ledger for the Provider Quality module, same shape as escalation_slas/alert_rules. config.metrics[] carries one entry per provider_quality_metric (domain, direction, target/warning thresholds, min_denominator, clinically_governed); config.credential_ladder carries the §29.7 warning -> grace -> restriction -> suspension day offsets as data, not code. Reader: private.provider_quality_policy_config().';

comment on column public.provider_quality_policy.approved_by is
  'The Clinical Director who signed this version. Null on a freshly-proposed version — the same active-but-unsigned posture escalation_slas has shipped with since 20260730105131; part 6 still refuses clinical_quality metrics whose own clinically_governed flag is false regardless of whether the document itself is signed.';

create unique index provider_quality_policy_one_active_idx
  on public.provider_quality_policy (is_active) where is_active;

alter table public.provider_quality_policy enable row level security;

-- Readable by any authenticated caller: a clinician being measured is
-- entitled to see the thresholds they are measured against (§29.9 "Providers
-- should be able to see their own performance" is meaningless if the target
-- line is hidden from them).
create policy provider_quality_policy_select on public.provider_quality_policy
  for select to authenticated using (true);

create policy provider_quality_policy_insert on public.provider_quality_policy
  for insert to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.provider_quality_policy to authenticated;
revoke update, delete on public.provider_quality_policy from authenticated;

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

create or replace function private.provider_quality_policy_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select config from public.provider_quality_policy where is_active limit 1;
$$;

comment on function private.provider_quality_policy_config() is
  'The live policy document, or null when no version is active. Callers must treat null as "do not compute" rather than falling back to a hardcoded default — an unconfigured platform must not silently invent quality thresholds.';

revoke all on function private.provider_quality_policy_config() from public;

create or replace function private.provider_quality_metric_policy(p_metric public.provider_quality_metric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select m
  from jsonb_array_elements(
         coalesce(private.provider_quality_policy_config() -> 'metrics', '[]'::jsonb)
       ) as m
  where m ->> 'metric' = p_metric::text
  limit 1;
$$;

comment on function private.provider_quality_metric_policy(public.provider_quality_metric) is
  'One metric''s policy entry from the active document, or null if the metric is not configured. Null means "not measured here" — never "measured with defaults".';

revoke all on function private.provider_quality_metric_policy(public.provider_quality_metric) from public;

create or replace function private.provider_quality_metric_is_reportable(p_metric public.provider_quality_metric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when private.provider_quality_metric_policy(p_metric) is null then false
      -- §29.1: clinical quality "only where validated and clinically
      -- governed". A clinical_quality metric must carry an explicit
      -- clinically_governed=true; every other domain is reportable once
      -- configured.
      when (private.provider_quality_metric_policy(p_metric) ->> 'domain') = 'clinical_quality'
        then (private.provider_quality_metric_policy(p_metric) ->> 'clinically_governed')::boolean
      else true
    end,
    false
  );
$$;

comment on function private.provider_quality_metric_is_reportable(public.provider_quality_metric) is
  '§29.1 clinical-governance gate. False for an unconfigured metric and for any clinical_quality metric whose clinically_governed flag is not explicitly true — part 6 omits such a metric from the scorecard entirely rather than reporting an ungoverned clinical number.';

revoke all on function private.provider_quality_metric_is_reportable(public.provider_quality_metric) from public;

-- ---------------------------------------------------------------------------
-- Signing (Clinical Director only, same gate shape as sign_alert_rules)
-- ---------------------------------------------------------------------------

create or replace function public.sign_provider_quality_policy(p_policy_id uuid)
returns public.provider_quality_policy
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_row      public.provider_quality_policy;
begin
  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director;

  if v_staff_id is null then
    raise exception 'only an active Clinical Director may sign the provider quality policy'
      using errcode = '42501';
  end if;

  update public.provider_quality_policy
    set is_active = false
    where is_active and id <> p_policy_id;

  update public.provider_quality_policy
    set approved_by = v_staff_id,
        approved_at = now(),
        is_active = true
    where id = p_policy_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'provider quality policy version not found';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'provider_quality_policy.signed',
         'provider_quality_policy', v_row.id,
         jsonb_build_object('version', v_row.version)
  from public.clinical_staff cs where cs.id = v_staff_id;

  return v_row;
end;
$$;

comment on function public.sign_provider_quality_policy(uuid) is
  'Clinical-Director-gated activation + signature of a provider quality policy version. Deactivates whatever version was previously live in the same statement, so the one-active unique index can never be violated by a two-step sign.';

revoke execute on function public.sign_provider_quality_policy(uuid) from public, anon;
grant execute on function public.sign_provider_quality_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- v1 — active, unsigned. Thresholds are starting operating targets, NOT
-- clinical standards: every clinical_quality metric ships
-- clinically_governed=false, so part 6 will report none of them until a
-- Clinical Director has validated the definition and flipped the flag in a
-- new version. That is the honest launch state — the platform has no
-- validated provider-level clinical quality measurement yet, and §29.1 says
-- not to report one until it does.
-- ---------------------------------------------------------------------------

insert into public.provider_quality_policy (version, config, notes, is_active)
values (
  1,
  jsonb_build_object(
    'metrics', jsonb_build_array(
      jsonb_build_object('metric', 'appointment_completion_rate', 'domain', 'operational',
        'direction', 'higher_is_better', 'target', 90, 'warning', 80, 'min_denominator', 10, 'unit', 'percent'),
      jsonb_build_object('metric', 'provider_cancellation_rate', 'domain', 'operational',
        'direction', 'lower_is_better', 'target', 5, 'warning', 10, 'min_denominator', 10, 'unit', 'percent'),
      jsonb_build_object('metric', 'patient_no_show_rate', 'domain', 'operational',
        'direction', 'lower_is_better', 'target', 15, 'warning', 25, 'min_denominator', 10, 'unit', 'percent',
        'note', 'Reported for context, never as a provider fault — a patient not attending is not the provider''s performance.'),
      jsonb_build_object('metric', 'appointment_punctuality_rate', 'domain', 'operational',
        'direction', 'higher_is_better', 'target', 85, 'warning', 70, 'min_denominator', 10, 'unit', 'percent',
        'grace_minutes', 10),
      jsonb_build_object('metric', 'alert_response_minutes', 'domain', 'operational',
        'direction', 'lower_is_better', 'target', 30, 'warning', 60, 'min_denominator', 5, 'unit', 'minutes'),
      jsonb_build_object('metric', 'escalation_resolution_hours', 'domain', 'operational',
        'direction', 'lower_is_better', 'target', 4, 'warning', 8, 'min_denominator', 5, 'unit', 'hours'),
      jsonb_build_object('metric', 'alert_sla_met_rate', 'domain', 'operational',
        'direction', 'higher_is_better', 'target', 95, 'warning', 85, 'min_denominator', 5, 'unit', 'percent'),

      jsonb_build_object('metric', 'encounter_note_completion_rate', 'domain', 'documentation',
        'direction', 'higher_is_better', 'target', 95, 'warning', 85, 'min_denominator', 5, 'unit', 'percent'),
      jsonb_build_object('metric', 'referral_documentation_rate', 'domain', 'documentation',
        'direction', 'higher_is_better', 'target', 95, 'warning', 85, 'min_denominator', 3, 'unit', 'percent'),
      jsonb_build_object('metric', 'result_acknowledgement_rate', 'domain', 'documentation',
        'direction', 'higher_is_better', 'target', 98, 'warning', 90, 'min_denominator', 5, 'unit', 'percent'),

      jsonb_build_object('metric', 'experience_punctuality', 'domain', 'patient_experience',
        'direction', 'higher_is_better', 'target', 4.0, 'warning', 3.5, 'min_denominator', 5, 'unit', 'rating_1_5'),
      jsonb_build_object('metric', 'experience_communication', 'domain', 'patient_experience',
        'direction', 'higher_is_better', 'target', 4.0, 'warning', 3.5, 'min_denominator', 5, 'unit', 'rating_1_5'),
      jsonb_build_object('metric', 'experience_professionalism', 'domain', 'patient_experience',
        'direction', 'higher_is_better', 'target', 4.0, 'warning', 3.5, 'min_denominator', 5, 'unit', 'rating_1_5'),
      jsonb_build_object('metric', 'experience_overall', 'domain', 'patient_experience',
        'direction', 'higher_is_better', 'target', 4.0, 'warning', 3.5, 'min_denominator', 5, 'unit', 'rating_1_5'),

      jsonb_build_object('metric', 'abnormal_result_response_hours', 'domain', 'clinical_quality',
        'direction', 'lower_is_better', 'target', 4, 'warning', 8, 'min_denominator', 5, 'unit', 'hours',
        'clinically_governed', false,
        'note', 'Maps to the 4-hour abnormal-result contact SLA. Not reportable until a Clinical Director validates that reviewed_at on an abnormal-result escalation is a fair measure of clinician response.'),
      jsonb_build_object('metric', 'follow_up_completion_rate', 'domain', 'clinical_quality',
        'direction', 'higher_is_better', 'target', 90, 'warning', 75, 'min_denominator', 10, 'unit', 'percent',
        'clinically_governed', false),
      jsonb_build_object('metric', 'care_gap_resolution_rate', 'domain', 'clinical_quality',
        'direction', 'higher_is_better', 'target', 80, 'warning', 60, 'min_denominator', 10, 'unit', 'percent',
        'clinically_governed', false),
      jsonb_build_object('metric', 'guideline_adherence_rate', 'domain', 'clinical_quality',
        'direction', 'higher_is_better', 'target', 90, 'warning', 75, 'min_denominator', 10, 'unit', 'percent',
        'clinically_governed', false)
    ),
    'credential_ladder', jsonb_build_object(
      'warning_days_before_expiry', 30,
      'grace_days_after_expiry', 14,
      'restriction_days_after_expiry', 15,
      'suspension_days_after_expiry', 30
    ),
    'intervention_triggers', jsonb_build_array(
      jsonb_build_object('when', 'metric_below_warning_two_consecutive_periods', 'suggest', 'feedback'),
      jsonb_build_object('when', 'upheld_complaint', 'suggest', 'supervision'),
      jsonb_build_object('when', 'serious_or_critical_complaint', 'suggest', 'formal_investigation'),
      jsonb_build_object('when', 'credential_suspension', 'suggest', 'restricted_access')
    )
  ),
  'v1 initial operating targets. Every clinical_quality metric ships clinically_governed=false deliberately: no provider-level clinical quality measure on this platform has been validated or signed off yet, and §29.1 permits reporting one only where it has been. Operational/documentation/experience thresholds are management targets, not clinical standards.',
  true
);

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_config jsonb;
  v_metric_count integer;
  v_enum_count integer;
begin
  v_config := private.provider_quality_policy_config();
  if v_config is null then
    raise exception 'FAIL: no active provider_quality_policy after seeding v1';
  end if;

  select count(*) into v_enum_count
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'provider_quality_metric';

  select count(*) into v_metric_count
  from jsonb_array_elements(v_config -> 'metrics');

  if v_metric_count <> v_enum_count then
    raise exception 'FAIL: % provider_quality_metric enum values but % configured in policy v1', v_enum_count, v_metric_count;
  end if;

  if private.provider_quality_metric_is_reportable('guideline_adherence_rate') then
    raise exception 'FAIL: an ungoverned clinical_quality metric is reportable — the §29.1 governance gate does not discriminate';
  end if;
  if not private.provider_quality_metric_is_reportable('appointment_completion_rate') then
    raise exception 'FAIL: a configured operational metric is not reportable — the gate is over-blocking';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'provider_quality_metric'
      and (e.enumlabel like '%prescription%' or e.enumlabel like '%revenue%'
           or e.enumlabel like '%volume%' or e.enumlabel like '%_count')
  ) then
    raise exception 'FAIL: a volume/revenue metric exists in provider_quality_metric — §29.3 forbids it';
  end if;

  if (v_config -> 'credential_ladder' ->> 'suspension_days_after_expiry')::int
     <= (v_config -> 'credential_ladder' ->> 'restriction_days_after_expiry')::int then
    raise exception 'FAIL: credential ladder is not monotonic (suspension must come after restriction)';
  end if;

  if has_function_privilege('anon', 'public.sign_provider_quality_policy(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute sign_provider_quality_policy';
  end if;
  if not has_function_privilege('authenticated', 'public.sign_provider_quality_policy(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute sign_provider_quality_policy';
  end if;
  if has_table_privilege('authenticated', 'public.provider_quality_policy', 'UPDATE')
     or has_table_privilege('authenticated', 'public.provider_quality_policy', 'DELETE') then
    raise exception 'FAIL: authenticated holds UPDATE/DELETE on provider_quality_policy';
  end if;

  raise notice 'PASS: provider quality taxonomy + governance policy v1 active (unsigned), clinical-quality metrics gated off, no volume/revenue metric exists';
end $$;
