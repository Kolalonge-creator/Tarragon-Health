# Founder decisions (recorded 2026-09-30)

These settle the conflicts between the v5 spec and the live platform. Every session inherits them. S01 copies them into `docs/DECISIONS.md`.

1. **Platform Credit is removed.** Patients pay per service at checkout, with no stored balance (v5 INV-09 stands). Reason: avoid stored-value regulation. Removal is its own session (S01b).
2. **WhatsApp is removed.** In-app, push and email only; SMS stays for verification codes. Removal is its own session (S01c).
3. **Clinician model is hybrid.** Freelance verified clinicians (v5 credentialing, Next-task queue, per-task fees, on-call) work **alongside** Tarragon-employed doctors. Do not delete the employed-doctor tiers or auto-assignment. Both feed the same task queue and paging. Employed doctors are paid by salary, not per-task fees; `employment_type` (employed / freelance) decides which earnings path applies. Sessions S15-S20, S30, S31 and S76-S78 must support both.
4. **App layout: split the staff console out (long-term choice).** `apps/web` keeps marketing and the patient web dashboard. A new `apps/console` (Next.js, staff only: clinician, ops, clinical lead, admin, partner areas) is extracted from it in session S01d, on its own domain with stricter security headers. `apps/mobile` keeps its name (no rename to `apps/patient`). Shared code (Supabase clients, auth helpers, UI, types) moves into `packages/`. All new console work in S35, S36 and S76-S78 is built in `apps/console`.
