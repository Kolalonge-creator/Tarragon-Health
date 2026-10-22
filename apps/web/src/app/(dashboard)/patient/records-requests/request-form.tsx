"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SCOPE_CODES, type ScopeCode } from "@/lib/records-request/letter";
import { t, type Locale } from "@tarragon/i18n";
import { createRecordsRequestAction } from "./actions";

/** Prepares a request. Every control is labelled, large enough to tap, and the form still works if the network drops: it says so instead of pretending. */
export function RequestForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [facility, setFacility] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<ScopeCode[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (code: ScopeCode) => setScope((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  const input = "mt-1 block min-h-11 w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 py-2 text-base dark:border-night-ink/30";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const r = await createRecordsRequestAction({ facility, contact, scope, note });
            if (r.ok && r.id) {
              router.push(`/patient/records-requests/${r.id}`);
              return;
            }
            setMessage(r.ok ? t("records_request.created", locale) : r.error === "not_open" ? t("records_request.not_open", locale) : r.error === "invalid" ? t("records_request.invalid", locale) : t("records_request.failed", locale));
          } catch {
            setMessage(t("records_request.failed", locale));
          }
        });
      }}
    >
      <label className="block text-sm font-medium">
        {t("records_request.facility_label", locale)}
        <input value={facility} onChange={(e) => setFacility(e.target.value)} required minLength={2} maxLength={160} className={input} aria-describedby="rr-facility-help" />
      </label>
      <p id="rr-facility-help" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("records_request.facility_help", locale)}</p>
      <label className="block text-sm font-medium">
        {t("records_request.contact_label", locale)}
        <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} className={input} />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("records_request.scope_label", locale)}</legend>
        {SCOPE_CODES.map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5" checked={scope.includes(c)} onChange={() => toggle(c)} />
            {t(`records_request.scope.${c}`, locale)}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm font-medium">
        {t("records_request.note_label", locale)}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={input} />
      </label>
      <Button type="submit" disabled={pending || facility.trim().length < 2 || scope.length === 0}>{t("records_request.create", locale)}</Button>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </form>
  );
}
