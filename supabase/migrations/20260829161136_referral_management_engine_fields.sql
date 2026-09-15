-- Tarragon Health — Referral Management Engine (67.x), remaining gaps not
-- already covered by the concurrently-shipped Specialist Referral
-- intake/provenance/outcome-and-closure work (20260828231917/231947): "where
-- did this referral come from, what does it actually ask the specialist to
-- do, and how do we know why it stalled or got declined."
--
-- specialist_referrals already carries, as of this migration:
--   * origin (booking_origin) — payment-rail concept, distinct from clinical
--     origin, left alone.
--   * referred_by / preferred_consultation_type / preferred_location /
--     parent_referral_id (20260828231917) — clinical provenance/preference,
--     already covers "who created this and what do they prefer."
--   * outcome_document_path / care_plan_update_note / closed_at / closed_by
--     + the status='closed' CHECK (20260828231947) — already covers closure
--     integrity; this migration does NOT duplicate it.
--
-- What's still missing and added here:
--   * referral_source: a clinical origin TAXONOMY (abnormal result, chronic-
--     care programme, emergency assessment, hospital discharge...) — the
--     live referred_by/provenance work tracks WHO and a soft consult-type
--     preference, not WHY the episode exists. Deliberately a separate
--     column from `origin` (payment-rail) so neither meaning is overloaded.
--   * requested_service: what specifically is being asked of the specialist,
--     beyond the bare specialist_type (67.6's "avoid a bare 'please see
--     patient for further assessment'").
--   * appropriateness_flags: a point-in-time snapshot of the CDS advisory
--     checks run at submission (67.7) — advisory only, audit trail, never a
--     gate; the referring clinician stays accountable either way.
--   * declined_reason: "referral rejected" must always carry a reason
--     (67.12) — the live closure work's CHECK only governs status='closed',
--     not 'declined', so this is a real, non-duplicated gap.
--   * submitted_at: when the episode left draft and went live (67.4) — the
--     live schema has no draft concept at all yet (added in the next
--     migration in this series).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'referral_source') then
    create type public.referral_source as enum (
      'clinician_initiated',
      'abnormal_lab_result',
      'abnormal_imaging_result',
      'chronic_care_programme',
      'emergency_assessment',
      'specialist_recommendation',
      'hospital_discharge',
      'clinical_rule'
    );
  end if;
end $$;

alter table public.specialist_referrals
  add column if not exists referral_source public.referral_source not null default 'clinician_initiated',
  add column if not exists requested_service text,
  add column if not exists appropriateness_flags jsonb not null default '[]'::jsonb,
  add column if not exists declined_reason text,
  add column if not exists submitted_at timestamptz;

comment on column public.specialist_referrals.referral_source is
  'Clinical origin of the episode (67.2) — distinct from both the payment-rail origin column and referred_by/preferred_* (who created it / their soft preference). Backfilled from screening_upgrade_id where present; new referrals set it explicitly at creation.';
comment on column public.specialist_referrals.requested_service is
  'What is specifically being asked of the specialist, beyond the bare specialist_type — the "clinical question" half of the referral package (67.6), avoids a bare "please see patient for further assessment."';
comment on column public.specialist_referrals.appropriateness_flags is
  'Snapshot of CDS advisory checks (apps/web/src/lib/referrals/appropriateness-check.ts) run at submission — audit trail only. Never blocks: the referring clinician remains accountable for the decision (67.7).';
comment on column public.specialist_referrals.declined_reason is
  'Required when status is declined (67.12) — enforced by specialist_referrals_declined_requires_reason below. Distinct from care_plan_update_note (20260828231947), which governs closure, not decline.';
comment on column public.specialist_referrals.submitted_at is
  'When the episode left draft and became a live referral (67.4 Draft -> Submitted). Null for a still-draft referral. Server-stamped by enforce_specialist_referral_create / stamp_specialist_referral_submission, never client-supplied.';

-- Backfill: every existing row predates this column and was, in practice,
-- either triggered by an abnormal screening result or created directly by a
-- clinician — the only two paths that existed before this migration.
update public.specialist_referrals
  set referral_source = 'abnormal_lab_result'
  where screening_upgrade_id is not null and referral_source = 'clinician_initiated';

-- submitted_at: the 'draft' status doesn't exist until the next migration in
-- this series, so every row that exists right now was, by definition,
-- already live the moment it was created.
update public.specialist_referrals
  set submitted_at = created_at
  where submitted_at is null;

-- declined_reason: backfill any pre-existing declined row before the CHECK
-- constraint goes on, same defensive discipline as the live
-- specialist_referrals_closed_requires_outcome migration used for its own
-- backfill. Row count was 0 as of 2026-08-03 and creation has stayed narrow
-- since, but this is never assumed.
update public.specialist_referrals
  set declined_reason = 'Reason not recorded (retroactive backfill on ' || to_char(now(), 'YYYY-MM-DD') || ')'
  where status = 'declined' and declined_reason is null;

alter table public.specialist_referrals
  add constraint specialist_referrals_declined_requires_reason
    check (status <> 'declined' or declined_reason is not null);

do $$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'specialist_referrals'
     and column_name in (
       'referral_source', 'requested_service', 'appropriateness_flags',
       'declined_reason', 'submitted_at'
     );
  if v_n <> 5 then
    raise exception 'not all referral management engine columns were created (found %)', v_n;
  end if;
  if exists (select 1 from public.specialist_referrals where status = 'declined' and declined_reason is null) then
    raise exception 'a declined referral still has no reason after backfill';
  end if;
end $$;
