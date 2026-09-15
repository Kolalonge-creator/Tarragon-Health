# Family ("Your people") — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes.
> **Also read `apps/mobile/src/screens/sections/supporting-screen.tsx` +
> `apps/mobile/src/lib/acting.ts` in full before anything else** — Family
> shares the same underlying `profile_access` table from the opposite
> direction, and this doc's reconciliation section below depends on you
> having read both first. Section id for this feature: `family`.
>
> This is the largest remaining section (~3,500 web lines). Budget
> accordingly — likely 3-4x the effort of weight-management.

## Summary

`/patient/family` is the patient's consent-and-relationships hub for
everything outside their own body: who Tarragon calls in an emergency
(next of kin / emergency contact), who else is allowed to see or act on
the patient's own record (view/manage grants, category-scoped clinical
visibility, temporary/emergency access), children and consenting adults
whose records the patient keeps on their behalf (no login of their own),
and the two-sided accept/decline flow that gates every new access grant. It
replaced the old "Family Plan" billing dashboard (killed 2026-07-29) —
nothing on this page is entitlement-gated any more; it is pure
consent-graph management on top of `profile_access`/`care_access_requests`/
`emergency_access_grants`/`profile_access_categories`.

## File inventory

**Page directory** (`apps/web/src/app/(dashboard)/patient/family/`) — 18
files, **2,796 lines**:

| File | Lines |
|---|---|
| `caregiver/page.tsx` | 28 |
| `adults-you-manage-list.tsx` | 51 |
| `emergency-access-banner.tsx` | 55 |
| `dependants-list.tsx` | 65 |
| `add-child-actions.ts` | 98 |
| `matured-dependent-banner.tsx` | 107 |
| `care-access-log.tsx` | 112 |
| `add-child-form.tsx` | 113 |
| `claim-dependent-actions.ts` | 129 |
| `add-elder-actions.ts` | 136 |
| `household-overview.tsx` | 136 |
| `add-elder-form.tsx` | 162 |
| `care-access-requests-list.tsx` | 167 |
| `page.tsx` | 186 |
| `next-of-kin-form.tsx` | 198 |
| `care-visibility-list.tsx` | 337 |
| `care-access-actions.ts` | 340 |
| `caregiver/caregiver-request-flow.tsx` | 376 |

**Shared lib files** (load-bearing) — 5 files, **718 lines**:

| File | Lines |
|---|---|
| `apps/web/src/lib/validation/add-child-dependent.ts` | 27 |
| `apps/web/src/lib/validation/elder-proxy-dependent.ts` | 52 |
| `apps/web/src/lib/queries/emergency-access.ts` | 138 |
| `apps/web/src/lib/validation/care-access.ts` | 172 |
| `apps/web/src/lib/queries/care-access.ts` | 329 |

**Total: 23 files, ~3,514 lines.**

## Data model

| Table / RPC | Purpose | R/W | Classification |
|---|---|---|---|
| `profiles.emergency_contact_{name,phone,relationship,consent,consent_at}` | Next-of-kin contact info (read by `private.handle_emergency_event`) | R/W (own row) | **Safe direct client** |
| `find_profile_by_phone(lookup_phone)` RPC | Resolve a phone → same-org patient account, excludes self | R | **Safe direct client** |
| `profile_access` (`profile_id = me`) | Grants over MY record — who follows/manages me | R | **Safe direct client** |
| `profile_access` (`grantee_user_id = me`) | Grants TO me — who I follow/manage | R | **Safe direct client — same query direction `acting.ts`'s `loadPeopleISupport` already uses** |
| `profile_access` DELETE (`id`, `profile_id = auth.uid()`) | Revoke a grant on my own record | W | **Safe direct client** (RLS scoped to owner) |
| `profile_access` UPDATE `permissions`/`expires_at` | Narrow a manage grant / set expiry | W | **Safe direct client** (RLS scoped to owner) |
| `profile_access` INSERT (child/elder provisioning) | Create the manage grant for a newly-provisioned dependent | W | **Needs API route** — bundled inside a service-role flow, never called in isolation |
| `profile_access_categories` via `set_care_access_categories(p_grant_id, p_categories)` RPC | Which of 8 clinical categories a grantee can see | W | **Safe direct client** (RPC self-enforces owner-only via `private.enforce_category_access_owner`) |
| `care_access_requests` SELECT (either side) | Pending accept/decline proposals | R | **Safe direct client** |
| `request_care_access(p_phone, p_permission_level, p_direction, p_relationship, p_permissions, p_expires_at)` RPC | Create a pending next-of-kin ('view') or eldercare ('manage') proposal | W | **Safe direct client** — "runs on the caller's own RLS-scoped client, never service role" |
| `respond_to_care_access_request(p_request_id, p_accept)` RPC | Accept/decline → turns into a real `profile_access` grant | W | **Safe direct client** (SECURITY DEFINER internally, but any authenticated caller may invoke it) |
| `care_access_requests` UPDATE `status='cancelled'` (`initiated_by = me`, `status='pending'`) | Withdraw a request I sent | W | **Safe direct client** (guarded by `private.guard_care_access_request_update` BEFORE UPDATE trigger — don't attempt a wider update shape) |
| `care_access_events` SELECT | Audit log of grant lifecycle events | R | **Safe direct client** |
| `emergency_access_grants` SELECT (`profile_id = me`) | Active emergency grants ON my record | R | **Safe direct client** |
| `emergency_access_grants` SELECT (`profile_id = target`) | Emergency grants I've requested | R | **Safe direct client** |
| `emergency_access_grants` INSERT | Escalate a grant to 24h emergency read access | W | **Safe direct client** (already called directly from a web client hook, no server action wrapper even) |
| `emergency_access_grants` UPDATE `revoked_at`/`revoked_by` | End an active emergency grant | W | **Safe direct client** |
| `auth.admin.createUser` + `provision_dependent_profile_basics` RPC + `profile_access` INSERT + vaccination-schedule generation (`addChildDependentAction`) | Provision a login-less **child** dependent | W | **Needs API route — service role**, wraps `add-child-actions.ts` verbatim |
| `auth.admin.createUser` + `provision_dependent_profile_basics(..., p_dependent_kind='elder_proxy')` + `profile_access` INSERT + emergency-contact write + `audit_log` INSERT (`addElderProxyDependentAction`) | Provision a login-less **consenting adult** dependent | W | **Needs API route — service role**, wraps `add-elder-actions.ts` verbatim |
| `auth.admin.updateUserById` (attach real phone) + `profiles` UPDATE (`is_dependent_account=false`) + `notifications` INSERT + `audit_log` INSERT (`claimDependentAccountAction`) | Convert a matured (18+) child dependent into their own login | W | **Needs API route — service role**, wraps `claim-dependent-actions.ts` verbatim |
| `useHouseholdCareCircle` + `useSupportedPersonHealth` + `useVaccinationSchedules` | "Family health" rollup card | R | **Safe direct client**, but purely a rollup of data already visible elsewhere natively — low value, recommend deferring |

## Recommended new API routes

Only three actions touch a service-role client or `auth.admin.*`:

1. **`POST /api/mobile/family/add-child`** — thin wrapper around
   `addChildDependentAction`. Cannot be direct: creates a synthetic
   `auth.users` row via `auth.admin.createUser`, then a service-role
   `profile_access` insert.
2. **`POST /api/mobile/family/add-elder-proxy`** — thin wrapper around
   `addElderProxyDependentAction`. Same reason, plus writes an `audit_log`
   consent-attestation row that must not be reimplemented client-side.
3. **`POST /api/mobile/family/claim-dependent`** — thin wrapper around
   `claimDependentAccountAction`. Uses `auth.admin.updateUserById` to
   attach a real phone to an existing synthetic auth user.

All three: `createBearerClient(accessToken)` → `supabase.auth.getUser(accessToken)`
for identity, then call the *exact same* server action function (or inline
its logic verbatim), same pattern as
`apps/web/src/app/api/mobile/vitals/route.ts`.

**Everything else** — next-of-kin nomination, eldercare request creation,
accept/decline, cancel, revoke, category toggles, emergency access
request/revoke — is safe to call directly from the mobile RLS-scoped
client and needs no new route, even though several are currently written
as `"use server"` actions on web (they're server actions purely for web's
own Next.js conventions, no service-role calls inside). Mirror their
orchestration logic (phone lookup → dedup checks → RPC call → friendly
message) in a new mobile lib file instead of duplicating a route.

## Recommended mobile files

**Lib files:**
- `apps/mobile/src/lib/family-consent.ts` — next-of-kin nominate/revoke,
  emergency-access-banner read/revoke, care-access-requests
  read/respond/cancel, care-visibility read/set-categories. Mirrors
  `care-access-actions.ts` + `emergency-access.ts` + `care-access.ts`'s
  `useMyCareFollowers`/`useSetCareAccessCategories` query-direction logic
  (`profile_id = me`).
- `apps/mobile/src/lib/family-dependents.ts` — children/adults-I-manage
  lists (extends `acting.ts`'s `loadPeopleISupport` query shape with
  `dependent_kind`, `date_of_birth`, `majority_review_at`), plus the three
  new API-route calls (add child, add elder proxy, claim matured
  dependent) via `apps/mobile/src/lib/api.ts`'s `request<T>()`.

**Screen files** — split into a container + tabs given the size:
- `apps/mobile/src/screens/sections/family-screen.tsx` — thin container
  with a segmented control switching between the two tabs below.
- `apps/mobile/src/screens/sections/family-circle-tab.tsx` — next of kin
  card, emergency access banner, pending requests (accept/decline/cancel),
  care visibility category toggles. **Direction: who can see/act on MY
  record.**
- `apps/mobile/src/screens/sections/family-people-tab.tsx` — children you
  look after, adults you manage (read-only display, "open their account"
  links out to the existing `supporting` section rather than
  re-implementing the switch), add-child form, add-elder-proxy form,
  matured-dependent claim banner. **Direction: who I can see/act on.**

**Build order** (highest-value + simplest first, all zero-service-role
work before any service-role work):
1. Next-of-kin card + emergency access banner (view/revoke) — smallest,
   safety-critical, purely direct-client reads/writes on `profiles` and
   `emergency_access_grants`.
2. Care access requests (accept/decline/cancel) — moderate size,
   safety-adjacent (the gate every new grant passes through), all via
   existing RPCs.
3. Care visibility list (category toggles only — defer the granular-
   permission/expiry sub-editor to a later pass or WebView).
4. Children-you-manage/adults-you-manage read-only lists, reusing/
   extending the `acting.ts` query.
5. Add-child/add-elder-proxy provisioning forms + matured-dependent claim
   — last, since these are the only pieces needing new API routes and
   touch account creation for a minor or a non-consenting-in-person adult.

## Wiring

- `sections.ts`: `family` entry already exists — remove `webviewPath`.
- `home-shell.tsx`: add import + `{section === "family" && <FamilyScreen
  userId={userId} organisationId={organisationId} onNavigate={handleSelect} />}`.

## Reconciliation with `supporting-screen.tsx` / `acting.ts`

**They are genuinely different directions on the same underlying table,
and Family conflates both on one web page — a fresh mobile build should
not.**

- `supporting-screen.tsx`/`acting.ts`'s `loadPeopleISupport` queries
  `profile_access` filtered on **`grantee_user_id = me`** — profiles
  *granted to* the signed-in user. This is exactly the same query
  direction as `care-access.ts`'s `profilesGrantedTo()`, which backs
  **`DependantsList`** ("children you look after") and
  **`AdultsYouManageList`** ("people whose care you manage") on the Family
  page. **These two Family cards are not a new relationship — they are the
  same `profile_access(grantee_user_id=me)` data `supporting-screen.tsx`
  already renders**, just split by `dependent_kind` and enriched with
  `date_of_birth`/`majority_review_at`.
- The genuinely new, complementary half of Family is the **inverse**
  direction: `profile_access` filtered on **`profile_id = me`** (who can
  see/act on *my own* record) — `NextOfKinForm`, `CareVisibilityList`,
  `EmergencyAccessBanner`, and the "waiting on them" half of
  `CareAccessRequestsList`. Nothing native today reads this direction.
- `care_access_requests` and its accept/decline flow sit across both
  directions at once and is also entirely new — `supporting-screen.tsx`
  only shows *already-accepted* grants, never a pending proposal.

**Recommendation:** do not re-implement a second "switch into their
account" mechanism inside Family. The children/adults lists in
`family-people-tab.tsx` should be read-only display + provisioning entry
points; for existing `manage`-level rows that already support acting-for,
link out via `onNavigate('supporting')` to the one real switch mechanism
rather than duplicating `startActingFor`/`SecureStore` logic. Family's real
native surface area is the `profile_id = me` direction plus the request
accept/decline flow plus dependent provisioning — that's the ~70% of this
task not already covered elsewhere.

## Safety flags

- **Minors:** `addChildDependentAction` creates a full synthetic
  `auth.users` row (`is_dependent_account=true`,
  `dependent_kind='minor_child'`) with no way to log in.
  `private.sweep_dependent_majority_review` flags it at 18; a separate cron
  independently steps `manage`→`view` the same day. `claimDependentAccountAction`
  is the only path that attaches a real phone and flips
  `is_dependent_account=false` — go through the API route verbatim; don't
  reimplement the phone-attach/flag-flip sequence client-side, and don't
  skip the "hasn't been flagged for majority review yet" guard.
- **Elder proxy consent:** `addElderProxyDependentAction`'s
  `confirmed_consent` checkbox is a required, explicitly-validated
  attestation logged to `audit_log` — keep this as a hard requirement, not
  a soft hint, and preserve the phone-lookup refusal (an existing account
  on that number must route to the eldercare-accept flow instead, never
  silently overwritten).
- **Emergency contact accuracy:** `profiles.emergency_contact_*` is read
  directly by `private.handle_emergency_event`/
  `private.notify_unacknowledged_emergencies` — treat this write path as
  safety-critical, keep the E.164 regex validation identical to web's, and
  preserve the "contactability is always recorded even with no Tarragon
  account" vs "visibility requires accept" split described in
  `care-access-actions.ts`'s header comment.
- **`request_care_access` takes a phone number, never a profile id** —
  `private.guard_care_access_request_insert` refuses a direct profile-id
  insert; always resolve via `find_profile_by_phone` first, exactly like
  web.
- **`reproductive_health`** must stay its own separate, never-bundled-with-
  "select all" toggle in the native `CareVisibilityList` port, per
  CLAUDE.md's standing rule on this access category.
- **`care_access_requests` UPDATE is trigger-guarded**
  (`private.guard_care_access_request_update`) to only allow
  `status`/`responded_by`/`responded_at`/`updated_at` to change — don't
  build a native mutation attempting a wider update shape.

## Stay WebView / link-out (recommended first-pass scope cut)

Given the size, recommend porting natively **only**: next-of-kin +
emergency access banner, care-access-requests accept/decline/cancel, and
the care-visibility category toggles (~560 lines of web source). Keep as
WebView for now:

- **The full eldercare "manage" request wizard**
  (`caregiver/caregiver-request-flow.tsx`, 376 lines, 4-step stepper) —
  low-frequency, form-heavy, exactly the class of feature the mobile spec
  already keeps as WebView elsewhere. Link out via the existing
  `/patient/family/caregiver` WebView path.
- **`AccessScopeEditor`** (the granular-permission + expiry sub-editor
  nested inside `CareVisibilityList`) — secondary refinement of an
  already-native category toggle; low frequency, can stay WebView or be
  added later.
- **`care-access-log.tsx`** (audit trail) — pure low-frequency read; not
  worth native effort in the first pass.
- **`HouseholdOverview`** ("Family health" rollup) — purely re-derives data
  already visible in other now-native sections (vitals, vaccinations,
  screenings); low incremental value for the native-build cost.
- **Add-child/add-elder-proxy/claim-dependent** could also reasonably be
  deferred to a second native pass if the first pass should ship faster —
  they're the only pieces requiring new API routes and touch account
  provisioning, the most sensitive part of this feature.
