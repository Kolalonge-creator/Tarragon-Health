"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { KIND_KEYS } from "@/lib/community/model";
import { useJoin, usePreviewInvite } from "@/lib/queries/community";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

export function CommunityJoinCard({ token, locale }: { token: string; locale: Locale }) {
  const preview = usePreviewInvite(token);
  const join = useJoin();
  const [agree, setAgree] = useState(false);

  if (preview.isPending) return <p className={MUTED} role="status">…</p>;

  if (join.data?.ok) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p role="status">{t("community.join.done", locale)}</p>
          <Button asChild className={TOUCH}>
            <Link href={join.data.cohort_id ? `/patient/community/${join.data.cohort_id}` : "/patient/community"}>{t("community.join.open", locale)}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const p = preview.data;
  if (!p || !p.ok || join.data?.ok === false) {
    // One message for every failure: expired, used, closed, wrong account, unknown. Nothing here says why.
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p role="alert">{t("community.join.invalid", locale)}</p>
          <p className={`text-sm ${MUTED}`}>{t("community.join.sign_in", locale)}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("community.join.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p>{t("community.join.body", locale, { name: p.name, kind: t(KIND_KEYS[p.kind], locale).toLowerCase() })}</p>
        <p className={`text-sm ${MUTED}`}>{t("community.join.consent_note", locale)}</p>
        <div className={`flex items-start gap-3 ${TOUCH}`}>
          <input id="join-consent" type="checkbox" className="mt-1 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <Label htmlFor="join-consent" className="font-normal leading-snug">{t("community.join.consent", locale)}</Label>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" className={TOUCH} disabled={!agree || join.isPending} onClick={() => join.mutate({ token, consent: true })}>
            {t("community.join.accept", locale)}
          </Button>
          <Button asChild variant="outline" className={TOUCH}>
            <Link href="/patient/community">{t("community.group.back", locale)}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
