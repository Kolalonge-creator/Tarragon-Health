import { Field, fieldClass, Hidden, SubmitButton } from "@/components/credentialing/shared";
import { declareConflict } from "@/lib/rota/actions";

/**
 * "I know this patient personally": a clinician declares a conflict of interest from the patient's own page. They will not be
 * offered this patient's work and will not lead their care; the Chief Medical Officer reviews it. Shown to clinicians only.
 */
export function DeclareConflictForm({ patientId }: { patientId: string }) {
  return (
    <details className="rounded-lg border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card">
      <summary className="cursor-pointer font-medium">I know this patient personally</summary>
      <form action={declareConflict} className="mt-3 flex flex-wrap items-end gap-3">
        <Hidden name="returnTo" value={`/clinician/patients/${patientId}`} />
        <Hidden name="patientId" value={patientId} />
        <Field label="Relationship" hint="For example a family member, a friend, a neighbour.">
          <input name="reason" required minLength={3} maxLength={200} className={fieldClass} />
        </Field>
        <SubmitButton tone="outline">Declare a conflict</SubmitButton>
      </form>
    </details>
  );
}
