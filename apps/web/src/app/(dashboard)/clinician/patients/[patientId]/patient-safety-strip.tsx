import { provenanceLabel, type AllergyHeaderView } from "@/lib/clinical/allergy-header-view";

/**
 * Patient-record header safety line (doctor workspace spec 11.1, 11.2, 28): age and sex, then allergies with
 * their provenance, visible on every tab. A list that could not be read says so and is never drawn as
 * "no allergies". Severity and provenance are written in words, so colour is never the only signal.
 */
export function PatientSafetyStrip({
  ageSex,
  allergies,
}: {
  ageSex: string | null;
  allergies: AllergyHeaderView;
}) {
  return (
    <section aria-label="Patient safety summary" className="space-y-1 text-sm">
      {ageSex && <p className="text-charcoal-ink/70">{ageSex}</p>}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-charcoal-ink">Allergies:</span>
        <AllergyContent view={allergies} />
      </div>
    </section>
  );
}

function AllergyContent({ view }: { view: AllergyHeaderView }) {
  if (view.kind === "denied") {
    return (
      <span className="text-amber-800">
        Not available to you (you are not on this patient&apos;s care team). Do not treat this as no allergies.
      </span>
    );
  }
  if (view.kind === "error") {
    return <span className="text-amber-800">Could not be loaded. Do not treat this as no allergies; reload the page.</span>;
  }
  if (view.kind === "none") {
    return <span className="text-charcoal-ink/70">None recorded.</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Recorded allergies">
      {view.items.map((a) => (
        <li
          key={a.id}
          className={
            a.provenance === "ruled_out"
              ? "rounded-md border border-charcoal-ink/20 bg-white px-2 py-0.5 text-charcoal-ink/70 line-through decoration-charcoal-ink/40"
              : a.severity === "severe"
              ? "rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-red-900"
              : "rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900"
          }
        >
          <span className="font-semibold">{a.substance}</span>
          {a.severity && <span>, {a.severity}</span>}
          <span className="text-xs opacity-80"> ({provenanceLabel(a.provenance)})</span>
        </li>
      ))}
    </ul>
  );
}
