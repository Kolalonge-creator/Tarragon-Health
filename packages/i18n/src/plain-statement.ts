import { t, type Locale } from "./translate";
import type { MessageKey } from "./en";

/**
 * The one-page "Pricing and accessibility" statement, shared by the public site, the web Settings and the phone Settings so the
 * three cannot drift. The wording lives in the catalogue (`plain.*`). The Membership price is never typed here: each surface reads
 * it from versioned configuration and passes the already formatted figure in. When it cannot be read, pass null and the statement
 * says "See the price in the app before you pay" instead of showing a number.
 */
export interface PlainStatementInput {
  /** The formatted naira figure for Membership, without the naira sign, or null when it could not be read. */
  readonly price: string | null;
  /** The refund window in days, or null when it could not be read. */
  readonly refundDays: number | null;
}

export interface PlainStatement {
  readonly title: string;
  readonly intro: string;
  readonly privacy: { readonly title: string; readonly points: readonly string[]; readonly fullLink: string };
  readonly pricing: {
    readonly title: string;
    readonly freeHead: string;
    readonly freeBody: string;
    readonly paidHead: string;
    readonly paidBody: string;
    readonly priceLine: string;
    readonly refundLine: string | null;
    readonly medicines: string;
    readonly noTricks: string;
    readonly seePage: string;
  };
  readonly access: { readonly title: string; readonly points: readonly string[]; readonly limits: string; readonly fullLink: string };
  readonly ads: { readonly title: string; readonly body: string };
}

export function plainStatement(input: PlainStatementInput, locale: Locale = "en"): PlainStatement {
  const tr = (key: string, params?: Record<string, string | number>) => t(`plain.${key}` as MessageKey, locale, params);
  return {
    title: tr("title"),
    intro: tr("intro"),
    privacy: {
      title: tr("privacy.title"),
      points: [1, 2, 3, 4].map((n) => tr(`privacy.${n}`)),
      fullLink: tr("privacy.full"),
    },
    pricing: {
      title: tr("pricing.title"),
      freeHead: tr("pricing.free_head"),
      freeBody: tr("pricing.free_body"),
      paidHead: tr("pricing.paid_head"),
      paidBody: tr("pricing.paid_body"),
      priceLine: input.price === null ? tr("pricing.price_unavailable") : tr("pricing.price", { price: input.price }),
      refundLine:
        input.price !== null && input.refundDays !== null ? tr("pricing.refund", { days: input.refundDays }) : null,
      medicines: tr("pricing.medicines"),
      noTricks: tr("pricing.no_tricks"),
      seePage: tr("pricing.see_page"),
    },
    access: {
      title: tr("access.title"),
      points: ["text", "reader", "audio", "motion", "skip"].map((n) => tr(`access.${n}`)),
      limits: tr("access.limits"),
      fullLink: tr("access.full"),
    },
    ads: { title: tr("ads.title"), body: tr("ads.body") },
  };
}
