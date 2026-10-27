"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { acceptFollowUpTaskProposal, draftScribeDocument } from "@/lib/scribe/actions";
import { DOCUMENT_KINDS, DOCUMENT_WATERMARK, watermarkedText, type DocumentDraft, type DocumentKind } from "@/lib/scribe/documents";
import type { ScribeFact } from "@/lib/scribe/facts";
import { scribeErrorMessage } from "@/lib/scribe/error-messages";
import { ProblemReportForm, type ProblemReportInput } from "./problem-report-form";

interface Props {
  patientId: string;
  noteId: string;
  consentId: string;
  facts: readonly ScribeFact[];
  patientContext?: { age?: number; sex?: string; conditions?: string[] };
  onReport?: (kind: DocumentKind, report: ProblemReportInput) => Promise<boolean>;
}

type Slot = { state: "idle" } | { state: "working" } | { state: "unavailable" } | { state: "error"; message: string } | { state: "ready"; draft: DocumentDraft };

const KIND_LABEL: Record<DocumentKind, Parameters<typeof t>[0]> = {
  letter: "scribeui.docs.letter",
  prescription_proposal: "scribeui.docs.prescription_proposal",
  follow_up_tasks: "scribeui.docs.follow_up_tasks",
};

function Watermark() {
  return (
    <p className="inline-block rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800" data-testid="watermark">
      {DOCUMENT_WATERMARK}
    </p>
  );
}

/**
 * Letter, prescription proposal and follow-up task drafts, written from the facts the clinician already confirmed. Everything stays in the
 * browser until the clinician acts: a letter is copied out, a prescription line is a proposal to enter in the prescribing form by hand
 * (nothing here can create a prescription), and a task becomes a follow-up only when accepted.
 */
export function DocumentDraftsPanel({ patientId, noteId, consentId, facts, patientContext, onReport }: Props) {
  const [slots, setSlots] = useState<Partial<Record<DocumentKind, Slot>>>({});
  const set = (kind: DocumentKind, slot: Slot) => setSlots((prev) => ({ ...prev, [kind]: slot }));

  async function run(kind: DocumentKind) {
    set(kind, { state: "working" });
    try {
      const out = await draftScribeDocument({ scribeConsentId: consentId, encounterNoteId: noteId, kind, confirmedFacts: [...facts], patientContext });
      if (out.status === "disabled") set(kind, { state: "unavailable" });
      else set(kind, { state: "ready", draft: out.document });
    } catch (err) {
      set(kind, { state: "error", message: scribeErrorMessage(err) });
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-charcoal-ink/15 p-3" aria-label={t("scribeui.docs.heading", "en")}>
      <p className="text-sm font-medium">{t("scribeui.docs.heading", "en")}</p>
      <div className="flex flex-wrap gap-2">
        {DOCUMENT_KINDS.map((kind) => (
          <Button key={kind} size="sm" variant="outline" type="button" disabled={slots[kind]?.state === "working"} onClick={() => run(kind)}>
            {slots[kind]?.state === "working" ? t("scribeui.docs.working", "en") : t(KIND_LABEL[kind], "en")}
          </Button>
        ))}
      </div>
      {DOCUMENT_KINDS.map((kind) => {
        const slot = slots[kind];
        if (!slot || slot.state === "idle" || slot.state === "working") return null;
        if (slot.state === "unavailable") return <p key={kind} role="status" className="text-xs text-charcoal-ink/70">{t("scribeui.docs.unavailable", "en")}</p>;
        if (slot.state === "error") return <p key={kind} role="alert" className="text-xs text-red-600">{slot.message}</p>;
        return (
          <div key={kind} className="space-y-2 border-t border-charcoal-ink/10 pt-2" data-testid={`draft-${kind}`}>
            <p className="text-xs font-medium">{t(KIND_LABEL[kind], "en")}</p>
            <Watermark />
            <DraftBody draft={slot.draft} patientId={patientId} />
            {onReport && <ProblemReportForm withSection={false} onSubmit={(r) => onReport(kind, r)} />}
          </div>
        );
      })}
    </section>
  );
}

function DraftBody({ draft, patientId }: { draft: DocumentDraft; patientId: string }) {
  if (draft.kind === "letter") return <LetterBody initial={draft.body} />;
  if (draft.kind === "prescription_proposal") {
    return (
      <div className="space-y-1">
        <p className="text-xs text-charcoal-ink/70">{t("scribeui.docs.rx_notice", "en")}</p>
        <ul className="list-disc pl-4 text-sm">
          {draft.items.map((i, n) => (
            <li key={n}>
              {[i.medicine, i.dose, i.frequency, i.duration].filter(Boolean).join(", ")}
              {i.reason ? ` (${i.reason})` : ""}
            </li>
          ))}
        </ul>
        {draft.dropped > 0 && <p className="text-xs text-amber-700">{t("scribeui.docs.dropped", "en", { count: draft.dropped })}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <ul className="space-y-2 text-sm">
        {draft.items.map((i, n) => (
          <TaskRow key={n} description={i.description} days={i.dueInDays} patientId={patientId} />
        ))}
      </ul>
      {draft.dropped > 0 && <p className="text-xs text-amber-700">{t("scribeui.docs.dropped", "en", { count: draft.dropped })}</p>}
    </div>
  );
}

function LetterBody({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial);
  return (
    <div className="space-y-1">
      <Textarea value={body} rows={8} onChange={(e) => setBody(e.target.value)} />
      <Button size="sm" variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(watermarkedText(body))}>
        {t("scribeui.docs.copy", "en")}
      </Button>
    </div>
  );
}

function TaskRow({ description, days, patientId }: { description: string; days: number; patientId: string }) {
  const [state, setState] = useState<"open" | "working" | "created" | "failed" | "dismissed">("open");
  if (state === "dismissed") return null;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>
        {description} <span className="text-xs text-charcoal-ink/60">({t("scribeui.docs.due_in", "en", { days })})</span>
      </span>
      {state === "created" ? (
        <span role="status" className="text-xs text-tarragon-green">{t("scribeui.docs.task_created", "en")}</span>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={state === "working"}
            onClick={async () => {
              setState("working");
              try {
                const r = await acceptFollowUpTaskProposal({ patientId, dueInDays: days });
                setState(r.ok ? "created" : "failed");
              } catch {
                setState("failed");
              }
            }}
          >
            {t("scribeui.docs.task_accept", "en")}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setState("dismissed")}>
            {t("scribeui.docs.task_dismiss", "en")}
          </Button>
          {state === "failed" && <span role="alert" className="text-xs text-red-600">{t("scribeui.docs.task_failed", "en")}</span>}
        </>
      )}
    </li>
  );
}
