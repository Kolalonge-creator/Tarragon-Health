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
