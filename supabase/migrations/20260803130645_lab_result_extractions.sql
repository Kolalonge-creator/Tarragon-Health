-- AI-assisted extraction of an uploaded lab result into structured values.
--
-- WHY: self-arranged fulfilment means results arrive as a PDF or a phone photo
-- from any lab in the country, in any layout. Without extraction those uploads
-- are a pile of documents a doctor must read one by one, and none of the
-- numbers reach the trend charts, the CV-risk engine, or the HbA1c trajectory.
-- Extraction is what makes a self-arranged result as useful as a partner one.
--
-- SAFETY: AI drafts, never decides. Same discipline as case_briefs and
-- patient_result_explanations:
--   * this table only ever holds a PROPOSAL; nothing here is clinical record;
--   * a clinician confirms (or corrects) before a single value is written to
--     lab_analyte_readings;
--   * confirming is an explicit human act, stamped server-side to the caller's
--     own clinical_staff row and immutable afterwards;
--   * extraction NEVER creates a screening_results row, never sets an abnormal
--     flag, and never drives an escalation. private.handle_lab_result_document
--     already states this rule on the upload it hangs off ("Uploading a file
--     does not itself create a screening result") and this does not weaken it.
--
-- Patients deliberately cannot read this table: an unconfirmed machine reading
-- of their own blood test is exactly the kind of number that should not reach
-- them before a doctor has looked at it. Same select shape as case_briefs.

create table if not exists public.lab_result_extractions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete restrict,
  -- One extraction per document. Cascade because an extraction is meaningless
  -- without the document it read.
  document_id uuid not null unique
    references public.lab_result_documents (id) on delete cascade,
  status text not null check (status in ('ready', 'failed')),
  model_id text,
  -- [{code, value, unit, taken_on, source_text}] — the model's reading of the
  -- document, never authoritative on its own.
  proposed jsonb not null default '[]'::jsonb,
  error_message text,
  -- Provenance: RESTRICT rather than SET NULL, per the 2026-07-30 hardening —
  -- once an attribution is set it must never be silently erased.
  confirmed_by uuid references public.clinical_staff (id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lab_result_extractions_patient_idx
  on public.lab_result_extractions (patient_id, created_at desc);

alter table public.lab_result_extractions enable row level security;

-- SELECT only, org staff only. Every write goes through the service-role
-- generator or the confirm RPC below, so a compromised session can neither
-- fabricate a proposal nor overwrite one.
drop policy if exists lab_result_extractions_select on public.lab_result_extractions;
create policy lab_result_extractions_select on public.lab_result_extractions
  for select using (private.is_org_staff(organisation_id));

-- RLS restricts ROWS; it does not grant table access. Supabase only
-- auto-provisions this at project creation, and this exact grant has been
-- missed three times in this codebase's history (M1 sprint, case_briefs, the
-- 30-table backfill), so it ships here with an assertion rather than a hope.
grant select on public.lab_result_extractions to authenticated;

drop trigger if exists lab_result_extractions_set_updated_at on public.lab_result_extractions;
create trigger lab_result_extractions_set_updated_at
  before update on public.lab_result_extractions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Confirming is the only path from a proposal to the clinical record.
--
-- Forge-proof in the same way every other attribution on this platform is:
-- confirmed_by is derived from the caller's own active clinical_staff row and
-- never taken from the client, and a second confirmation is refused so a
-- reviewed extraction cannot be quietly re-written.
--
-- The caller passes the values they ACCEPT, which may differ from what the
-- model proposed — that is the whole point of a human check, and it is why
-- this takes readings as an argument rather than blindly inserting `proposed`.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_lab_result_extraction(
  p_extraction_id uuid,
  p_readings jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.lab_result_extractions%rowtype;
  v_staff_id uuid;
  v_reading jsonb;
  v_taken_at timestamptz;
begin
  select * into v_row from public.lab_result_extractions where id = p_extraction_id;
  if v_row.id is null then
    raise exception 'Extraction not found' using errcode = '42501';
  end if;

  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_row.organisation_id
    and cs.active;
  if v_staff_id is null then
    raise exception 'Only an active care-team clinician can confirm an extracted result'
      using errcode = '42501';
  end if;

  if v_row.confirmed_at is not null then
    raise exception 'This result has already been confirmed' using errcode = '23505';
  end if;

  for v_reading in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb))
  loop
    v_taken_at := coalesce(
      nullif(v_reading->>'taken_on', '')::timestamptz,
      v_row.created_at
    );
    insert into public.lab_analyte_readings
      (organisation_id, patient_id, code, value, unit, taken_at)
    values (
      v_row.organisation_id,
      v_row.patient_id,
      v_reading->>'code',
      (v_reading->>'value')::numeric,
      v_reading->>'unit',
      v_taken_at
    );
  end loop;

  update public.lab_result_extractions
     set confirmed_by = v_staff_id,
         confirmed_at = now()
   where id = p_extraction_id;
end;
$function$;

revoke all on function public.confirm_lab_result_extraction(uuid, jsonb) from public;
revoke all on function public.confirm_lab_result_extraction(uuid, jsonb) from anon;
grant execute on function public.confirm_lab_result_extraction(uuid, jsonb) to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.lab_result_extractions', 'SELECT') then
    raise exception 'authenticated cannot select lab_result_extractions - RLS would govern nothing';
  end if;
  if has_table_privilege('anon', 'public.lab_result_extractions', 'SELECT') then
    raise exception 'anon can read lab_result_extractions';
  end if;
  if has_function_privilege('anon', 'public.confirm_lab_result_extraction(uuid, jsonb)', 'EXECUTE') then
    raise exception 'anon can execute confirm_lab_result_extraction';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_lab_result_extraction(uuid, jsonb)', 'EXECUTE') then
    raise exception 'authenticated cannot execute confirm_lab_result_extraction';
  end if;
  -- No write policy may exist: proposals are service-role written only.
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'lab_result_extractions' and p.polcmd <> 'r'
  ) then
    raise exception 'lab_result_extractions must have no write policy';
  end if;
end $$;
