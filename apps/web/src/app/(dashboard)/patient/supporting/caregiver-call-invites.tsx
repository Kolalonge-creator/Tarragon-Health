"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDateTime } from "@/lib/format-date";
import { useAnswerConsultationInvite, useMyConsultationInvites } from "@/lib/queries/caregiver-invites";

/**
 * CGJ: the supporter's own list of calls they have been invited to join, by the patient, one call at a time. Shows only a first name and a
 * time. The invite is the source of truth here; the notification that points to this page is neutral and optional. Renders nothing when
 * there is no live invite.
 */
export function CaregiverCallInvites({ locale }: { locale: Locale }) {
  const invites = useMyConsultationInvites();
  const answer = useAnswerConsultationInvite();
  const [failed, setFailed] = useState(false);
  const list = invites.data ?? [];
  if (list.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consult.cg.invites_title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {list.map((i) => (
            <li key={i.pass_id} className="space-y-2 py-3">
              <p className="font-medium">
                {t("consult.cg.invited_on", locale, {
                  name: i.patient_first_name,
                  when: formatPatientDateTime(i.scheduled_at, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                })}
              </p>
              {i.state === "invited" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={answer.isPending}
                    onClick={async () => {
                      setFailed(false);
                      try {
                        await answer.mutateAsync({ passId: i.pass_id, accept: true });
                      } catch {
                        setFailed(true);
                      }
                    }}
                  >
                    {t("consult.cg.accept", locale)}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={answer.isPending}
                    onClick={async () => {
                      setFailed(false);
                      try {
                        await answer.mutateAsync({ passId: i.pass_id, accept: false });
                      } catch {
                        setFailed(true);
                      }
                    }}
                  >
                    {t("consult.cg.decline", locale)}
                  </Button>
                </div>
              ) : (
                <Button asChild className="min-h-11">
                  <Link href={`/patient/supporting/consultation/${i.encounter_id}`}>{t("consult.cg.join", locale)}</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <FormError id="caregiver-invite-error" message={failed ? t("consult.cg.error", locale) : null} />
      </CardContent>
    </Card>
  );
}
