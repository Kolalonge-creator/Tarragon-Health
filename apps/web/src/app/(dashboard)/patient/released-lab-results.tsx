"use client";

import { useActionState, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { addOwnLabResult, getOwnResultFileUrl } from "@/lib/lab-results/structured-actions";
import { formatRange, LAB_RESULT_FILE_ACCEPT, myLabResultsSchema, type MyLabResult } from "@/lib/lab-results/structured";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TOUCH = "min-h-11";
const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

function useMyLabResults(patientId: string) {
  return useQuery({
    queryKey: ["my-lab-results", patientId],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_lab_results");
      if (error) throw error;
      return myLabResultsSchema.parse(data ?? []);
    },
  });
}

function FileButton({ id, locale }: { id: string; locale: Locale }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={TOUCH}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await getOwnResultFileUrl(id);
            if (r.url) window.open(r.url, "_blank", "noopener");
            setFailed(!r.url);
          })
        }
      >
        {t("labres.file.open", locale)}
      </Button>
      {failed ? <p role="alert" className="text-sm text-red-700">{t("labres.add.error.unknown", locale)}</p> : null}
    </>
  );
}

function ResultCard({ r, locale }: { r: MyLabResult; locale: Locale }) {
  const released = r.status === "released";
  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{formatPatientDate(r.received_at)}</p>
        <Badge variant={released ? "green" : "amber"}>{t(`labres.status.${r.status}`, locale)}</Badge>
      </div>
      {r.own_upload && !released ? <p className={`mt-1 text-sm ${MUTED}`}>{t("labres.own.note", locale)}</p> : null}
      {released && r.items.length > 0 ? (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{t("labres.title", locale)}</caption>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.analyte_code} className="border-t">
                <th scope="row" className="py-1 pr-2 text-left font-normal">{i.analyte_code.replace(/_/g, " ")}</th>
                <td>{i.value_numeric !== null ? `${i.value_numeric} ${i.unit}` : i.value_text}</td>
                <td className={MUTED}>{formatRange(i.ref_low, i.ref_high, i.unit)}</td>
                <td>{t(`labres.item.flag.${i.flag}`, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {released && !r.explain_allowed ? <p className={`mt-2 text-sm ${MUTED}`}>{t("labres.explain.off", locale)}</p> : null}
      {r.has_file ? <div className="mt-2"><FileButton id={r.lab_result_id} locale={locale} /></div> : null}
    </li>
  );
}

function AddOwnResult({ locale, onDone }: { locale: Locale; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof addOwnLabResult>>, fd: FormData) => {
    const r = await addOwnLabResult(prev, fd);
    if (r?.success) onDone();
    return r;
  }, undefined);
  return (
    <form action={action} className="space-y-2 border-t pt-3">
      <h3 className="font-medium">{t("labres.add.title", locale)}</h3>
      <p className={`text-sm ${MUTED}`}>{t("labres.add.help", locale)}</p>
      <Label htmlFor="own-result-file" className="sr-only">{t("labres.add.title", locale)}</Label>
      <Input id="own-result-file" type="file" name="file" accept={LAB_RESULT_FILE_ACCEPT} required className={TOUCH} />
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">{t("labres.add.done", locale)}</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>{t("labres.add.button", locale)}</Button>
    </form>
  );
}

export function ReleasedLabResults({ patientId, locale }: { patientId: string; locale: Locale }) {
  const q = useMyLabResults(patientId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labres.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.data && q.data.length === 0 ? <p className={`text-sm ${MUTED}`}>{t("labres.empty", locale)}</p> : null}
        <ul className="space-y-2">
          {(q.data ?? []).map((r) => (
            <ResultCard key={r.lab_result_id} r={r} locale={locale} />
          ))}
        </ul>
        <AddOwnResult locale={locale} onDone={() => void q.refetch()} />
      </CardContent>
    </Card>
  );
}
