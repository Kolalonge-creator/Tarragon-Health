"use client";

import { useEffect, useState } from "react";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Explicit, revocable consent to share programme progress with a clinician. Off until the patient turns it on, and turning it off
 * takes effect at once on the database side (the audited clinician read refuses without it). The wording is a draft until the CMO and
 * counsel sign it (docs/OPEN-QUESTIONS.md).
 */
export function TherapyShareConsentCard({ enrolmentId }: { enrolmentId: string }) {
  const [shared, setShared] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await createClient().from("therapy_share_consents").select("shared").eq("enrolment_id", enrolmentId).maybeSingle();
        if (!cancelled) setShared(e ? null : (data?.shared ?? false));
      } catch {
        if (!cancelled) setShared(null);
      }
    })();
    return () => { cancelled = true; };
  }, [enrolmentId]);

  async function change(next: boolean) {
    setBusy(true);
    setError(false);
    try {
      const { error: e } = await createClient().rpc("set_therapy_progress_sharing", { p_enrolment: enrolmentId, p_share: next });
      if (e) setError(true);
      else setShared(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("therapy.share.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("therapy.share.body")}</p>
        {shared !== null && <p role="status" className="text-sm font-medium">{shared ? t("therapy.share.status_on") : t("therapy.share.status_off")}</p>}
        <Button type="button" disabled={busy || shared === null} onClick={() => change(!shared)}>
          {shared ? t("therapy.share.off") : t("therapy.share.on")}
        </Button>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("therapy.share.error")}</p>}
      </CardContent>
    </Card>
  );
}
