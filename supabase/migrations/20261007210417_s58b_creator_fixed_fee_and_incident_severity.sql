-- S58b: creator fixed fee through the S30/S31 machinery, and event-failure incident severities.
--
-- 1. Creator fee (founder decision 2026-10-07: a FIXED fee per approved, published learning item, no usage pool).
--    * earnings_ledger gains kind 'creator_item'. One line per item (reference = a stable id derived from the content id), so a
--      republish, a new version or a retry never pays twice. Gross kobo, same as every S30 line.
--    * The amount comes ONLY from the approved fee schedule: new optional key creator_item_published_fee_kobo in fee_schedules.items.
--      Nothing is seeded and no amount is invented. With no schedule the line waits (the sweep posts it, retroactively, at the first
--      approved schedule); with a schedule that lacks the key the line is a zero line flagged needs_review (no_fee_for_creator_item)
--      for an admin to correct by adjustment, the same as an unpriced task type.
--    * A line is written only when ALL hold: the item is published, servable (not past its review date), not a placeholder, has a named
--      reviewer who is not the creator, a review date and a verified creator who is an ACTIVE CONTRACTED clinician. Employed doctors are
--      paid by salary (F-03) so they get no line. An item that is withdrawn or expired before posting pays nothing.
--    * Payment goes through the existing S31 weekly payout drafts and the second-person approval; nothing new moves money here.
--    * RLS is unchanged: earnings_ledger_select lets a clinician read only their own lines and an admin read their organisation's.
-- 2. Incident severity: page_incident() always opens sev1/clinical. A rewards-event failure is now sev3 (technical) and the creator
--    earnings sweep failure sev2, through page_incident_sev(); the patient's own write is still never undone. (The lesson-event failure
--    path belonged to S55's emitter, which S33's emitter replaced: see the note below.)
--
-- Rows affected: 0 (no ledger row exists with this kind; no incident is changed). Counts to record in the dry run:
-- select count(*) from earnings_ledger where kind = 'creator_item'; select count(*) from health_education_content where creator_id is not null.

-- ---------------------------------------------------------------------------
-- 1. Incident helper with a severity
-- ---------------------------------------------------------------------------
create function private.page_incident_sev(p_org uuid, p_ref text, p_sev text, p_title text, p_summary text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_sev not in ('sev1', 'sev2', 'sev3', 'sev4') then raise exception 'page_incident_sev: bad severity %', p_sev; end if;
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'technical', p_sev::public.ops_incident_severity, p_title, p_summary, p_ref, now(), now());
  end if;
end;
$$;
revoke all on function private.page_incident_sev(uuid, text, text, text, text) from public, anon, authenticated;

-- The lesson and course completion events are S33's (private.learning_progress_events, 20261006193149): S55 no longer carries a second
-- emitter, so there is nothing here to give a lower severity. S33's trigger raises on a failed event write, which stops the progress
-- insert instead of opening an incident; whether that should become a best-effort write with a sev2 incident is recorded as a follow-up
-- (docs/OPEN-QUESTIONS.md, integration note), not decided here.

create or replace function private.rewards_emit(
  p_type text, p_patient uuid, p_payload jsonb, p_key text, p_agg_type text, p_agg_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  begin
    select organisation_id into v_org from public.profiles where id = p_patient;
    if v_org is null then return; end if;
    perform private.emit_domain_event(p_type, v_org, p_payload, p_type || ':' || p_key, p_patient, p_agg_type, p_agg_id);
  exception when others then
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (v_org, 'rewards_event.error', p_agg_type, p_agg_id, jsonb_build_object('event_type', p_type, 'error', sqlerrm));
      if v_org is not null then
        perform private.page_incident_sev(v_org, 'rewards_event_failed', 'sev3', 'A rewards event could not be written',
          'A Health Points event failed to write; see audit_log action rewards_event.error (one open incident covers all of them). The person''s own record was saved.');
      end if;
    exception when others then
      raise warning 'rewards_emit failed for % and could not be audited: %', p_type, sqlerrm;
    end;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fee schedule validation accepts the optional creator key
-- ---------------------------------------------------------------------------
create or replace function private.fee_items_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  code text;
  e jsonb;
  s jsonb;
  v_last numeric;
  v_share jsonb;
  v_ref jsonb;
  v_max constant numeric := 1000000000;
begin
  if jsonb_typeof(r) is distinct from 'object' then return false; end if;
  for k in select jsonb_object_keys(r) loop
    if k not in ('task_types', 'on_call_shift_fee_kobo', 'lead_fee_per_patient_month_kobo', 'consultation_share_pct',
                 'consultation_reference_price_kobo', 'pilot_minimum_per_declared_hour_kobo', 'creator_item_published_fee_kobo') then
      return false;
    end if;
  end loop;
  foreach k in array array['on_call_shift_fee_kobo', 'lead_fee_per_patient_month_kobo', 'pilot_minimum_per_declared_hour_kobo'] loop
    if not private.fee_is_int(r -> k, 0, v_max) then return false; end if;
  end loop;
  -- S58b: optional. The fixed fee for one approved, published learning item. Absent means no fee is set (a line is flagged, never guessed).
  if r ? 'creator_item_published_fee_kobo' and not private.fee_is_int(r -> 'creator_item_published_fee_kobo', 0, v_max) then return false; end if;
  v_share := r -> 'consultation_share_pct';
  if jsonb_typeof(v_share) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_share)) <> 3 then return false; end if;
  foreach k in array array['video', 'audio', 'phone'] loop
    if not private.fee_is_int(v_share -> k, 0, 100) then return false; end if;
  end loop;
  if r ? 'consultation_reference_price_kobo' then
    v_ref := r -> 'consultation_reference_price_kobo';
    if jsonb_typeof(v_ref) is distinct from 'object' then return false; end if;
    for k in select jsonb_object_keys(v_ref) loop
      if k not in ('video', 'audio', 'phone') or not private.fee_is_int(v_ref -> k, 0, v_max) then return false; end if;
    end loop;
  end if;
  if jsonb_typeof(r -> 'task_types') is distinct from 'object' then return false; end if;
  for code in select jsonb_object_keys(r -> 'task_types') loop
    if code !~ '^[a-z][a-z0-9_]*$' then return false; end if;
    e := r -> 'task_types' -> code;
    if jsonb_typeof(e) is distinct from 'object' or not private.fee_is_int(e -> 'base_fee_kobo', 0, v_max)
       or jsonb_typeof(e -> 'wait_multiplier_steps') is distinct from 'array' then
      return false;
    end if;
    v_last := 0;
    for s in select value from jsonb_array_elements(e -> 'wait_multiplier_steps') loop
      if jsonb_typeof(s) is distinct from 'object' or not private.fee_is_int(s -> 'at_pct', 1, 1000)
         or not private.fee_is_int(s -> 'add_pct', 0, 300) or (s ->> 'at_pct')::numeric <= v_last then
        return false;
      end if;
      v_last := (s ->> 'at_pct')::numeric;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ledger kind
-- ---------------------------------------------------------------------------
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'public.earnings_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%''minimum_topup''%' and pg_get_constraintdef(oid) ilike '%''lead_month''%';
  if v_con is null then raise exception 'S58b: the earnings_ledger kind check was not found'; end if;
  execute format('alter table public.earnings_ledger drop constraint %I', v_con);
  alter table public.earnings_ledger add constraint earnings_ledger_kind_check
    check (kind in ('task', 'consultation', 'on_call_shift', 'lead_month', 'minimum_topup', 'adjustment', 'creator_item'));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Posting
-- ---------------------------------------------------------------------------
-- true = nothing more to do for now (a line exists, or the item earns none); false = must wait for a fee schedule.
create function private.post_creator_item_earning(p_content uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  c public.health_education_content%rowtype;
  cr public.learning_creators%rowtype;
  cs public.clinical_staff%rowtype;
  fs public.fee_schedules%rowtype;
  v_ref uuid := private.earnings_ref('creator_item:' || p_content::text);
  v_fee jsonb;
  v_amount bigint := 0;
  v_calc jsonb;
begin
  select * into c from public.health_education_content where id = p_content;
  if not found or c.creator_id is null then return true; end if;
  if c.content_status <> 'published' or c.is_placeholder or not coalesce(c.clinician_reviewed, false)
     or c.reviewed_at is null or c.reviewed_by_name is null or char_length(btrim(c.reviewed_by_name)) < 3
     or not private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due) then
    return true;
  end if;
  select * into cr from public.learning_creators where id = c.creator_id;
  if not found or cr.status <> 'verified' then return true; end if;
  -- the creator may not be the named reviewer of their own item (money follows the review)
  if lower(btrim(c.reviewed_by_name)) = lower(btrim(cr.display_name)) then return true; end if;
  select * into cs from public.clinical_staff where profile_id = cr.profile_id;
  if not found or not cs.active or cs.employment_type::text <> 'contracted' then return true; end if;
  if exists (select 1 from public.earnings_ledger where clinician_id = cr.profile_id and kind = 'creator_item' and reference_id = v_ref) then return true; end if;
  fs := private.fee_schedule_at(cs.organisation_id, now());
  if fs.id is null then return false; end if;
  v_fee := fs.items -> 'creator_item_published_fee_kobo';
  if v_fee is not null and jsonb_typeof(v_fee) = 'number' then
    v_amount := (v_fee #>> '{}')::bigint;
    v_calc := jsonb_build_object('ok', true, 'amount_kobo', v_amount);
  else
    v_calc := jsonb_build_object('ok', false, 'needs_review', 'no_fee_for_creator_item');
  end if;
  v_calc := v_calc || jsonb_build_object('content_id', c.id, 'content_code', c.code, 'content_version', c.version,
    'creator_id', cr.id, 'schedule_version', fs.version);
  perform private.ledger_insert(cs.organisation_id, cr.profile_id, 'creator_item', 'health_education_content', v_ref, v_amount, fs.id, v_calc,
                                now(), cs.is_test);
  return true;
end;
$$;
revoke all on function private.post_creator_item_earning(uuid) from public, anon, authenticated;

-- A failure must never block a publish; it is logged and the sweep retries and raises an incident.
create function private.earnings_on_creator_item_published() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.post_creator_item_earning(new.id);
  exception when others then
    insert into public.audit_log (action, entity_type, entity_id, event)
    values ('earnings.post_error', 'health_education_content', new.id, jsonb_build_object('step', 'creator_item', 'error', sqlerrm));
  end;
  return null;
end;
$$;
revoke all on function private.earnings_on_creator_item_published() from public, anon, authenticated;
create trigger health_education_content_creator_earnings
  after insert or update of content_status, creator_id, clinician_reviewed, reviewed_by_name, next_review_due, is_active on public.health_education_content
  for each row when (new.creator_id is not null and new.content_status = 'published')
  execute function private.earnings_on_creator_item_published();

create function private.creator_item_earnings_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_posted integer := 0;
  v_deferred integer := 0;
  v_errors integer := 0;
begin
  for r in select c.id from public.health_education_content c
            join public.learning_creators cr on cr.id = c.creator_id
           where c.content_status = 'published'
             and not exists (select 1 from public.earnings_ledger l
                              where l.kind = 'creator_item' and l.clinician_id = cr.profile_id
                                and l.reference_id = private.earnings_ref('creator_item:' || c.id::text)) loop
    begin
      if private.post_creator_item_earning(r.id) then v_posted := v_posted + 1; else v_deferred := v_deferred + 1; end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (action, entity_type, entity_id, event)
      values ('earnings.sweep_error', 'health_education_content', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 then
    perform private.page_incident_sev(null, 'creator_earnings_sweep', 'sev2', 'Creator earnings lines could not be posted',
      format('%s learning item(s) could not be written by private.creator_item_earnings_sweep(); see audit_log action earnings.sweep_error.', v_errors));
  end if;
  return jsonb_build_object('checked_ok', v_posted, 'deferred', v_deferred, 'errors', v_errors);
end;
$$;
revoke all on function private.creator_item_earnings_sweep() from public, anon, authenticated;
select cron.schedule('earnings-creator-items', '7,22,37,52 * * * *', $$ select private.creator_item_earnings_sweep(); $$);

-- ---------------------------------------------------------------------------
-- self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.fee_items_valid(jsonb_build_object('task_types', '{}'::jsonb, 'on_call_shift_fee_kobo', 0, 'lead_fee_per_patient_month_kobo', 0,
        'consultation_share_pct', '{"video":0,"audio":0,"phone":0}'::jsonb, 'pilot_minimum_per_declared_hour_kobo', 0, 'creator_item_published_fee_kobo', 1)) then
    raise exception 'S58b: a schedule with a creator fee is refused';
  end if;
  if private.fee_items_valid(jsonb_build_object('task_types', '{}'::jsonb, 'on_call_shift_fee_kobo', 0, 'lead_fee_per_patient_month_kobo', 0,
        'consultation_share_pct', '{"video":0,"audio":0,"phone":0}'::jsonb, 'pilot_minimum_per_declared_hour_kobo', 0, 'creator_item_published_fee_kobo', 1.5)) then
    raise exception 'S58b: a fractional creator fee is accepted';
  end if;
  if (select count(*) from cron.job where jobname = 'earnings-creator-items') <> 1 then raise exception 'S58b: creator sweep not scheduled'; end if;
  if has_function_privilege('anon', 'private.post_creator_item_earning(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.page_incident_sev(uuid, text, text, text, text)', 'EXECUTE') then
    raise exception 'S58b: a private function is executable by a client role';
  end if;
end $$;
