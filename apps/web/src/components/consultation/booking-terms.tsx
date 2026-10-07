"use client";

import { t, type Locale } from "@tarragon/i18n";
import { koboToNaira } from "@tarragon/shared";
import { useMyBookingTerms, type BookingTerms } from "@/lib/queries/appointments";

/**
 * S64 (15.7): the price, the cancel rule and what comes back, shown BEFORE the patient pays, on every booking path. Every number comes
 * from the live policy and the live product (my_booking_terms), never from this file. What comes back on a cancelled visit is the visit
 * credit, not cash: whether money is returned is still undecided (OQ-133), so this screen never promises it.
 */
export function BookingTermsView({ terms, locale = "en" }: { terms: BookingTerms; locale?: Locale }) {
  const price = terms.price_kobo === null ? null : `₦${koboToNaira(terms.price_kobo).toLocaleString("en-NG")}`;
  return (
    <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15" data-testid="booking-terms">
      <p className="font-medium">{t("terms.title", locale)}</p>
      {price ? <p>{t("terms.price", locale, { price })}</p> : <p>{t("terms.unpriced", locale)}</p>}
      <p>{t("terms.cancel", locale, { hours: terms.cancel_window_hours })}</p>
      {!terms.late_cancel_credit_returned && <p>{t("terms.late", locale)}</p>}
      <p>{t("terms.care_team_cancels", locale)}</p>
      <p>{t("terms.adult", locale, { age: terms.min_age_years })}</p>
    </div>
  );
}

/** Loads the terms for one appointment type. A failed load says so (it is never silently empty), so nobody pays unseen. */
export function BookingTermsCard({ appointmentType, locale = "en" }: { appointmentType: string; locale?: Locale }) {
  const { data, isError } = useMyBookingTerms(appointmentType);
  if (isError) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("terms.load_failed", locale)}</p>;
  if (!data) return null;
  return <BookingTermsView terms={data} locale={locale} />;
}
