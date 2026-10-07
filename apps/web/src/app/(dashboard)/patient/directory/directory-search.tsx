"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { directionsHref, telHref } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { detectMapsPlatform, EMPTY_FILTERS, hmoKey, nairaFromKobo, nhiaKey, searchArgs, tierKey, type DirectoryRow, type SearchFilters } from "@/lib/directory/model";
import { DirectoryNotOpenError, useDirectorySearch, useReportListing, useRequestBooking } from "@/lib/queries/directory";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const FIELDS = ["phone", "address", "hours", "closed", "services", "other"] as const;

/** Last-verified line and tier on every listing (spec 15.11). Reads the date the database gives; never invents one. */
function LastVerified({ row, locale }: { row: DirectoryRow; locale: Locale }) {
  return (
    <p className={`text-sm ${MUTED}`}>
      {t(tierKey(row.tier), locale)}
      {" · "}
      {row.last_verified_at ? t("directory.last_verified", locale, { date: formatPatientDate(row.last_verified_at) }) : t("directory.never_verified", locale)}
    </p>
  );
}

function ReportForm({ row, locale }: { row: DirectoryRow; locale: Locale }) {
  const report = useReportListing();
  const [field, setField] = useState<(typeof FIELDS)[number]>("phone");
  const [detail, setDetail] = useState("");
  if (report.isSuccess) return <p role="status" className="text-sm">{t("directory.report.thanks", locale)}</p>;
  return (
    <form
      className="space-y-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        report.mutate({ listingTable: row.listing_table, listingId: row.listing_id, field, detail });
      }}
    >
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("directory.report.title", locale)}</legend>
        {FIELDS.map((f) => (
          <label key={f} className={`flex items-center gap-2 ${TOUCH}`}>
            <input type="radio" name={`report-${row.listing_id}`} checked={field === f} onChange={() => setField(f)} />
            {t(`directory.report.field.${f}` as const, locale)}
          </label>
        ))}
      </fieldset>
      <Label htmlFor={`detail-${row.listing_id}`}>{t("directory.report.detail", locale)}</Label>
      <Input id={`detail-${row.listing_id}`} value={detail} maxLength={500} onChange={(e) => setDetail(e.target.value)} />
      {report.isError ? <p role="alert" className="text-sm">{t("directory.report.error", locale)}</p> : null}
      <Button type="submit" disabled={report.isPending} className={TOUCH}>{t("directory.report.send", locale)}</Button>
    </form>
  );
}

function BookForm({ row, locale }: { row: DirectoryRow; locale: Locale }) {
  const book = useRequestBooking();
  const [when, setWhen] = useState("");
  const [service, setService] = useState("");
  const price = nairaFromKobo(row.price_kobo);
  if (book.isSuccess) return <p role="status" className="text-sm">{t("directory.booking.sent", locale)}</p>;
  return (
    <form
      className="space-y-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const iso = new Date(when).toISOString();
        book.mutate({ facilityId: row.listing_id, slotIso: iso, service });
      }}
    >
      <p className="text-sm">{price ? t("directory.booking.price_shown", locale, { amount: price }) : t("directory.booking.price_unknown", locale)}</p>
      <Label htmlFor={`when-${row.listing_id}`}>{t("directory.booking.when", locale)}</Label>
      <Input id={`when-${row.listing_id}`} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
      <Label htmlFor={`svc-${row.listing_id}`}>{t("directory.booking.service", locale)}</Label>
      <Input id={`svc-${row.listing_id}`} value={service} maxLength={120} onChange={(e) => setService(e.target.value)} />
      {book.isError ? <p role="alert" className="text-sm">{t("directory.booking.error", locale)}</p> : null}
      <Button type="submit" disabled={book.isPending || !when} className={TOUCH}>{t("directory.booking.send", locale)}</Button>
    </form>
  );
}

function Listing({ row, locale, platform, hmoQuery }: { row: DirectoryRow; locale: Locale; platform: "ios" | "android" | "web"; hmoQuery: string }) {
  const [panel, setPanel] = useState<"none" | "report" | "book">("none");
  const tel = telHref(row.phone);
  const maps = directionsHref({ latitude: row.latitude, longitude: row.longitude, name: row.name, address: row.address }, platform);
  const price = nairaFromKobo(row.price_kobo);
  const hmo = hmoKey(row.hmo_status);
  const nhia = nhiaKey(row.nhia_status);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.name}</CardTitle>
        <LastVerified row={row} locale={locale} />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{[row.address, row.city, row.state].filter(Boolean).join(", ")}</p>
        {row.distance_km !== null ? <p className={`text-sm ${MUTED}`}>{t("directory.distance", locale, { km: row.distance_km.toFixed(1) })}</p> : null}
        {row.open_now !== null ? <p className="text-sm">{row.open_now ? t("directory.open_now", locale) : t("directory.closed_now", locale)}</p> : null}
        {row.hours_text ? <p className={`text-sm ${MUTED}`}>{row.hours_text}</p> : null}
        <p className="text-sm">{price ? t("directory.price.per_item", locale, { amount: price }) : t("directory.price.unknown", locale)}</p>
        {hmo ? <p className="text-sm">{t(hmo, locale, { hmo: hmoQuery })}</p> : null}
        {nhia ? <p className="text-sm">{t(nhia, locale)}</p> : null}
        {row.rating_count > 0 ? (
          <p className="text-sm">
            {row.rating_average !== null ? `${t("directory.rating.average", locale, { average: String(row.rating_average) })} · ` : ""}
            {t("directory.rating.count", locale, { count: String(row.rating_count) })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {maps ? <Button asChild variant="outline" className={TOUCH}><a href={maps}>{t("directory.directions", locale)}</a></Button> : null}
          {tel ? <Button asChild variant="outline" className={TOUCH}><a href={tel}>{t("directory.call", locale)}</a></Button> : null}
          {row.listing_table === "facilities" ? <Button variant="outline" className={TOUCH} onClick={() => setPanel(panel === "book" ? "none" : "book")}>{t("directory.book", locale)}</Button> : null}
          <Button variant="ghost" className={TOUCH} onClick={() => setPanel(panel === "report" ? "none" : "report")}>{t("directory.report", locale)}</Button>
        </div>
        {panel === "report" ? <ReportForm row={row} locale={locale} /> : null}
        {panel === "book" ? <BookForm row={row} locale={locale} /> : null}
      </CardContent>
    </Card>
  );
}

export function DirectorySearch({ locale }: { locale: Locale }) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  // The filters and the moment they were submitted travel together: "open now" must not re-key the query on every render.
  const [submitted, setSubmitted] = useState<{ filters: SearchFilters; nowIso: string } | null>(null);
  const [locError, setLocError] = useState(false);
  // The place is held in memory for this search only. It is sent as an argument and never written anywhere.
  const args = searchArgs(submitted?.filters ?? EMPTY_FILTERS, submitted?.nowIso ?? "");
  const result = useDirectorySearch(args, submitted !== null);
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  function toggleNearMe(on: boolean) {
    setLocError(false);
    if (!on) return set("near", null);
    navigator.geolocation?.getCurrentPosition(
      (p) => set("near", { lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setLocError(true),
      { maximumAge: 60_000, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ filters, nowIso: new Date().toISOString() });
        }}
      >
        {(["state", "service", "language", "hmo"] as const).map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`f-${k}`}>{t(`directory.filter.${k}` as const, locale)}</Label>
            <Input id={`f-${k}`} value={filters[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <label className={`flex items-center gap-2 ${TOUCH}`}>
          <input type="checkbox" checked={filters.nhia} onChange={(e) => set("nhia", e.target.checked)} />
          {t("directory.filter.nhia", locale)}
        </label>
        <label className={`flex items-center gap-2 ${TOUCH}`}>
          <input type="checkbox" checked={filters.openNow} onChange={(e) => set("openNow", e.target.checked)} />
          {t("directory.filter.open_now", locale)}
        </label>
        <label className={`flex items-center gap-2 ${TOUCH}`}>
          <input type="checkbox" checked={filters.near !== null} onChange={(e) => toggleNearMe(e.target.checked)} />
          {t("directory.filter.use_location", locale)}
        </label>
        <p className={`text-sm ${MUTED}`}>{t("directory.filter.location_note", locale)}</p>
        {locError ? <p role="alert" className="text-sm">{t("directory.error", locale)}</p> : null}
        <Button type="submit" className={TOUCH}>{t("directory.search", locale)}</Button>
      </form>

      {result.error instanceof DirectoryNotOpenError ? <p role="status">{t("directory.not_open", locale)}</p> : null}
      {result.isError && !(result.error instanceof DirectoryNotOpenError) ? <p role="alert">{t("directory.error", locale)}</p> : null}
      {result.isSuccess && result.data.length === 0 ? <p role="status">{t("directory.none", locale)}</p> : null}
      <div className="space-y-3">
        {(result.data ?? []).map((row) => (
          <Listing key={`${row.listing_table}-${row.listing_id}`} row={row} locale={locale} platform={detectMapsPlatform()} hmoQuery={submitted?.filters.hmo.trim() ?? ""} />
        ))}
      </div>
    </div>
  );
}
