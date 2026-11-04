"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SEMANTIC_ICON } from "@/lib/icons";
import { formatPatientDate } from "@/lib/format-date";
import { useRevokeMember, useSupportedPeople, useSupporterView } from "@/lib/queries/care-circle";
import { SupporterBlocks, SupporterBlocksEmpty, hasSharedBlocks } from "./supporter-blocks";
import { PersonSwitcher } from "./person-switcher";
import { WeeklyDigestCard } from "@/components/care-circle/weekly-digest-card";
import { CircleTasksPanel } from "@/components/care-circle/circle-tasks-panel";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const BACK = { href: "/patient/supporting", label: "People you support" };

/**
 * What a supporter sees about the person they support: one read, and only the blocks the database sent. A block that is absent is
 * simply not shared; this component never asks for it another way. Read only: no export, no copy button, no raw readings.
 *
 * When nothing is shared right now (access ended, never existed, or the person paused sharing) the page says one calm, neutral thing.
 * A pause is deliberately indistinguishable from a removal (docs/design/S29.md section 7: care_circle_pauses is readable only by the
 * patient), so the wording never suggests either.
 */
export function SupporterView({ patientId, locale, alertSlot }: { patientId: string; locale: Locale; alertSlot?: ReactNode }) {
  const router = useRouter();
  const view = useSupporterView(patientId);
  const people = useSupportedPeople();
  const leave = useRevokeMember();
  const memberId = people.data?.find((p) => p.patient_id === patientId)?.member_id;

  if (view.isPending) {
    return (
      <div className="space-y-6" role="status" aria-label={t("supporterjoin.view.loading", locale)}>
        <Skeleton className="h-10 w-2/3 motion-reduce:animate-none" />
        <Skeleton className="h-32 w-full motion-reduce:animate-none" />
        <Skeleton className="h-32 w-full motion-reduce:animate-none" />
      </div>
    );
  }

  if (view.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Shared with you" icon={SEMANTIC_ICON.family} backTo={BACK} />
        <Card role="alert">
          <CardContent className="space-y-4 pt-6">
            <p>{t("supporterjoin.view.load_failed", locale)}</p>
            <Button type="button" variant="outline" className={TOUCH} onClick={() => void view.refetch()}>
              {t("supporterjoin.view.retry", locale)}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const v = view.data;
  if (!v) {
    return (
      <div className="space-y-6">
        <PageHeader title="Shared with you" icon={SEMANTIC_ICON.family} backTo={BACK} />
        {/* a request for help is never held back by what else is shared, so it still shows here if the database sends one */}
        {alertSlot}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p role="status" className="font-medium">{t("supporterjoin.view.nothing_now", locale)}</p>
            <p className={`text-sm ${MUTED}`}>{t("supporterjoin.view.nothing_now_body", locale)}</p>
            <Button asChild variant="outline" className={TOUCH}>
              <Link href={BACK.href}>{BACK.label}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("supporterjoin.view.title", locale, { name: v.name })}
        icon={SEMANTIC_ICON.family}
        backTo={BACK}
        description={
          <>
            {t("circle.view.privacy", locale, { name: v.name })} {t("circle.view.shared_until", locale, { date: formatPatientDate(v.shared_until) })}
          </>
        }
      />
      <PersonSwitcher people={people.data ?? []} current={patientId} locale={locale} />
      {alertSlot}

      <h2 className="sr-only">{t("supporterjoin.view.shared_heading", locale, { name: v.name })}</h2>
      {hasSharedBlocks(v, locale) ? <SupporterBlocks view={v} locale={locale} name={v.name} /> : <SupporterBlocksEmpty view={v} locale={locale} />}
      <WeeklyDigestCard patientId={patientId} locale={locale} />
      <CircleTasksPanel patientId={patientId} locale={locale} />

      <div className="flex flex-wrap gap-3">
        {v.can_pay ? (
          <Button asChild className={TOUCH}>
            <Link href={`/patient/supporting/circle/${patientId}/pay`}>{t("circle.view.pay", locale)}</Link>
          </Button>
        ) : null}
        {memberId ? (
          <Button
            type="button"
            variant="outline"
            className={TOUCH}
            disabled={leave.isPending}
            onClick={async () => {
              if (!window.confirm(t("circle.view.leave_confirm", locale, { name: v.name }))) return;
              await leave.mutateAsync(memberId);
              router.push("/patient/supporting");
            }}
          >
            {t("circle.view.leave", locale)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
