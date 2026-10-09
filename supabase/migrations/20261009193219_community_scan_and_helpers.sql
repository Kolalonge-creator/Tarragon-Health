-- Community, Phase 1, part 2 of 4: private helpers, the text normaliser, the contact-detail detectors and the scan.
--
-- Design: docs/COMMUNITY_SPEC.md sections 4.1 to 4.3.
--
-- The database is the system of record for filtering, so no client can bypass it. There is deliberately NO TypeScript
-- copy of these rules in Phase 1: a second implementation could drift from the one that actually decides.
--
-- WHAT THE SCAN RETURNS: a decision and rule ids and classes. NEVER the matched text (a blocked phone number must not
-- be written anywhere).
--
-- POSTGRES REGEX NOTE: in an ARE, \b is a BACKSPACE; the word boundary is \y. Every pattern below uses \y.
--
-- KNOWN TRADE-OFFS, stated so nobody has to rediscover them (see also the proof file):
--   * A run of digits is read as a phone or account number only when it looks like one: 10+ digits starting like a Nigerian
--     mobile (0[789][01]...), 12+ digits starting 234[789][01], 10+ digits with a group of 4 or more, or 8+ single digits
--     spaced apart. Lists of readings ("110 125 130 140", "70 80 90 100 110") are deliberately NOT flagged, because a
--     hypertension or diabetes group is full of them. A contact exchange that avoids every digit pattern is caught, if at
--     all, by the contact-intent phrases, new-member pre-moderation and reports.
--   * Dates (09-10-2026) and times (14:30) are masked first so an appointment in a post is not read as a number.
--   * A link-like word with a common top-level domain ("ok.com") is read as a link; a missing space after a full stop in
--     such a case is blocked with a gentle message and can be retyped.

-- ---------------------------------------------------------------------------
-- 1. Configuration readers
-- ---------------------------------------------------------------------------
create or replace function private.community_cfg() returns jsonb
language sql stable security definer set search_path = '' as $$
  select params from public.community_config where is_active
$$;

create or replace function private.community_cfg_get(p_path text[]) returns text
language sql stable security definer set search_path = '' as $$
  select private.community_cfg() #>> p_path
$$;

create or replace function private.community_cfg_int(p_key text) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
begin
  v := private.community_cfg() ->> p_key;
  if v is null then
    raise exception 'community configuration is missing "%" (no active community_config version?)', p_key using errcode = '55000';
  end if;
  return v::integer;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Normaliser
-- ---------------------------------------------------------------------------
-- NFKC (full-width digits and look-alike forms collapse to plain ones), strip soft hyphens, zero-width and bidi controls,
-- lower-case, fold Arabic-Indic and Persian digits to 0-9, and straighten curly quotes (phone keyboards type the curly one).
-- The characters are written as \uXXXX escapes on purpose: invisible characters in source cannot be reviewed.
create or replace function private.community_normalise(p_text text) returns text
language sql immutable set search_path = '' as $$
  select translate(
    lower(regexp_replace(normalize(coalesce(p_text, ''), NFKC), '[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]', '', 'g')),
    E'\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9\u2019\u2018\u00b4`',
    E'01234567890123456789''''''''')
$$;

-- The view used to find phone and account numbers: number words become digits, dates and times are masked, and the letter o
-- becomes a zero when it sits against digits ("o8o3").
create or replace function private.community_digit_view(p_norm text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  t text := p_norm;
  prev text;
  n integer := 0;
begin
  t := regexp_replace(t, '\yzero\y', '0', 'g');
  t := regexp_replace(t, '\yone\y', '1', 'g');
  t := regexp_replace(t, '\ytwo\y', '2', 'g');
  t := regexp_replace(t, '\ythree\y', '3', 'g');
  t := regexp_replace(t, '\yfour\y', '4', 'g');
  t := regexp_replace(t, '\yfive\y', '5', 'g');
  t := regexp_replace(t, '\ysix\y', '6', 'g');
  t := regexp_replace(t, '\yseven\y', '7', 'g');
  t := regexp_replace(t, '\yeight\y', '8', 'g');
  t := regexp_replace(t, '\ynine\y', '9', 'g');
  -- dates (dd/mm/yyyy, yyyy-mm-dd) and times (hh:mm) are not phone numbers
  t := regexp_replace(t, '(?<![0-9])(?:(?:0?[1-9]|[12][0-9]|3[01])[-./](?:0?[1-9]|1[0-2])[-./](?:19|20)[0-9]{2}|(?:19|20)[0-9]{2}[-./](?:0?[1-9]|1[0-2])[-./](?:0?[1-9]|[12][0-9]|3[01]))(?![0-9])', ' ', 'g');
  t := regexp_replace(t, '(?<![0-9])(?:[01]?[0-9]|2[0-3]):[0-5][0-9](?![0-9])', ' ', 'g');
  -- o against a digit is a zero; repeat so "o8o3o" folds all the way
  loop
    prev := t;
    t := regexp_replace(t, '([0-9][ ._()*+-]*)o', E'\\1' || '0', 'g');
    t := regexp_replace(t, 'o([ ._()*+-]*[0-9])', '0' || E'\\1', 'g');
    n := n + 1;
    exit when t = prev or n >= 12;
  end loop;
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Detectors (each takes the NORMALISED text)
-- ---------------------------------------------------------------------------
create or replace function private.community_detect_phone(p_norm text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v text;
  m text[];
  d text;
  g text[];
  tot integer;
  mx integer;
  singles integer;
begin
  v := private.community_digit_view(p_norm);
  -- a decimal such as 6.5 or 7.25 is a measurement, not a phone number; a chain such as 0.8.0.3 is not matched (it is a dodge)
  v := regexp_replace(v, '(^|[^0-9.])[0-9]+\.[0-9]{1,2}(?![0-9]|\.[0-9])', '\1 ', 'g');
  if v ~ '\+\s?[0-9][0-9 ._()-]{8,}[0-9]' then return true; end if;     -- an international number written with a plus
  for m in select regexp_matches(v, '[0-9](?:[0-9 ._()*+-]*[0-9])?', 'g') loop
    d := regexp_replace(m[1], '[^0-9]', '', 'g');
    tot := length(d);
    if tot < 9 then continue; end if;
    g := regexp_split_to_array(btrim(regexp_replace(m[1], '[^0-9]+', ' ', 'g')), ' ');
    select coalesce(max(length(x)), 0), count(*) filter (where length(x) = 1) into mx, singles from unnest(g) as x;
    if tot >= 10 and d ~ '^0[789][01]' then return true; end if;        -- a Nigerian mobile written nationally
    if tot >= 12 and d ~ '^234[789][01]' then return true; end if;      -- ... or internationally
    if mx >= 10 then return true; end if;                               -- an account number or a long unbroken number
    if tot between 10 and 13 and mx <= 4 and cardinality(g) >= 3 and (m[1] ~ '[-._()]' or (cardinality(g) = 3 and (select min(length(x)) from unnest(g) as x) <= 3)) then return true; end if;  -- a number in short blocks, with separators or an uneven last block
    if singles >= 8 then return true; end if;                           -- digits spaced apart to dodge the filter
  end loop;
  return false;
end $$;

create or replace function private.community_detect_email(p_norm text) returns boolean
language sql immutable set search_path = '' as $$
  select p_norm ~ '[a-z0-9._%+-]{2,}\s?(?:@|\(at\)|\[at\]|\{at\})\s?[a-z0-9-]{2,}\s?(?:\.|\(dot\)|\[dot\]|\{dot\}|\ydot\y)\s?[a-z]{2,}'
      or p_norm ~ '\y[a-z0-9._-]{2,}\s+at\s+[a-z0-9-]{2,}\s+dot\s+[a-z]{2,}\y'
$$;

create or replace function private.community_detect_handle(p_norm text) returns boolean
language sql immutable set search_path = '' as $$
  select p_norm ~ '(?:^|[^a-z0-9._])@[a-z0-9_.]{3,}'
$$;

-- True when the text holds a link that is NOT on the allow-list. p_allowed is a JSON array of exact hostnames.
-- Exact match only: "tarragonhealth.ng.example.com" and "tarragonhealth.ng@evil.com" are both refused (COM-10).
create or replace function private.community_detect_url(p_norm text, p_allowed jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  tok text;
  h text;
begin
  -- "evil[.]com", "evil(dot)com", "evil {.} com" are the same link
  p_norm := regexp_replace(p_norm, '\s?[\[({]\s?(?:\.|dot)\s?[\])}]\s?', '.', 'g');
  -- "example dot com" written out can never be allow-listed
  if p_norm ~ '\y[a-z0-9-]+\s+dot\s+(?:com|ng|org|net|co)\y' then return true; end if;
  for m in
    select regexp_matches(p_norm,
      '(?:https?://|www\.)[^\s]+|\y[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|ng|org|net|co|io|me|ly|info|biz|app|xyz|tv|link|site|online|store|shop|health)\y(?:/[^\s]*)?',
      'g')
  loop
    tok := m[1];
    h := regexp_replace(tok, '^https?://', '');
    if split_part(split_part(split_part(h, '/', 1), '?', 1), '#', 1) like '%@%' then return true; end if;   -- user@host tricks
    h := split_part(split_part(split_part(h, '/', 1), '?', 1), '#', 1);
    h := regexp_replace(h, ':[0-9]+$', '');
    h := regexp_replace(h, '[.,;:!?)\]]+$', '');
    if not (coalesce(p_allowed, '[]'::jsonb) @> jsonb_build_array(h)) then return true; end if;
  end loop;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The scan
-- ---------------------------------------------------------------------------
-- decision: safety > block > hold > allow. 'unavailable' when no rule set is live (the caller must refuse to post).
create or replace function private.community_scan(p_body text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_set public.community_filter_rule_sets;
  v_norm text;
  v_allowed jsonb;
  r record;
  v_hit boolean;
  v_hits jsonb := '[]'::jsonb;
  v_rank integer := 0;
  v_dec text := 'allow';
begin
  select * into v_set from public.community_filter_rule_sets where status = 'active';
  if not found then
    return jsonb_build_object('decision', 'unavailable', 'version', null, 'hits', '[]'::jsonb);
  end if;
  v_norm := private.community_normalise(p_body);
  v_allowed := coalesce(v_set.params -> 'allowed_hosts', '[]'::jsonb);
  for r in select id, class, kind, pattern, action from public.community_filter_rules where rule_set_version = v_set.version order by id loop
    if r.kind = 'detector' then
      v_hit := case r.pattern
        when 'phone_digits' then private.community_detect_phone(v_norm)
        when 'email' then private.community_detect_email(v_norm)
        when 'handle' then private.community_detect_handle(v_norm)
        when 'url' then private.community_detect_url(v_norm, v_allowed)
        else false end;
    else
      v_hit := v_norm ~ r.pattern;
    end if;
    if v_hit then
      v_hits := v_hits || jsonb_build_array(jsonb_build_object('rule_id', r.id, 'class', r.class, 'action', r.action));
      v_rank := greatest(v_rank, case r.action when 'safety' then 3 when 'block' then 2 when 'hold' then 1 else 0 end);
    end if;
  end loop;
  v_dec := case v_rank when 3 then 'safety' when 2 then 'block' when 1 then 'hold' else 'allow' end;
  return jsonb_build_object('decision', v_dec, 'version', v_set.version, 'hits', v_hits);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Who is who (none of these uses private.is_org_staff())
-- ---------------------------------------------------------------------------
create or replace function private.community_is_moderator(p_group uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator')
     where s.profile_id = (select auth.uid())
       and s.scope = 'moderator' and s.revoked_at is null
       and (s.group_id is null or p_group is null or s.group_id = p_group))
$$;

create or replace function private.community_is_safety_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.community_staff s
      join public.profiles p on p.id = s.profile_id and p.is_active and p.role in ('admin', 'care_coordinator')
     where s.profile_id = (select auth.uid())
       and s.scope = 'safety_reviewer' and s.revoked_at is null)
$$;

-- Adults only (COM-4). No date of birth, a merged account or a dependant account is not an adult member: fail closed.
create or replace function private.community_adult(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile and p.is_active
       and p.merged_into_profile_id is null
       and not coalesce(p.is_dependent_account, false)
       and p.date_of_birth is not null
       and p.date_of_birth <= (current_date - interval '18 years')::date)
$$;

-- The blocking sanction in force for this member in this group, or null.
create or replace function private.community_active_sanction(p_profile uuid, p_group uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.kind
    from public.community_sanctions s
   where s.profile_id = p_profile
     and (s.group_id is null or s.group_id = p_group)
     and s.kind in ('mute', 'suspend', 'ban')
     and s.appeal_state <> 'overturned'
     and s.starts_at <= now()
     and (s.ends_at is null or s.ends_at > now())
     and s.appeal_state <> 'overturned'
   order by case s.kind when 'ban' then 1 when 'suspend' then 2 else 3 end
   limit 1
$$;

-- One quiet in-app notice, fixed text chosen by the template key, no group name, no handle, no excerpt (INV-07).
-- Skipped when the recipient already has an unread notice of the same kind from the last ten minutes.
create or replace function private.community_notify(p_recipient uuid, p_template text, p_source uuid, p_source_table text default 'community_posts') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null then return; end if;
  if exists (
    select 1 from public.notifications n
     where n.recipient_id = p_recipient and n.template = p_template and n.opened_at is null
       and n.created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload, content_class, source_table, source_id)
  select p.organisation_id, p.id, 'in_app', p_template, '{}'::jsonb, 'non_clinical', p_source_table, p_source
    from public.profiles p where p.id = p_recipient and p.is_active;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Privileges: private helpers are for the SECURITY DEFINER functions only
-- ---------------------------------------------------------------------------
revoke all on function
  private.community_cfg(), private.community_cfg_get(text[]), private.community_cfg_int(text),
  private.community_normalise(text), private.community_digit_view(text),
  private.community_detect_phone(text), private.community_detect_email(text), private.community_detect_handle(text),
  private.community_detect_url(text, jsonb), private.community_scan(text),
  private.community_is_moderator(uuid), private.community_is_safety_reviewer(),
  private.community_adult(uuid), private.community_active_sanction(uuid, uuid),
  private.community_notify(uuid, text, uuid, text)
from public, anon, authenticated, service_role;
