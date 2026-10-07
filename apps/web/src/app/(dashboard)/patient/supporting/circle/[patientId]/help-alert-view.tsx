"use client";

import { useQuery } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { directionsHref } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";
import { createClient } from "@/lib/supabase/client";

interface HelpAlert { alert_id: string; sent_at: string; latitude: number | null; longitude: number | null }

/** Shows a supporter the latest "ask for help" tap from the person they support, with the location only if the person shared it. The read is audited by the database. */
export function HelpAlertView({ patientId, locale }: { patientId: string; locale: Locale }) {
  const q = useQuery({
    queryKey: ["care-circle", "help-alert", patientId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("circle_help_alert_view", { p_patient: patientId });
      if (error) throw new Error(error.message);
      return (data as unknown as HelpAlert | null) ?? null;
    },
  });
  const a = q.data;
  if (!a) return null;
  const maps = directionsHref({ latitude: a.latitude, longitude: a.longitude }, "android");
  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.help.view.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{formatPatientDateTime(a.sent_at)}</p>
        {maps ? (
          <>
            <p className="text-sm font-medium">{t("circle.help.view.location", locale)}</p>
            <Button asChild variant="outline" className="min-h-11"><a href={maps}>{t("circle.help.view.open_maps", locale)}</a></Button>
          </>
        ) : (
          <p className="text-sm">{t("circle.help.view.no_location", locale)}</p>
        )}
      </CardContent>
    </Card>
  );
}
