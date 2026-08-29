"use client";

import { useState } from "react";
import { useMedicationEducationTopics, findEducationTopic } from "@/lib/queries/medication-access";
import type { Medication } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";

/**
 * Module 21 §21.12 — purpose/timing/administration/effects/side
 * effects/warnings/monitoring/refill info. Dose, timing and refill date
 * already show elsewhere on this medication row; this panel only adds the
 * clinical/educational narrative, matched by drug class. A drug with no
 * matching reference row shows a plain fallback rather than guessing —
 * general education, never a substitute for what your care team told you.
 */
export function MedicationEducationPanel({ medication }: { medication: Medication }) {
  const [open, setOpen] = useState(false);
  const { data: topics } = useMedicationEducationTopics();
  const topic = topics ? findEducationTopic(topics, medication.drug_name) : null;

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-charcoal-ink/70"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide" : "Learn about this medicine"}
      </Button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-md bg-charcoal-ink/5 p-3 text-xs text-charcoal-ink/70">
          {!topic && (
            <p>
              We don&apos;t have general education notes for this medicine yet — ask your care team
              about what it&apos;s for, what to expect, and any warnings.
            </p>
          )}
          {topic && (
            <>
              <Row label="Purpose">{topic.purpose}</Row>
              {medication.dose && <Row label="Dose">{medication.dose}</Row>}
              {medication.frequency && <Row label="Timing">{medication.frequency}</Row>}
              {topic.expected_effects && <Row label="What to expect">{topic.expected_effects}</Row>}
              {topic.common_side_effects && (
                <Row label="Common side effects">{topic.common_side_effects}</Row>
              )}
              {topic.warnings && <Row label="Warnings">{topic.warnings}</Row>}
              {topic.monitoring_note && <Row label="Monitoring">{topic.monitoring_note}</Row>}
              {medication.refill_date && (
                <Row label="Refill">
                  Due {new Date(medication.refill_date).toLocaleDateString()}
                </Row>
              )}
              <p className="pt-1 text-charcoal-ink/40">
                General information about {topic.drug_class} — always follow your care team&apos;s
                specific instructions for you.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-charcoal-ink">{label}: </span>
      {children}
    </p>
  );
}
