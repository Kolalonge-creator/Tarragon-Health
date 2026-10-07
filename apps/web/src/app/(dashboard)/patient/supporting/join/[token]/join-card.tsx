"use client";

import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { permissionKey } from "@/lib/care-circle/model";
import { useAcceptInvite, usePreviewInvite } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

export function JoinCard({ token, locale }: { token: string; locale: Locale }) {
  const preview = usePreviewInvite(token);
  const accept = useAcceptInvite();

  if (preview.isPending) return <p className={MUTED} role="status">…</p>;

  if (accept.data?.ok) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p role="status">{t("circle.join.done", locale)}</p>
          <Button asChild className={TOUCH}>
            <Link href={`/patient/supporting/circle/${accept.data.patient_id}`}>{t("circle.join.open", locale)}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const p = preview.data;
  if (!p || !p.ok || accept.data?.ok === false) {
    // One message for every failure: expired, used, wrong account, unknown. Nothing here says who was invited.
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p role="alert">{t("circle.join.invalid", locale)}</p>
          <p className={`text-sm ${MUTED}`}>{t("circle.join.sign_in", locale)}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.join.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p>{t("circle.join.body", locale, { name: p.inviter_first_name, relationship: p.relationship })}</p>
        <section aria-labelledby="join-sees">
          <h3 id="join-sees" className="font-medium">{t("circle.join.sees", locale)}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {p.permissions.map((perm) => <li key={perm}>{t(permissionKey(perm), locale)}</li>)}
          </ul>
        </section>
        <div className="flex flex-wrap gap-3">
          <Button type="button" className={TOUCH} disabled={accept.isPending} onClick={() => accept.mutate(token)}>
            {t("circle.join.accept", locale)}
          </Button>
          <Button asChild variant="outline" className={TOUCH}>
            <Link href="/patient/supporting">{t("circle.join.decline", locale)}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
