-- Tarragon Control — M1: append-only audit log
-- Source: docs/tarragon-build-spec-v3.md §5.11
-- "Append-only. Revoke UPDATE and DELETE from all roles including service
-- role. Attach a generic trigger to every table holding patient data."

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if TG_OP = 'DELETE' then
    v_row_id := OLD.id;
    v_before := to_jsonb(OLD);
    v_after := null;
  elsif TG_OP = 'INSERT' then
    v_row_id := NEW.id;
    v_before := null;
    v_after := to_jsonb(NEW);
  else -- UPDATE
    v_row_id := NEW.id;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  end if;

  insert into audit_log (
    actor_profile_id, actor_role, action, table_name, row_id, before, after, ip
  ) values (
    auth.uid(),
    private.current_role(),
    TG_OP,
    TG_TABLE_NAME,
    v_row_id,
    v_before,
    v_after,
    inet_client_addr()
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.write_audit_log is
  'Generic audit trigger. actor_role reads profiles.role at write time via private.current_role() rather than trusting a client-supplied value. ip is the DB-connection-level client address (PostgREST/Supavisor), not necessarily the end-user browser IP behind it — sufficient for the append-only trail the spec asks for, not a substitute for edge/app-layer request logging if that is ever needed.';

-- Attach to every table holding patient data (spec §5.11's own phrase).
-- Reference/catalog tables (organisations, programmes, partners,
-- notification_templates, protocol_configs, app_config) are deliberately
-- NOT wired here — they hold no individual patient data. app_config's own
-- set_by/set_at columns already carry its accountability trail per §1.

create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function private.write_audit_log();

create trigger trg_audit_patients
  after insert or update or delete on patients
  for each row execute function private.write_audit_log();

create trigger trg_audit_clinicians
  after insert or update or delete on clinicians
  for each row execute function private.write_audit_log();

create trigger trg_audit_devices
  after insert or update or delete on devices
  for each row execute function private.write_audit_log();

create trigger trg_audit_consent_records
  after insert or update or delete on consent_records
  for each row execute function private.write_audit_log();

create trigger trg_audit_readings
  after insert or update or delete on readings
  for each row execute function private.write_audit_log();

create trigger trg_audit_triage_classifications
  after insert or update or delete on triage_classifications
  for each row execute function private.write_audit_log();

create trigger trg_audit_clinical_contacts
  after insert or update or delete on clinical_contacts
  for each row execute function private.write_audit_log();

create trigger trg_audit_clinical_notes
  after insert or update or delete on clinical_notes
  for each row execute function private.write_audit_log();

create trigger trg_audit_escalations
  after insert or update or delete on escalations
  for each row execute function private.write_audit_log();

create trigger trg_audit_referrals
  after insert or update or delete on referrals
  for each row execute function private.write_audit_log();

create trigger trg_audit_medications
  after insert or update or delete on medications
  for each row execute function private.write_audit_log();

create trigger trg_audit_medication_dispenses
  after insert or update or delete on medication_dispenses
  for each row execute function private.write_audit_log();

create trigger trg_audit_lab_orders
  after insert or update or delete on lab_orders
  for each row execute function private.write_audit_log();

create trigger trg_audit_enrolments
  after insert or update or delete on enrolments
  for each row execute function private.write_audit_log();

create trigger trg_audit_screening_participants
  after insert or update or delete on screening_participants
  for each row execute function private.write_audit_log();

create trigger trg_audit_wallet_transactions
  after insert or update or delete on wallet_transactions
  for each row execute function private.write_audit_log();

create trigger trg_audit_subscriptions
  after insert or update or delete on subscriptions
  for each row execute function private.write_audit_log();

-- proof_log is itself patient-facing and append-only by convention (I10);
-- it is not additionally wired into audit_log to avoid a table auditing
-- its own sibling append-only log.

-- Append-only enforcement: revoke UPDATE/DELETE from every role, including
-- service_role. Only INSERT (already policy-gated in 0002_rls.sql) and
-- SELECT (superadmin only) remain possible.
revoke update, delete on audit_log from public, anon, authenticated, service_role;
