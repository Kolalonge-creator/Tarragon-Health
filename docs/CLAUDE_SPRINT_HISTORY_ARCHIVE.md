# Tarragon Health — Sprint History Archive

> This is the full, unedited, dated build-history record that used to live inline in `CLAUDE.md`.
> It was extracted verbatim (no content removed or rewritten) on 2026-08-04 to keep `CLAUDE.md`
> itself scannable — see the "Where things actually stand" section at the top of `CLAUDE.md` for
> why, and for a short, current-as-of-cleanup summary of what in here still matters operationally.
>
> **Read this file for historical reasoning, exact migration filenames, or the specific PR behind a
> past decision. Do not treat any price, rate, plan name, feature-availability claim, or "state:
> done" note below as current** — this project's business rules and shipped-feature list changed
> extremely often, and later entries in this same file repeatedly reverse earlier ones (diaspora
> pricing was reworked at least four times before diaspora subscriptions were replaced entirely by a
> sponsor/Care-Voucher model, for one example). Always confirm against the live database or the
> actual running code before acting on anything you read here.
>
> Entries run chronologically from 2026-07-09 through 2026-08-03. The first block below is the
> 2026-07-29 "pivot reversed" banner and the frozen v3 (M1/M2) sprint record; the second block is the
> day-by-day "Current Sprint" changelog that followed it.

---

## ⚠️ 2026-07-29 (evening) — PIVOT REVERSED. Read this section first, every session.

**The platform (`apps/web`) is the build target again. It is NOT frozen. v3 is now an idea source,
not a replacement.** This supersedes the earlier same-day banner, which declared a full pivot to the
narrow v3 cardiometabolic build and froze `apps/web` — that pivot lasted less than a day.

Founder decision, after walking through what v3 actually offers: **v3 is not a newer version of the
platform, it is a narrower product with different commercial physics.** So it splits in two, and the
two halves are treated completely differently:

1. **v3's engineering and clinical-safety discipline → PORT IT IN.** Invariants as failing-first
   tests, I1 (no clinical content on WhatsApp/SMS/email) as a real DB CHECK rather than a
   convention, delivery states (delivered/opened/acted) + device heartbeat + forced-channel
   fallback, the escalation SLA table as data not code, deterministic always-classify with a
   `clinician_override` field, versioned clinician-approved rulesets, I5 (urgent/emergency cannot
   be closed by a text-only note), `proof_log`-style plain-language patient-facing summaries,
   small-cell suppression, provenance NOT NULL, I6, I7.
2. **v3's product narrowing → four rules ADOPTED, the rest NOT.** These delete shipped features and
   are founder-approved (2026-07-29):
   - **I9** — institutions get aggregate only; **only superadmin** may drill into an individual.
     Removes the employer/HMO per-member drill-down shipped 2026-07-16.
   - **I8** — **no capitation, ever.** Removes `finance_capitation_contracts` / HMO capitation.
   - **Individual enrolment only** — removes family plans (Family Lite/Plus/Premium) and ParentCare.
   - **One naira price list** — removes the GBP/USD diaspora price book. Reason given: a visible
     NGN-vs-diaspora gap makes buyers sceptical.

   Everything else in build-spec-v3 §19's out-of-scope list does **not** apply here — care
   coordination, specialist referrals and multimorbidity remain core platform categories.

**Agreed order:** restore the platform DB first (done), then remove the four areas above as
deliberate, tested migrations, so each removal is provable. **The four removals are NOT yet built.**

### Where each database lives (as of 2026-07-29 evening)

| Project | Ref | Holds |
|---|---|---|
| **Tarragon Health** | `koiplnmbgnqnbywhpjlf` | **The platform.** 277/277 migrations, 184 tables, 487 policies, 20 cron jobs. All 7 Edge Functions + their secrets. This is the go-forward database. |
| Tarragon Platform | `rjsxbhgqdudowlvarmzq` | Throwaway rehearsal copy of the same 277. Slated for deletion. |
| tarragon-control-staging | `jpdwbnvrgvpntcmfefeu` | Paused. Duplicate v3 build from the (now preserved) `~/Documents/tarragon-control` repo. |

`koiplnmbgnqnbywhpjlf` was chosen to keep the platform specifically because **Edge Function secrets
never transfer between projects** and fail silently when missing — the lesson already learned the
hard way with `stripe-webhook`. Keeping the ref also avoided re-pointing Paystack, Stripe, Zoom
and Meta.

- **Migrations:** `supabase/migrations/` = the platform (277). `supabase/migrations_v3_spec_build/`
  = the 44 v3 files, reference only, applied to no active project. See that folder's README.
- **`reference/tarragon-control/`** = a full git bundle + every file of the separate v3 repo, which
  had **no git remote**. Contains the I1–I10 invariant suite and M1–M4 exit tests that exist
  nowhere else — the highest-value artifacts for the port described above.
- The **"Current Sprint — v3"** section below is the record of the M1–M4 v3 build. Real work,
  kept as history, **not the current build target**. Log new platform work in the legacy
  "Current Sprint" section further down instead.

### Three bugs only a clean replay could find (fixed 2026-07-29, do not reintroduce)

1. `20260706033358` revoked EXECUTE on `public.rls_auto_enable()` — **a function no committed
   migration ever creates.** It was made directly against the old database. Now guarded on
   `pg_proc`. ⚠️ **A rebuilt database therefore had no `rls_auto_enable` event trigger** from
   2026-07-06 through 2026-07-29, so the auto-enable-RLS-on-new-table safety net did not exist
   and had never existed in migration history for that whole window. **Fixed 2026-07-29 evening**
   by `20260729235803_rls_auto_enable_event_trigger` — a real `create event trigger` on
   `ddl_command_end` for `CREATE TABLE`/`CREATE TABLE AS`/`SELECT INTO` in the `public` schema,
   auto-enabling RLS (no policy — that still has to be written per table) the instant a table is
   created, with zero explicit `alter table ... enable row level security` needed. Verified live:
   a bare `CREATE TABLE` with no follow-up ALTER came up `relrowsecurity = true` in a rolled-back
   transaction. `anon`/`PUBLIC` EXECUTE revoked on the function in the same migration this time
   (no follow-up needed, unlike the original out-of-band version). Every table created before
   this timestamp still needed — and got, per migration history — its own explicit
   `enable row level security` line; this only protects tables created from here forward.
2. **Seven version numbers were claimed by more than one migration** (`20260720120000` by six
   files), from parallel sessions hand-typing round-number timestamps.
   `supabase_migrations.version` is the PK, so the second file of each group could never record.
   Renumbered by seconds. **Never hand-type a round-number migration timestamp.**
3. Bare `vector(1536)` failed on replay — pgvector installs into `extensions`, which is not on the
   migration connection's search_path (`config.toml`'s `extra_search_path` governs PostgREST, not
   psql). Always write `extensions.vector(...)`.

**Anon-execute finding: CLOSED** by `20260729183412_revoke_anon_execute_on_security_definer_rpcs.sql`.
`public` now has **zero** anon-executable SECURITY DEFINER functions. Note the mechanism, because
this codebase got it wrong four times: `anon` holds no direct grant — it inherits EXECUTE from the
**PUBLIC pseudo-role** (the leading `=X/postgres` entry in `pg_proc.proacl`). So
`revoke ... from anon` is a **no-op**; `revoke ... from public` is the fix. Always end such a
migration with an assertion block that raises if `has_function_privilege('anon', ...)` is still
true — that assertion is what caught the wrong form being applied here.

### ▶ NEXT ACTIONS — start here

**State: all four founder-approved removals are done, both pricing decisions that were blocking
them are answered, and the four follow-up items from the same evening (lab_partner merge,
rls_auto_enable, the I1–I10 invariant port, config.toml) are also done.** `supabase/migrations/`
has 293 files, matching every migration this session applied (287 base + the 5 lab_partner +
`rls_auto_enable_event_trigger`), verified by diffing the applied version list against the
filenames, not by counting. typecheck, lint (0 errors, 2 pre-existing warnings), 444 web + 47
shared tests and the production build all green. Nothing from this session is half-finished.
⚠️ **The live database has a 294th applied migration, `20260730000555_vaccination_schedule_signoffs`,
with no local file** — a concurrent session's in-flight work, not part of this pass and
deliberately not reconciled here per the shared-working-directory hazard (don't touch another
session's uncommitted work). Whoever picks it up next should pull it from
`supabase_migrations.schema_migrations.statements` and commit the file, same as every prior
reconciliation in this log.

`main-dev` is pushed and reproduces the live database. Removals 1-3 were merged as a single
fast-forward — they were a linear stack, not three parallel branches — along with
`20260729194127_scoped_access_roles_out_of_org_staff` from a parallel session.

| # | Removal | Migration(s) |
|---|---|---|
| 1 | ~~**No capitation (I8)**~~ ✅ | `20260729122912` |
| 2 | ~~**Institutions aggregate-only (I9)**~~ ✅ | `20260729124330` |
| 3 | ~~**One price list**~~ ✅ | `20260729130000`, `131500`, `140916`, `141426` |
| 4 | ~~**Individual enrolment only**~~ ✅ | `20260729143514` |
| + | ~~**GBP + Diaspora Premium retired, USD rate set**~~ ✅ | `20260729143814` |

✅ **`claude/lab-partner-role` (PR #159) is now merged — deliberately NOT as the raw branch.**
Its five migrations were timestamped `20260727*` and one of them
(`harden_is_org_staff_exclude_partner_employees`) rewrites `is_org_staff`. Applying it as-is would
have run *after* `20260729194127` in wall-clock time but sorted *before* it, so its older
definition would have overwritten the newer one and silently re-admitted `pharmacist`,
`lab_liaison`, `finance` and `analyst` to 314 policies across 110 patient-scoped tables — it was
merged and reverted once here for exactly this reason. Fixed 2026-07-29 evening: renumbered all
five to `20260729234443`–`234618` (after `20260729194127`) and rewrote the hardening migration to
COMPOSE with the two prior exclusions rather than replace them — net effect one role,
`lab_partner`, added; every prior exclusion preserved and proven by assertion block. Verified with
a rolled-back RLS test including a clinician control and a deliberate-sabotage run
(`packages/db/tests/lab_partner_rls.sql` — sabotaged, a lab partner reads 2 lab_orders + 30
profiles; fixed, 0 + 1).

✅ **`rls_auto_enable` written for real, 2026-07-29 evening** —
`20260729235803_rls_auto_enable_event_trigger`. The rebuilt database had no auto-enable-RLS-on-
new-table safety net from 2026-07-06 through 2026-07-29 (see bug 1 below); now a real
`create event trigger` on `ddl_command_end` auto-enables RLS the instant any `CREATE TABLE` runs
in the `public` schema, proven live in a rolled-back transaction (a bare `CREATE TABLE` with zero
`ALTER TABLE` statements came up `relrowsecurity = true`). `anon`/`PUBLIC` EXECUTE revoked on the
function in the same migration.

✅ **The I1–I10 invariant suite ported, 2026-07-29 evening** —
`packages/db/tests/i1_i10_invariants_platform.sql`, adapted from
`reference/tarragon-control/supabase/tests/invariants_test.sql` onto the platform's real tables
(the two schemas share no table names). 7 of 11 checks are genuine, live-proven **PASS** (I3, I4×2,
I8, I9×4). **3 are genuine, live-proven GAPS — real findings, not hypothetical:**
- **I1 — no clinical content on WhatsApp/SMS/email.** `public.notifications` has no
  `content_class` column and no CHECK at all. Enforced today by convention only (every template in
  this codebase is deliberately non-clinical), not by the database. This is the exact item the
  pivot banner above already named under "PORT IT IN" — now a concrete, rerunnable regression check
  instead of banner text.
- **I5 — urgent/emergency escalations can be closed by a text-only note.** `escalations` has no
  trigger requiring a linked synchronous contact (voice/video) before a `clinician_alerts.level =
  'emergency'`-linked escalation resolves. Proven live: the resolve succeeds with nothing but
  `resolution_note`. Also already named under "PORT IT IN" above.
- **I14 — a patient can edit their own device-sourced vitals reading.** New finding, not
  previously flagged anywhere in this file. `vitals_readings_update`'s RLS policy is source-blind
  (`patient_id = auth.uid() OR is_org_staff(...)`) — nothing stops a patient from directly editing
  a `source = 'device'` row after the fact, which matters because device readings already feed the
  BP/glucose red-flag and abnormal-result pipelines. **This is a product decision, not purely an
  engineering one** — tightening it changes real patient-facing behaviour (can a patient edit ANY
  vitals row, or only manual ones?) — flag to the founder before building the fix.
None of the three were fixed in this pass — the suite's job was to prove and document them
precisely, matching the source file's own "a fake pass is worse than no test" discipline. Building
the actual DB-level enforcement for each is real, separate, higher-blast-radius engineering work
(I1 needs a content-classification audit of every live template; I5 needs the synchronous-contact
trigger designed; I14 needs the founder's call above) — do not build any of the three without an
explicit ask.

✅ **`supabase/config.toml`'s stale region comment fixed, 2026-07-29 evening.** It previously and
incorrectly claimed production must be `af-south-1`; corrected to `eu-west-1`, matching the real
live project and the rest of this file.

**Removal 3 changed meaning mid-flight — do not re-read the old wording.** "One naira price list"
does NOT mean naira only. It means **one price, payable in naira or dollars**: the naira price is
the only stored price and the dollar price is derived from it at the admin-set reference rate
(`/admin/settings/diaspora-pricing`), enforced by `private.enforce_derived_price`. Changing the
rate recomputes every derived row, clears provider references (Paystack Plans and Stripe Prices are
amount-immutable) and mints replacements.

**Removal 4's replacement model, as the founder specified it:** each person keeps their own account
and their own subscription. A next of kin can be **contacted if something goes wrong** and can
**view activity but not edit it**. That maps exactly onto `profile_access`, which was already in
the schema and already correct:

| Level | Who | What the database allows |
|---|---|---|
| `view` | next of kin | reads every profile_access-aware SELECT policy; every write policy requires `manage`, so they cannot edit |
| `manage` | a parent, for a child with no login | reads and writes — vaccination doses, bookings, reproductive-health |

**The gap this removal actually had to close** was not the model, it was that **no UI had ever
written an adult grant** — only `addChildDependentAction`. `/patient/family` is now where a patient
names a next of kin (granting `view` and filling the `emergency_contact_*` fields the escalation
path already reads), lists the children they look after, and adds a new one. It is ungated: naming
a next of kin is not something a person should have to buy.

**Prove any change to this with a control.** `packages/db/tests/individual_enrolment_and_next_of_kin.sql`
pairs every negative check with a positive one in the same rolled-back transaction — the `view`
next of kin is refused the exact write a `manage` guardian completes. It was confirmed to
discriminate by re-running it with the control downgraded to `view`, which fails at that check with
`42501`. A blocked-everything grant would otherwise pass a negatives-only test.

**`quarterly_report` moved to Complete Care** — it was granted only by tiers removal 4 deletes, and
leaving it granted to nobody would have left a built, working per-patient PDF (generator, cron,
download route) reachable by no one. **That is a pricing judgement, not a founder decision on
record**; reverse it by deleting one block in `20260729143514`.

**The price list is fully on sale again, and this was a real latent bug.** Removal 3's restore had
left all 12 naira plan and add-on rows with `paystack_plan_code = null`, so after removal 4 deleted
Family Plus and Family Premium — the only two active paid plans — **Free was the only purchasable
plan on the platform.** The Paystack Plans still existed at exactly the right amounts, so they were
re-linked (each guarded on the amount matching) rather than re-minted. All 24 rows (12 naira, 12
dollar) are now active with real provider objects. ⚠️ **All of them are on the TEST-mode Paystack
and Stripe accounts** — a live-keys cutover needs a full re-sync.

**Provider objects for the deleted tiers:** 10 family/ParentCare Paystack Plans still exist and are
renamed `RETIRED 2026-07-29 - …`. Paystack has no delete or deactivate for a plan. They are
unreachable in practice — the app only ever initialises checkout from a `subscription_plans` row,
those rows are gone, and the account has **zero payment pages** (checked), which is the only way to
buy a plan outside the app.

**⚠️ `private.is_org_staff` is still the highest-leverage security function in this codebase.**
Removal 2 found it admitted **every non-patient role**, so `corporate_admin` and `hmo_admin`
satisfied **314 policies across 110 patient-scoped tables** — an employer or HMO administrator had
direct RLS read access to vitals, medications, screening results and risk scores for every patient
in their organisation. Two such accounts existed. Fixed in the function itself rather than in 314
policies, then the three non-health surfaces an employer genuinely owns (`employer_roster_members`,
`outcome_reports`, `cohort_cost_model_constants`) were re-granted by name.
`20260729194127_scoped_access_roles_out_of_org_staff` then removed `pharmacist`, `lab_liaison`,
`finance` and `analyst` for the same reason. **Any change to this function is a change to 110
tables at once.**

**The pattern the four removals set — follow it for anything similar:**
1. **Count the rows first.** Every one of the four turned out to have zero rows, which converted a
   feared data migration into a pure structural change. Put the counts in the migration header so a
   reader can see why no conversion step exists.
2. **Delete the enum VALUE, not just the feature.** `outcomes_contract_type` lost `capitation`,
   `booking_origin` lost `capitated`, and removal 4 dropped `family_relationship` outright. An
   unreachable enum member is the loophole the feature grows back through. Where the type is too
   widely used to rewrite — `currency` still carries `GBP`, because it is stamped on historical
   payment rows — make the guarantee with a CHECK on the tables that matter instead.
3. **Rewrite dependents before you drop the thing they depend on.** `DROP TABLE` refuses while a
   policy references it, and `CASCADE` would have quietly left `patient_quarterly_reports` one
   policy short — the wrong failure. Recreate the policy first, then drop.
4. **End with a DO block of assertions.** The migration is the test: it raises if any deleted enum
   value, table, function body, policy or plan row survived. That is what makes "removed" provable
   rather than hopeful.
5. **Prove it with a simulated session AND a control.** `set_config('request.jwt.claims', …)` +
   `set local role authenticated` in a rolled-back transaction. An institution seeing 0 patient rows
   means something only once a clinician in the same probe sees 15; a `view` grantee being refused a
   write means something only once a `manage` grantee completes it. Then break the test on purpose
   and confirm it fails — removal 4's suite was validated that way.
6. **Anything data-only dies in a rebuild.** `seed.sql` runs on a local `db reset` and is never
   applied to a remote project. Removal 3 existed because the price book lived there. After each
   removal, reconcile `seed.sql` too, or a fresh environment resurrects what the database now
   refuses.
7. **Deleting the row is not deleting the product.** Check the provider. Paystack has no
   delete-or-deactivate for a plan, so the mitigation is that no `subscription_plans` row and no
   payment page reference it — verify both rather than assuming.

**Founder decisions — all three answered 2026-07-29, recorded here so they are not re-asked:**
1. **The FX reference rate.** USD only, "as it is the universal currency", at **₦1,365 to the
   dollar**. Pounds retired outright rather than given a rate. Editable any time at
   `/admin/settings/diaspora-pricing`, which is now a single-rate form.
2. **Diaspora Premium.** Retired. It had no naira counterpart, so it could never sit on a single
   price list, and it was GBP-only anyway.
3. **Removal 4's replacement model.** Individual accounts plus a next of kin who can be contacted
   and can view but not edit — see the removal-4 section above.

**Owner-side (cannot be done by an agent):**
- Delete the **Tarragon Platform** (`rjsxbhgqdudowlvarmzq`) and **tarragon-control-staging**
  (`jpdwbnvrgvpntcmfefeu`) projects in the dashboard — MCP can only pause, not delete. Everything
  from both is preserved in this repo. Keeping Tarragon Platform briefly as a fallback is fine.
- **Rename** `koiplnmbgnqnbywhpjlf` if desired — it is correctly named "Tarragon Health" already,
  but nothing else should be named "Tarragon Platform" going forward.
- ~~**Push `main-dev` to GitHub.**~~ Done 2026-07-29. `reference/tarragon-control/` is still the
  only copy of that repo's history and it still lives on one disk.

## Current Sprint — v3 (FROZEN — not an active roadmap, see 2026-07-30 note)

**2026-07-30 — founder confirmed: "V3 should be enhancement of what we already have, not a
replacement."** This sharpens the pivot-reversal above. Concretely: neither of the two v3
codebases below (this project's M1/M2, or the separate `tarragon-control` repo which independently
reached M1-M4) continues as a milestone-by-milestone build. **Do not resume M3/M4/M5/etc. in
either place.** Both stay dormant, reference-only — the only sanctioned path for anything in v3
reaching the real platform is a deliberate, explicitly-asked-for port of one named feature/
discipline into `apps/web`, the same way I1-I10, `rls_auto_enable`, and the four narrowing rules
were each pulled in above. If asked to "continue v3," clarify which specific piece to port instead
of resuming a milestone.

The M1/M2 entries below are the historical record of what was built here before the pivot
reversed, kept for reference — do not add new milestones to this section going forward.

### 2026-07-29 — M1 built and verified: schema, RLS, audit, invariants (this session)
Full Phase 1 §5 schema (all 17 enums, 33 tables — see build-spec-v3 §5.1–§5.11), RLS enabled and
policied on every table (default-deny, matches §6), the generic audit trigger (§5.11) attached to
every patient-linked table, and DB-level enforcement of I1 (CHECK constraints), I2 (readings →
exactly one triage_classifications row, via a v0-provisional "everything needs_review" trigger —
blocks reading inserts entirely until a real clinician approves at least a provisional protocol,
which is correct per §7.1's own build order), I3 (NOT NULL, schema-level), I5 (BEFORE INSERT
trigger — closing an urgent/emergency classification requires a linked voice/synchronous_in_app
`clinical_contacts` row), I8 (no `capitation` enum value, structurally impossible to add without a
migration), I9 (institution_admin returns zero rows on every patient-scoped table — proven, not
assumed), I10 (proof_log triggers on clinical_notes/triage_classifications/escalations/
medication_dispenses). I4's exact `funder_reads_summary` policy from §6.2 implemented on `proof_log`.
- **Two mechanical deviations from the literal spec text** (not product decisions — invalid/missing
  SQL, fixed the same way this codebase has always handled spec gaps): (1) `escalations.breached`
  used `generated always as (... now() ...) stored`, which Postgres rejects (generated columns must
  be immutable) — replaced with a plain column + `v_escalations` view exposing a live-computed
  `breached_live`. (2) `programmes` (control/concierge) and `app_config` (accountability_model +
  the four Phase 2 go-live guards L1–L4) are referenced throughout the spec but never DDL'd —
  added both, `app_config` as a singleton row, superadmin-write-only.
- **Real bugs the test suite caught and fixed** (see `packages/db/tests/m1_invariant_and_rls_suite.sql`
  for the full account): `authenticated` had no base table-level GRANT after the schema reset
  (RLS restricts rows, but the role still needs the underlying SQL grant — Supabase normally
  provisions this at project creation, not on a schema rebuilt mid-project); `funder_reads_summary`/
  `consent_records_select` let an institution_admin-role consent grantee through, which violates
  I9's *absolute* "zero rows, no exceptions" — fixed by excluding institution_admin from those
  policies regardless of any consent naming that profile (defence in depth for §13's product
  promise); `lab_orders`' staff policy reused `can_see_patient()` (which includes patient
  self-access), accidentally letting a patient query `commission_minor` directly instead of being
  forced through the column-safe `lab_orders_patient()` function.
- Two `security_definer_view`-flagged views (`lab_orders_patient`, `clinical_notes_summary` — the
  column-restriction pattern for "patient/coordinator needs fewer columns than staff") were
  converted to SECURITY DEFINER **functions** instead, which only carries the accepted
  `authenticated_security_definer_function_executable` WARN every sibling RPC in this codebase's
  history carries, not the ERROR-level view finding.
- **Verified live** via `packages/db/tests/m1_invariant_and_rls_suite.sql`, a rolled-back
  transaction (JWT-claims role simulation, `set local role authenticated`, matching this
  codebase's established RLS-verification convention) — every invariant assertion and the full
  six-role RLS matrix passed with zero leftover rows after rollback. `get_advisors` clean (only
  the 2 accepted SECURITY DEFINER WARNs + a pre-existing, unrelated auth setting).
- **Real gap, flagged not guessed at:** the spec has no table linking an `institution_admin`
  profile to a specific `organisations` row (no `organisation_admins` bridge, no
  `profiles.organisation_id`) — `organisations`/`invoice_lines` currently have no institution_admin
  policy at all (safe default: zero rows, not broken), deferred to **M8** when the institution
  portal actually needs it. Flag to the founder before M8 starts.
- **Not yet built:** CI wiring for the test suite (needs a disposable/branch database + a
  `pnpm --filter db test:rls` script — tracked in the test file's own header comment). Repo
  scaffolding for `apps/patient`/`apps/screening`/`apps/console`/`apps/public` is READMEs only,
  correctly not-yet-functional per the spec's own milestone-order discipline (§20: "do not begin
  a milestone until the previous one passes its test").
- **Open decisions, per spec §21 — stop and ask before guessing:** voice vendor, `who_hearts` v1
  thresholds (ship v0-provisional until 200 real screening-day readings exist), Head of Clinical
  Operations name, validated-device list source, referral criteria v1 document, and — separately
  — the institution_admin↔organisation linkage gap noted above.

### 2026-07-29 — M2 built and verified: activation guard + accountability signature (this session)
Scoped tightly to §20's exit test — "Expired-MDCN clinician auto-suspends overnight; note
signature block renders correctly under both models" — not the full auth-screens/patient-clinician
CRUD surface, which has no consuming UI until M7/M8 per each app's own README discipline
(`apps/patient`, `apps/console` are still correctly READMEs-only). `profiles`/`patients`/`clinicians`
and the `handle_new_user` auth trigger already existed from M1; M2 adds the lifecycle rules around
`clinicians.active` and the accountability model.
- **Activation gate (write-time):** `private.enforce_clinician_activation_requirements` (BEFORE
  INSERT/UPDATE trigger on `clinicians`) blocks a row from ever reaching `active = true` unless
  `private.clinician_meets_activation_requirements` passes — MDCN current always; under
  `tech_layer` (the default), indemnity provider/policy/expiry also required and current. Under
  `provider`, indemnity is irrelevant, matching §4's table exactly. Re-validates on every update to
  an already-active row, not just insert, so an ops edit can't accidentally leave stale credentials
  active.
- **Nightly sweep (time-based):** `private.run_clinician_activation_guard`, scheduled via
  `cron.schedule('clinician-activation-guard-nightly', '15 2 * * *', ...)`, catches credentials that
  lapse purely by the passage of time with no write ever happening — the write-time trigger
  structurally can't see that. Only ever suspends (`active → false` + a `suspended_reason`), never
  activates; activation stays a deliberate ops/superadmin action gated by the trigger above.
  Suspension needs no `profiles.role` change or grant revocation — `private.actor_clinician_id()`
  already filters on `active = true` (a belt-and-suspenders comment already in the M1 RLS helper
  file anticipated this), so every `can_see_patient()` check for the clinician role goes dead the
  instant this one column flips. This is what §5.2's "revokes the clinician role grant immediately"
  means in this schema.
- **Real gap the M1 RLS review missed, fixed same pass:** `clinicians_update` let a clinician
  update their OWN row (`profile_id = auth.uid()`), including `active`/`suspended_reason`/
  `mdcn_*`/`indemnity_*` — combined with the guard above, a clinician the nightly sweep just
  suspended could have immediately reactivated themselves. Nothing in §5.2 defines a legitimate
  clinician self-service field on this table, so the self-update clause was removed outright
  (ops_admin/superadmin only) rather than patched with a second column-restriction trigger.
- **Accountability stamping is server-derived, not client-supplied:** `private.stamp_clinical_note_accountability`
  (BEFORE INSERT on `clinical_notes`) always overwrites `accountability_model_at_signing` (from
  live `app_config`) and `mdcn_number_at_signing` (from the real `clinicians` row), regardless of
  what the caller sends — same never-trust-the-client discipline as every other attribution field
  in this codebase. Proven in the test suite by deliberately inserting spoofed values and asserting
  they get overwritten.
- **Signature block rendering:** `packages/protocol/src/accountability.ts`, `getSignatureBlock(clinician, model)`
  — a pure function rendering the two §4 variants ("practising under own registration" /
  "on behalf of Tarragon Health Ltd"), unit-tested for both models
  (`accountability.test.ts`, 3 tests, added `jest.config.mjs` mirroring `packages/shared`'s since
  none existed yet). Always render from a signed note's own `accountability_model_at_signing`
  (or, for a not-yet-signed preview, live `app_config`) — never from live config for a past note,
  so a later model switch doesn't rewrite history, per §4's own requirement.
- **Verified live** via `packages/db/tests/m2_activation_guard_and_signature.sql`, a rolled-back
  transaction: activation blocked on expired MDCN, blocked on missing indemnity under
  `tech_layer`, allowed under `provider` with null indemnity, both nightly-suspension paths
  (MDCN and indemnity lapse) correctly stamp `suspended_reason`, the self-update lockdown holds
  (RLS admits zero matching rows, doesn't error — asserted on resulting state not an exception),
  and the stamping trigger overwrites spoofed input. Re-ran `m1_invariant_and_rls_suite.sql`
  unchanged afterward — no regression. `pnpm --filter @tarragon/protocol test`/`typecheck` green.
  `get_advisors` shows no new finding (only the same 2 pre-existing accepted SECURITY DEFINER
  WARNs from M1 + the pre-existing, unrelated leaked-password-protection setting — everything new
  this pass lives in `private` schema, never exposed via PostgREST, so it doesn't need an explicit
  anon/authenticated revoke the way a `public.*` RPC would).
- **Not yet built (deliberately, per milestone discipline):** any actual sign-up/login screen —
  there is no consuming app until M7 (patient) / M8 (console); `handle_new_user` (M1) is the whole
  of "auth infrastructure" needed so far. CI wiring for either test suite is still the same
  tracked-not-done follow-up as M1.
- **Next: M3** — `apps/screening` offline-first capture: consent-before-measurement, BP×2 with a
  rest-interval timer, `source = 'screening_day'`, on-device instant result card, aggregate
  report with `min_cohort_size` suppression, duplicate-not-merge conflict resolution on sync,
  attach-rate instrumentation (`screening_participants.converted_to_enrolment_id`). Exit test per
  §20: "200 synthetic readings captured offline, synced, duplicates surfaced not merged."

---

## Current Sprint (UPDATE THIS EVERY SPRINT)

**Status:** Sprint 4 (Python ML Microservice) is paused (2026-07-09) — do not resume without an explicit ask. All active work since then is TypeScript, logged chronologically below.

### Sprint 4 — Python ML Microservice (paused 2026-07-09)
Goal: build `services/ml` into the SCORE2 CVD/HbA1c-trajectory/BP-control/lab-interpretation/cohort-analytics service, wire it into TypeScript via `packages/shared/ml-client.ts`, deploy it — `docs/FEATURE_SPEC.md` §4 (weeks 7–9).

State at pause (confirmed live 2026-07-12): all 6 endpoints typed and never-throw in `ml-client.ts`; wired into BP-control assessment on every BP vitals log, a clinician lab/screening-result form (CVD risk + HbA1c trajectory + `patient_risk_scores` writes), and the corporate dashboard's cohort analytics (org-scoped, no PII sent). Railway deploy confirmed live (`/health`, `/docs` both 200). `patient_risk_scores` has 2 real `bp_control` rows proving the full path (Vercel → Railway → Supabase) worked at least twice — though both predate the "Fix Railway build" PR by a day or two, so if in doubt, log a fresh BP reading and check for a newer row. Sentry wired behind optional `SENTRY_DSN` (no-op if unset); no Sentry project created yet (needs the user's cloud credentials).

### 2026-07-11 — Marketing site + platform convergence (PR #15, merged to main-dev)
- Full marketing site: homepage, 4 priority programmes, pricing, contact/leads, `/medication`, `/labs`
- **AbnormalResultHandler** Edge Function (`supabase/functions/abnormal-result-handler`) — previously missing, now deployed and verified live
- Abnormal-screening E2E test (`apps/web/e2e/`, opt-in via `pnpm test:e2e`)
- WhatsApp policy change codified: app/web is the sole interface for signup/core actions; WhatsApp/SMS is notifications + human doctor↔patient chat only (see Non-Negotiable Business Rules, `docs/ARCHITECTURE.md` §1.3/§8)
- `docs/FULL_SPECIFICATION_V4.md` roadmap doc added
- Staging: Vercel auto-deployed the merge commit (`677735d`) to Preview; build passed but the URL sits behind Vercel's deployment-protection/SSO gate, never independently browser-verified
- CI: TypeScript green; Python ML failed on a pre-existing, unrelated mypy error (confirmed already broken on main-dev before this merge)

### 2026-07-12 — Reconciliation + clinical trust model foundation
**Reconciliation:**
- Local migration filenames now match remote's applied history exactly (30 renamed, committed `df955dd`); `20260711000000_leads.sql` had never actually run — the marketing Contact page's lead capture was silently failing — now live
- Railway's `enchanting-playfulness` service (misleadingly labelled `@tarragon/web`) was confirmed to have always been correctly scoped to `services/ml` — renamed to `@ml-service` for clarity; confirmed genuinely live via `/health`/`/docs`
- `private.handle_new_user()` trigger bugs (missing `+` on phone, dropped role/org on delayed `app_metadata` update) were already fixed by an existing migration — confirmed deployed function matches migration byte-for-byte
- `/corporate`/`/hmo` route collision resolved: platform dashboards moved to `/dashboard/corporate`/`/dashboard/hmo`; bare paths now 404 cleanly and are free for marketing to use
- Pre-existing Python mypy failure fixed (`test_score2.py`'s `dict(...)` + `**kwargs` spread was untyped enough to fail `score2_risk`'s keyword-only params) — inlined the call args instead; `uv run mypy .` clean
- `/about` page built (hero, continuity-thesis pillars, CTA band) — **founder name/photo/bio are still bracketed placeholders**, don't announce this page publicly until a human supplies a real bio
- WhatsApp support-inbox webhook (`supabase/functions/whatsapp-webhook`, human-routed only) and a Termii sender-ID rename (`TarragonHlth` → `Tarragon`) committed

**Clinical trust model foundation** (per `docs/CLINICAL_TRUST_MODEL_SPEC.md` §7 build sequence):
- `clinical_staff` table + `escalations.reviewed_by`/`reviewed_at` — shared null-gated `ReviewedByDoctor` component, set once at resolve time, never retroactively
- `care_team_assignment` (one row per patient) + clinician-side assignment form + patient-facing `YourCareTeam` card, same null-gating
- `protocol_versions` append-only ledger — only the org's active Clinical Director can sign a new protocol version; no update/delete grant at all
- MDCN/NMCN credential verification: `clinical_staff.verified_by` + two DB CHECK constraints (`clinical_staff_active_requires_verification`, `clinical_staff_no_self_verification`) — first UI to actually create `clinical_staff` records
- `PatientEscalations` component — patient-friendly view of the caller's own escalations, composes `ReviewedByDoctor`
- Onboarding wizard (`profiles.onboarding_completed_at` gate, `/onboarding`) — verified live end-to-end
- `send-support-reply` Edge Function (deployed, signs replies with the real clinician name, fails closed if `WHATSAPP_TOKEN` unset) + `/clinician/support-inbox` UI — verified live including the fail-closed path
- Health Passport shipped separately in PR #23 (2026-07-14): `/patient/health-passport`, PDF export via `@react-pdf/renderer` — re-confirmed working 2026-07-15
- Every item from spec §7 done except ops-only items (annual re-verification, indemnity tracking — see 2026-07-13 below)

### 2026-07-12/13 — Patient subscriptions, Paystack payments, add-ons (Sprint 6, NGN only — Stripe/GBP is the entry below)
- `add_ons`/`subscription_add_ons` (each add-on gets its own Paystack Plan+Subscription), `payment_transactions` (webhook-only write), price-lock triggers on `subscription_plans`/`add_ons` once a plan has a real subscriber (admin UI offers "clone as new plan" instead)
- `public.has_feature_access(feature)` RPC generalizes the old inline `has_ai_coach_access()` check (regression-verified)
- Seed data rewritten to match the live pricing page's real tiers (`free`/`essential`/`complete`/`family` + yearly) — old codes were stale and never matched `pricing.ts`; same fix applied to remote
- Paystack: server-only client, hosted-checkout redirect, deployed `paystack-webhook` (signature-verified/idempotent/never-throws)
- Entitlement gating (`RequiresEntitlement`/`UpgradePrompt`) on the 5 capabilities the Free tier excludes; family dashboard (`/patient/family`, `care-team-contact.tsx`) had to be built from scratch
- Full funnel: onboarding plan-selection step → Paystack redirect → webhook-driven activation; self-serve `/patient/subscription`; admin `/admin/settings/subscriptions`
- **2026-07-13, real Paystack test-mode keys supplied:** a genuine `charge.success` processed successfully, confirming `PAYSTACK_WEBHOOK_SECRET` is correctly set
- **Live click-through (2026-07-13) surfaced and fixed 3 real bugs:**
  1. Detach/plan-change didn't call `refetch()` on the relevant React Query hooks — stale UI until manual reload
  2. `subscriptions`' UPDATE RLS only granted org staff, never the subscriber (asymmetric vs. `subscription_add_ons`) — the local-only cancel path silently no-op'd under a patient's own session while still claiming success, leaving them billed. Fixed via `createServiceRoleClient()` for those specific writes (ownership already verified via RLS-scoped SELECT beforehand)
  3. Paystack's `subscription.create` webhook event can arrive before `charge.success` flips the row to `active`, so the enrichment query missed it — fixed by matching `status IN ('trialing','active')`; `paystack-webhook` redeployed (v4)
- **Still open:** a real card charge through Paystack's hosted checkout has never been driven end-to-end in-browser — the sandboxed preview browser can't follow the cross-origin redirect to `checkout.paystack.com` (`ERR_ABORTED`/403 on OPTIONS). Checkout *initialization* is confirmed working (real transaction refs created, verified via Paystack's `/transaction/verify` API) — this exact gap recurred and was re-confirmed 2026-07-15 (see this session's verification pass below)

### 2026-07-13 — Stripe (GBP/USD diaspora)
- Mirrors the Paystack architecture: hosted-checkout redirect, webhook-driven activation, same `subscriptions`/`subscription_add_ons`/`payment_transactions` tables
- `apps/web/src/lib/stripe/` wraps the official SDK to preserve Paystack's never-throw `{ok,data|error}` contract; deployed `stripe-webhook` handles `checkout.session.completed`, subscription created/updated/deleted, invoice succeeded/failed
- `resolveProvider(currency)` (NGN→Paystack, else→Stripe) + a `canDisableRemotely()` gate fixing a real bug: a naive Paystack-shaped check would never cancel a live Stripe subscription, since Stripe rows never populate `provider_email_token`
- Admin UI gained a currency selector; patient/onboarding UI gained `CurrencyTabs`; 18 diaspora rows seeded (round-number pricing, not conversion), `is_active=false` until synced to a real Stripe Price
- **Verified:** typecheck/lint clean; all 18 rows render correctly in-browser; "Sync to Stripe" degrades gracefully without keys
- **Not yet verified:** `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` still empty — no live Stripe Checkout round-trip has happened yet

### 2026-07-13 — Marketing site completion, Lighthouse, clinical_staff ops items, indemnity exemptions
- `/corporate` and `/hmo` marketing pages built via a shared `B2bPageTemplate` — the last unbuilt items in `docs/MARKETING_SITE_SPEC.md` §7's DoD
- Homepage FAQ copy fixed (previously implied WhatsApp could log readings/sign up — now correctly states app/web only)
- Full Lighthouse pass across all 12 marketing pages found and fixed 2 real site-wide issues: low-contrast eyebrow-label text (`text-brand-green` → `text-deep-forest`, several components including a duplicate in `story-panel.tsx` missed on the first grep-only pass) and a missing caption in the homepage walkthrough button's `aria-label` (WCAG 2.5.3). All 12 pages now 100/100/100 a11y/best-practices/SEO, 91–99 performance
- **Merged to `main-dev` as PR #17** (`a4823f6`), all CI green
- Annual license re-verification + indemnity/malpractice insurance tracking built — the last ops-only items from `docs/CLINICAL_TRUST_MODEL_SPEC.md` §7: `indemnity_insurer`/`indemnity_policy_number`/`indemnity_expires_at` + a CHECK constraint blocking activation of a Director/Escalation Doctor without current cover (a write-time gate, not continuous enforcement — ops still needs to act on expiry badges). **Merged as PR #18** (`d89796c`)
- Indemnity-requirement exemptions built per explicit user request (individual/role-wide/org-wide, audited not silent) via a BEFORE INSERT/UPDATE trigger replacing the CHECK constraint; scope isolation verified (a role-wide exemption doesn't leak to other roles). **Merged as PR #19** (`d0a7148`)
- Found (and later resolved by the Stripe work above): two applied-but-uncommitted migrations discovered on remote, meaning someone had started Stripe/diaspora work directly against the DB without committing — same class of drift as the 2026-07-12 leads.sql issue

### 2026-07-13/14 — Bluetooth clinical device integration (branch `claude/tarragon-medical-device-integration-cn8e82`)
- `patient_devices` pairing table + `vitals_readings.source`/`device_id`/`external_reading_id` (idempotent dedupe, no parallel table per the ingestion-boundary rule)
- Real Bluetooth SIG GATT parsers in `packages/shared` (SFLOAT decoder, BP Measurement 0x2A35, Glucose Measurement 0x2A18), 14 tests passing
- `POST /api/mobile/device-readings`: bearer-auth ingestion, dedupes on `23505`, reuses `assessBpControlBestEffort` (extracted + refactored to accept the caller's own Supabase client — fixed a real latent bug where the bearer-token path would've silently no-op'd under RLS)
- New `apps/mobile` Expo scaffold (BLE pairing/sync screens) — typechecks clean, **never run on a simulator/device, no functional verification**
- Weight Scale (0x2A9D) parsing is a known, deliberate scope gap — sync screen shows "not supported yet"
- Adding `apps/mobile` to the workspace broke `pnpm test` (jest-environment-node/jest-mock mismatch) and silently corrupted `apps/web`'s typecheck (`@types/react@18` vs `19` clash) — fixed via `pnpm.overrides` in `pnpm-workspace.yaml`

### 2026-07-15 — Doctor tier ladder, migration reconciliation, Care Coordination merge
- **Tier ladder schema (branch `claude/doctor-tier-ladder-clinical-model`):** `clinical_staff.doctor_tier` (backfilled from the old role column), `profiles.user_role` gained `care_coordinator` (Tier 1-3 map to the existing `clinician` account role, Tier 4/5 to the existing `doctor` role — only `care_coordinator` was genuinely new), `clinician_alerts.escalation_level`, `lab_orders.investigation_tier`. Indemnity trigger extended to cover Tier 4/5 directly
- **`clinical_staff.role` retirement:** dropped the `role` column and its enum type entirely (first DROP COLUMN/DROP TYPE in this project's history) in favor of `is_clinical_director` (orthogonal governance flag, not a tier rung) + `doctor_tier`; all call sites (`useOrgClinicians`, care-team/protocol/health-passport director lookups, admin UI) rewritten; verified via a rolled-back transaction test covering every scope-isolation case
- **Migration reconciliation:** found **13** migrations live on remote with no local file — all from two other open PRs sharing the same DB, [PR #28](https://github.com/Kolalonge-creator/Tarragon-Health/pull/28) (Care Coordination, 8 files) and [PR #36](https://github.com/Kolalonge-creator/Tarragon-Health/pull/36) (Care Nav/employer enrollment, 5 files, 3 needed renaming to their real applied timestamps). Pulled and verified all 13 against live `information_schema`/`pg_proc` before committing — local history now matches remote exactly (83/83)
- **Pharmacy-authority-by-tier:** `private.has_prescribing_authority(org)` (structural DB gate, mirrors the indemnity pattern) requires Tier 2+ or Clinical Director; `medications` RLS now enforces it for org-staff writes (patient self-add untouched). Clinician UI shows a friendly explanation instead of a raw RLS error for Tier 1
- **Tier 1-4 Doctor Dashboard UI:** `/clinician` and `/doctor` now show the caller's real tier label + authority blurb (role-gated views of one worklist, per master plan §12 — not five separate dashboards), falling back to a generic label only when the caller has no `clinical_staff` row
- **PR #28 (Care Coordination) reconciled and merged:** one-off Paystack/Stripe charge path for bookings; human-readable `patient_number`/`order_number`/`referral_number` IDs; `/clinician/referrals` specialist-referral worklist + patient-facing `YourReferrals` card; lab catalogue booking UI (`LabCatalogue`/`LabOrdersList`/`LabResults`) plus 6 new single-test bundles fixing a gap where hiv/hep_b tests existed but were unbookable; pharmacy catalogue booking UI; commission dashboard (`/admin/settings/commissions`) driven by a DB trigger on `payment_confirmed` across all 4 order types
- **Clinician-originated-orders guardrail:** `ordered_by` (→ `clinical_staff`) on `lab_orders`/`pharmacy_orders` + BEFORE INSERT triggers rejecting patient-initiated rows unless tied to a due `screening_schedule` (labs) or an active clinician-sourced medication (pharmacy refills)
- **PR #28 and PR #36 both merged to `main-dev`** (confirmed via `git log`)
- **In-browser verification pass (same day, post-merge):** clicked through all 4 merged flows as real test accounts — clinician lab ordering (real `lab_orders` row, `ordered_by` correctly resolved), patient checkout initiation (real Paystack transaction ref created; the cross-origin redirect to `checkout.paystack.com` is blocked by the sandboxed preview browser, same known gap as the 2026-07-13 Paystack entry above — not a regression), pharmacy ordering correctly blocked for a patient with no clinician-prescribed meds, admin commission dashboard (renders cleanly, correctly empty), employer roster manager, and the Care Navigation booking-request flow (real `booking_requests` row, correctly org-scoped). No console errors, no unexpected failed requests — the 3-way merge reconciliation holds under real clicks, not just typecheck
- **Tier 1 confirm/continue-refill workflow built** (migration `20260715190000_medications_confirm_refill.sql`): `medications.last_confirmed_at`/`last_confirmed_by` (→ `clinical_staff`, server-derived — never client-supplied, can't be spoofed), a new `private.can_confirm_medication_refill(org)` (Tier 1 only) broadening `medications_update`'s RLS gate, and a BEFORE UPDATE trigger (`private.enforce_medication_confirm_only`) that restricts a non-prescribing caller to touching `refill_date` only on an existing `source='clinician'` row — drug/dose/frequency/active-status stay Tier 2+/Director acts, patient-sourced medications are rejected outright. UI: a "Confirm & continue" control on `MedicationsList` (shared with the patient's own view but only rendered when the clinician page passes `canConfirmRefill`, i.e. caller is Tier 1 and lacks prescribing authority), plus a null-gated "Confirmed by your care team · date" line. Verified with a 5-case rolled-back transaction test (refill-only succeeds; dose/is_active/patient-sourced-med all correctly blocked with `42501`; spoofed `last_confirmed_by` silently overridden by the trigger) and a real live click-through as the Tier 1 test account. `pnpm typecheck`/`lint`/`test` (189 tests) all clean.
- **Real card charges driven end-to-end in a real, non-sandboxed browser** (via the `claude-in-chrome` extension controlling the user's actual Chrome, not the sandboxed preview) — closes the gap flagged in the entry above. **Paystack:** a genuine `4084...4081` test charge on lab order LAB-000020 (₦9,000) → real `charge.success` webhook → `lab_orders.status='payment_confirmed'` → commission auto-recorded (₦1,800, Healthtracka, `pending`) — worked cleanly, Paystack's Edge Function secrets were already correctly configured. **Stripe:** synced `essential_usd` to a real Stripe Price via `/admin/settings/subscriptions` (`stripe_price_id`/`stripe_product_id` now set, `is_active=true`); a genuine `4242...4242` test charge produced a real, verified-via-API Stripe subscription — but found and fixed a real gap: the deployed `stripe-webhook` Edge Function reads `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from its own Deno secrets store, separate from `apps/web/.env.local` (which only configures the Next.js side), so all 6 webhook deliveries at checkout time silently no-op'd (`{ok:false,error:"not_configured"}`, still HTTP 200, so Stripe never auto-retried). Once the user set those two secrets directly on the Edge Function, replayed the missed events as properly HMAC-signed synthetic webhooks (built from real Stripe API data, POSTed only to our own endpoint — no Stripe domain touched) to confirm the fix: `subscriptions.status='active'`, real `provider_ref`, `current_period_end` correctly filled in. **Lesson for next time:** any Edge Function webhook integration needs its secrets set in *both* places — `.env.local` for local dev and the Supabase Edge Function secrets store for the deployed function — they do not share a source.
- **Next:** nothing outstanding from this pass. Broader project Next items unchanged — see Clinical Tier Ladder's Phase 2/3 list above (specialist-matching engine, wellness testing, Employer/HMO risk dashboards) — none of those are in scope without an explicit ask.

### 2026-07-16 — Home collection & delivery logistics (branch `claude/home-collection-delivery-logistics`, explicit ask — pulled forward from master plan §6/§8/§11/§13 Phase 2)
- New global partner catalogues `home_visit_providers`/`logistics_partners` (mirrors `lab_providers`/`pharmacy_partners`: no `organisation_id`, authenticated read, admin write), seeded with one inactive placeholder row each — no feature flag; the patient-facing "coming soon in your area" state is just what renders with zero active rows for a region, and flipping a real partner row to active is the only mechanism needed to turn the real UI on
- `lab_orders.home_visit_provider_id`/`home_visit_scheduled_at`/`courier_reference`; `pharmacy_orders.logistics_partner_id`/`delivery_address`/`estimated_delivery_at`/`courier_reference`/`delivery_confirmed_at`
- `commission_type` extended with `home_visit`/`delivery`; new triggers record a commission on the null→non-null transition of the provider/partner FK (a later, separate event from the existing payment-confirmed commission triggers)
- `set_pharmacy_order_delivery_address` RPC (security definer, ownership re-checked in-body) so a patient can set their own delivery address despite staff-only UPDATE RLS on `pharmacy_orders`
- New `/clinician/orders` staff worklist (manual state entry → matched provider/courier → schedule/assign; "mark delivered" action) and `/admin/settings/logistics-partners` partner management page
- Patient-facing `HomeCollectionAvailability`/`DeliveryAvailability`/`DeliveryAddressForm` wired into the existing lab/pharmacy order lists
- `pnpm typecheck`/`lint`/`test` (240 tests) all clean at merge
- **Not yet done:** no real home-visit or logistics partner has been contracted — both seed rows stay `is_active = false` until ops signs one, so the patient-facing feature is live in code but dormant in practice until then. State/region matching is manual text entry (no `profiles.state` column exists yet to read from instead, same gap as the existing specialist-referral assignment form)
- **Next:** none from this pass — this closes out the two items pulled forward from Phase 2. Remaining Phase 2/3 items (specialist-matching engine, wellness testing, Employer/HMO risk dashboards) are unchanged and still require an explicit ask.

### 2026-07-16 — Post-merge browser verification + 2 fixes (branch `claude/home-collection-followup-fixes`)
- **In-browser verification pass** of the above, as real clinician/admin/patient test-account sessions: `/clinician/orders` and `/admin/settings/logistics-partners` both render and function correctly, the admin "Activate" toggle genuinely turns the live UI on with no redeploy, the commission dashboard correctly picks up `home_visit`/`delivery` types, `HomeCollectionAvailability` correctly renders the "scheduled" state on a real order, and the patient/admin route guards hold. No console errors, no unexpected failed requests.
- **Found and fixed a real gap:** `useAssignHomeVisitProvider`/`useAssignLogisticsPartner` (`apps/web/src/lib/queries/logistics-partners.ts`) wrote `home_visit_provider_id`/`logistics_partner_id` straight through the Supabase client with nothing checking the referenced partner was `is_active` — only the *matching* query (dropdown population) filtered on it, which is a UI courtesy, not a guarantee. This is exactly how an inactive placeholder row ended up assigned to a real `lab_orders` row during the branch author's own testing, defeating the "activating a partner row is the entire mechanism" design the feature is built around. Fixed with `private.enforce_home_visit_provider_active()`/`private.enforce_logistics_partner_active()`, BEFORE INSERT OR UPDATE triggers on `lab_orders`/`pharmacy_orders` (migration `20260716150000_enforce_active_logistics_partners.sql`) — same structural-gate pattern as `enforce_medication_confirm_only`/`enforce_lab_order_origin`. Verified both directions with rolled-back transactions (inactive assignment correctly blocked with `23514`; active assignment still succeeds) directly against the live database before merge. The stale test assignment and its resulting phantom commission row were cleaned up.
- **Migration filename reconciliation:** the 5 files from the previous entry were committed locally as `20260716140000`–`20260716142000`, but had actually been applied to the remote database under different auto-generated timestamps (`20260715230120`–`20260715230156`) by whoever built the branch — same class of drift flagged in the 2026-07-12 and 2026-07-15 entries. Renamed (pure `git mv`, no content changes) to match remote exactly.
- `pnpm typecheck`/`lint`/`test` all clean.
- **Next:** nothing outstanding from this pass.

### 2026-07-16 — Location-based facility selection (branch `claude/medication-pathway-pharmacy-notifications`, explicit ask)
Patients can now choose *where* a lab test / vaccination / pharmacy collection / hospital visit happens, by **state → city → optional area** (+ "use my location"), pre-filled from a saved profile location. Decision: **unify on `public.facilities`** as the single location directory (per the `20260715162815` "one directory, not two" rule) — commissions/pricing stay keyed to the provider/partner tables, so a facility carries an optional `lab_provider_id`/`pharmacy_partner_id` link and a lab booking *derives* its commission-bearing `provider_id` from the chosen facility.
- **Schema (4 additive migrations `20260716160000`–`163000`, all idempotent `add column if not exists`):** `profiles.state/city/area`; `facilities.area` + `lab_provider_id`/`pharmacy_partner_id` links + type/location index; `lab_orders.facility_id` (the physical WHERE, alongside the derived provider_id — does not weaken `enforce_lab_order_origin`); `pharmacy_partners.state/city/area` + `specialist_providers.city/area` (partner-keyed catalogues get the same location model directly rather than a duplicate facility row). Seed adds 9 facilities (5 lab centres linked to real `lab_providers`, 2 vaccination centres, 2 hospitals across Lagos/Abuja) + backfills partner/specialist locations.
- **UI:** shared `FacilitySelector` (`patient/facility-selector.tsx`) + lifted `distanceKm` into `@/lib/geo` (deduped from `facility-directory.tsx` and `pharmacy-catalogue.tsx`). Wired into: lab booking on the screening calendar (facility picker replaces the flat provider dropdown; a facility with no `lab_provider_id` is shown but not bookable online); new `VaccinationBooking` card (facility picker → existing `booking_requests` path, additive to log-only `LogVaccinationForm`); pharmacy catalogue gains a state/city/area filter; facility directory gains the `area` filter; specialist-referral staff matching gains a city field + same-state/same-city-first sort. New `PatientLocationForm` + `updatePatientLocation` server action on both the patient dashboard and onboarding.
- **Reconciliation note:** the branch's own 4 pending pharmacy migrations (`120000`–`123000`: contact/location, `patient_allergies`, order notifications trigger, `fulfilment_method`) had **not** been applied to remote, so a first types regen from remote regressed them — applied all 4 to remote (idempotent-guarded) so remote matches the full branch, then regenerated `database.types.ts` cleanly.
- **Verified:** `pnpm typecheck`/`lint`/`test` (205) all clean; DB data-path confirmed via SQL (Lagos/Ikeja lab picker returns the linked provider; an unlinked test lab correctly reports non-bookable). **Not browser-verified** — another chat's `next dev` held the `.next` dev lock so this session couldn't start its own server; not killed.
- **Next:** browser click-through as a patient test account (set location → book a due screening at a facility → confirm a `lab_orders` row carries both `facility_id` and the derived `provider_id`) once a dev server is free; commit + open PR.

### 2026-07-16 — Medication pathway Phase 0/1: no-login pharmacy order notifications (same branch)
First slice of the 6-stage medication-management pathway (gap analysis vs. the pathway spec: 1 built / 5 partial / 6 not-built; this ships the highest-value gap — order fulfilment notifications — plus foundations). Phases 2–8 (prescription/care-plan linkage, medication history/timeline, specialist-added meds, adherence check-ins, missed-dose escalation ladder, medication-review engine, drug-class lab monitoring, pharmacist login surface) are scoped but **not built** — do not start without an explicit ask.
- **The feature:** when a pharmacy order hits `payment_confirmed`, a DB trigger (`private.enqueue_pharmacy_order_notifications`, same WHEN guard as the commission trigger) enqueues 4 `notifications` rows — **patient** WhatsApp+email (a showable confirmation carrying order number + patient ID) and **pharmacy** SMS+email (patient name/number + order number). This lets partner pharmacies fulfil an order **without ever logging into the dashboard** — the no-login path the founder asked for. It's a notification/confirmation layer only (never gates the order, never parses inbound), so it stays inside the WhatsApp-is-notifications-only rule. Verified end-to-end via a rolled-back live-DB transaction: a paid order enqueued all 4 rows with correct destinations/payloads.
- **Email channel:** `send-pending-notifications` Edge Function extended with a **Resend** `email` sender + two templates (`pharmacy_order_patient_confirmation`, `pharmacy_order_pharmacy_alert`) with branded HTML, plus payload-driven `to_email`/`to_phone` so non-profile recipients (pharmacies) can be reached. `email` was already a valid `notification_channel`, just never wired. New env: `RESEND_API_KEY`/`RESEND_FROM` (`.env.example` + **must also be set on the Edge Function secrets store**, same lesson as the 2026-07-15 Stripe webhook). Email SEND is not runtime-tested (no key/deploy yet); the queue content is verified. The patient WhatsApp template needs Meta approval — falls back to SMS meanwhile.
- **Schema (4 idempotent migrations `20260716120000`–`123000`):** `pharmacy_partners.contact_phone/contact_email/uses_platform_login` (+ redundant-with-facility-model lat/long/address, kept because already applied to remote — a follow-up may drop them); `patient_allergies` table (patient + org-staff RLS, foundation for the Phase 8 pharmacist surface); `pharmacy_orders.fulfilment_method` (pickup live / delivery gated until logistics partners onboard). All guarded (`if not exists`/`drop-then-create`) and confirmed re-appliable against remote.
- **Location reconciliation:** collided mid-build with the facility-selection workstream (state/city/area); per user decision the pharmacy "nearest" UI runs on the shared state/city/area + `facility-selector` model, with lat/long retained as an additive precise-distance sort (hybrid, not the clean drop originally chosen — flagged for optional later cleanup).
- **Drift caveat:** the 4 migrations are applied to remote but **not recorded in `supabase_migrations.schema_migrations`** (same pre-deploy state as the other ~11 unrecorded 2026-07-16 local migrations) — idempotency guards mean a `db push` re-run is now safe regardless.
- **Verified:** `pnpm typecheck`/`lint`/`test` (web 205 + shared 35) all clean; migration idempotency + trigger behaviour confirmed via rolled-back live SQL. **Not browser-verified** (another chat holds the dev-server lock).

### 2026-07-16 — Medication pathway Phases 2–8 (same branch, one batched PR)
Built the rest of the 6-stage pathway on top of Phase 0/1. Each phase = migration + RLS + UI + types + live rollback-SQL verification; migrations applied via `apply_migration` so they ARE recorded in `schema_migrations` (unlike the Phase 0/1 batch). `pnpm typecheck`/`lint`/`test` (web 205 + shared 35) green throughout. **Not browser-verified** (dev-server lock held by another chat). Email delivery still pending Resend setup (no API key/domain yet — founder to create key + verify sender + set `RESEND_API_KEY`/`RESEND_FROM` on the Edge Function secrets store).
- **Phase 2 — lifecycle:** `medications.stopped_at`/`stopped_reason` + Stop action + collapsible history; `medication_source` gains `specialist` + `prescriber_name`/`prescriber_document_url` (patient can log a specialist-started med with name + consult document); care-plan condition shown per drug.
- **Phase 6 — review engine:** `medication_review_cadences` (HTN 6mo, diabetes/CVD/CKD 3mo…) + `medication_reviews`; activating a care plan auto-schedules a review, completing one rolls the next; `reviewed_by`/`completed_at` stamped server-side (null-gated attribution); daily reminder cron + `/clinician/medication-reviews` worklist.
- **Phase 7 — drug-class lab monitoring:** `drug_monitoring_rules` (Metformin→renal 12mo, ACE-i→renal+K post-initiation, statin→LFTs, warfarin→INR) + `medication_lab_monitoring`; a clinician/specialist med auto-schedules the right monitoring (patient-added drugs get none); patient `LabMonitoringCard`.
- **Phase 4 — adherence check-ins:** `medication_adherence_checkins` auto-scheduled Day 3 / Week 2 / Month 1 / Month 3; daily reminder cron; patient answers **in-app** (`AdherenceCheckins` card) — WhatsApp/SMS only reminds.
- **Phase 5 — missed-dose escalation ladder:** `medication_adherence_alerts`; a `missed` dose log recomputes 30-day miss count and raises/upgrades an alert (≥3 → coach, ≥6 → doctor; upgrade-only; one active per med); ack/resolve stamped server-side; `/clinician/adherence` worklist.
- **Phase 3 — medicines cabinet:** medications list gains a summary (next review + next lab) + per-drug days-remaining-to-refill.
- **Phase 8a — dispensed record:** `pharmacy_order_dispenses` (drug/qty/date), patient can self-log what they collected (works for no-login pharmacies); no stock/inventory.
- **Phase 8b — pharmacist surface:** new `pharmacist` user_role + `profiles.pharmacy_partner_id`; a partner pharmacist logs in (`/pharmacist`) and sees, FOR AN ORDER ROUTED TO THEIR PHARMACY ONLY, the patient's allergy status + current meds, and records a dispense. **Cross-tenant PHI access is confined to four SECURITY DEFINER RPCs** (`pharmacist_orders`/`pharmacist_order_allergies`/`pharmacist_order_medications`/`pharmacist_record_dispense`), each scoped via `private.pharmacist_partner()` — NO broad RLS grants on profiles/allergies/medications. **Isolation proven via live SQL** (jwt-claims simulation): pharmacist A sees their order's patient's allergy+meds (1/1/1), pharmacist B and a non-pharmacist see nothing (0/0/0); write blocked cross-pharmacy too. If this surface is extended, keep isolation enforced in that one helper + re-run the isolation test.
- **New cron jobs live on remote:** `medication-review-reminders-daily`, `medication-checkin-reminders-daily`. New WhatsApp templates (`medication_review_due`, `medication_adherence_checkin`) need Meta approval — fall back to SMS meanwhile.

### 2026-07-16 — Employer/HMO risk-stratification dashboards (branch `claude/employer-hmo-risk-dashboards`)
Explicit founder ask (same session as the home-logistics pull-forward above) to build `/dashboard/hmo` to parity with the already-real `/dashboard/corporate` cohort-analytics pipeline.
- New `patient_care_gaps` view (`security_invoker` — verified not security-definer) deriving three gap shapes (overdue screenings, stale chronic monitoring, unactioned abnormal results) from existing RLS'd tables, no new mutable table. New `cohort_cost_model_constants` table (admin-editable, org-override-or-platform-default) backing a "modeled estimate" cost-avoided figure for HMO renewal conversations — every UI surface shows a persistent "modeled estimate, not a real claims feed" disclaimer.
- `/dashboard/hmo` rewritten to reuse `load-cohort-analytics.ts`/`RosterManager`/`OutcomeReportsPanel` unchanged (`RosterManager` gained an `entityLabel` prop for "member" vs "staff" copy), plus new `CareGapPanel`/`ClaimsImpactCard`. Per-member drill-down shown to org-staff (not new exposure — they already have direct RLS access to the underlying tables); only the aggregate cohort percentages stay anonymised.
- `/dashboard/corporate` gained age-band segmentation (computed client-side from `profiles.date_of_birth`, no ML service change) and a renewal-facing outcome-evidence card; `generateOutcomeReport` now freezes care-gap counts + the cost-avoided estimate into each report snapshot.
- **Live browser verification** (own dev server on a spare port + the local ML microservice started for this pass, real Chrome via claude-in-chrome): created a test `hmo_admin` account/org and reset `corp.verify.test@tarragonhealth.com`'s password. `/dashboard/hmo` empty-state renders cleanly (roster add works, "Generate report" shows a graceful error with no cohort data). `/dashboard/corporate` with the ML service up: real cohort analytics render, the new Age segmentation card correctly buckets the one real enrolled patient, the new Outcome evidence card renders with the required "modeled estimate" disclaimer, and generating two outcome reports back-to-back correctly triggers the compliance-trend card and freezes `careGaps`/`costAvoided` into each snapshot (confirmed via direct SQL).
- **Found and fixed a real bug live-testing this:** `generateOutcomeReport` (a server action) never invalidated `useOutcomeReports`' React Query cache, so "Report generated." showed while the list below still said "No reports generated yet." until a full reload. Fixed by exporting `reportsKey` and invalidating it once the action's message changes.
- `pnpm typecheck`/`lint`/`test` clean (205 web tests, 35 shared tests). Migrations applied and verified against the live Supabase project; `get_advisors` shows no new issues.
- **Not yet verified:** a populated HMO org with a real claimed member (only a "pending signup" roster row existed) — so `CareGapPanel`/`ClaimsImpactCard` are confirmed correct in the empty/error state but not yet seen rendering non-zero data.
- **Next:** the platform-default cost-avoided estimate (₦150,000/abnormal catch) is a placeholder an admin should replace with a real negotiated figure once available.

### 2026-07-16 — Premium ParentCare: standalone subscription tier (branch `claude/parentcare-subscription-tier`)
Same explicit founder ask.
- New `parentcare`/`parentcare_yearly`/`parentcare_gbp`/`parentcare_yearly_gbp`/`parentcare_usd`/`parentcare_yearly_usd` plan rows — up to 2 parents included, `dedicated_coordinator` shipped as a base-plan feature here specifically (add-on-gated everywhere else), reusing `care_team_assignment`/`YourCareTeam` unchanged. `extra-parentcare-member*` add-on, one row per currency/interval variant, matching the existing `extra-family-member-plus`/`-premium` precedent.
- Shared quarterly-PDF-report infrastructure (`patient_quarterly_reports` append-only archive, data assembler reusing `get-health-passport-data.ts`, PDF document reusing `HealthPassportDocument` with a title override, on-demand download route, Vercel Cron job) — closes a real gap where Family Premium's pricing copy already promised this and nothing implemented it.
- New `/patient/parentcare` page (reuses `FamilyMembersManager` verbatim — it was already plan-agnostic).
- **Found and fixed 5 real bugs in passing** (the first 4 zero-subscriber/zero-blast-radius, found before browser verification): `family_plus`/`family_premium`/`diaspora_premium_gbp` had an empty `features[]` array since `20260715142113`; `private.validate_family_plan_member_count()` only recognized the exact `extra-family-member` add-on code, never crediting Plus/Premium subscribers for their tier-specific add-on; the onboarding plan-selector's monthly/yearly grouping regex only matched a trailing `_yearly`, breaking GBP/USD toggles for every currency variant; `useAddFamilyPlanMember`'s plan lookup was hardcoded to the exact code `'family'`. The 5th, found live-syncing all 6 plans via `/admin/settings/subscriptions`: the "Sync to Paystack/Stripe" button never invalidated the plans cache after a successful sync — every sync had actually succeeded server-side (confirmed via direct DB checks) but the row kept showing "Inactive" until a full reload. Fixed.
- **Live verification (real Chrome via claude-in-chrome):** synced all 6 new plan rows live — each now has a real `paystack_plan_code`/`stripe_price_id` and `is_active=true`. Confirmed the rows render correctly in the patient-facing plan switcher (`/patient/subscription`), including currency tabs and the monthly/yearly toggle. Drove **two real** Stripe test-mode checkouts end-to-end as a patient (`4242...4242`) — both charges succeed, "Payment received" shown each time.
- **Blocked, then diagnosed:** neither checkout's subscription ever flipped to `active` — `payment_transactions` (the webhook's own audit log, written only after signature verification succeeds) had zero rows for either attempt despite the deployed function returning HTTP 200 both times, and `GET /v1/webhook_endpoints` on the Stripe account showed **zero registered endpoints** — meaning events were arriving via an ephemeral `stripe listen` CLI session (a fresh signing secret every restart) rather than a permanent one, explaining why a prior successful test could work while later ones silently failed signature verification. Registered a permanent Dashboard webhook endpoint (`we_1TteSUE7JJdIgXQyo8SLtAuw` → `.../functions/v1/stripe-webhook`, all 6 events the handler supports) via the Stripe API; project owner needs to copy its signing secret from the Stripe Dashboard into the Edge Function's secrets store as `STRIPE_WEBHOOK_SECRET` (not printed here — real credential). (One direct `UPDATE` to a subscription row was attempted mid-session to work around this for QA purposes and was correctly caught and reverted by the permission classifier — the row was left in its true, unpaid-activation state.)
- `pnpm typecheck`/`lint`/`test` clean (205 web tests, 35 shared tests). Migrations applied and verified against the live Supabase project; `get_advisors` shows no new issues.
- **Next:** project owner sets the new webhook endpoint's real signing secret on the Edge Function, then re-verify the patient-facing checkout→active→attach-a-parent→quarterly-report flow end-to-end.

### 2026-07-16 — Patient onboarding: consent gate + guided intake + care-programme recommendations + KYC (branch `claude/patient-onboarding-intake-consent`, explicit ask)
Reworked registration→dashboard onboarding to match the intended intake flow (consent, demographics, questionnaire, risk, recommended programme). Three migrations (`20260716180000`–`182000`) applied via `apply_migration` (recorded in `schema_migrations`); `pnpm typecheck`/`lint`/`test` (211 web + 35 shared) clean; `get_advisors` shows no new issues; all four new tables have RLS.
- **Phase A — consent + demographics gate:** `consent_versions` (append-only catalogue, seeded data-processing/telehealth/terms — copy is honest placeholder, **needs counsel review before public launch**) + `patient_consents` (append-only acceptance). `private.enforce_onboarding_prereqs` BEFORE UPDATE trigger on `profiles` structurally blocks the null→set transition of `onboarding_completed_at` for a patient unless DOB+sex are present and all current consents recorded — the app-layer step ordering's structural backstop, can't be spoofed. `profiles.sex`/`date_of_birth` already existed; only collected now. Verified via rolled-back SQL (`blocked_demo=t blocked_consent=t completed_ok=t`).
- **Phase B — guided intake:** `/onboarding` reworked from a plan-only page into an ordered client wizard (`onboarding-flow.tsx`): consent → about-you (DOB/sex) → location → **health profile** (the existing `RiskAssessmentForm` + `AddMedicationForm` surfaced inline, skippable) → plan. `YourCareTeam` (async server component) is passed in as a `careTeamSlot` prop rather than imported into the client tree (that import was the one real bug found + fixed in browser verification — it pulled `supabase/server.ts`/`next/headers` into the client bundle).
- **Phase C — recommended care programme:** rule engine `care-programme-recommendations.ts` (+6 tests) maps risk tiers + self-reported diagnoses + BMI → suggested chronic programmes; generated on risk-assessment submit into a new `care_plan_recommendations` table (service-role write, same pattern as `prevention_risk_scores`; partial-unique index prevents duplicate open proposals per patient+condition). **Guardrail-correct:** the patient card (`CareProgrammeRecommendations`) frames it as "pending review", never doctor-attributed; a clinician promotes it into a real clinician-authored `care_plans` row via `/clinician/recommendations` (accept creates the plan with `assigned_clinician_id` = the acting clinician, status `draft`). Verified via rolled-back SQL (`dup_blocked=t accepted_links_plan=t`).
- **KYC (optional, non-blocking):** `identity_verifications` table storing **only the last 4 digits** of the NIN/BVN (NDPR minimisation), patient-insert-pending-only RLS + service-role/staff for results. `apps/web/src/lib/identity/provider.ts` is an adapter registry keyed by `IDENTITY_PROVIDER`; **Dojah adapter wired for real** (GET `{base}/api/v1/kyc/{nin|bvn}?…`, `AppId`+`Authorization` headers, 5s timeout, never-throws, 4xx→not-verified, 5xx/network→pending). Env: `IDENTITY_PROVIDER`/`IDENTITY_API_KEY`/`IDENTITY_APP_ID`/`IDENTITY_BASE_URL` (`.env.example`). No Dojah credentials exist yet, so the live NIN/BVN round-trip is **unverified** — the unconfigured graceful path (records `pending`, shows "we've recorded this") was browser-verified end-to-end and the row stored only `id_last4`. Adapter is `server-only`, so per jest-config convention it's exercised via the app, not unit-tested.
- **Browser-verified** (real Chrome via preview, as the Lab Test Patient with `onboarding_completed_at` temporarily nulled then restored through the gate): full wizard renders and progresses — consent submit → "Done", demographics saved through the real DB gate, location + KYC card + intake all revealed; KYC unconfigured path recorded a `pending` row with only `id_last4`. Test account restored to its original state (the added consent/DOB rows are legitimate and left in place; the test identity row was deleted).
- **Next:** project owner sets `IDENTITY_PROVIDER=dojah` + `IDENTITY_API_KEY`/`IDENTITY_APP_ID` (Dojah dashboard) to turn on live verification, then verify a real NIN/BVN round-trip; counsel review of the seeded consent copy before public launch. Identity verification stays non-blocking regardless.

### 2026-07-16 — Preventive health pathway: vaccination schedules + programme enrolment + periodic reviews (branch `claude/preventive-health-pathway`, explicit ask)
Third major branch of the same day. `vaccination_catalog`/`vaccination_records`/`vaccination_schedules` (child immunisation, WHO/NPI-style schedule), `preventive_programme_enrolments` (screening programme enrolment, e.g. cervical/breast/prostate cancer screening cadences), and `periodic_health_reviews` (annual/biannual check-in scheduling, distinct from the chronic-disease `medication_reviews` cadence). Reminder cron (`queue_vaccination_reminders`) sends exactly one flat WhatsApp reminder per dose, gated by `reminder_sent_at is null` — no due-soon/overdue escalation model yet, flagged as a known gap in the 2026-07-30 Child Immunisation entry above.
- **Schema:** `vaccination_catalog` (global, admin-managed — WHO/NPI schedule seed data), `vaccination_records` (per-child dose log, patient/guardian or clinician-entered), `vaccination_schedules` (computed due dates per child per catalog entry, generated on child-profile creation), `preventive_programme_enrolments` (patient + programme type + cadence + next-due date), `periodic_health_reviews` (scheduled check-in rows, distinct table from `medication_reviews`).
- **UI:** `/patient/vaccinations` (child selector, due/overdue/completed list, log-a-dose form), `/patient/screening` programme enrolment cards, periodic review reminder surfaced on the dashboard.
- **Verified:** `pnpm typecheck`/`lint`/`test` all clean; migrations applied and recorded. Reminder cron confirmed queuing correctly via rolled-back SQL.
- **Next:** due-soon/overdue notification tiering (closed later, 2026-07-30 Child Immunisation entry); catch-up intake flow for children with an unknown vaccination history (also closed later, same entry).

### 2026-07-19 — Care messaging + Omada-style lifestyle coaching P1 + finance GL foundations
Three workstreams landed this session.
- **`care_messages`/`care_message_threads`:** in-app patient↔care-team messaging (the channel that later, 2026-07-30, becomes the sole two-way conversation surface per the Non-Negotiable Business Rules correction — WhatsApp inbound stays human-routed support-inbox only, never a two-way conversation record). Server-derived null-gated attribution on every message; a new "Messages" surface on the patient dashboard's Overview section; `/clinician/messages` on the staff side.
- **Omada-style lifestyle coaching, Phase 1:** `nutrition_log_entries` (meal logging, gated behind the `lifestyle_coaching` feature entitlement), `lpe_goal_instances`/`lpe_task_instances` (lifestyle/physical-exercise programme instance tracking — goals and tasks generated from a programme template, tracked per patient). Foundation only; later phases (P2+) not yet scoped in this entry.
- **Finance GL foundations:** first version of the general ledger — `finance_accounts` (chart of accounts), `finance_journal_entries`/`finance_journal_lines` (double-entry), automated posting triggers on payment/commission events. This is the base the 2026-07-25/26 Finance GL Phase 1/2 entries build on.
- **Verified:** typecheck/lint/test clean at merge; migrations applied and recorded.

### 2026-07-21 — BLE Weight Scale + thermometer + pulse oximeter GATT profiles; device-sourcing research
Closes the Weight Scale (0x2A9D) gap flagged as a known scope gap in the 2026-07-13/14 Bluetooth entry above. Full BLE support now covers all five standard GATT clinical profiles: BP cuff (0x2A35), glucometer (0x2A18), weight scale (0x2A9D, spec-fixed 0.005 kg/0.01 lb resolutions, imperial converted to kg, 0xFFFF measurement-unsuccessful rejected), thermometer (0x2A1C, 32-bit medical FLOAT, °F converted to °C), and pulse oximeter (PLX Spot-Check 0x2A5E). `patient_device_type` gained `thermometer`/`pulse_oximeter` (migration `20260721141233`); readings land in the existing `vitals_readings` columns (`weight_kg`/`temperature_c`/`spo2_pct`) via the same device-readings API.
- **Device-sourcing research (same session):** compared candidate BP-cuff/glucometer models for real standard-GATT compliance vs. proprietary app/SDK lock-in (Omron/iHealth push proprietary apps). A&D Medical UA-651BLE (BP) and Roche Accu-Chek Guide/Guide Me (glucose) came out as the two models with documented, credible standard-GATT compliance — flagged as the pair to physically buy and pair with the real Expo app before recommending any device model to patients (this recommendation carried forward into the later CLAUDE.md device-sourcing note).
- **Also fixed this session:** a display-time humanisation patch for a raw analyte-key leak (`total_cholesterol`) into patient-facing copy — later cited as one of the motivating examples for the 2026-07-30 v3 proof_log plain-language enforcement work.
- **Verified:** `pnpm typecheck`/`lint`/`test` clean; BLE parser tests extended to cover all 5 profiles.

### 2026-07-23 — Tarragon Prevent tier seeded; wellness testing catalogue; prevention-healthy-users visibility
- Seeded 6 Tarragon Prevent placeholder plan rows (₦3,500/mo · ₦35,000/yr · £7/£70 · $9/$90 — placeholder pricing, `is_active=false` pending sync; later confirmed final and activated 2026-07-26, see that entry).
- Prevention-healthy-users visibility work: surfacing preventive-care value to patients who have no active chronic condition (the platform's dual-state prevention/chronic design point).
- Wellness testing catalogue groundwork referenced here as schema-scaffolding context for later gamification work (2026-07-30 Wellness gamification entry explicitly reuses `nutrition_log_entries` from the 2026-07-19 entry rather than building a new meal-log table).

### 2026-07-24 — Talk-to-a-doctor copy correction; tetanus/shingles dosing accuracy
- **Talk-to-a-doctor copy correction:** a previous homepage section was added then reverted on founder feedback about homepage bloat — cited later (2026-07-30 Wellness gamification entry) as the precedent for keeping new marketing surface area small rather than adding new homepage sections.
- **Tetanus/shingles dosing-accuracy work:** corrections to the vaccination catalog's dosing intervals for tetanus and shingles, part of ongoing maintenance on the vaccination schedule system built 2026-07-16 and later versioned/signed 2026-07-30.

### 2026-07-25 — Finance GL: income statement, balance sheet, settlement reconciliation
First real financial-statement layer on top of the 2026-07-19 GL foundations. Income statement and balance sheet reporting RPCs; settlement import/match/unmatch/post workflow for reconciling partner/provider settlements against the ledger. This is the base the 2026-07-26 Phase 2 entry (audit trail, maker-checker, cost centers, etc.) extends. `finance@tarragonhealth.ng` test account referenced in later entries as still having no password set for browser verification.

### 2026-07-26 — Finance GL Phase 2: audit trail, maker-checker approvals, cost centers, budgets, cash flow statement, accounts payable, HMO capitation register, Nigeria statutory compliance calendar, KPI strip
- **Audit trail:** every HUMAN-triggered finance write (post/reverse journal, period status change, account/tax-rate edit, settlement import/match/unmatch/post, revenue-recognition run, every new write below) now logs to the platform's immutable `audit_log` via `private.log_audit()` — deliberately NOT added to `private.finance_post_journal` itself (the primitive automated payment/commission posting uses), so the log stays a record of human decisions, not a duplicate of the ledger. New `/finance/audit` tab (filterable by date/action, actor name resolved).
- **Maker-checker approvals — a real segregation-of-duties control:** a manual journal entry with any line at or above a configurable per-currency threshold (`finance_approval_settings`, seeded placeholder ₦500,000/£5,000/$5,000 — founder to confirm), and locking an accounting period, now go through `finance_approval_requests` instead of posting immediately. A second finance officer must approve — **the requester can never approve their own request** (enforced inside the approval RPC itself, not just the UI; proven via rolled-back SQL both for a manual journal and confirmed the reviewer-≠-requester check fires before any posting happens). New `/finance/approvals` tab (pending queue + reviewed history); `finance_post_manual_journal`'s return shape changed `uuid`→`jsonb` (`{status:'posted'|'pending_approval', ...}`) so the ledger UI can show the right message either way.
- **Cost centers:** `finance_cost_centers` (seeded CLINICAL/PARTNER_NET/CORP_HMO/MARKETING/PRODUCT_ENG/OPS_ADMIN) + optional `cost_center_code` on every journal line (manual-entry form gained the column; automated capitation postings tag `CORP_HMO`). `finance_pnl_by_cost_center` reporting RPC — **found + fixed a real bug during verification**: nested `sum()` inside `jsonb_agg()` at the same query level ("aggregate function calls cannot be nested"), fixed with a two-level aggregation subquery before shipping.
- **Budgets:** `finance_budgets` (account × month × optional cost center) + `finance_budget_variance` (budget vs. real ledger activity), new `/finance/budgets` tab.
- **Cash flow statement (indirect method):** the third core financial statement alongside the existing income statement/balance sheet. `finance_accounts.cash_flow_category` (operating/investing/financing/none — the two bank accounts are `none`, they ARE the cash line) + `finance_cash_flow_statement` RPC, folded into `/finance/statements`. Investing/financing sections read honestly zero — nothing has been posted to those categories yet (no fixed-asset purchases or capital raises in the ledger).
- **Accounts payable (vendors + bills):** `finance_vendors` + `finance_bills` for operating spend that isn't already automated (rent, SaaS, marketing, indemnity, professional fees) — draft → approve (books Dr Expense/Cr AP, +Cr WHT payable if the vendor is WHT-applicable) → pay (books Dr AP/Cr Bank). New account `2500 Accounts payable — vendors`. New `/finance/payables` tab (vendor CRUD, bill lifecycle, AP aging).
- **HMO capitation register** (a real Non-Negotiable Business Rule item with no prior GL treatment): `finance_capitation_contracts` (linked to an `organisations` row of type `hmo` — reuses the existing HMO identity, rejects non-HMO orgs) + `finance_capitation_receipts`, posting Dr Bank/Cr new account `4300 Capitation revenue (HMO)`, distinct from fee-for-service revenue. Register shows implied-PMPM/rate-variance math and an **optional, honestly-labelled** loss-ratio figure (`estimated_cost_of_care_minor` is manually entered — Tarragon has no claims ledger, so this is never a real claims feed, same disclaimer discipline as the HMO risk dashboard's cost-avoided estimate). New `/finance/capitation` tab.
- **Nigeria statutory compliance calendar:** `finance_compliance_obligation_types` (seeded VAT/WHT/PAYE/Pension-PRA-2014/NHF monthly cadences + annual CIT/TET, standard statutory day-of-month figures — confirm exact dates with a tax adviser) + `finance_filings` ("mark as filed" with a real remittance reference, audit-logged) + `finance_compliance_calendar` RPC computing upcoming/due-soon/overdue instances on read. Deliberately a tracker, not a filing engine — never files anything with FIRS/PENCOM itself (no such public API exists). New `/finance/compliance` tab.
- **KPI strip + risk flags on Overview:** `finance_kpi_summary` (gross/net margin, MoM/YoY revenue growth, days-sales-outstanding on commission receivable, cash-runway-in-months) and `finance_risk_flags` (pending approvals, settlements unreconciled >7 days, AP due-soon/overdue, overdue statutory filings) — the Overview now surfaces a "Needs attention" strip linking straight to the relevant tab instead of bookkeeping issues hiding until someone thinks to check.
- **Verified beyond typecheck/lint/test/build:** every new write path proven via rolled-back live SQL with JWT-claims simulation across two real accounts (`finance@tarragonhealth.ng` + an admin test account) — approval-threshold routing (small entry posts immediately, large entry queues, self-approval blocked, a different officer approves successfully, double-approval blocked), cost-center persistence through both the direct-post and approval-approved paths, the full bill lifecycle (WHT computed correctly, AP aging correct), capitation contract org-type validation + PMPM/loss-ratio math, compliance calendar status transitions + mark-filed audit-logging, and the KPI/risk-flag RPCs against real data. **Not browser-verified** (composition over DB-verified primitives + green production build, consistent with the original 2026-07-25 finance build's own verification posture).
- **Regen note:** `database.types.ts` regenerated from remote and re-hand-patched for the recurring nullable-Args generator quirk (this time on `finance_upsert_tax_rate.p_id`, `finance_upsert_vendor.p_id/p_wht_rate_pct`, `finance_create_bill.p_due_date/p_cost_center_code/p_description`, `finance_upsert_budget.p_cost_center_code/p_notes`, `finance_upsert_capitation_contract.p_id/p_effective_to/p_notes`, `finance_record_capitation_receipt.p_estimated_cost_of_care_minor/p_notes`, `finance_mark_filed.p_amount_minor/p_notes`, `finance_approve_request.p_note` — plus the pre-existing `analytics_log_patient_access`/`analytics_upsert_risk`/`analytics_upsert_finance_input` patches from the 2026-07-19 entry, which a literal regen strips every time).
- **Next / founder steps:** confirm the placeholder approval threshold (₦500k/£5k/$5k); confirm the statutory cadence day-of-month figures with a tax adviser (especially the pension "7 working days" approximation); the compliance calendar's annual CIT assumes a calendar-year financial year — correct it if Tarragon's FY differs; authenticated browser click-through of all 6 new tabs once a test credential is available (same blocker as the original finance build — the `finance@tarragonhealth.ng` account still has no password set).
- **Same-day follow-up — connect automated postings to real platform data (explicit ask: "are these fully integrated with data the platform generates?"):** audited every new surface for genuine automatic connectivity vs. hidden manual-entry-only gaps. Honest finding: cost centers, VAT/WHT filing amounts, and capitation enrolment counts were all genuinely disconnected from data the platform already has — fixed. Budgets, vendor bills, and capitation contracts/receipts themselves stay correctly manual (there is no platform-native source for a landlord's rent invoice, a negotiated HMO rate, or "we filed with FIRS" — building a fake automation there would be worse than an honest manual form). One migration (`20260726130000`, applied + recorded):
  - **Cost centers now populate automatically from real events**, closing the gap where "P&L by cost center" only ever showed data a human had manually tagged: booking/service payment revenue (4100) and commission income (4200) → `PARTNER_NET` (matches those two accounts' own descriptions — both are explicitly partner-network lines); settlement processing fees (5000) → `OPS_ADMIN`. Subscription/add-on/wallet postings deliberately stay unassigned — they're core platform revenue with no single owning department, and forcing a tag on them would misrepresent the P&L rather than "connect" it. Verified live: inserting a real `commissions` row (which fires the existing AFTER INSERT trigger, unchanged) now automatically tags its 4200 line `PARTNER_NET` with zero manual step.
  - **Compliance "mark as filed" now suggests a real amount** instead of requiring a blind manual figure: new `finance_compliance_suggested_amount(obligation_code, period_label)` reads the ledger's own authoritative VAT (2200−1300) / WHT (2300) balances for that month and pre-fills the amount field (still editable — the actual remitted figure is what finance actually paid). Pension/PAYE/NHF correctly return no suggestion — there's no payroll subsystem on the platform to derive those from, so those stay honestly manual.
  - **Capitation receipt form now pre-fills "Enrolled members"** from the live `roster_active_members` count already shown in the register, instead of asking the user to retype a number the platform already knows (still editable, since the HMO's own billed count may legitimately differ from Tarragon's claimed-roster count).
  - **Verified:** rolled-back live SQL confirms the commission auto-tagging; `finance_compliance_suggested_amount` called live against real ledger data (correctly returns 0 for VAT this period, matching the platform's real VAT-exempt state — not hardcoded, a genuine read). `pnpm --filter web typecheck`/`lint`(0 errors, 2 pre-existing warnings)/`test` (436)/production build all green; `get_advisors` shows no new finding; confirmed the new RPC is `anon`-denied/`authenticated`-allowed.
  - **Still and correctly manual, by design:** budgets (a target a human sets, nothing to derive), vendor bills (no platform-native record of rent/SaaS/professional-fee invoices), capitation contracts (a negotiated business deal) and the receipt $ amount itself (capitation typically arrives as a bank transfer outside Paystack/Stripe, so there's no `payment_transactions` row to hook automatically), and every compliance "mark filed" click (a human action with FIRS/PENCOM, not something the platform can observe).

### 2026-07-26 — Tarragon Prevent tier: synced + activated (founder confirmed pricing final)
Founder confirmed the 6 Tarragon Prevent placeholder prices (₦3,500/mo · ₦35,000/yr · £7/£70 · $9/$90, seeded 2026-07-23 as part of the prevention-healthy-users-visibility build, `is_active=false` pending sync) are **final for now**. All 6 rows were already synced + `is_active=true` on the live project by the time this pass checked — re-verified directly against the provider APIs rather than trusting DB columns alone: `prevent`/`prevent_yearly` are real Paystack Plans (`PLN_p5ulhm2eal2984m`/`PLN_ntgxmcc47sc6pze`, correct amount/interval/currency); the 4 GBP/USD rows are real, active Stripe Prices (correct `unit_amount`/`currency`/`recurring.interval`, both linked to real Stripe Products). All 6 confirmed `price_locked=false` with 0 active subscribers — fully open to a future reprice. The onboarding/subscription plan-selector queries filter on exactly `is_active=true`, so Tarragon Prevent is live and checkout-able now, no deploy needed (the marketing `/pricing` card was already showing regardless of this flag — it's static copy in `_content/pricing.ts`, not DB-driven; this activation is what makes the tier actually purchasable). Repricing later: the bulk % adjustment tool (`/admin/settings/subscriptions`) already reaches these rows since it operates on any active, unlocked plan; an exact new number still needs a direct Supabase update + re-sync (Paystack Plans/Stripe Prices are amount-immutable), same pattern as every prior reprice in this file. `seed.sql` deliberately left at `is_active=false` — matches the established convention (e.g. ParentCare) that a fresh environment must run its own sync against whatever provider keys it has, rather than seed inheriting another environment's activated state.

### 2026-07-27 — Lab Partner role: partner-lab login, mirrors pharmacist (branch `claude/lab-partner-role`, isolated worktree, explicit ask)
Labs had only one path — email a result to Tarragon's in-house Lab Liaison Officer, who uploads on their behalf (`lab_liaison` role, 20260720120000/120100). There was no equivalent of `pharmacist` (a partner's OWN staff logging in, scoped to just their own catalogue row) for labs. Built `lab_partner`, side by side with `lab_liaison` — a lab picks whichever fits it; neither replaces the other. Five migrations applied via `apply_migration` (recorded: `20260727002631`/`002742`/`004013`/`004156`/`004500`); `pnpm --filter web typecheck`/`lint`(0 errors, 2 pre-existing warnings)/`test` (436)/production build (`/lab-partner` compiles) all green.
- **Schema, same shape as `pharmacist_surface.sql`:** `profiles.lab_provider_id` (→ `lab_providers`) + `private.lab_partner_provider()` (returns the caller's lab only for role='lab_partner', null otherwise) + three SECURITY DEFINER RPCs scoped to it — `lab_partner_orders()` (worklist, excludes `pending_payment`), `lab_partner_order_patient(order_id)` (patient lookup for the storage-path step), `lab_partner_upload_result(...)` (inserts `lab_result_documents` with a new `source='lab_partner'` value, reusing the EXISTING insert trigger verbatim — same clinician_review alert + patient notification as every other source, no duplicated logic — and advances the order to `resulted` unless already resulted/cancelled). No broad RLS grant anywhere; a lab_partner reaching for another lab's order gets zero rows / a `42501`, proven via rolled-back live SQL (jwt-sim across two real lab_provider-scoped accounts + a plain patient session, all three read/write paths).
- **App layer:** `/lab-partner` page + worklist (per-order upload form, mirrors `pharmacist-worklist.tsx`), `lib/queries/lab-partner.ts`, a new `uploadResultAsLabPartner` server action in `lib/lab-results/actions.ts` (storage-upload-then-RPC-insert-with-rollback, same shape as the existing `uploadResultDocumentForPatient`). Wired into `roles.ts`/`navigation.ts`/`(dashboard)/layout.tsx`/`members.ts` (provisioning role list)/`robots.ts`.
- **Found + fixed two real, currently-live security gaps in passing (not hypothetical — both confirmed against real data before and after):**
  1. **The anon-execute gotcha's documented fix was wrong.** `20260724020855`/`20260724163357`/`20260720224204`'s comments claim `revoke ... from public` doesn't strip anon's EXECUTE and only `revoke ... from anon` works — the opposite is true. Confirmed live: `has_function_privilege('anon', 'public.pharmacist_orders()', 'EXECUTE')` is STILL `true` today, on a function those very migrations claimed to have fixed. `pg_proc.proacl` shows why — anon inherits EXECUTE via the PUBLIC pseudo-grant (`=X/postgres`) a new function gets by default, not a direct `anon=X` entry, so revoking from `anon` (which never held a direct grant) is a no-op; revoking `from public` is what actually removes it (confirmed: `anon` flips to `false`, `authenticated` correctly stays `true`). An earlier, correct precedent already existed (`20260719230239_open_health_check_revoke_public`) before the mistaken belief took over. Fixed for my own three new RPCs (`20260727004156`); **the previously "fixed" functions across the codebase (pharmacist_order_allergies/medications/orders/record_dispense, admin_send_broadcast, admin_broadcast_audience_count, the facility-activation RPCs, etc.) are still anon-executable today** — out of scope to re-audit all of them in this pass, flagging for a dedicated follow-up.
  2. **`private.is_org_staff()` didn't exclude partner-employee roles.** It only ever excluded `role = 'patient'` — any other role with a non-null `organisation_id` passes it, which is exactly what most multi-tenant tables' RLS gates on. Both `pharmacist` and `lab_partner` are documented as RPC-only, no-broad-RLS roles, but nothing enforced that. Confirmed live (not hypothetical): the real `Test Pharmacist` fixture (`organisation_id` = org 0001) could read a real `lab_orders` row (`LAB-000019`) directly via plain RLS — a live PHI-adjacent bypass of the entire pharmacist-scoped-RPC design, and the exact same latent exposure my new `lab_partner` role would carry if ever provisioned with an org id (the generic admin members-provisioning UI doesn't prevent this). Fixed (`20260727004500`): `is_org_staff` now excludes `'pharmacist'`/`'lab_partner'` too — verified byte-scoped (`create or replace`, only the role list changed) and re-verified live both directions: pharmacist's direct `lab_orders` read now returns 0, a genuine org-staff role (doctor test fixture) is completely unaffected (still returns 1). Neither role's own application code ever used direct `.from(table)` reads (100% `.rpc(...)`-only for both), so this closes a real gap with zero legitimate-access regression.
- **Verified beyond typecheck/lint/test/build:** full isolation proof via rolled-back live SQL — Lab A's session sees exactly its own order, resolves the right patient, uploads successfully (order flips to `resulted`, `lab_result_documents` row lands with `source='lab_partner'` + correct org/patient, a `clinician_review`/escalation-level-2 alert fires, 2 notification rows queue — all via the pre-existing trigger, not new code); Lab B's session sees 0 orders/NULL patient/blocked-`42501` upload attempt with zero side effects; a plain patient session sees 0 orders. `get_advisors` shows only the expected `authenticated`-security-definer WARN on the 3 new RPCs (same accepted advisory every sibling RPC carries) — confirmed no new/unexpected finding, and the lint-output byte count is identical before/after the `is_org_staff` hardening (no new/removed advisory).
- **NOT browser-verified** (no dev-server/test-credential run this session — composition over DB-verified primitives + green production build). **Next / owner steps:** provision a real lab-partner login when a partner lab wants one (leave `organisation_id` unset, set `lab_provider_id` via direct SQL — no admin UI for either FK yet, same as pharmacist today); a dedicated follow-up to re-audit and properly fix every previously-"anon-fixed" RPC across the codebase using the corrected `revoke ... from public` form; browser click-through of the `/lab-partner` worklist once a preview env is free.

### 2026-07-30 — Child Immunisation build kickoff: versioned/signed vaccination-schedule layer + real Clinical Director provisioned (branch `claude/child-immunisation-module`, isolated worktree)
**Reconciliation note:** `main` was 24 commits behind `main-dev` at the time of this entry (`main-dev` has `lab_partner` role and other sprints `main` doesn't) — this entry's 3 commits were cherry-picked directly onto `main` to unblock a live sign-off without dragging in that unreconciled gap. **Closed same day** by the full `main-dev`→`main` release described in the entry at the end of this file.
An external "Child Immunisation Record & Due Notifications" build spec was reviewed against what already exists — `vaccination_catalog`/`vaccination_records`/`vaccination_schedules` (live since 2026-07-06, actively maintained through 2026-07-24's tetanus/shingles dosing-accuracy work) already cover most of it, including a verification/certificate layer (2026-07-17) the spec's own scope excluded. Founder chose to **merge the spec's genuinely-new ideas into the existing system rather than build a parallel one**. This session shipped the first piece: a versioned, Clinical-Director-signed review record over the live schedule. Three migrations applied via `apply_migration` (recorded: `20260729235803` — reconciling another session's already-live `rls_auto_enable_event_trigger` with no local file, same recurring drift class as every prior entry — `20260730000555`, `20260730001541`); `pnpm --filter web typecheck`/`lint`(0 errors, 2 pre-existing warnings)/`test` (444)/production build all green.
- **`vaccination_schedule_signoffs` + `sign_vaccination_schedule()`:** mirrors `cv_risk_config`'s proven signing model (director-only, forge-proof, one-active-at-a-time, audit-logged) — global scope (no `organisation_id`), matching `vaccination_catalog` itself. `catalog_snapshot` (follow-up migration) captures exactly what was reviewed at draft time, so a later catalog edit can't silently drift from what was actually signed off. **Deliberately not wired into `queue_vaccination_reminders` yet** — checked live before writing anything: zero active Clinical Directors existed in production at the time, so gating live reminders on a signature would have silently stopped them. Verified via rolled-back live SQL (`packages/db/tests/vaccination_schedule_signoff.sql`): non-director blocked, real director signs, attribution correct, one-active-only holds.
- **`/admin/settings/vaccination-schedule`:** a straight structural clone of `/admin/settings/cv-risk-config`'s review-then-sign UI — shows the live catalog, lets an admin snapshot it into a draft, lets an active Clinical Director sign. New "Clinical" nav group links it (the founder asked to be able to find and review this again later — `cv-risk-config` itself has no nav link at all, a pre-existing gap not fixed here, out of scope for this pass).
- **A real Clinical Director now exists:** the founder (`kola.longe@tarragonhealth.ng`, the only real non-test admin account in production) confirmed Clinical Director status verbally and chose to **skip recording a real MDCN/credential number for now** rather than have one invented. Provisioned via an org-wide `clinical_staff_indemnity_exemptions` grant (`applies_to_director=true`, not a per-record self-exemption — the per-record `indemnity_exempt_by` column structurally can't reference the record's own `profile_id`, and there is no second real admin in this org to serve as grantor) + `license_verified_at` set directly (no `verified_by`, which is nullable and so doesn't trip the no-self-verification check). Logged to `audit_log` (`clinical_staff.director_provisioned_no_credential`) with the deferred-credential reason on record. **A version-1 draft sign-off already exists**, snapshotting the current live catalog — the founder can sign it at `/admin/settings/vaccination-schedule` any time; I did not and will not simulate that click myself, the entire point of the forge-proof design is that it has to be a real authenticated click.
- **Not browser-verified with a disposable test account** — Supabase's Auth Admin API returned a bare `AuthRetryableFetchError: {}` (HTTP 500) twice in a row while provisioning one, reproduced both through the real `/login` form and by calling the Admin API directly from a script outside the app entirely, an infrastructure-level issue unrelated to this change. **BUT verified for real the same day**, in the founder's own browser: this code was only on an unpushed branch, so the first click-through 404'd — cherry-picked the 3 commits directly onto `main` (as [PR #162](https://github.com/Kolalonge-creator/Tarragon-Health/pull/162), since production deploys from `main` and `main`/`main-dev` had drifted 24 commits apart — that gap is pre-existing and still unreconciled, flagged not fixed), merged, Vercel auto-deployed, and **the founder signed version 1 live** — confirmed by screenshot: "Version 1 — Active — signed", the page correctly rolled forward to "version 2" for the next catalog change. `claude/child-immunisation-module` (this branch, [PR #161](https://github.com/Kolalonge-creator/Tarragon-Health/pull/161)) targeting `main-dev` is still open/unmerged — `main-dev` has the schema+RPC (applied straight to the shared live DB) but not yet this app-layer UI on that branch specifically.
- **▶ Resume here (next session):** the merged plan's remaining pieces, none started yet —
  1. Catch-up intake flow: when a child is added with a DOB >90 days in the past, ask "do you know which vaccines they've had?" (enter from card / photo / "not sure") before generating any due/overdue state or notification — a `history_unknown`-style flag on the child's profile, suppressing late-state notifications specifically, never blocking the schedule view itself.
  2. Per-state notification dedup: `private.queue_vaccination_reminders` (`supabase/migrations/20260716190000_vaccination_schedules.sql`) currently sends exactly one flat WhatsApp reminder per dose, ever (gated by `reminder_sent_at is null`) — no due-soon nudge, no late escalation. Needs a due_soon/due_now/late model with one notification per (dose, state).
  3. Forbidden-copy lint test for the notification templates (no "you must", "we have booked", "guaranteed", etc.).
  4. Optionally wire `sign_vaccination_schedule`'s active row into `queue_vaccination_reminders` as a hard gate now that a real signed version exists — was deliberately left unwired while no director existed; revisit now that one does.
  5. A real MDCN/credential number for the founder's `clinical_staff` record when convenient (currently exempted, not verified — see the bullet above).

### 2026-07-30 — Release: main-dev → main, closing the 24-commit reconciliation gap
Explicit ask ("merge, move, push, pr all changes... so everything is up to date"). Two independent pieces landed same session, then both released together:
- **Marketing site expansion** ([PR #166](https://github.com/Kolalonge-creator/Tarragon-Health/pull/166), squash-merged to `main-dev`): a large batch of uncommitted working-tree changes found sitting on `main-dev` — cookie consent banner (opt-out, marketing-only, honors DNT, gates the existing page-tracker beacon), a non-clinical mental well-being pulse-check (always-visible Nigerian support-line notice, explicitly disclaimed against the real PHQ-9/GAD-7 screen), BMI/calorie + activity-intensity calculators (reuse the platform's existing BMI logic, no signup), an interactive Screening Journey tool, a new informational `/gift` page (funds an existing Health Wallet or shares the existing referral link — no new checkout path), `/accessibility` + `/cookies` legal pages, a leadership-panel/`/about` redesign (real founder bio; other seats honestly labeled "Open role"; drops the retired 1:120-ratio claim; softens "obesity"→"weight" in patient-facing copy), a homepage PWA-install mockup, a resources-hub carousel/share system, an illustrative unauthenticated plan-preview sample for `/prevention`, a login/signup visual refresh (no auth logic changed), and 6 content-only `marketing_resources` migrations (already applied to the live project before this session — confirmed via `list_migrations` before committing, no drift). Touches no auth/payment/RLS logic. Verified: `pnpm --filter web typecheck`/`lint` (0 errors, 2 pre-existing warnings)/`test` (465 passing) all green before commit.
- **`main-dev` → `main` release** (this entry): the Child Immunisation entry directly above flagged a 24-commit `main`/`main-dev` divergence as "pre-existing and still unreconciled" after cherry-picking just the vaccination-schedule-signoff work onto `main` via PR #162/#163. Closed properly here rather than left open: merged `main-dev` (27 commits ahead, including PR #166 above) into `main` via a dedicated `release/main-dev-to-main-20260730` branch — dry-run first to confirm shape, one real conflict (`CLAUDE.md`'s own changelog, both branches having appended different entries after the PR #158 release point — resolved by keeping both entries in chronological order and keeping the more complete, browser-verified version of the Child Immunisation entry that existed on `main` after the PR #162 cherry-pick); `navigation.ts`/`database.types.ts` auto-merged cleanly (identical vaccination-schedule-signoff content on both sides). This release brings the **founder-approved 2026-07-29 business-model changes to production for the first time**: no capitation (I8), institutions get aggregate-only patient access (I9 — this one closes a live PHI-exposure bug, not just a feature), one price list (GBP retired, USD derived from an admin-set naira rate), individual-enrolment-only (removes Family Lite/Plus/Premium and ParentCare as purchasable plans — existing subscribers on those tiers are grandfathered per the removal migration's own logic, not force-cancelled), plus the `lab_partner` role, the `rls_auto_enable` safety-net trigger, and the I1–I10 invariant-suite port. Confirmed with the founder before merging, given the live business-model impact. `main` and `main-dev` are fully reconciled as of this release — no more divergence in either direction.
- **Verification:** same local `pnpm --filter web typecheck`/`lint`/`test` pass as PR #166 (nothing new to break — this is a pure merge, no new code); CI (TypeScript, Python ML, Vercel preview) green on both PR #166 and the release PR before merging either.
- **Next:** none blocking. The Child Immunisation build's own 5-item resume list above (catch-up intake flow, per-state notification dedup, forbidden-copy lint, wiring the signed schedule into the reminder cron, a real MDCN number for the founder) is unchanged by this release.

### 2026-07-30 — v3 integration, first port: I5 (emergency escalations can no longer be closed by a text-only note)
Founder confirmed the direction for the whole v3 effort: **"V3 should be enhancement of what we already have, not a replacement"** — sharpens the pivot-reversal at the top of this file. Neither dormant v3 codebase (this project's old M1/M2, or the separate `tarragon-control` repo) resumes as a milestone build; the only sanctioned path is a deliberate, scoped port of one named v3 discipline into `apps/web` at a time — see [[project_tarragon_control_v3_rebuild]] (memory, resolved). Asked where to start; chose **I5** first (patient-safety gap, clearest precedent) over I1 (needs a template audit first) per the user's own pick from an explicit menu.
- **The gap, as proven by `packages/db/tests/i1_i10_invariants_platform.sql`'s I5 check (ported 2026-07-29):** `escalations.status` could be set to `'resolved'` on an `emergency`-level `clinician_alerts` case with nothing but a `resolution_note` — no requirement for any real, synchronous contact with the patient first.
- **Fixed** — migration `20260730092804_i5_emergency_escalation_synchronous_contact.sql`: `private.enforce_emergency_escalation_synchronous_contact()`, a BEFORE UPDATE trigger on `escalations` mirroring `enforce_medication_confirm_only`'s shape, blocks (`23514`) the transition into `'resolved'` on an `emergency`-level escalation unless a `video_consultations` row exists (the platform's only synchronous-contact record) either linked via `escalation_id` — the real path `startVirtualReview` already creates — or, for the same patient, with `started_at` between the escalation's creation and now; either way requiring `status in ('started','completed')` so a merely-scheduled or no-show call doesn't count. **Deliberately scoped to `emergency` only** — `urgent_escalation` is NOT gated, flagged not guessed at (a separate decision, since `CLINICAL_TRUST_MODEL_SPEC`'s SLA table treats Red/urgent and Emergency as different tiers). `'referred'` is a different transition (forwarding, not closing) and stays ungated.
- **Verified live, 4 cases in one rolled-back transaction** (`packages/db/tests/i5_emergency_escalation_synchronous_contact.sql`): emergency + zero contact → blocked; emergency + a completed, escalation-linked video consult → resolves; emergency + zero contact but transitioning to `'referred'` → succeeds (not gated); non-emergency (`clinician_review`) + zero contact → resolves (gate is emergency-only by design). All 4 passed as designed on the first run.
- **`packages/db/tests/i1_i10_invariants_platform.sql` updated in place** — I5 flipped from its documented GAP to a PASS-expecting check (per that file's own stated convention: "the day someone builds the real enforcement, this file's GAP checks... should be flipped to expect-rejection"). Full suite re-run live: I5 now PASS, I1/I14 unchanged (still genuine, undisturbed GAPs — out of scope this pass), zero regressions.
- **Found + fixed a real bug while browser-verifying:** `apps/web/src/app/(dashboard)/doctor/escalations/[escalationId]/resolve-form.tsx` swallowed every resolve error into a generic "Could not save. Try again." — defeating the whole point of a trigger message meant to guide the clinician. First fix attempt (`resolve.error instanceof Error`) was itself wrong: confirmed live via a temporary debug log that this app's bundled Supabase error object has the correct `.message` but fails `instanceof Error` (a bundler/chunk realm issue, not a data problem) — fixed with a plain `resolve.error?.message` duck-typed read instead, matching how the rest of the codebase already handles Supabase errors elsewhere (no `instanceof` checks). **Browser-verified end-to-end** (real Chrome pane, `doctor.tier4.test@tarragon.test`, a real disposable `clinician_alerts`/`escalations` fixture on `patient.essential.test`): submitting the resolve form with only a text note now shows the clinician the exact guidance — "An emergency escalation cannot be resolved with only a note — complete a synchronous voice or video contact with the patient first (start a virtual review)" — instead of the old generic message. Fixture cleaned up afterward.
- `pnpm --filter web typecheck`/`lint` (0 errors, the same 2 pre-existing warnings) clean. `get_advisors` (security): zero findings reference the new function — clean.
- **Next:** continue the v3 port list per the founder's own priority call when asked — I1 (notifications content-classification CHECK, needs a template audit first), the escalation-SLA-as-data table, a `clinician_override` field on `clinician_alerts`, `proof_log`-style patient-facing summaries, and the `recorded_by` NOT NULL provenance question (architecturally tricky — conflicts with the existing `on delete set null` pattern, needs its own design decision, not a quick migration). See conversation history for the full status audit of all 11 "PORT IT IN" items.

### 2026-07-30 — v3 integration, second port: I1 (notifications gains a real content-classification backstop)
Second item off the same list, picked as the natural next step (the other item explicitly flagged in CLAUDE.md as needing a template audit before building).
- **The audit, done first, not assumed:** read all 28 live templates in `supabase/functions/send-pending-notifications/index.ts` end to end. 26 are plainly operational (reminders/confirmations/logistics — due dates, drug/vaccine/test *names* for identification, order numbers) and match the Non-Negotiable Business Rules' existing convention. Two genuine nuances found and documented rather than silently resolved: **`broadcast_announcement`** carries admin-authored free text fanned out to whatsapp/sms/email — no column-based CHECK can inspect prose, so this stays a UI/policy matter (see below). **`referral_specialist_alert`**'s email-only leg (no WhatsApp leg exists for it) includes `referral_reason` — genuine clinical context sent to a receiving specialist, professional HCP-to-HCP correspondence rather than the patient-facing "open rail" the rule protects against, and already a deliberate prior design decision per that template's own existing comment — left unchanged, flagged for visibility.
- **Fixed** — migration `20260730094515_i1_notifications_content_class.sql`: `notifications.content_class` (`clinical`/`non_clinical`, default `non_clinical`) + CHECK `notifications_no_clinical_on_open_rail` rejecting `content_class = 'clinical'` on `channel in ('whatsapp','sms','email')`. **A backstop, not a retroactive reclassification** — every one of the ~25 existing `private.enqueue_*`/`queue_*` trigger functions that insert into `notifications` needed zero code changes, since none of them ever set `content_class` explicitly and the default satisfies the new CHECK automatically. What changes is that a *future* insert can no longer flip a whatsapp/sms/email row to `'clinical'`.
- **Verified live, 5 cases in one rolled-back transaction** (`packages/db/tests/i1_notifications_content_class.sql`): `clinical` + each of whatsapp/sms/email → blocked (`23514`); `clinical` + `in_app` → allowed; the real existing insert pattern (no `content_class` specified) + `whatsapp` → still succeeds, defaults to `non_clinical`. All 5 passed as designed.
- **`packages/db/tests/i1_i10_invariants_platform.sql` updated in place** — I1's check now proves live rejection (insert `content_class='clinical'`+`whatsapp`, expect `check_violation`) rather than just checking column existence, matching I5's proof style. Full suite re-run: I1 now PASS, only I14 remains a documented, out-of-scope GAP, zero regressions.
- **Closed the one residual risk the audit found:** `broadcast_announcement`'s free text can't be caught by a DB constraint, so `apps/web/src/app/(dashboard)/admin/settings/broadcasts/broadcast-composer.tsx` gained a warning directly under the message field: "This goes out over WhatsApp/SMS/email — never include a diagnosis, test result, or other clinical detail specific to a person." Browser-verified (real Chrome pane, `md.lipidtest@tarragon.test`, an existing test admin account) — renders exactly under the Message textarea, no console errors.
- `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings) clean. `get_advisors` (security): zero findings reference the new column/constraint.
- **Next:** same remaining list as above, minus I1 — escalation-SLA-as-data table, `clinician_override` on `clinician_alerts`, `proof_log`-style patient-facing summaries, and the `recorded_by` NOT NULL provenance design question. Ask the founder which to pick next rather than guessing priority.

### 2026-07-30 — I1 follow-up: broadcast_announcement's free-text gap moved from warning-only to enforced
The entry above left `broadcast_announcement` as a UI-only caption because a DB CHECK can't inspect prose. Closed that residual gap with a real server-side heuristic block instead of a constraint — migration `20260730155706_broadcast_content_class_enforcement.sql` (applied via `apply_migration`, recorded at that timestamp).
- **`private.broadcast_content_flags(text)`:** regex heuristic targeting phrasing that only makes sense addressed to one person about THEIR result ("you tested positive", "your diagnosis", "abnormal result") — deliberately NOT condition names on their own, since this platform legitimately markets named confidential screenings (HIV/Hep B/cervical) as general campaigns (`/annual-health-check`); blocking condition names outright would false-positive on exactly that kind of legitimate announcement. Documented in the migration as a best-effort backstop, not a clinical-content classifier — a determined admin could still phrase around it.
- **`admin_send_broadcast` itself now refuses to enqueue a flagged message** (raises `23514`), regardless of how it's called (UI, script, or direct API) — this is the actual enforcement, not just a UI check. New `admin_broadcast_content_check(text)` preview RPC lets the composer check before ever creating a `notification_broadcasts` row, so a blocked attempt doesn't leave an orphaned draft.
- **`broadcast-composer.tsx`** gained a required attestation checkbox ("I confirm this message contains no diagnosis, test result, or other clinical detail specific to an individual patient") gating the Send button — the passive caption from the prior entry is now an active, required acknowledgment, plus a pre-submit call to the new check RPC.
- **Verified live, 5 cases in one rolled-back transaction** (`packages/db/tests/broadcast_content_class_enforcement.sql`): clean campaign copy naming a screened-for condition is NOT flagged; "your test result"/"you tested positive" phrasing IS flagged; `admin_send_broadcast` blocks a flagged message with `23514`; a clean broadcast still sends normally. **Also browser-verified end-to-end** (real Chrome pane, worktree dev server, `md.lipidtest@tarragon.test`): a diagnosis-phrased draft was blocked client-side with the friendly message and created no draft row; the same composer with clean copy sent successfully ("Queued to 15 recipients"). The real send this produced (1 broadcast row + 15 notification rows in the live dev database) was deleted immediately after confirming it worked, matching this codebase's established test-cleanup convention.
- `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings)/`test` (465) clean. `get_advisors`: only the accepted `authenticated_security_definer_function_executable` WARN on the new RPC (same advisory every sibling RPC carries) — confirmed via `has_function_privilege` that `anon` is denied on all three touched functions.
- **Built in an isolated worktree** (`.claude/worktrees/i1-broadcast-hardening`) per [[feedback_shared_working_directory_hazard]] — a concurrent session was mid-flight on notification-delivery-state/push-subscription/device-heartbeat work in the main checkout at the same time (live DB was already past `20260730153333` when this branch started at `20260730095649`).
- **Next:** none blocking. Same v3-port items remain: escalation-SLA-as-data table, `proof_log`-style summaries, `recorded_by` NOT NULL provenance.

### 2026-07-30 — v3 integration, third port: `clinician_override` (a doctor can now record disagreement with the auto-assigned alert level)
Third item off the same list, picked as the most self-contained of the three remaining (additive schema, no need to touch the ~15 existing trigger functions that write `clinician_alerts.level`, unlike the SLA-as-data table's invasive refactor or `proof_log`'s bigger new-feature shape).
- **The gap:** `clinician_alerts.level` is set deterministically by system triggers (the BP/diabetes red-flag engines, `handle_abnormal_screening_result`, etc.) with no field for a clinician to record disagreement — the only existing write path (`useAcknowledgeAlert`) touches `status`/`acknowledged_by`/`acknowledged_at` only, and no UI anywhere let a human override the classification.
- **Fixed** — migration `20260730095649_clinician_alert_override.sql`: `clinician_alerts` gains `override_level`/`override_reason`/`overridden_by`/`overridden_at`. **`level` itself is never touched** — the system's original classification stays permanently recoverable; the effective level for display/triage is `coalesce(override_level, level)`. A CHECK requires a reason whenever `override_level` is set. `private.enforce_alert_override_clinical_only` (BEFORE UPDATE, same "RLS admits broadly, trigger narrows" shape as `enforce_medication_confirm_only`) requires the caller to have an active `clinical_staff` row before touching either override field — structurally, not just by convention, blocking exactly the case the Clinical Tier Ladder rule already forbids (a Care Coordinator making a clinical judgment call). `overridden_by`/`overridden_at` are always server-derived from the caller's own `clinical_staff` row, proven forge-proof against a same-statement spoofing attempt.
- **Real finding while testing, not a bug in the feature:** the QA test accounts provisioned 2026-07-27 have **no `clinical_staff` rows at all** — confirmed live, only 1 row exists in the whole table (the founder's own, from the same-day Clinical Director provisioning). The platform DB was rebuilt from scratch this week (see the top-of-file pivot-reversal banner) and that roster was never re-provisioned against the fresh rebuild. First verification pass misread this as a spoofing-prevention bug; re-run with a self-contained fixture (a fresh `clinical_staff` row inserted inside the same rolled-back transaction) confirmed the trigger is correct. Flagged in memory — don't assume the 2026-07-27 QA roster's clinical-tier gating still works without checking.
- **Verified live, 6 cases in one rolled-back transaction** (`packages/db/tests/clinician_alert_override.sql`): care_coordinator attempt → blocked (`42501`); real clinician overrides with a spoofed `overridden_by` in the same statement → allowed, but forced to the real caller; system `level` left untouched; an unrelated (acknowledge) update leaves the override intact; `override_level` with no reason → blocked (`23514`); clearing `override_level` wipes reason/overridden_by/overridden_at together. All 6 passed.
- **Wired into the actual product surface**, not left as inert schema: `/doctor/escalations/[id]` now shows the effective (override-aware) level badge, an "Override classification" control (level select + required reason), and — once set — a null-gated "Overridden to X · reason · by Dr Y on date" note with a "Clear override" action. New `useOverrideAlertLevel`/`useClearAlertOverride` hooks in `lib/queries/clinician-alerts.ts`; `database.types.ts` hand-patched (4 new columns + the `overridden_by` → `clinical_staff` FK) rather than a full regen, to avoid pulling in other sessions' in-flight schema from the same live project.
- **Found + fixed a real bug while browser-verifying:** the first save appeared to silently do nothing — the badge and override note didn't update. Root cause: `/doctor/escalations/[id]/page.tsx` is an async server component that fetches once per request; the mutation's React Query cache invalidation has nothing to do with that server-fetched data. Confirmed via direct SQL that the write itself was correct the whole time. Fixed by adding `router.refresh()` alongside the query invalidation on both the override-save and clear-override success paths. **Browser-verified end-to-end after the fix** (real Chrome pane, `doctor.tier4.test@tarragon.test` given a temporary real `clinical_staff` row for the test, a disposable escalation fixture on `patient.essential.test`): override to Emergency → badge flips from "Urgent escalation" to "Emergency", note shows the reason and real attribution ("By Dr. Tier Four Director Test on 30/07/2026") → Clear override → badge and note revert, DB confirms all four fields null again. Fixtures (escalation, clinician_alert, the temporary clinical_staff row) all cleaned up afterward.
- `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings)/`test` (465 web) clean. `get_advisors` (security): zero findings reference any of the new columns/function.
- **Next:** two items left on the v3 port list — escalation-SLA-as-data table (currently hardcoded intervals across ~5 migrations, a genuinely more invasive refactor) and `proof_log`-style plain-language patient-facing summaries (today's `audit_log` is technical/internal only; may partially overlap with the existing `patient_timeline`, worth checking before building). The `recorded_by` NOT NULL provenance question stays flagged as architecturally tricky, not a quick next pick. Ask the founder which to pick, per the same pattern as I5/I1/this one.

### 2026-07-30 — v3 integration, fourth port: escalation-SLA-as-data table, plus a proof_log finding (both done in one pass, per explicit ask)
Closed the escalation-SLA item off the same list and investigated `proof_log` rather than building it blind, per the founder's own choice from an explicit menu.
- **The audit, done before writing anything:** read every live function that computes `clinician_alerts.sla_due_at` — 8 functions (`handle_abnormal_screening_result`, `handle_bp_reading_red_flag`, `handle_emergency_event`, `handle_foot_self_check`, `handle_lpe_red_flag`, `handle_obesity_ed_screen`, `flag_missing_glucose_logs`, `flag_overdue_vitals`), 12 distinct (pathway, tier) SLA commitments. **Found a real, live inconsistency, not hypothetical:** the same `alert_level` value carries different SLA meanings depending which function wrote it — `urgent_escalation` is 24h in the screening-abnormal-result pipeline, 1h in the BP/LPE/obesity red-flag engines, and 4h in the diabetic-foot-check pathway; `emergency` is 2h in screening/`emergency_events` but 15min in the LPE/obesity engines. `docs/CLINICAL_TRUST_MODEL_SPEC.md` §6's own three-tier Amber(24h)/Red(2h)/Emergency(immediate) table predates and doesn't cleanly map onto the pathways added since.
- **Fixed** — migration `20260730105131_v3_port_escalation_sla_config.sql`: new `escalation_slas` (versioned, Director-signable, mirrors `cv_risk_config`/`vaccination_schedule_signoffs` exactly — global scope, no `organisation_id`, since this is platform-wide clinical protocol) + `private.escalation_sla_minutes(pathway, tier)` lookup helper (fails LOUD via `raise exception` on an unknown combination rather than silently returning null — a missing SLA on a real clinical alert is a worse failure mode than a blocked insert) + `public.sign_escalation_slas()` RPC. All 8 functions rewired to call the lookup instead of a hardcoded interval literal — every other line byte-identical to the live definition pulled from `pg_proc` first.
- **Deliberately did NOT reconcile the discovered inconsistency** — collapsing `urgent_escalation`'s three live values (or `emergency`'s two) to one number is a clinical-safety judgment call across genuinely different care pathways, not an engineering refactor, same class of decision as I14/the doctor:patient ratio. v1 is seeded as a **faithful, zero-behaviour-change transcription** of what was already live (`is_active=true` from the migration itself, since the trigger rewrites need a resolvable config the instant it runs — unlike `vaccination_schedule_signoffs`, which could stay unwired pending signature, this can't), but deliberately **unsigned** — the `notes` field documents the exact divergence found above and asks the Clinical Director to decide whether to reconcile (tightening only, never loosening) or keep the pathways genuinely distinct. New `/admin/settings/escalation-slas` page (structural twin of `/admin/settings/vaccination-schedule` and `/admin/settings/cv-risk-config`) shows the active config grouped by tier with a "Diverges" badge on any tier carrying more than one distinct SLA, and lets a Director sign to formally attest it or draft+sign a reconciled version — new "Clinical" nav entry.
- **Verified beyond the migration's own assertion block:** a second rolled-back live-SQL pass fired the real `handle_bp_reading_red_flag` and `handle_emergency_event` triggers end-to-end (not just the standalone lookup function) and confirmed `sla_due_at` lands at the exact pre-port offset; a permanent test (`packages/db/tests/escalation_slas_config.sql`) covers all 12 lookups, both live trigger paths, the fail-loud negative case, and the `sign_escalation_slas` forge-proof gate (non-director blocked, active Director signs, one-active-at-a-time) — mirrors `vaccination_schedule_signoff.sql`'s proven shape. `get_advisors` shows only the expected `authenticated`-security-definer WARN on `sign_escalation_slas` (same accepted advisory every sibling RPC carries) — confirmed via `has_function_privilege` that `anon` is denied on both new functions. `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings)/`test` (465, unchanged — no new TS unit tests needed for a page that's a structural twin of an already-tested precedent) all clean.
- **`proof_log` finding (investigated, not built):** compared the v3 spec's proof_log shape (`id, patient_id, event_type, actor_profile_id, actor_display, summary, occurred_at, source_table, source_id`, trigger-populated per I10, patient-facing plain-language mandate, plus a consent-gated funder-read policy at spec §6.2/I4) against this platform's real `patient_timeline` (built 2026-07-17, already trigger-populated via `SECURITY DEFINER` triggers, append-only grants, same `source_table`/`source_id` back-reference shape). **Conclusion: proof_log is substantially already satisfied by `patient_timeline` — building a second table would violate this codebase's own repeated no-second-source-of-truth rule.** Three real, narrower gaps found instead:
  1. **No funder/consent-gated third-party read policy.** `patient_timeline`'s RLS is `patient_id = auth.uid() OR is_org_staff(...)` only — confirmed live via `pg_policies`. proof_log's headline spec example (I4) is exactly a `profile_access`/`consent_records`-style grantee reading a patient's log; several OTHER tables on this platform already got that extension (`lab_analyte_readings` for the lipid module's family visibility, vaccination tables for child management) but `patient_timeline` never did.
  2. **No enforced plain-language guarantee.** proof_log's spec makes this a hard requirement; `patient_timeline` relies on convention only, and it already had one real violation — raw analyte keys (`total_cholesterol`) leaking into patient-facing copy, found and fixed 2026-07-21 as a display-time humanisation patch, not a structural guarantee. Nothing stops the next new trigger author from doing the same thing.
  3. **Missing dispense-event coverage.** `medication_dispenses` is one of only 4 explicitly-named required trigger sources in the v3 I10 test; confirmed via grep that this platform's real analog, `pharmacy_order_dispenses`, has **zero** `patient_timeline` trigger wired to it — a patient collecting their dispensed medication leaves no trace on their own timeline today.
  - Not a gap, just a legitimate shape difference: `patient_timeline.actor_clinical_staff_id` is a live FK (resolved at render time) vs proof_log's `actor_display` (a frozen string) — a later `clinical_staff.full_name` change would retroactively affect how old entries display, a real but low-severity provenance nuance (name changes are rare); and this platform never had a unified `clinical_notes` table to begin with, so that trigger source has no analog to port.
  - **None of the three gaps were built this pass** — per the founder's own choice, this was reported rather than acted on blind. The dispense-trigger gap is mechanical and low-risk (matches the same pattern used for every other `patient_timeline` source); the funder-read-policy gap is a real product/security decision (broadening third-party access to a patient's timeline) that deserves the same flag-before-building treatment as the SLA reconciliation above; the plain-language gap has no clean DB-level enforcement (a CHECK can't validate "is this plain English" the way I1's content-classification CHECK could) — a convention-plus-code-review discipline is probably the right fix, not a migration.
- **Next:** ask the founder to (a) decide on the escalation-SLA reconciliation and sign a version at `/admin/settings/escalation-slas`, and (b) pick which (if any) of the three proof_log gaps to close — the dispense-trigger addition is the safest quick win if only one gets picked. Remaining v3 port items: `recorded_by` NOT NULL provenance (architecturally tricky, flagged not scheduled), I6, I7 (not yet audited this session).

### 2026-07-30 — v3 integration, fifth port: all three proof_log gaps closed (explicit ask)
Founder asked to close all three gaps from the entry directly above rather than pick one. Two migrations applied + recorded (`20260730114022_patient_timeline_dispense_event_type` — the enum-add-then-use split, its own transaction — and `20260730114201_patient_timeline_gap_closure`); `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings)/`test` (465) all clean; `get_advisors` (security) shows zero findings referencing `patient_timeline` or any of the new/changed functions.
- **Gap 1 — funder/consent-gated third-party read policy:** `patient_timeline_select` extended with the exact `profile_access` EXISTS clause already used verbatim on `lab_analyte_readings`/`vaccination_records`/`booking_requests` — a grantee (any permission level) now reads a patient's timeline the same way those three tables already allow. **No new UI consumes this yet** — `PatientTimeline` is only ever rendered with the caller's own `profile.id` (patient dashboard) or a clinician's `patientId` route param; a family-member timeline view would be a separate, not-yet-asked-for feature. Closing the gap here is deliberately scoped to the RLS capability, not a new page — flagged so it isn't mistaken for a finished feature.
- **Gap 2 — enforced plain-language guarantee:** moved the humanisation from `patient-timeline.tsx`'s display-time `humaniseSummary()` regex (added 2026-07-21 for one specific analyte-key leak) into `private.record_timeline_event()` itself — the single INSERT choke-point every current and future timeline-writing trigger already calls through. `summary` is now stored clean (`replace(p_summary, '_', ' ')`) at write time, not just rendered clean by one UI component; a **backfill** cleaned every pre-existing row with an underscore in `summary` in the same migration (count logged via `raise notice`, never touches `title`/`metadata`/any other field, purely cosmetic — no historical fact changes). The client-side `humaniseSummary()` is kept as a harmless belt-and-braces second pass (its comment updated to say so) rather than removed, in case some future path ever bypasses the shared writer. **Audited all 9 existing trigger functions' summary-generation lines for other raw-value leaks** (specialist_type/care_plan_status enum interpolation, etc.) — found none beyond the already-known analyte-key case, and the two enum values that could theoretically leak (`ob_gyn`, no multi-word `care_plan_status` value exists) are now moot regardless since the write-time strip covers them structurally.
- **Gap 3 — missing dispense-event coverage:** `timeline_event_type` gains `'medication_dispensed'` (its own migration, per the enum-add-then-use split) + `private.timeline_from_pharmacy_dispense()` (`AFTER INSERT` on `pharmacy_order_dispenses`, same shape as every sibling trigger in `patient_timeline`'s original migration) — a patient collecting their dispensed medication now appears on their own timeline ("Medication collected · {drug} · {quantity}"). Attribution null-gated via the existing `timeline_staff_from_profile()` helper (a patient self-logging their own collection correctly gets no false "reviewed by" attribution). `database.types.ts` hand-patched (new enum member in both `Enums` and `CompositeTypes`-adjacent literal-union locations) rather than a full regen, same drift-avoidance convention as every prior entry.
- **Verified live, 4 cases in one rolled-back transaction** (`packages/db/tests/patient_timeline_gap_closure.sql`): a raw `total_cholesterol`-style summary passed through `record_timeline_event` is stored already-clean; a real `pharmacy_order_dispenses` insert produces the expected `medication_dispensed` row; a `profile_access` grantee reads the owner's timeline; a stranger with no grant reads zero rows. All 4 passed as designed; the migration's own assertion block (policy references `profile_access`, zero rows still contain a raw underscore, the new trigger is attached) also passed.
- **Next:** none blocking on this thread. Remaining v3 port items unchanged: `recorded_by` NOT NULL provenance (architecturally tricky, flagged not scheduled), I6, I7 (not yet audited).

### 2026-07-30 — v3 integration, sixth port: provenance hardening (SET NULL → RESTRICT), explicit ask
Founder asked to close this out too rather than leave it flagged. Migration `20260730120000_provenance_fk_hardening.sql` applied and recorded (**via the Supabase CLI `db query --linked`, not `apply_migration`** — the Supabase MCP server returned `net::ERR_FAILED` on every call this session; see `reference_supabase_cli_sql_access.md` for the fallback recipe, which also covers wrapping the DDL + a `supabase_migrations.schema_migrations` insert in one transaction so it's recorded exactly as `apply_migration` would have). `pnpm --filter web typecheck`/`lint` (0 errors, same 2 pre-existing warnings)/`test` (465) unaffected (pure schema change, no TS touched); `get_advisors` (security, via `db advisors --linked`) shows no finding referencing this change.
- **The investigation, done before writing anything:** grepped the whole codebase for any path that hard-deletes a `public.profiles` or `public.clinical_staff` row — raw SQL `DELETE`, `auth.admin.deleteUser`, anything. Found **none**. Clinician deactivation is done via `clinical_staff.active = false` everywhere (the nightly activation guard, indemnity exemptions, the whole Clinical Tier Ladder lifecycle); there is no account-deletion feature on the platform at all, not even a stub.
- **Why "make it NOT NULL" — the literal phrase this item was flagged under — would have been the WRONG fix:** a live query found **85** attribution FKs (`reviewed_by`/`recorded_by`/`acknowledged_by`/`assigned_clinician_id`/`overridden_by`/etc. across ~50 tables) referencing `profiles`/`clinical_staff` with `ON DELETE SET NULL`. Most are legitimately null until an action occurs — `escalations.reviewed_by` is null while open, `clinician_alerts.acknowledged_by` is null until acknowledged, `medication_reviews.reviewed_by` is null until reviewed. A blanket `NOT NULL` would break every one of those insert paths for zero safety benefit. The real concern proof_log/v3 care about is narrower and correct: once an attribution IS set, it must never be silently erased by an unrelated later event — exactly what `ON DELETE SET NULL` currently allows and `ON DELETE RESTRICT` prevents. Since no code path ever deletes the referenced row today, converting is a **zero-behaviour-change hardening**, same "tighten, never loosen" reasoning already used for the vaccination schedule and escalation SLA work earlier this session.
- **Applied as one data-driven migration**, not 85 hand-written `ALTER TABLE` statements: a `plpgsql` loop reads `pg_constraint` for every single-column FK with `confdeltype = 'n'` targeting `profiles`/`clinical_staff` and rewrites each to `ON DELETE RESTRICT`, logging every conversion via `raise notice`. Lower error surface than hand-enumeration, and inherently covers every such FK rather than whatever subset a manual grep happens to catch (confirmed zero multi-column FKs among them, so the single-column assumption is safe). Post-migration count: 0 remaining `SET NULL` (was 85), `RESTRICT`-family count 5→90, exactly matching.
- **Verified live, 2 cases in one rolled-back transaction** (`packages/db/tests/provenance_fk_hardening.sql`): a real `clinical_staff` row referenced via `patient_timeline.actor_clinical_staff_id` (through the shared `record_timeline_event()` writer) — attempting to hard-delete it now raises `foreign_key_violation` instead of silently succeeding and nulling the reference, and the attribution is confirmed intact afterward; separately, a null-attribution write (no actor at write time) still succeeds fine, proving the legitimately-null-until-actioned lifecycle is completely unaffected. Both passed as designed.
- **Next:** none blocking. Remaining v3 port items: I6, I7 (not yet audited this session). The MCP outage that forced the CLI fallback for this entry should be re-checked next session — if it's still down, the CLI recipe in `reference_supabase_cli_sql_access.md` is the working path.

**Founder decision, same session — escalation SLA reconciliation: keep pathway-specific, do not collapse to one number per tier.** Presented both options (reconcile to the fastest value per tier vs. sign the pathway-specific v1 as-is); founder confirmed the differing SLAs are legitimate clinical differentiation — a routine abnormal screening result reasonably carries a slower SLA than a red-flagged home BP reading or a positive self-harm screen, not an inconsistency to fix. `escalation_slas` v1's `notes` field updated (direct `UPDATE`, no migration needed — data only) to record this and remove the "flag for Director review" language now that the review has happened. **Still not signed** — that needs a real authenticated Clinical Director click at `/admin/settings/escalation-slas`; this was never simulated, per the same discipline as every other forge-proof sign-off in this codebase.

### 2026-07-30 — v3 integration, closing item: I6 and I7 require no build
Checked both against the current codebase rather than leaving them as an open "not yet audited" line.
Neither needed new code — both were already resolved and already documented as comments in
`packages/db/tests/i1_i10_invariants_platform.sql` from the 2026-07-29 invariant-suite port; this just
closes the loop on the CLAUDE.md side.
- **I6** (escalation counts never compensation-reachable) — vacuously true. Confirmed no code path
  anywhere on the platform ties clinician pay/compensation to escalation or `clinician_alerts` counts.
  There is nothing to build; a DB-level check would be testing the absence of a feature that doesn't
  exist, which this codebase's own "a fake pass is worse than no test" discipline correctly declines to
  fake.
- **I7** (export always available regardless of subscription) — already correct, by absence of a gate.
  `apps/web/src/app/api/patient/health-passport/pdf/route.ts` has no `requireEntitlement`/
  `has_feature_access` call anywhere in it — Health Passport export is reachable by every patient on
  every plan, matching the invariant exactly. Contrast with `quarterly-report/pdf/route.ts`, which
  correctly DOES gate on `has_feature_access('quarterly_report')` — that's a genuinely paid,
  tier-specific report, not the same "always-available export" I7 protects. This is an app-layer
  absence-of-gate fact, not something a DB migration can assert; if a future change ever adds an
  entitlement check to the health-passport route, that is the moment to re-open this invariant, not
  before.
- **v3 port status:** all "PORT IT IN" items from the pivot-reversal banner are now closed except
  `recorded_by` NOT NULL provenance (deliberately not built — see the provenance-hardening entry above
  for why `ON DELETE RESTRICT` was the correct fix instead of a blanket `NOT NULL`, which would have
  broken every legitimately-null-until-actioned attribution column on the platform).
