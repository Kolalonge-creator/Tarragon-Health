# Cybersecurity Incident Runbook

*Operational runbook, not a legal filing. This is for a **suspected** intrusion, credential compromise, or attack in progress — the moment something looks wrong, before anyone knows whether it's actually a reportable personal-data breach. That determination, and the NDPC/patient-notification process once something is confirmed, lives entirely in `../legal/breach-notification-runbook.md` — this runbook's whole job is detection and containment, ending in a handoff to that one. Don't wait for certainty before starting here; the breach-notification runbook's 72-hour clock starts at the moment TarragonHealth becomes aware, and every hour spent here before that clock starts is an hour of the statutory window still intact if this turns out to be reportable.*

## What counts as a reportable (suspected) incident

On this platform's real architecture — Supabase Postgres with RLS as the primary defence, Vercel/Railway hosting, service-role keys and Supabase project tokens as the highest-value credentials, GitHub as the source of truth — the categories most likely to trigger this runbook are:

- Anomalous database access — query volume, patterns, or a `pg_stat`/log signal that looks like someone is enumerating patient records rather than serving normal app traffic. CLAUDE.md's own history has real examples of the underlying vulnerability class even without malicious intent: a wrong role admitted to `private.is_org_staff()`, or a function's `anon` EXECUTE privilege silently inherited through `PUBLIC` rather than actually revoked — either one is a live door, confirmed or suspected exploitation aside.
- A leaked or exposed credential — a service-role key, an admin password, a Supabase or Vercel project token, a `.env` value committed to a public location.
- Unusual authentication activity — a spike in failed logins, a login from a context that doesn't match a known user's pattern, or any sign MFA/rate-limiting has been bypassed.
- A dependency or platform CVE affecting something actually deployed (Next.js, a package with direct DB/auth exposure) that's being actively exploited elsewhere, not just theoretically applicable.
- A report from a partner (a lab, pharmacy, HMO, or Paystack/Stripe) that their side was compromised in a way that could expose data they hold on our patients, or credentials we shared with them.
- Anything that, on investigation, starts looking like unauthorised access to, disclosure of, loss of, or destruction of personal data — at that point this **is** a suspected breach in the breach-notification runbook's own sense, and stage 4 below applies.

**When in doubt, open an incident.** A false alarm that turns out to be a misconfigured monitoring alert costs an hour of investigation; a real intrusion never opened costs the company any chance of containing it before it becomes a confirmed breach.

## Severity and detection clock

The clock that matters here is **time to containment**, because every hour an intrusion continues is more data at risk and, if this becomes reportable, less of the 72-hour NDPC window survives once `discovered_at` is logged.

- **Low** — a single anomaly, plausibly benign, no evidence of actual unauthorised access.
- **Medium** — a credential or vulnerability that *could* be exploited but no confirmed access yet; contained same-day.
- **High** — confirmed unauthorised access to a bounded, non-sensitive scope, or a credential known to be exposed but not yet confirmed used.
- **Critical** — confirmed or highly likely unauthorised access to patient data, an active/ongoing intrusion, or anything that could plausibly meet the breach-notification runbook's own "reasonably suspected" threshold.

## Roles

- **Whoever notices first** (any employee, contractor, or a report from a partner) — escalates immediately to the founder. Do not sit on it to "confirm first" — a suspected intrusion is contained faster the earlier it's flagged, even half-formed.
- **Security Lead / incident commander** [to be appointed/confirmed — there is no dedicated security team or on-call rotation on this platform; today this role is filled by whoever on the founder/engineering side is available when something is flagged].
- **Founder / engineering** — technical containment: revoke the credential, roll the affected key, patch the RLS/privilege gap, take a compromised service offline. Produces the facts the eventual breach-notification process would need if this escalates: what access occurred, to what data, over what window, confirmed or still suspected.
- **Outside counsel** — looped in once severity reaches High/Critical or as soon as this looks like it may hand off to the breach-notification runbook; best-effort, non-blocking — containment does not wait on counsel, but counsel should not be the last to know either.

## The four stages

### 1. Detect and isolate
The moment something looks wrong: stop the immediate exposure first — revoke a leaked credential, disable a compromised account, take an exposed resource offline — before spending time confirming exactly what happened. Record a `discovered_at`-equivalent timestamp the moment suspicion crosses the "a reasonable person would act on this" threshold; that timestamp matters later if this becomes a confirmed breach.

### 2. Investigate and scope
Work out what was actually accessed, by what means, and for how long — query logs, auth logs, git history for a leaked credential, and the specific RLS/privilege surface involved. This is where "suspected" starts turning into "confirmed" or "ruled out." Keep a running log of what's known and not yet known, the same discipline as the breach-notification runbook's own incident description.

### 3. Contain and eradicate
Close the actual hole, not just the symptom — the same standard CLAUDE.md already holds RLS fixes to: ship the fix as a migration with a proof (a rolled-back-transaction test, or for a privilege gap, a live `has_function_privilege`/`has_table_privilege` check — CLAUDE.md's own history is full of "believed fixed, found still broken" entries for exactly this class of gap, so verify live, don't trust a past comment). Confirm the hole is actually closed before standing down, not just patched in the obvious place.

### 4. Confirm outcome — close, or hand off
Two ways this stage ends:
- **Ruled out or fully contained with no personal-data exposure**: close this incident with a summary of what was found, what was fixed, and how it was verified closed.
- **Confirmed or reasonably suspected personal-data breach**: this incident does not close here — it **hands off directly to `../legal/breach-notification-runbook.md`**. Everything gathered in stages 2–3 (what data, how many people, what window, confirmed vs. suspected) becomes the input to that runbook's own "Open — contain" stage. Don't restart the clock or re-investigate from scratch; carry the findings across.

## After the incident
Every incident closed on a structural cause should produce a concrete follow-up — a migration, a CI check, a monitoring rule — that makes the same class of exposure structurally harder, not just a one-time patch. The recurring pattern in this codebase's own history (the `anon` EXECUTE gotcha alone has recurred multiple times despite being "fixed" before) is the argument for treating every closed incident as a chance to add a check that would catch it automatically next time, not just fix the one instance.

## Contact
Questions about this runbook: the founder, or whoever is on-call for `apps/web`/infrastructure at the time.
