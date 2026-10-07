"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { directionsHref, telHref } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { bookingStateKey, nairaFromKobo, ratingStatusKey, type MyBooking } from "@/lib/directory/model";
import { useMyBookings, useRespondBooking, useSubmitRating } from "@/lib/queries/directory";

const TOUCH = "min-h-11";

function RateForm({ b, locale }: { b: MyBooking; locale: Locale }) {
  const submit = useSubmitRating();
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  if (submit.isSuccess) return <p role="status" className="text-sm">{t("directory.rating.thanks", locale)}</p>;
  return (
    <form
      className="space-y-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ facilityId: b.facility_id, bookingId: b.booking_id, rating: score, comment });
      }}
    >
      <p className="text-sm">{t("directory.rating.rules", locale)}</p>
      <Label htmlFor={`score-${b.booking_id}`}>{t("directory.rating.rate", locale)}</Label>
      <Input id={`score-${b.booking_id}`} type="number" min={1} max={5} value={score} onChange={(e) => setScore(Number(e.target.value))} />
      <Input aria-label={t("directory.rating.rate", locale)} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
      {submit.isError ? <p role="alert" className="text-sm">{t("directory.rating.error", locale)}</p> : null}
      <Button type="submit" disabled={submit.isPending} className={TOUCH}>{t("directory.rating.rate", locale)}</Button>
    </form>
  );
}

function Row({ b, locale }: { b: MyBooking; locale: Locale }) {
  const respond = useRespondBooking();
  const open = b.state === "requested" || b.state === "confirmed";
  const maps = directionsHref({ latitude: b.latitude, longitude: b.longitude, name: b.facility_name, address: b.address }, "android");
  const tel = telHref(b.facility_phone);
  const price = nairaFromKobo(b.price_shown_kobo);
  const status = ratingStatusKey(b.rating_status);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{b.facility_name}</CardTitle>
        <p className="text-sm">{formatPatientDateTime(b.slot_at)} · {t(bookingStateKey(b.state), locale)}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {price ? <p className="text-sm">{t("directory.price.per_item", locale, { amount: price })}</p> : null}
        <div className="flex flex-wrap gap-2">
          {maps ? <Button asChild variant="outline" className={TOUCH}><a href={maps}>{t("directory.directions", locale)}</a></Button> : null}
          {tel ? <Button asChild variant="outline" className={TOUCH}><a href={tel}>{t("directory.call", locale)}</a></Button> : null}
        </div>
        {open ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              <Button className={TOUCH} disabled={respond.isPending || b.patient_response === "coming"} onClick={() => respond.mutate({ bookingId: b.booking_id, response: "coming" })}>
                {t("directory.bookings.coming", locale)}
              </Button>
              <Button variant="outline" className={TOUCH} disabled={respond.isPending} onClick={() => respond.mutate({ bookingId: b.booking_id, response: "cancelling" })}>
                {t("directory.bookings.cancel", locale)}
              </Button>
            </div>
            <p className="text-sm">{t("directory.bookings.cancel_note", locale)}</p>
            {respond.isError ? <p role="alert" className="text-sm">{t("directory.bookings.error", locale)}</p> : null}
          </div>
        ) : null}
        {b.state === "completed" && !b.rating_status ? <RateForm b={b} locale={locale} /> : null}
        {status ? (
          <p className="text-sm">
            {t(status, locale, { date: b.rating_respond_by ? formatPatientDate(b.rating_respond_by) : "" })}
            {b.rating_held ? ` ${t("directory.rating.held", locale)}` : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BookingsList({ locale }: { locale: Locale }) {
  const q = useMyBookings();
  if (q.isLoading) return <p role="status">…</p>;
  if (q.isError) return <p role="alert">{t("directory.error", locale)}</p>;
  if ((q.data ?? []).length === 0) return <p role="status">{t("directory.bookings.none", locale)}</p>;
  return <div className="space-y-3">{(q.data ?? []).map((b) => <Row key={b.booking_id} b={b} locale={locale} />)}</div>;
}
