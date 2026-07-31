import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * States, at the point where somebody is deciding whether to book an HIV,
 * hepatitis or cervical screening, what actually happens to the result.
 *
 * Every claim here is enforced somewhere real, not a reassurance we wrote:
 *
 *  - "never sent to you over WhatsApp, SMS or email" — sensitive screen_types
 *    (hiv, hep_b, hep_c, cervical_smear, mammography, psa, fit, colonoscopy,
 *    clinical_breast_exam) set `sensitive` on the result, and
 *    supabase/functions/abnormal-result-handler explicitly suppresses the
 *    patient message for those: the news is delivered by a doctor, never by a
 *    template. See migration 20260719140000_sensitive_result_gating.
 *  - "no clinical detail ever leaves on those channels" — invariant I1 is a
 *    database CHECK (notifications_no_clinical_on_open_rail), so a
 *    content_class='clinical' row physically cannot be queued to whatsapp,
 *    sms or email. It is not a convention anybody can forget.
 *  - "the result still reaches a doctor" — the clinician alert fires before
 *    the suppression branch, so suppressing the message never loses the
 *    result. handle_abnormal_screening_result has no entitlement check either,
 *    so this holds on every plan including Free.
 *
 * If any of those three change, this copy has to change with them. Do not
 * soften it into generic privacy language: the specificity is the point, and
 * it is the reason somebody anxious about testing will go ahead and book.
 */
export function ConfidentialResultNotice({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-md border border-clinical-navy/15 bg-clinical-navy/[0.04] p-3 ${className ?? ""}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-clinical-navy">
        <SEMANTIC_ICON.privacy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        How your result reaches you
      </p>
      <ul className="mt-2 space-y-1 text-xs text-charcoal-ink/75">
        <li>
          A result like this is never sent to you over WhatsApp, SMS or email. A doctor tells
          you, and talks it through with you.
        </li>
        <li>
          Those channels never carry clinical detail at all. Our database refuses to queue it,
          so a reminder can say a result is ready but never what it says.
        </li>
        <li>
          Only you and the doctor reviewing it can see the result. It is not shown to an
          employer or an HMO, even if one pays for your plan.
        </li>
      </ul>
    </div>
  );
}
