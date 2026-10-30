import { PREGNANCY_UNKNOWN_MESSAGE } from "@/lib/clinical/pregnancy-status";

/** Shown wherever a medicine or dose depends on pregnancy and the status could not be read (OQ-555 follow-up). It is never hidden when status is unknown. */
export function PregnancyUnknownNotice() {
  return (
    <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
      {PREGNANCY_UNKNOWN_MESSAGE}
    </p>
  );
}
