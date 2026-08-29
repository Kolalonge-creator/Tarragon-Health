-- see supabase/migrations/20260829094857_ai_governance_guardrails_prompts_knowledge.sql
create type public.ai_guardrail_kind as enum (
  'prohibited_diagnosis',
  'prohibited_prescribing',
  'emergency_escalation',
  'population_restriction',
  'max_autonomy',
  'mandatory_human_review',
  'output_constraint',
  'prohibited_topic'
);

comment on type public.ai_guardrail_kind is
  'The guardrail categories of 40.5. prohibited_diagnosis/prohibited_prescribing and population_restriction are hard content limits; emergency_escalation is the "must route to a human now" rule; max_autonomy caps ai_systems.autonomy_level; mandatory_human_review forces a human in the loop before the output has any effect.';

create type public.ai_guardrail_enforcement as enum ('blocking', 'escalate', 'warn');

comment on type public.ai_guardrail_enforcement is
  'What happens when a guardrail matches. blocking = the AI output is suppressed and the fallback runs; escalate = the output is suppressed AND a clinician is paged; warn = the output is allowed but the interaction is flagged for review.';

create table public.ai_guardrails (
  id            uuid primary key default gen_random_uuid(),
  ai_system_id  uuid not null references public.ai_systems (id) on delete cascade,
  rule_code     text not null check (rule_code ~ '^[a-z0-9_]+$'),
  kind          public.ai_guardrail_kind not null,
  description   text not null,
  enforcement   public.ai_guardrail_enforcement not null,
  config        jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  approved_by   uuid references public.clinical_staff (id) on delete restrict,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint ai_guardrails_unique_rule unique (ai_system_id, rule_code),
  constraint ai_guardrails_approval_paired check ((approved_by is null) = (approved_at is null))
);

comment on table public.ai_guardrails is
  'Per-system guardrail rules (40.5). config carries the rule''s parameters -- e.g. {"max_level":"recommend"} for max_autonomy, {"patterns":[...]} for prohibited_topic, {"excluded":["pregnancy","under_18"]} for population_restriction. Runtime enforcement reads these through private.ai_guardrails_for(); an unreachable or empty result means "no governed guardrails beyond the ones compiled into the code", never "no guardrails".';

comment on column public.ai_guardrails.enforcement is
  'blocking and escalate both suppress the AI output; only escalate additionally pages a clinician. Never downgrade an emergency_escalation guardrail to warn -- the escalation, not the flag, is the safety behaviour.';

create index ai_guardrails_system_idx on public.ai_guardrails (ai_system_id) where is_active;

create trigger ai_guardrails_set_updated_at
  before update on public.ai_guardrails
  for each row execute function private.set_updated_at();

alter table public.ai_guardrails enable row level security;

create policy ai_guardrails_select on public.ai_guardrails
  for select to authenticated using (true);
create policy ai_guardrails_write on public.ai_guardrails
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_guardrails to authenticated;

create or replace function private.guard_ai_guardrail_autonomy_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap  text;
  v_sys  public.ai_autonomy_level;
begin
  if new.kind <> 'max_autonomy' or not new.is_active then
    return new;
  end if;

  v_cap := new.config->>'max_level';
  if v_cap is null then
    raise exception 'a max_autonomy guardrail must set config->>''max_level''';
  end if;

  select autonomy_level into v_sys from public.ai_systems where id = new.ai_system_id;

  if private.ai_autonomy_rank(v_sys) > private.ai_autonomy_rank(v_cap::public.ai_autonomy_level) then
    raise exception 'ai_systems.autonomy_level (%) already exceeds this max_autonomy guardrail (%) -- lower the system''s autonomy first', v_sys, v_cap;
  end if;

  return new;
end;
$$;

comment on function private.guard_ai_guardrail_autonomy_ceiling() is
  'Refuses a max_autonomy guardrail that the registered system already breaches, so the ceiling can never be recorded as satisfied while the system runs above it.';

create trigger ai_guardrails_autonomy_ceiling
  before insert or update on public.ai_guardrails
  for each row execute function private.guard_ai_guardrail_autonomy_ceiling();

create or replace function private.ai_guardrails_for(p_system_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rule_code', g.rule_code,
        'kind', g.kind,
        'description', g.description,
        'enforcement', g.enforcement,
        'config', g.config
      )
      order by g.kind, g.rule_code
    ),
    '[]'::jsonb
  )
  from public.ai_guardrails g
  join public.ai_systems s on s.id = g.ai_system_id
  where s.system_code = p_system_code and g.is_active;
$$;

comment on function private.ai_guardrails_for(text) is
  'Active guardrails for one AI system, as a jsonb array for the runtime enforcement layer. Returns [] (never raises) for an unknown system -- callers must treat that as "no governed guardrails on top of the code-level ones", not as "guardrails cleared".';

revoke all on function private.ai_guardrails_for(text) from public, anon;

create table public.ai_prompt_versions (
  id                  uuid primary key default gen_random_uuid(),
  ai_system_id        uuid not null references public.ai_systems (id) on delete cascade,
  version             integer not null check (version > 0),
  system_prompt       text not null,
  safety_instructions text not null,
  retrieval_config    jsonb not null default '{}'::jsonb,
  output_constraints  jsonb not null default '{}'::jsonb,
  model_config        jsonb not null default '{}'::jsonb,
  change_summary      text,
  is_active           boolean not null default false,
  approved_by         uuid references public.clinical_staff (id) on delete restrict,
  approved_at         timestamptz,
  activated_by        uuid references public.profiles (id) on delete set null,
  activated_at        timestamptz,
  retired_at          timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ai_prompt_versions_unique_version unique (ai_system_id, version),
  constraint ai_prompt_versions_activation_paired
    check ((activated_by is null) = (activated_at is null)),
  constraint ai_prompt_versions_signature_implies_approval
    check (approved_by is null or approved_at is not null),
  constraint ai_prompt_versions_active_requires_approval
    check (not is_active or (approved_at is not null and activated_by is not null))
);

comment on table public.ai_prompt_versions is
  'Centrally controlled prompt + model configuration per AI system (40.6): system prompt, safety instructions, retrieval configuration, output constraints and model configuration, versioned and approval-gated. Exactly one version per system may be is_active; activation runs through public.activate_ai_prompt_version(), which is Clinical-Director-gated for clinically meaningful or high-risk systems.';

comment on column public.ai_prompt_versions.safety_instructions is
  'The safety half of the prompt, kept in its own column rather than concatenated into system_prompt so a Clinical Director reviewing a change can see at a glance whether the safety instructions moved.';

comment on column public.ai_prompt_versions.model_config is
  'Model configuration governed alongside the prompt -- e.g. {"model":"claude-sonnet-5","max_tokens":500}. The runtime treats a governed model identifier as the expected one for ai_vendor_model_observations (40.19).';

create unique index ai_prompt_versions_one_active_per_system
  on public.ai_prompt_versions (ai_system_id) where is_active;

create index ai_prompt_versions_system_idx on public.ai_prompt_versions (ai_system_id, version desc);

create trigger ai_prompt_versions_set_updated_at
  before update on public.ai_prompt_versions
  for each row execute function private.set_updated_at();

alter table public.ai_prompt_versions enable row level security;

create policy ai_prompt_versions_select on public.ai_prompt_versions
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_prompt_versions_insert on public.ai_prompt_versions
  for insert to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and activated_by is null
    and activated_at is null
    and is_active = false
  );
create policy ai_prompt_versions_update on public.ai_prompt_versions
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update on public.ai_prompt_versions to authenticated;

create or replace function private.guard_ai_prompt_version_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.approved_at is not null then
    if new.system_prompt is distinct from old.system_prompt
      or new.safety_instructions is distinct from old.safety_instructions
      or new.retrieval_config is distinct from old.retrieval_config
      or new.output_constraints is distinct from old.output_constraints
      or new.model_config is distinct from old.model_config
      or new.version is distinct from old.version
    then
      raise exception 'ai_prompt_versions: v% is approved -- propose a new version instead of editing a governed prompt', old.version;
    end if;
  end if;

  if old.approved_at is null and new.approved_at is not null
     and current_user in ('authenticated', 'anon', 'authenticator')
  then
    raise exception 'approve a prompt version through public.activate_ai_prompt_version(), not by writing approved_at directly';
  end if;

  return new;
end;
$$;

comment on function private.guard_ai_prompt_version_immutability() is
  'Freezes an approved prompt version''s governed text and blocks direct self-approval, so the only path to a live prompt change is propose-a-new-version + public.activate_ai_prompt_version(). Deliberately SECURITY INVOKER: that is what lets it distinguish the definer-rights RPC (current_user = postgres) from a client UPDATE (current_user = authenticated). The frozen-text half applies to every caller, RPC included.';

create trigger ai_prompt_versions_immutable_after_approval
  before update on public.ai_prompt_versions
  for each row execute function private.guard_ai_prompt_version_immutability();

create or replace function public.activate_ai_prompt_version(p_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system  record;
  v_staff   uuid;
  v_actor   uuid := (select auth.uid());
  v_org     uuid;
begin
  select s.id, s.system_code, s.name, s.risk_class, s.clinically_meaningful
    into v_system
  from public.ai_prompt_versions pv
  join public.ai_systems s on s.id = pv.ai_system_id
  where pv.id = p_id;

  if v_system.id is null then
    raise exception 'AI prompt version not found';
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.is_clinical_director
  limit 1;

  if v_system.clinically_meaningful or v_system.risk_class in ('high', 'very_high') then
    if v_staff is null then
      raise exception 'not authorised: only an active Clinical Director can activate a prompt version for % (%), a clinically meaningful or high-risk AI system',
        v_system.name, v_system.system_code;
    end if;
  elsif v_staff is null and not private.is_admin() then
    raise exception 'not authorised: activating a prompt version requires an admin or an active Clinical Director';
  end if;

  update public.ai_prompt_versions
     set is_active = false, retired_at = coalesce(retired_at, now())
   where ai_system_id = v_system.id and is_active and id <> p_id;

  update public.ai_prompt_versions
     set approved_by  = coalesce(approved_by, v_staff),
         approved_at  = coalesce(approved_at, now()),
         activated_by = v_actor,
         activated_at = now(),
         retired_at   = null,
         is_active    = true,
         change_summary = coalesce(p_note, change_summary)
   where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)),
    v_actor, 'ai_prompt_version.activated', 'ai_prompt_versions', p_id,
    jsonb_build_object(
      'ai_system_code', v_system.system_code,
      'signed_by_clinical_staff', v_staff,
      'note', p_note
    )
  );

  return p_id;
end;
$$;

comment on function public.activate_ai_prompt_version(uuid, text) is
  'Approves and activates one prompt version, retiring the previously active one. Requires an active Clinical Director for a clinically meaningful or high-risk AI system; an admin otherwise. approved_by is derived from the caller''s own clinical_staff record and is left null (never faked) when an admin without one activates a low-risk system''s prompt.';

revoke all on function public.activate_ai_prompt_version(uuid, text) from public, anon;
grant execute on function public.activate_ai_prompt_version(uuid, text) to authenticated;

create or replace function private.active_ai_prompt(p_system_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'prompt_version_id', pv.id,
    'version', pv.version,
    'system_prompt', pv.system_prompt,
    'safety_instructions', pv.safety_instructions,
    'retrieval_config', pv.retrieval_config,
    'output_constraints', pv.output_constraints,
    'model_config', pv.model_config
  )
  from public.ai_prompt_versions pv
  join public.ai_systems s on s.id = pv.ai_system_id
  where s.system_code = p_system_code and pv.is_active
  limit 1;
$$;

comment on function private.active_ai_prompt(text) is
  'The governed prompt for one AI system, or null when none has been activated yet. Never raises: a system with no governed prompt runs on its in-repo constant, so introducing governance cannot take a live patient-facing feature down.';

revoke all on function private.active_ai_prompt(text) from public, anon;

alter table public.ai_system_versions
  add column approval_actor_id uuid references public.profiles (id) on delete set null;

comment on column public.ai_system_versions.approval_actor_id is
  'The account that approved this version. Always set when approved_at is. Distinct from approved_by, which is the Clinical Director''s clinical signature and is legitimately null for a low-risk, non-clinical system approved by an admin.';

alter table public.ai_system_versions
  drop constraint ai_system_versions_approval_paired;

alter table public.ai_system_versions
  add constraint ai_system_versions_approval_actor_paired
    check ((approval_actor_id is null) = (approved_at is null));

alter table public.ai_system_versions
  add constraint ai_system_versions_signature_implies_approval
    check (approved_by is null or approved_at is not null);

create or replace function private.guard_ai_system_version_approval_route()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.approved_at is null and new.approved_at is not null
     and current_user in ('authenticated', 'anon', 'authenticator')
  then
    raise exception 'approve an AI system version through public.approve_ai_system_version(), not by writing approved_at directly';
  end if;
  return new;
end;
$$;

comment on function private.guard_ai_system_version_approval_route() is
  'Blocks client-side self-approval of an AI system version, so the evaluation-gate in public.approve_ai_system_version() cannot be stepped around with a plain UPDATE.';

create trigger ai_system_versions_approval_route
  before update on public.ai_system_versions
  for each row execute function private.guard_ai_system_version_approval_route();

create table public.ai_knowledge_sources (
  id              uuid primary key default gen_random_uuid(),
  source_code     text not null unique check (source_code ~ '^[a-z0-9_]+$'),
  title           text not null,
  source_type     text not null check (source_type in (
                    'education_material', 'clinical_protocol', 'pathway_document',
                    'formulary', 'external_guideline', 'platform_record')),
  reference_table text,
  reference_id    uuid,
  external_url    text,
  citation_label  text not null,
  ai_system_id    uuid references public.ai_systems (id) on delete cascade,
  is_active       boolean not null default true,
  approved_by     uuid references public.clinical_staff (id) on delete restrict,
  approved_at     timestamptz,
  review_due_on   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ai_knowledge_sources_approval_paired check ((approved_by is null) = (approved_at is null)),
  constraint ai_knowledge_sources_reference_paired check ((reference_table is null) = (reference_id is null))
);

comment on table public.ai_knowledge_sources is
  'The approved sources an AI answer may be grounded in, and the citation label shown when it is (40.7). ai_system_id null means the source is available to every registered system. An unapproved source (approved_at null) is a draft: the runtime must not cite it.';

comment on column public.ai_knowledge_sources.citation_label is
  'Patient-facing attribution text, e.g. "Based on Tarragon''s approved hypertension education material." Written in the brand voice -- warm, plain, no clinical jargon -- because this string is rendered directly to patients.';

create index ai_knowledge_sources_system_idx on public.ai_knowledge_sources (ai_system_id) where is_active;
create index ai_knowledge_sources_reference_idx on public.ai_knowledge_sources (reference_table, reference_id)
  where reference_table is not null;

create trigger ai_knowledge_sources_set_updated_at
  before update on public.ai_knowledge_sources
  for each row execute function private.set_updated_at();

alter table public.ai_knowledge_sources enable row level security;

create policy ai_knowledge_sources_select on public.ai_knowledge_sources
  for select to authenticated using (true);
create policy ai_knowledge_sources_write on public.ai_knowledge_sources
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_knowledge_sources to authenticated;

create or replace function private.approved_ai_knowledge_sources(p_system_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ks.id,
        'source_code', ks.source_code,
        'title', ks.title,
        'source_type', ks.source_type,
        'citation_label', ks.citation_label,
        'reference_table', ks.reference_table,
        'reference_id', ks.reference_id
      )
      order by ks.title
    ),
    '[]'::jsonb
  )
  from public.ai_knowledge_sources ks
  where ks.is_active
    and ks.approved_at is not null
    and (
      ks.ai_system_id is null
      or ks.ai_system_id = (select id from public.ai_systems where system_code = p_system_code)
    );
$$;

comment on function private.approved_ai_knowledge_sources(text) is
  'Approved, active knowledge sources one AI system may cite. Only approved sources are returned -- a draft source has no citation_label the platform is willing to stand behind.';

revoke all on function private.approved_ai_knowledge_sources(text) from public, anon;

do $$
declare
  v_sys uuid;
  v_pv  uuid;
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_guardrails', 'ai_prompt_versions', 'ai_knowledge_sources')) <> 3
  then
    raise exception 'not every part-2 AI governance table was created';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_guardrails', 'ai_prompt_versions', 'ai_knowledge_sources')
      and not c.relrowsecurity
  ) then
    raise exception 'a part-2 AI governance table was created without row level security';
  end if;

  if has_function_privilege('anon', 'private.ai_guardrails_for(text)', 'EXECUTE')
    or has_function_privilege('anon', 'private.active_ai_prompt(text)', 'EXECUTE')
    or has_function_privilege('anon', 'private.approved_ai_knowledge_sources(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.activate_ai_prompt_version(uuid, text)', 'EXECUTE')
  then
    raise exception 'anon can still execute an AI governance function';
  end if;

  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour)
  values ('AI-998', 'assertion probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe')
  returning id into v_sys;

  insert into public.ai_prompt_versions
    (ai_system_id, version, system_prompt, safety_instructions, approved_by, approved_at)
  values (v_sys, 1, 'probe', 'probe', null, now())
  returning id into v_pv;

  begin
    update public.ai_prompt_versions set system_prompt = 'edited' where id = v_pv;
    raise exception 'ai_prompt_versions_immutable_after_approval did not block editing an approved prompt';
  exception
    when raise_exception then
      if sqlerrm not like '%propose a new version%' then raise; end if;
  end;

  update public.ai_prompt_versions
     set approved_at = null, approved_by = null, is_active = false where id = v_pv;
  update public.ai_prompt_versions set system_prompt = 'edited' where id = v_pv;

  if (select system_prompt from public.ai_prompt_versions where id = v_pv) <> 'edited' then
    raise exception 'an unapproved draft prompt could not be edited -- the guard is over-broad';
  end if;

  begin
    insert into public.ai_system_versions
      (ai_system_id, version, model_identifier, intended_population, excluded_population, approved_at)
    values (v_sys, 'probe-1', 'probe-model', 'probe', 'probe', now());
    raise exception 'ai_system_versions_approval_actor_paired allowed an approval with no accountable actor';
  exception
    when check_violation then null;
  end;

  delete from public.ai_systems where id = v_sys;

  if exists (select 1 from public.ai_systems where system_code = 'AI-998') then
    raise exception 'assertion probe row leaked into ai_systems';
  end if;
end;
$$;
