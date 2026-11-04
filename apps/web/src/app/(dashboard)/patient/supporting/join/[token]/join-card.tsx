"use client";

import Link from "next/link";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withoutCrossOrganisation } from "@tarragon/shared";
import { SupporterPermissionList } from "@/components/care-circle/supporter-permission-list";
import type { InviteStatus } from "@/lib/care-circle/join-link";
import { useAcceptInvite, useDeclineInvite, useInviteStatus, usePreviewInvite } from "@/lib/queries/care-circle";
import { signOutAndReturnToInvite } from "./actions";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

function Checking({ locale }: { locale: Locale }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6" role="status" aria-label={t("supporterjoin.join.checking", locale)}>
        <Skeleton className="h-6 w-3/4 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
        <Skeleton className="h-24 w-full motion-reduce:animate-none" />
      </CardContent>
    </Card>
  );
}

const REASON_KEYS: Readonly<Record<Exclude<InviteStatus["reason"], "wrong_contact">, MessageKey>> = {
  expired: "supporterjoin.error.expired",
  no_longer_valid: "supporterjoin.error.no_longer_valid",
  not_found: "supporterjoin.error.no_longer_valid",
  already_member: "supporterjoin.error.already_member",
  own_invite: "supporterjoin.error.own_invite",
  needs_supporter_account: "supporterjoin.error.needs_supporter",
  not_available: "supporterjoin.error.not_available",
};

/** One kind, specific sentence for why this link did not open, and the one next step that fixes it. */
function Problem({ token, status, locale, onRetry }: { token: string; status: InviteStatus; locale: Locale; onRetry: () => void }) {
  const message =
    status.reason === "wrong_contact"
      ? t(status.contact_kind === "phone" ? "supporterjoin.error.wrong_contact_phone" : "supporterjoin.error.wrong_contact_email", locale, {
          hint: status.contact_hint ?? "",
        })
      : t(REASON_KEYS[status.reason], locale);
  const switchAccount = status.reason === "wrong_contact" || status.reason === "needs_supporter_account";
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p role="alert" className="text-charcoal-ink dark:text-night-ink">{message}</p>
        <div className="flex flex-wrap gap-3">
          {switchAccount ? (
            <form action={signOutAndReturnToInvite}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className={TOUCH}>{t("supporterjoin.error.switch_account", locale)}</Button>
            </form>
          ) : null}
          {status.reason === "already_member" ? (
            <Button asChild className={TOUCH}>
              <Link href={status.patient_id ? `/patient/supporting/circle/${status.patient_id}` : "/patient/supporting"}>
                {t("supporterjoin.error.open_people", locale)}
              </Link>
            </Button>
          ) : null}
          {status.reason === "not_available" ? (
            <Button type="button" variant="outline" className={TOUCH} onClick={onRetry}>
              {t("supporterjoin.view.retry", locale)}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The signed-in half of the join link. It shows who asked and exactly what will be shared, said once and in the supporter's own voice,
 * accepts only on the button, and when something is wrong says what and how to fix it (the person holding the link already holds
 * the 256-bit token, so naming the state of that one invite tells them nothing a stranger could use).
 */
export function JoinCard({ token, locale }: { token: string; locale: Locale }) {
  const preview = usePreviewInvite(token);
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const p = preview.data;
  const failed = !preview.isPending && (!p || !p.ok || accept.data?.ok === false);
  const status = useInviteStatus(token, failed);

  if (preview.isPending) return <Checking locale={locale} />;

  if (accept.data?.ok) {
    const name = p && p.ok ? p.inviter_first_name : "";
    return (
      <Card>
        <CardHeader><CardTitle>{t("supporterjoin.join.done_title", locale, { name })}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p role="status">{t("supporterjoin.join.done", locale, { name })}</p>
          <Button asChild className={TOUCH}>
            <Link href={`/patient/supporting/circle/${accept.data.patient_id}`}>{t("supporterjoin.join.open", locale, { name })}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (decline.isSuccess && decline.data) {
    // "Not now" is silent for the person who asked, and this says only what is true for this person: nothing was shared.
    return (
      <Card>
        <CardContent className="pt-6"><p role="status">{t("cctools.join.not_now_done", locale)}</p></CardContent>
      </Card>
    );
  }

  if (failed || !p || !p.ok) {
    if (status.isPending || !status.data) return <Checking locale={locale} />;
    return (
      <Problem
        token={token}
        status={status.data}
        locale={locale}
        onRetry={() => {
          accept.reset();
          void preview.refetch();
        }}
      />
    );
  }

  const name = p.inviter_first_name;
  const cross = p.cross_organisation === true;
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">{t("supporterjoin.join.title", locale, { name })}</CardTitle>
        <p className={`text-sm ${MUTED}`}>{t("supporterjoin.join.relationship", locale, { relationship: p.relationship })}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <SupporterPermissionList
          permissions={cross ? withoutCrossOrganisation(p.permissions) : p.permissions}
          name={name}
          locale={locale}
          crossOrganisation={cross}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" className={`${TOUCH} sm:flex-1`} disabled={accept.isPending} onClick={() => accept.mutate(token)}>
            {t("circle.join.accept", locale)}
          </Button>
          <Button type="button" variant="outline" className={`${TOUCH} sm:flex-1`} disabled={decline.isPending} onClick={() => decline.mutate(token)}>
            {t("cctools.join.not_now", locale)}
          </Button>
        </div>
        {decline.isError || (decline.isSuccess && !decline.data) ? <p role="alert" className="text-sm">{t("cctools.join.not_now_error", locale)}</p> : null}
        {/* The web page is the fallback for a phone without the app; with the app, this hands the same link over (custom scheme, no rebuild). */}
        <p className="text-sm">
          <a className="inline-flex min-h-11 items-center underline" href={`tarragonhealth://join/${encodeURIComponent(token)}`}>{t("joinlink.open_in_app", locale)}</a>
        </p>
      </CardContent>
    </Card>
  );
}
