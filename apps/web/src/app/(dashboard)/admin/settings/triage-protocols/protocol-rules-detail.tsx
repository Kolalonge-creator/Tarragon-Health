import { Badge } from "@/components/ui/badge";
import { S59D_REVIEW_NOTES, parseTriageProtocolConfig, type RedFlagCondition, type TriageNode } from "@tarragon/symptom-triage-engine";

const CATEGORY_BADGE: Record<string, "red" | "amber" | "blue" | "green" | "grey"> = {
  emergency: "red",
  urgent: "amber",
  routine: "blue",
  self_management: "green",
};

/** A plain-words rendering of a rule's condition, so the reviewer reads exactly what fires it. Every key present must hold. */
export function describeCondition(c: RedFlagCondition): string {
  const parts: string[] = [];
  if (c.onset) parts.push(`onset is ${c.onset}`);
  if (c.minSeverity !== undefined) parts.push(`severity is ${c.minSeverity} or more`);
  if (c.anyAssociatedSymptom) parts.push(`any of these symptoms: ${c.anyAssociatedSymptom.join(", ")}`);
  if (c.allAssociatedSymptoms) parts.push(`all of these symptoms: ${c.allAssociatedSymptoms.join(", ")}`);
  if (c.anyTrigger) parts.push(`any of these triggers: ${c.anyTrigger.join(", ")}`);
  if (c.anyHistory) parts.push(`any of this history: ${c.anyHistory.join(", ")}`);
  if (c.measurementBelow) parts.push(`${c.measurementBelow.key} is ${c.measurementBelow.value} or lower`);
  if (c.measurementAtLeast) parts.push(`${c.measurementAtLeast.key} is ${c.measurementAtLeast.value} or higher`);
  return parts.length > 0 ? parts.join(" AND ") : "always";
}

function nodeLine(n: TriageNode): string {
  if (n.type === "outcome") return `${n.key}: ${n.category}${n.clinicianReviewRequired ? ", a clinician reviews" : ""}. ${n.rationale}`;
  if (n.kind === "boolean") return `${n.key}: "${n.prompt}" yes goes to ${n.onYes}, no goes to ${n.onNo}`;
  return `${n.key}: "${n.prompt}" ${n.options.map((o) => `${o.value} goes to ${o.next}`).join("; ")}`;
}

/**
 * Read-only view of every rule, question, outcome and source of a stored version, so the reviewer reads the whole thing in one
 * place before signing. It changes nothing and signs nothing. Sources and the CMO's questions appear for the S59d pathways.
 */
export function ProtocolRulesDetail({ config }: { config: unknown }) {
  const parsed = parseTriageProtocolConfig(config);
  if (!parsed) {
    return <p className="text-xs text-red-600">This version&apos;s configuration could not be read, so its rules cannot be shown. Do not sign it.</p>;
  }
  return (
    <details className="rounded-md border border-mist-grey/40 p-3">
      <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">Read every rule, question and source in this version</summary>
      <div className="mt-3 space-y-4">
        {parsed.pathways.map((p) => {
          const notes = S59D_REVIEW_NOTES[p.key];
          return (
            <section key={p.key} className="space-y-2">
              <h3 className="text-sm font-semibold text-charcoal-ink">
                {p.label} <span className="font-mono text-xs font-normal text-charcoal-ink/50">{p.key}</span>
              </h3>
              <p className="text-xs font-medium text-charcoal-ink/70">Red-flag rules (checked first, final when one fires)</p>
              <ul className="space-y-1">
                {p.redFlagScreen.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-start gap-2 text-xs">
                    <Badge variant={CATEGORY_BADGE[r.category] ?? "grey"}>{r.category}</Badge>
                    <span className="text-charcoal-ink/80">
                      {r.label}. <span className="text-charcoal-ink/60">Fires when {describeCondition(r.rule)}.</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-medium text-charcoal-ink/70">Questions and outcomes (starts at {p.startNodeKey})</p>
              <ul className="space-y-1">
                {Object.values(p.nodes).map((n) => (
                  <li key={n.key} className="text-xs text-charcoal-ink/70">
                    {nodeLine(n)}
                  </li>
                ))}
                <li className="text-xs text-charcoal-ink/70">If the questions reach a dead end: {p.fallbackOutcome.category}, a clinician reviews.</li>
              </ul>
              {notes && (
                <div className="space-y-1 rounded bg-mist-grey/10 p-2">
                  <p className="text-xs font-medium text-charcoal-ink/70">Sources (S59d draft, not independently reviewed)</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {notes.sources.map((s) => (
                      <li key={s.citation} className="text-xs text-charcoal-ink/70">
                        {s.citation}
                        {s.url ? ` (${s.url})` : ""}. {s.read === "page_read" ? "Page was read." : "NOT opened: check before signing."} {s.supports}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs font-medium text-charcoal-ink/70">Could not be verified</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {notes.unverified.map((u) => (
                      <li key={u} className="text-xs text-charcoal-ink/70">
                        {u}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs font-medium text-charcoal-ink/70">Questions only you can answer</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {notes.cmoQuestions.map((q) => (
                      <li key={q.id} className="text-xs text-charcoal-ink/70">
                        {q.id}: {q.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </details>
  );
}
