"use client";

import { useState } from "react";
import { useDisputePrescriptionSupply } from "@/lib/queries/medications";
import { formatPatientDate } from "@/lib/format-date";

/**
 * The patient's side of a clinician prescription: the identifiers a pharmacist asks for, and the PDF to take
 * to one (docs/PRESCRIPTION_PDF_SCOPE.md). The Rx number and verification code are shown here in clear text
 * because until this card existed no screen showed the code to anyone.
 *
 * Shown only for a clinician-prescribed, current prescription. The route enforces the same rules (and refuses
 * a superseded, stopped or expired one), so this never offers a button that would only fail for those cases.
 * The "not a controlled medicine" line is the founder's wording (2026-10-01): TarragonHealth does not
 * prescribe controlled medicines, and patients should be told.
 */
export interface RecordedSupply {
  id: string;
  dispensed_on: string;
  pharmacy_name: string | null;
  pharmacist_name: string | null;
  pharmacist_registration: string | null;
  pharmacist_registration_verified: boolean;
  disputed_at: string | null;
}

function SupplyLine({ supply, patientId }: { supply: RecordedSupply; patientId: string }) {
  const dispute = useDisputePrescriptionSupply(patientId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="space-y-1">
      <span>
        Supplied {formatPatientDate(supply.dispensed_on)}
        {supply.pharmacy_name ? ` by ${supply.pharmacy_name}` : ""}
        {supply.pharmacist_name ? `, pharmacist ${supply.pharmacist_name}` : ""}
        {supply.pharmacist_registration
          ? ` (registration ${supply.pharmacist_registration}${supply.pharmacist_registration_verified ? "" : ", not checked"})`
          : ""}
      </span>
      {supply.disputed_at ? (
        <span className="ml-2 text-amber-700 dark:text-amber-300">You reported this as not supplied</span>
      ) : open ? (
        <span className="mt-1 block space-y-1">
          <input
            aria-label="What was wrong (optional)"
            placeholder="What was wrong? (optional)"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded border border-charcoal-ink/20 px-2 py-1"
          />
          <button
            type="button"
            disabled={dispute.isPending}
            onClick={() => dispute.mutate({ dispenseId: supply.id, note }, { onSuccess: () => setOpen(false) })}
            className="rounded border border-red-600 px-2 py-1 font-medium text-red-700 dark:text-red-300"
          >
            {dispute.isPending ? "Sending…" : "Report this supply"}
          </button>
          {dispute.isError && <span className="block text-red-600">{(dispute.error as Error).message}</span>}
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="ml-2 underline text-charcoal-ink/60 dark:text-night-ink/60">
          This wasn&apos;t me
        </button>
      )}
    </li>
  );
}

export function PrescriptionDownload({
  medicationId,
  rxNumber,
  verificationCode,
  expiresAt,
  supplies,
  patientId,
  prescriptionId,
}: {
  medicationId: string;
  rxNumber: string | null;
  verificationCode: string | null;
  expiresAt: string | null;
  /** Supplies a pharmacy has recorded against this prescription (source 'pharmacy'), newest first. */
  supplies: RecordedSupply[];
  patientId: string;
  /** The signed prescription row, when there is one: lets the patient choose a verified pharmacy to collect from (S28). */
  prescriptionId?: string | null;
}) {
  if (!rxNumber || !verificationCode) return null;
  const expired = !!expiresAt && new Date(expiresAt).getTime() < new Date().getTime();
  const href = `/api/patient/prescriptions/${medicationId}/pdf`;

  return (
    <div className="mt-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3 text-xs space-y-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          <span className="text-charcoal-ink/50 dark:text-night-ink/55">Rx number </span>
          <span className="font-medium tabular-nums">{rxNumber}</span>
        </span>
        <span>
          <span className="text-charcoal-ink/50 dark:text-night-ink/55">Verification code </span>
          <span className="font-medium tracking-wider tabular-nums">{verificationCode}</span>
        </span>
        {expiresAt && (
          <span className={expired ? "text-red-700 dark:text-red-300" : "text-charcoal-ink/70 dark:text-night-ink/70"}>
            {expired ? "Expired" : "Valid until"} {formatPatientDate(expiresAt)}
          </span>
        )}
      </div>
      {supplies.length > 0 && (
        <ul className="space-y-1.5 text-charcoal-ink/70 dark:text-night-ink/70">
          {supplies.map((supply) => (
            <SupplyLine key={supply.id} supply={supply} patientId={patientId} />
          ))}
        </ul>
      )}
      {expired ? (
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">
          This prescription has expired. Use “Request renewal” to ask your care team for a new one.
        </p>
      ) : (
        <p>
          <a
            href={href}
            className="inline-flex items-center rounded-md border border-brand-green px-3 py-1.5 font-medium text-brand-green hover:bg-brand-green/5 dark:text-brand-green-bright dark:border-brand-green-bright"
          >
            Download prescription (PDF)
          </a>
          {prescriptionId && (
            <a
              href={`/patient/pharmacy/collect/${prescriptionId}`}
              className="ml-2 inline-flex items-center rounded-md border border-clinical-navy px-3 py-1.5 font-medium text-clinical-navy hover:bg-clinical-navy/5 dark:text-night-ink dark:border-night-ink"
            >
              Choose where to collect
            </a>
          )}
        </p>
      )}
      <p className="text-charcoal-ink/50 dark:text-night-ink/55">
        Take this to a pharmacy of your choice. This is not a controlled medicine: TarragonHealth does not prescribe
        controlled medicines.
      </p>
    </div>
  );
}
