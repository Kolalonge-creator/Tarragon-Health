"use client";

import { useActionState } from "react";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import type { LowCarbCheckinLine } from "@tarragon/clinical/lowcarb-programme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { respondToLowCarbOffer, stopLowCarbAsPatient } from "./actions";

const TOUCH = "min-h-11";
const LABEL = { glucose: "lowcarb.checkin.glucose", ketones: "lowcarb.checkin.ketones", weight: "lowcarb.checkin.weight" } as const;
const STATUS = { on_track: "lowcarb.checkin.on_track", due: "lowcarb.checkin.due", overdue: "lowcarb.checkin.overdue" } as const;

/** Colour is always paired with a word. Equal buttons for yes and no, no countdown, nothing pre-ticked. */
export function OfferCard({ enrolmentId }: { enrolmentId: string }) {
  const [state, act, pending] = useActionState(respondToLowCarbOffer, undefined);
  if (state?.outcome === "active") return <p role="status">{t("lowcarb.offer.accepted")}</p>;
  if (state?.outcome === "declined") return <p role="status">{t("lowcarb.offer.declined")}</p>;
  if (state?.outcome === "unavailable") return <p role="status">{t("lowcarb.offer.unavailable")}</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lowcarb.offer.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{t("lowcarb.offer.body")}</p>
        <p className="text-sm">{t("lowcarb.food.body")}</p>
        <form action={act} className="flex flex-wrap gap-3">
          <input type="hidden" name="enrolmentId" value={enrolmentId} />
          <Button type="submit" name="answer" value="yes" className={TOUCH} disabled={pending}>
            {t("lowcarb.offer.accept")}
          </Button>
          <Button type="submit" name="answer" value="no" variant="outline" className={TOUCH} disabled={pending}>
            {t("lowcarb.offer.decline")}
          </Button>
        </form>
        {state?.error ? (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CheckinCard({ checkins }: { checkins: LowCarbCheckinLine[] | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lowcarb.checkin.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{t("lowcarb.checkin.body")}</p>
        {checkins ? (
          <ul className="space-y-2 text-sm">
            {checkins.map((c) => (
              <li key={c.metric} className="flex flex-wrap items-center gap-2">
                <span>{t(LABEL[c.metric])}:</span>
                <span>{t("lowcarb.checkin.count", undefined, { done: c.countThisWeek, expected: c.expected })}</span>
                <Badge variant={c.status === "on_track" ? "green" : c.status === "due" ? "amber" : "blue"}>{t(STATUS[c.status])}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/patient/vitals" className="inline-block text-sm text-brand-green underline hover:no-underline dark:text-brand-green-bright">
          {t("lowcarb.checkin.title")}
        </Link>
      </CardContent>
    </Card>
  );
}

export function StopCard({ enrolmentId }: { enrolmentId: string }) {
  const [state, act, pending] = useActionState(stopLowCarbAsPatient, undefined);
  if (state?.outcome === "stopped") return <p role="status">{t("lowcarb.stopped")}</p>;
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <p className="text-sm">{t("lowcarb.stop.confirm")}</p>
      <Button type="submit" variant="outline" className={TOUCH} disabled={pending}>
        {t("lowcarb.stop.button")}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
