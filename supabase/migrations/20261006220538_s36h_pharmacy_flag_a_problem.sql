-- S36h: pharmacy "Flag a problem" on a prescription (spec 9.6, pharmacy row).
-- INV-02 (a prescription and its signature are never changed here), INV-07 (neutral notice), INV-10 (the prescriber-side read is audited),
-- INV-13 (is_test carried), INV-16 (the task type is a versioned row).
--
-- What this adds:
--   prescription_pharmacy_flags    append-only: one row per flag a partner pharmacy raises (kind, written reason, who, which pharmacy)
--   task type pharmacy_flag_review the prescriber side's work item, created through the existing private.create_clinical_task
--   public.pharmacist_prescriptions()                          prescriptions SENT to the caller's own pharmacy only
--   public.pharmacist_flag_prescription(rx, kind, reason)      the only door that writes a flag
--   public.clinician_pharmacy_flags()                          the prescriber's (or tied clinician's) audited read of flags
-- A flag never changes the prescription, never dispenses, never cancels. The pharmacy can only raise a problem with a prescription that
-- was sent to it and is still waiting (state = sent). The prescriber gets a neutral in-app notice naming nothing, plus a task.
--
-- Live counts at write time: 0 rows in prescription_pharmacy_flags (table is new). Task type is new; no backfill.
-- Statement of exact signatures (no overload of an existing name): all five names are new.

create table public.prescription_pharmacy_flags (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  prescription_id uuid not null references public.prescriptions (id) on delete restrict,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  flagged_by uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('out_of_stock', 'query_to_prescriber', 'other')),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  task_id uuid references public.clinical_tasks (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index prescription_pharmacy_flags_rx_idx on public.prescription_pharmacy_flags (prescription_id, created_at desc);
create index prescription_pharmacy_flags_partner_idx on public.prescription_pharmacy_flags (pharmacy_partner_id, created_at desc);

comment on table public.prescription_pharmacy_flags is
  'S36h: a problem a partner pharmacy raised on a prescription sent to it. Append only. Written only by public.pharmacist_flag_prescription. Never changes the prescription (INV-02).';

create function private.pharmacy_flag_immutable() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'a pharmacy flag is append only' using errcode = '42501'; end $$;
create trigger prescription_pharmacy_flags_append_only
  before update or delete on public.prescription_pharmacy_flags
  for each row execute function private.pharmacy_flag_immutable();

alter table public.prescription_pharmacy_flags enable row level security;
revoke all on public.prescription_pharmacy_flags from anon, authenticated;
grant select on public.prescription_pharmacy_flags to authenticated;
-- A partner pharmacy reads only its own flags. Staff read through clinician_pharmacy_flags (audited), never the table.
create policy prescription_pharmacy_flags_partner_select on public.prescription_pharmacy_flags
  for select to authenticated
  using (pharmacy_partner_id = private.pharmacist_partner());

-- ---------------------------------------------------------------------------
-- Task type and neutral notice. Priority, due time and tier are PROPOSED values held in this versioned row (OQ-241).
-- Not needs_confirmation: a row waiting for confirmation blocks approve_triage_rule_set, and this task is not made by a triage rule.
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('pharmacy_flag_review', 1, 5, 1440, 'medical_officer', '{}', 0, 30, false, true, '{}',
   'S36h: a partner pharmacy raised a problem on a prescription (out of stock, a query, other). PROPOSED class, due time and tier (OQ-241). Never changes the prescription.');

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_flag_notice', 'operational', 'important', 'clinician', array['in_app']::public.notification_channel[], 'immediate',
   'A partner pharmacy raised a problem on something your care team sent. Names no medicine, condition or patient (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_flag_notice', 'en', 'in_app', 'A pharmacy has raised something', 'A pharmacy has raised something on an item you sent. Open your pharmacy messages to read it.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- Partner: prescriptions sent to my own pharmacy
-- ---------------------------------------------------------------------------
create function public.pharmacist_prescriptions()
returns table (prescription_id uuid, state text, collection_code text, sent_at timestamptz, dispensed_at timestamptz,
               patient_name text, patient_number text, items jsonb, open_flags integer)
language sql stable security definer set search_path = ''
as $$
  select rx.id, rx.state::text, rx.collection_code, rx.sent_at, rx.dispensed_at, p.full_name, p.patient_number, rx.items,
         (select count(*)::integer from public.prescription_pharmacy_flags f where f.prescription_id = rx.id)
    from public.prescriptions rx
    join public.profiles p on p.id = rx.patient_id
   where private.pharmacist_partner() is not null
     and rx.pharmacy_partner_id = private.pharmacist_partner()
     and rx.state in ('sent', 'dispensed')
   order by coalesce(rx.sent_at, rx.created_at) desc
   limit 200;
$$;

-- ---------------------------------------------------------------------------
-- Partner: flag a problem. The prescription row is read, never written.
-- ---------------------------------------------------------------------------
create function public.pharmacist_flag_prescription(p_prescription uuid, p_kind text, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner uuid := private.pharmacist_partner();
  rx public.prescriptions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_flag uuid;
  v_task uuid;
begin
  if v_partner is null then
    raise exception 'This action is for partner pharmacies' using errcode = '42501';
  end if;
  -- Only the pharmacy the prescription was sent to; anything else looks exactly like "not found".
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner;
  if not found then
    raise exception 'Prescription not found for this pharmacy' using errcode = '42501';
  end if;
  if rx.state <> 'sent' then
    raise exception 'pharmacy_flag_not_open' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('out_of_stock', 'query_to_prescriber', 'other') then
    raise exception 'pharmacy_flag_kind' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'pharmacy_flag_reason' using errcode = '22023';
  end if;

  -- The prescriber's queue: a task on the patient (repeat flags on one prescription merge into the live task) ...
  v_task := private.create_clinical_task(rx.patient_id, 'pharmacy_flag_review', null, 'pharmacy_flag:' || rx.id);

  insert into public.prescription_pharmacy_flags
    (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, task_id, is_test)
  values (rx.organisation_id, rx.id, v_partner, (select auth.uid()), p_kind, v_reason, v_task, rx.is_test)
  returning id into v_flag;

  -- ... and one neutral in-app notice to the prescriber. No medicine, condition, patient or reason in it (INV-07).
  if rx.signed_by is not null and exists (select 1 from public.profiles pr where pr.id = rx.signed_by and pr.is_active and pr.role <> 'patient') then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (rx.organisation_id, rx.signed_by, 'in_app', 'pending', 'pharmacy_flag_notice', jsonb_build_object('flag_id', v_flag));
  end if;

  -- The audit row holds the kind and ids; the written reason stays in the flag row (clinical-adjacent text).
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (rx.organisation_id, (select auth.uid()), 'prescription.pharmacy_flagged', 'prescriptions', rx.id,
          jsonb_build_object('flag_id', v_flag, 'kind', p_kind, 'pharmacy_partner_id', v_partner, 'task_id', v_task));
  return v_flag;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prescriber: my flags (the clinician who signed, or one with a patient tie). One audit row per read (INV-10).
-- ---------------------------------------------------------------------------
create function public.clinician_pharmacy_flags()
returns table (flag_id uuid, prescription_id uuid, patient_id uuid, patient_name text, pharmacy_name text, kind text, reason text,
               items jsonb, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_ids uuid[];
begin
  if not exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_active and pr.role = 'clinician') then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select f.id
      from public.prescription_pharmacy_flags f
      join public.prescriptions rx on rx.id = f.prescription_id
     where private.is_org_staff(f.organisation_id)
       and (rx.signed_by = (select auth.uid()) or private.clinician_has_patient_access(rx.patient_id))
     order by f.created_at desc
     limit 100) x;
  if cardinality(v_ids) > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (private.current_org_id(), (select auth.uid()), 'prescription.pharmacy_flags_read', 'prescription_pharmacy_flags',
            jsonb_build_object('flag_ids', to_jsonb(v_ids)));
  end if;
  return query
    select f.id, f.prescription_id, rx.patient_id, p.full_name, pp.name, f.kind, f.reason, rx.items, f.created_at
      from public.prescription_pharmacy_flags f
      join public.prescriptions rx on rx.id = f.prescription_id
      join public.profiles p on p.id = rx.patient_id
      join public.pharmacy_partners pp on pp.id = f.pharmacy_partner_id
     where f.id = any (v_ids)
     order by f.created_at desc;
end;
$$;

revoke all on function public.pharmacist_prescriptions() from public, anon;
revoke all on function public.pharmacist_flag_prescription(uuid, text, text) from public, anon;
revoke all on function public.clinician_pharmacy_flags() from public, anon;
revoke all on function private.pharmacy_flag_immutable() from public, anon;
grant execute on function public.pharmacist_prescriptions() to authenticated;
grant execute on function public.pharmacist_flag_prescription(uuid, text, text) to authenticated;
grant execute on function public.clinician_pharmacy_flags() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_prescriptions()', 'EXECUTE')
     or has_function_privilege('anon', 'public.pharmacist_flag_prescription(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_pharmacy_flags()', 'EXECUTE') then
    raise exception 'S36h: anon can execute a pharmacy flag function';
  end if;
  if has_table_privilege('anon', 'public.prescription_pharmacy_flags', 'SELECT') then
    raise exception 'S36h: anon can read prescription_pharmacy_flags';
  end if;
  if has_table_privilege('authenticated', 'public.prescription_pharmacy_flags', 'INSERT, UPDATE, DELETE') then
    raise exception 'S36h: authenticated can write prescription_pharmacy_flags directly';
  end if;
end $$;
