"use client";

import { useQuery } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { directionsHref } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";
import { detectMapsPlatform } from "@/lib/directory/model";
import { createClient } from "@/lib/supabase/client";
import { helpRequestTypeLabelKey, parseHelpRequestType } from "@/lib/care-circle/help-request";

interface HelpAlert {
  alert_id: string;
  sent_at: string;
  latitude: number | null;
  longitude: number | null;
  // P22 / PD-08: what kind of help, and the patient's own short note. Null on an alert sent before typed requests existed.
  request_type?: string | null;
  request_note?: string | null;
}

/** Shows a supporter the latest "ask for help" tap from the person they support, with the location only if the person shared it. The read is audited by the database. */
export function HelpAlertView({ patientId, locale }: { patientId: string; locale: Locale }) {
  const q = useQuery({
    queryKey: ["care-circle", "help-alert", patientId],
    // No polling: every read of this alert is written to the care access log (INV-10), so a timer would fill the log. Focus refetch only.
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_help_alert_view", { p_patient: patientId });
      if (error) throw new Error(error.message);
      return (data as unknown as HelpAlert | null) ?? null;
    },
  });
  const a = q.data;
  if (!a) return null;
  const kind = parseHelpRequestType(a.request_type);
  const note = typeof a.request_note === "string" && a.request_note.trim() ? a.request_note.trim() : null;
  const maps = directionsHref({ latitude: a.latitude, longitude: a.longitude }, detectMapsPlatform());
  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.help.view.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{formatPatientDateTime(a.sent_at)}</p>
        <p className="font-medium">
          {kind ? t("circlehelp.view.asked_for", locale, { type: t(helpRequestTypeLabelKey(kind), locale) }) : t("circlehelp.view.general", locale)}
        </p>
        {note ? <p className="text-sm">{t("circlehelp.view.note", locale, { note })}</p> : null}
        {maps ? (
          <>
            <p className="text-sm font-medium">{t("circle.help.view.location", locale)}</p>
            <Button asChild variant="outline" className="min-h-11"><a href={maps}>{t("circle.help.view.open_maps", locale)}</a></Button>
          </>
        ) : (
          <p className="text-sm">{t("circle.help.view.no_location", locale)}</p>
        )}
        <p className="text-sm">{t("circlehelp.not_emergency", locale)}</p>
      </CardContent>
    </Card>
  );
}
