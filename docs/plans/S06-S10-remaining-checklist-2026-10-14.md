# S06x to S10x: what is left (2026-10-14)

Code for S06x, S07x, S08x, S09x/S09x2 and S10x is built, merged and applied to production. Every clinical and
privacy-sensitive behaviour below is behind a guard that is **off**. This list is what stands between "merged" and "on".

Written from the build session's records, not re-verified against the live system. Check each item before acting.

## 1. You sign (CMO), at `/clinician/clinical-signoff`

Approved text exists for all eight. None is signed. Re-check the ESH 2023 and AHA/ACC 2025 points against the full texts
before signing C1 to C4 (they rest on search summaries).

| Item | What it switches on | Guard that stays off until signed |
|---|---|---|
| C1 Home BP check protocol v1 | 7-day check, 12-reading minimum | `home_bp_programme` |
| C2 Home BP thresholds | 135/85 and above, borderline 130-134 / 80-84 | `home_bp_programme` |
| C3 White-coat / masked rule | Clinician-only task, never patient-facing | `bp_pattern_flag` |
| C4 Cuff and measurement guidance | Patient content | `home_bp_programme` |
| C5 Asymptomatic low BP | Amber 24-hour review below 90 systolic | S12 band set (not yet built) |
| C6 Adherence trigger | Below 80% for 2 weeks, or 3 missed critical doses | adherence config |
| C7 PRN limits and interaction wording | Clinician-set limits, warn never block | `prn_limits` |
| C8 Lock-screen pass fields | Initials, blood group, genotype, allergies on file, contact phone | `wallet_pass` (also needs counsel, item 3) |

## 2. You decide / confirm

- [ ] Confirm the founder-owned proposed values at `/admin/go-live`: `events.bus_rules`, `offline.trust`,
      `my_health.sharing_and_access_log`.
- [ ] Event bus launch choice. Recommendation: opt in `observation.recorded` and `triage.graded`; no partner mappings
      at launch (0 mappings and 0 ordered event types today).
- [ ] S09x2 open questions OQ-S09x-6 and OQ-S09x-7 (`docs/OPEN-QUESTIONS.md`).
- [ ] Danger-flagged unsent entries are never wiped at lease expiry (refinement of D3). Recommendation: keep.

## 3. Outside parties (nothing the build can do)

- [ ] D9 Counsel: NDPA 2023 basis for the emergency card and the access log. Instruct before the lock-screen pass goes on.
- [ ] D6 Write to NAFDAC for Greenbook terms (medicine catalogue). Fallback: hand-curated top Nigerian brands.
      Interaction rules need CMO plus pharmacist signature before the checker is on.
- [ ] D8 Supply two Android floor phones and one iPhone.

## 4. Needs a real device (cannot be proven in CI)

- [ ] `eas build` for the native binary (encrypted local database, NetInfo, remote wipe, wallet pass).
- [ ] On the phones: copy-verify-delete migration of the existing database, forced sign-out keeps drafts, remote wipe
      with the 30-day lease, lock-screen pass off by default.
- [ ] Background sync (`expo-background-task`) cannot be exercised in the iOS Simulator.

## 5. Small engineering follow-ups

- [ ] Add guard keys `research_export_enabled` and `symptom_checker_enabled` to `apps/web/src/lib/go-live/constants.ts`
      (`GUARD_KEYS`); the hub does not list them yet.
- [ ] S09x2: a signed config row versus actual behaviour (the log cutoff is data, not signed); role labels are held in SQL.
- [ ] Migration `20261013214207` (`s05b_corrected_by_fk_indexes`) is live but committed nowhere. Another session owns it.
- [ ] Other workflows that call `supabase db query --linked` can still race Release Integrity for the CLI login role
      (#1128 only serialises its own jobs).
- [ ] `hmo-eligibility` and `price-quote` edge functions were deployed 2026-10-14 and have not been called live.

## 6. Release Integrity state (2026-10-14)

- Edge function drift: green after #1119, #1127 and the redeploys.
- Database jobs (anon execute, migration drift, under-18 guard): failing on a login-role race; fix is PR #1128, waiting
  on its checks.
