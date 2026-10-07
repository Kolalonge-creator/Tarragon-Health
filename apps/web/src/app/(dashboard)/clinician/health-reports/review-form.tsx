"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@tarragon/i18n";
import { correctHealthReportAction, signHealthReportAction } from "@/lib/health-report/actions";

type Source = "template" | "clinician" | "clinician_edited_ai_draft";

export function ReviewForm({ reportId, status, templateSummary, aiDraft }: { reportId: string; status: "pending_signature" | "signed" | "superseded"; templateSummary: string; aiDraft: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(templateSummary);
  const [source, setSource] = useState<Source>("template");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (status === "superseded") return null;

  if (status === "signed") {
    return (
      <form
        className="space-y-2 rounded border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await correctHealthReportAction({ reportId, note });
            setMessage(r.ok ? "Correction opened." : `Not done: ${r.error ?? "failed"}`);
            if (r.ok && r.reportId) router.push(`/clinician/health-reports?id=${r.reportId}`);
          });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="hr-note">{t("report.review.correction_note", "en")}</label>
        <textarea id="hr-note" className="w-full rounded border p-2 text-sm" rows={3} value={note} onChange={(e) => setNote(e.target.value)} minLength={10} required />
        <button type="submit" disabled={pending} className="min-h-11 rounded border px-3 text-sm">{t("report.review.correct", "en")}</button>
        {message ? <p role="status" className="text-sm">{message}</p> : null}
      </form>
    );
  }

  return (
    <form
      className="space-y-2 rounded border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await signHealthReportAction({ reportId, summary: text, source });
          setMessage(r.ok ? "Signed. The patient can now read it." : `Not signed: ${r.error ?? "failed"}`);
          if (r.ok) router.push("/clinician/health-reports");
        });
      }}
    >
      <label className="block text-sm font-medium" htmlFor="hr-summary">{t("report.review.summary_label", "en")}</label>
      {aiDraft ? (
        <div className="space-y-1 rounded border p-2 text-sm">
          <p className="text-xs">{t("report.review.ai_draft_label", "en")}</p>
          <p>{aiDraft}</p>
          <button
            type="button"
            className="min-h-11 rounded border px-3 text-sm"
            onClick={() => {
              setText(aiDraft);
              setSource("clinician_edited_ai_draft");
            }}
          >
            Use as a starting point
          </button>
        </div>
      ) : null}
      <textarea
        id="hr-summary"
        className="w-full rounded border p-2 text-sm"
        rows={5}
        maxLength={2000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (source === "template") setSource("clinician");
        }}
        required
      />
      <button type="submit" disabled={pending || text.trim() === ""} className="min-h-11 rounded border px-3 text-sm">{t("report.review.sign", "en")}</button>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </form>
  );
}
