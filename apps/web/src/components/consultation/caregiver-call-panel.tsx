"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelCaregiverInviteAction, inviteCaregiverAction, removeCaregiverAction, type CaregiverFail } from "@/lib/consultations/actions";
import { activePasses, type CaregiverList, type CaregiverPass } from "@/lib/consultations/caregivers";

const STATUS_KEYS = {
  invited: "consult.cg.status_invited",
  accepted: "consult.cg.status_accepted",
  declined: "consult.cg.status_declined",
  removed: "consult.cg.status_removed",
} as const;

/**
 * CGJ: who else is on this call. The patient (or the proxy who already acts for them) invites one person from their Care Circle per call
 * and can cancel; the clinician sees "Caregiver present: <relationship>" and can remove them for the rest of the call. The invite lives
 * in the database, the page only shows it and asks: a failed action is shown, never swallowed, and nothing here needs a send to succeed.
 * Rendered next to the consultation room, which already refreshes the page while the consultation is live.
 */
export function CaregiverCallPanel({ encounterId, list, locale }: { encounterId: string; list: CaregiverList; locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const isClinician = list.role === "clinician";
  const active = activePasses(list);

  function failure(r: CaregiverFail) {
    setNote(r.reason === "not_allowed" ? t("consult.cg.error_not_allowed", locale) : t("consult.cg.error", locale));
  }
  function run(action: () => Promise<{ ok: true } | CaregiverFail>, done?: string) {
    setNote(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) failure(r);
      else if (done) setNote(done);
      router.refresh();
    });
  }

  // The clinician has nothing to look at until somebody has been invited
  if (isClinician && list.passes.length === 0) return null;
  // The patient sees the panel while the call is live, or while it still has something to show
  if (!isClinician && !list.live && list.passes.length === 0) return null;

  return (
    <Card data-testid="caregiver-panel">
      <CardHeader>
        <CardTitle className="text-base">{isClinician ? t("consult.cg.clin_title", locale) : t("consult.cg.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!isClinician && <p>{t("consult.cg.body", locale)}</p>}

        {list.passes.length > 0 && (
          <ul className="space-y-2">
            {list.passes.map((p) => (
              <li key={p.pass_id} className="flex flex-wrap items-center justify-between gap-2">
                <span role="status" aria-live="polite">
                  {isClinician ? clinicianLine(p, locale) : patientLine(p, locale)}
                </span>
                {isClinician && p.removable && (
                  <span className="flex flex-col items-start gap-1">
                    <Button variant="outline" disabled={pending} onClick={() => run(() => removeCaregiverAction(p.pass_id), t("consult.cg.clin_removed", locale))}>
                      {t("consult.cg.clin_remove", locale)}
                    </Button>
                  </span>
                )}
                {!isClinician && (p.state === "invited" || p.state === "accepted") && (
                  <Button variant="outline" disabled={pending} onClick={() => run(() => cancelCaregiverInviteAction(p.pass_id))}>
                    {t("consult.cg.cancel", locale)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isClinician && list.passes.some((p) => p.removable) && <p>{t("consult.cg.clin_remove_hint", locale)}</p>}

        {!isClinician && list.live && active.length < list.max && (
          <div className="space-y-2">
            {list.invitable.length === 0 && list.passes.length === 0 ? (
              <p>{t("consult.cg.none", locale)}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {list.invitable.map((m) => (
                  <li key={m.member_id}>
                    <Button disabled={pending} onClick={() => run(() => inviteCaregiverAction(encounterId, m.member_id), t("consult.cg.sent", locale))}>
                      {t("consult.cg.invite_button", locale, { name: m.name, relationship: m.relationship })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {note && (
          <p role="alert" className="text-charcoal-ink dark:text-night-ink">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function patientLine(p: CaregiverPass, locale: Locale): string {
  const status = p.state === "accepted" && p.present ? t("consult.cg.present", locale) : t(STATUS_KEYS[p.state], locale);
  return `${p.name ?? p.relationship} (${p.relationship}): ${status}`;
}

/** The clinician is given the relationship label and a state. Never a name. */
function clinicianLine(p: CaregiverPass, locale: Locale): string {
  // A removal stays on screen for the rest of the call, with the one thing the platform cannot do for the clinician: expel someone who is
  // already inside the video (OQ-CGJ-2).
  if (p.state === "removed") return t("consult.cg.clin_removed_line", locale, { relationship: p.relationship });
  if (p.state === "accepted" && p.present) return t("consult.cg.clin_present", locale, { relationship: p.relationship });
  if (p.state === "accepted") return t("consult.cg.clin_accepted", locale, { relationship: p.relationship });
  return t("consult.cg.clin_invited", locale, { relationship: p.relationship });
}
