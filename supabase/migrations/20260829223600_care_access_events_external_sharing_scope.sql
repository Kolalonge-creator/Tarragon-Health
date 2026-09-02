-- Tarragon Health
-- Data Governance gap-closure, item 4 of 7, step 2 of 2 (§87.12 "third-party
-- sharing" of the 2026-08-29 governance/safety spec audit). Confirmed live
-- before writing this: care_access_events + private.log_care_access()
-- already log person-to-person sharing (family/sponsor delegated access)
-- well, but its scope vocabulary has nothing for data sent to an EXTERNAL
-- ORGANISATION -- a lab, an HMO, the AI vendor. This is exactly where the
-- migration's own original comment (20260807010452) said new vocabulary
-- belongs.
--
-- Purely additive to the CHECK constraint. Wiring private.log_care_access()
-- calls into the actual lab-order/AI-case-brief send paths is a genuine
-- follow-up (this migration adds the vocabulary the spec asks for; call
-- sites adopting it is separate app-code work, not silently declared done
-- here).

alter table public.care_access_events
  drop constraint care_access_events_scope_known;

alter table public.care_access_events
  add constraint care_access_events_scope_known check (
    scope is null or scope = any (array[
      'care_receipt', 'health_summary', 'care_status', 'billing', 'refill_request', 'booking', 'messaging',
      'data_shared_lab', 'data_shared_hmo', 'data_shared_ai_vendor', 'data_shared_pharmacy', 'data_export_dsar'
    ])
  );

comment on constraint care_access_events_scope_known on public.care_access_events is
  'Vocabulary extended 2026-08-29 (§87.12) with data_shared_lab/hmo/ai_vendor/pharmacy + data_export_dsar for tracking disclosures to external organisations, alongside the original person-to-person sharing scopes.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.care_access_events'::regclass
      and conname = 'care_access_events_scope_known'
      and pg_get_constraintdef(oid) like '%data_shared_ai_vendor%'
  ) then
    raise exception 'care_access_events_scope_known missing the new external-sharing scope values';
  end if;
  if exists (
    select 1 from public.care_access_events
    where scope is not null and scope not in (
      'care_receipt', 'health_summary', 'care_status', 'billing', 'refill_request', 'booking', 'messaging',
      'data_shared_lab', 'data_shared_hmo', 'data_shared_ai_vendor', 'data_shared_pharmacy', 'data_export_dsar'
    )
  ) then
    raise exception 'an existing care_access_events row has a scope outside the new constraint -- migration is not safe to run';
  end if;
  raise notice 'PASS: care_access_events scope vocabulary now covers external-organisation sharing + DSAR export, zero existing rows affected';
end $$;
