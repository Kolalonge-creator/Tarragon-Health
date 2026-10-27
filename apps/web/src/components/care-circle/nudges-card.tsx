"use client";

import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecentNudges, useToolsStatus } from "@/lib/queries/care-circle";

/** The people a gentle nudge was sent about (S69b): a first name and a link, nothing about doses. Renders nothing while off or empty. */
export function NudgesCard({ locale }: { locale: Locale }) {
  const tools = useToolsStatus();
  const q = useRecentNudges(tools.data?.missed_dose === true);
  const rows = q.data ?? [];
  if (tools.data?.missed_dose !== true || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("cctools.nudges.title", locale)}</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.patient_id}>
              <Link className="underline" href={`/patient/supporting/circle/${r.patient_id}`}>{t("cctools.nudges.line", locale, { name: r.name })}</Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
