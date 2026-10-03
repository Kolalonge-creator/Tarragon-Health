# Tarragonhealth worktree inventory

Generated 2026-10-03 23:08. Read-only snapshot; nothing was merged, moved or deleted.
Base for comparison: `origin/main-dev`. **Unmerged** = commits whose patch is not already in base (`git cherry`), so squash/rebase-merged work is not counted as unmerged.

| Worktree | Branch | Unmerged | Dirty files | On remote | Last commit | Recommendation |
|---|---|---|---|---|---|---|
| Tarragonhealth | test/browser-e2e-b2c-and-employer-eligibility | 3 | 67 | yes | 2026-09-24 Fix stale comment on PromoCodeOrderType | Main checkout: review dirty files first |
| Tarragonhealth-v1 | feat/design-phase2-batch3 | 2 | 0 | yes | 2026-10-03 Review fix: readable danger-symptom header in Dark | Unmerged but pushed: merge or open PR, then remove |
| mystifying-booth-c1341f | (detached ed6e106f) | 3 | 0 | no | 2026-09-30 Merge fix/patient-facing-doctor-credibility: doctor-attribu | **Unmerged and not pushed**: push or merge before removing |
| mystifying-gates-2e835e | claude/mystifying-gates-2e835e | 1 | 0 | yes | 2026-09-17 Gate HealthKit/Health Connect permission requests to the in | Unmerged but pushed: merge or open PR, then remove |
| quirky-shirley-548671 | claude/quirky-shirley-548671 | 1 | 0 | yes | 2026-09-13 Merge remote-tracking branch 'origin/main-dev' into claude/ | Unmerged but pushed: merge or open PR, then remove |
| s07-today-bp-trends | feat/s07-today-bp-logging-trends-reminders | 2 | 0 | yes | 2026-10-03 S07: record founder decisions OQ-65 to OQ-68 | Unmerged but pushed: merge or open PR, then remove |

## Dirty worktrees (uncommitted files)

### Tarragonhealth
```
 M apps/mobile/src/lib/ai-coach.ts
 M apps/mobile/src/screens/sections/wellbeing-screen.tsx
 M apps/web/src/app/(dashboard)/admin/page.tsx
 M apps/web/src/app/(dashboard)/admin/settings/ai-governance/actions.ts
 M apps/web/src/app/(dashboard)/admin/settings/ai-governance/ai-governance-console.tsx
 M apps/web/src/app/(dashboard)/admin/settings/clinical-staff/clinical-staff-manager.tsx
 M apps/web/src/app/(dashboard)/admin/settings/resources/resources-manager.tsx
M  apps/web/src/app/(dashboard)/clinician/verified-documents/page.tsx
 M apps/web/src/app/(dashboard)/layout.tsx
M  apps/web/src/app/(dashboard)/patient/(sections)/care/page.tsx
 M apps/web/src/app/(dashboard)/patient/ai-coach-chat.tsx
 M apps/web/src/app/(dashboard)/patient/ask-a-doctor.tsx
M  apps/web/src/app/(dashboard)/patient/chronic-programme-actions.ts
M  apps/web/src/app/(dashboard)/patient/chronic-programme-timeline.tsx
 M apps/web/src/app/(dashboard)/patient/mental-health-form.tsx
M  apps/web/src/app/(dashboard)/patient/messages-flow.tsx
 M apps/web/src/app/(dashboard)/patient/second-opinion-request.tsx
MM apps/web/src/app/(dashboard)/patient/senior-case-review-card.tsx
M  apps/web/src/app/(dashboard)/patient/sexual-health/sexual-health-hub.tsx
M  apps/web/src/app/(dashboard)/patient/verified-documents-card.tsx
 M apps/web/src/app/(dashboard)/patient/womens-health-actions.ts
 M apps/web/src/app/(marketing)/_components/emergency-notice.tsx
 M apps/web/src/app/(marketing)/_components/marketing-footer.tsx
 M apps/web/src/app/(marketing)/_components/mental-health-support-notice.tsx
 M apps/web/src/app/(marketing)/_components/phone-mockup.tsx
 M apps/web/src/app/(marketing)/_components/trust-band.tsx
M  apps/web/src/app/(marketing)/_content/pricing.ts
 M apps/web/src/app/(marketing)/accessibility/page.tsx
 M apps/web/src/app/(marketing)/accountability/page.tsx
 M apps/web/src/app/(marketing)/annual-health-check/page.tsx
M  apps/web/src/app/(marketing)/for-you/page.tsx
M  apps/web/src/app/(marketing)/gift/page.tsx
M  apps/web/src/app/(marketing)/monitoring/page.tsx
 M apps/web/src/components/care-message-thread.tsx
M  apps/web/src/components/monitoring-cover-card.tsx
 M apps/web/src/components/patient-timeline.tsx
 M apps/web/src/components/reviewed-by-doctor.tsx
 M apps/web/src/components/reviewed-result-line.tsx
 M apps/web/src/components/shell/app-shell.tsx
 M apps/web/src/components/your-care-team.tsx
```

## Unmerged commits per worktree

### Tarragonhealth
- 406582623d6937a5e812685a31497b046ecd7baf Add registered address to marketing footer and Organization
- b98d4b77c3b9bad0e9abf51af05bf3c3aa851870 Fix stale lab-billing marketing copy, add Synlab trust mess
- f3b91fb53b88e7a29f0e5aac3f9a212348e069aa Fix repeated "trust" wording in labs page Synlab copy

### Tarragonhealth-v1
- af56e6fd9d4bdf73bff4650fa68d6540c8647114 Design Phase 2, batch 3: Prevention, Lab orders and Symptom
- 37f648a43c592c337ecfde420e4c0baaa06d3836 Review fix: readable danger-symptom header in Dark

### mystifying-booth-c1341f
- 13cf0cce9373dd02a109c567319d4a159a9bb3a7 Stop showing patients a doctor's MDCN/NMCN credential numbe
- 990add59df798027c09733b1a2933e52703e61b9 Consolidate the doctor-attribution select/type duplication
- f95f8e57a788978952722e835f74e79667fbe931 Migrate curbside-consults.ts onto the shared doctor-attribu

### mystifying-gates-2e835e
- 6b55ca44e253219aaf6bf4e3c428b19c7cf4608e Gate HealthKit/Health Connect permission requests to the in

### quirky-shirley-548671
- 09b6c8353ded2edd20bc6df8b5262e01b715ba96 Bring cancer-screening guidance to native Prevention screen

### s07-today-bp-trends
- 7d1c84629feb4f68a7397e97313e39435042b4a6 S07: research note, design note and open questions OQ-65 to
- c8fe0928ebd5814b694890b7977d2707a320c7b3 S07: record founder decisions OQ-65 to OQ-68

## Local branches with no worktree
Total local branches: 534; with worktree: 6.
Branches holding unmerged, unpushed commits (no worktree):
- `check-332` (1 unmerged)
- `chore/soft-supabase-ci-check` (1 unmerged)
- `claude/fix-anon-execute-care-access-emergency-fns` (1 unmerged)
- `claude/lab-result-ai-summary-followup` (1 unmerged)
- `claude/relaxed-jang-666b76` (1 unmerged)
- `claude/vibrant-pasteur-35f953` (1 unmerged)
- `copy/american-spelling-sweep` (2 unmerged)
- `diag/438-default-priv-investigation` (4 unmerged)
- `diag/default-priv-ci-scratch` (7 unmerged)
- `diag/s01d-e2e-404` (1 unmerged)
- `diag2/438-fresh` (2 unmerged)
- `feat/lab-location-reviews` (2 unmerged)
- `feature/ai-coach-tool-loop-fix-and-safety-eval` (1 unmerged)
- `fix/clean-replay-health-education-feed` (5 unmerged)
- `fix/onboarding-signup-risk-assessment-ux-audit` (3 unmerged)
- `fix/subscription-page-pay-per-service-copy-and-currency` (2 unmerged)
- `fix2/438-real-fix` (1 unmerged)
- `launch-scope-719-continued` (6 unmerged)
- `merge-341-check` (1 unmerged)
- `phase4-credit-gated-mobile-20260918` (4 unmerged)
- `phase5-other-mobile-flows-20260918` (4 unmerged)
- `phase6-native-pharmacy-20260918` (4 unmerged)
- `phase7-native-video-visit-20260918` (4 unmerged)
- `platform-credit-integration-20260918` (8 unmerged)
- `pr472-merge` (2 unmerged)
- `pr472-merge2` (2 unmerged)
- `pr472-review` (2 unmerged)
- `pr479-local` (3 unmerged)
- `pr479-review` (5 unmerged)
- `pr564-rebase` (1 unmerged)
- `pr769-fix` (3 unmerged)
- `pr795-merge-work` (3 unmerged)
- `reconcile-429` (1 unmerged)
- `resolve-309` (1 unmerged)
- `resolve-311` (7 unmerged)
- `resolve-312` (3 unmerged)
- `resolve-314` (6 unmerged)
- `resolve-320` (3 unmerged)
- `resolve-322` (2 unmerged)
- `resolve-334-v2` (1 unmerged)
- `resolve-335` (3 unmerged)
- `resolve-337` (1 unmerged)
- `resolve-338` (5 unmerged)
- `resolve-340` (4 unmerged)
- `resolve-344` (8 unmerged)
- `resolve-347-v2` (4 unmerged)
- `resolve-348-v2` (2 unmerged)
- `resolve-350` (2 unmerged)
- `resolve-369` (1 unmerged)
- `resolve-383` (1 unmerged)
- `resolve-390` (1 unmerged)
- `resolve-392` (3 unmerged)
- `resolve-395` (1 unmerged)
- `resolve-400` (5 unmerged)
- `resolve-417` (1 unmerged)
- `resolve-429` (1 unmerged)
- `tmp/diag-combined-438` (8 unmerged)
- `worktree-agent-a4ae8bda33010d706` (2 unmerged)
- `worktree-agent-a531a1247234db4ac` (1 unmerged)
- `worktree-agent-a76e63b1d9cd6a911` (1 unmerged)
- `worktree-agent-a7f848003772cd33c` (1 unmerged)
- `worktree-diet-sodium-budget` (1 unmerged)
- `worktree-fix-ai-coach-governance-e2e` (5 unmerged)
- `worktree-fix-ai-version-auto-retire` (2 unmerged)
- `worktree-since-last-visit-card` (6 unmerged)
