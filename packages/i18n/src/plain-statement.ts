import { t, type Locale } from "./translate";
import type { MessageKey } from "./en";

/**
 * The one-page "Pricing and accessibility" statement, shared by the public site, the web Settings and the phone Settings so the
 * three cannot drift. The wording lives in the catalogue (`plain.*`). No price is typed here: each surface reads the figures from
 * versioned configuration and passes them in already formatted. When a figure cannot be read, pass null and the statement says
 * "See the price in the app before you pay" (or the Membership screen, inside the app) instead of showing a number.
 *
 * Two shapes, following the same switch as the pricing page (`marketing.membership_ladder_public`):
 *  - ladder off: Free and one Membership (catalogue `membership_annual`, price `commerce.membership_prices`);
 *  - ladder on: Free, Membership (`membership_annual_no_panel`) and Membership Plus (`membership_annual`), prices
 *    `commerce.membership_ladder`. The one difference is the yearly blood panel.
 * The offer text comes from the same `catalog.membership_*` keys the pricing page and checkout use.
 */
export interface PlainStatementInput {
  /** Ladder off: the formatted naira figure for Membership, without the naira sign, or null when it could not be read. */
  readonly price: string | null;
  /** The refund window in days, or null when it could not be read. */
  readonly refundDays: number | null;
  /** Where the statement is shown. Inside the app, "see the price in the app" would be circular, so it points at the Membership screen. */
  readonly surface?: "public" | "app";
  /** Ladder on: the two formatted figures (no naira sign), either null when unreadable. Leave undefined when the ladder is off. */
  readonly ladder?: { readonly membership: string | null; readonly plus: string | null };
  /**
   * The renewal sentence, supplied by the surface (the web passes the pricing page's own `renewalCopy(...).short`, which already
   * carries the refund window and follows the auto-renew switch). Null: the statement makes no renewal claim and shows the refund line.
   */
  readonly renewalLine?: string | null;
}

export interface PlainOffer {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly string[];
  readonly priceLine: string;
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
    /** One offer (ladder off) or two (ladder on), each from the catalogue keys the pricing page uses. */
    readonly offers: readonly PlainOffer[];
    /** Ladder on only: one line saying the care is the same and the blood panel is the only difference. */
    readonly difference: string | null;
    /** The renewal sentence if the surface supplied one, else null. */
    readonly renewalLine: string | null;
    readonly refundLine: string | null;
    readonly noTricks: string;
    readonly seePage: string;
  };
  readonly access: { readonly title: string; readonly points: readonly string[]; readonly limits: string; readonly fullLink: string };
  readonly ads: { readonly title: string; readonly body: string };
}

export function plainStatement(input: PlainStatementInput, locale: Locale = "en"): PlainStatement {
  const tr = (key: string, params?: Record<string, string | number>) => t(`plain.${key}` as MessageKey, locale, params);
  const cat = (key: string) => t(`catalog.${key}` as MessageKey, locale);
  const unavailable = tr(input.surface === "app" ? "pricing.price_unavailable_app" : "pricing.price_unavailable");
  const priceLine = (name: string, price: string | null) => (price === null ? unavailable : tr("pricing.price", { name, price }));
  const offer = (code: string, name: string, price: string | null, count: number): PlainOffer => ({
    name,
    description: cat(`${code}.description`),
    includes: Array.from({ length: count }, (_, i) => cat(`${code}.incl.${i + 1}`)),
    priceLine: priceLine(name, price),
  });

  const ladder = input.ladder;
  const offers: PlainOffer[] = ladder
    ? [
        offer("membership_annual_no_panel", cat("membership_annual_no_panel.name"), ladder.membership, 3),
        offer("membership_annual", tr("pricing.plus_name"), ladder.plus, 4),
      ]
    : [offer("membership_annual", cat("membership_annual.name"), input.price, 4)];
  const anyPrice = ladder ? ladder.membership !== null || ladder.plus !== null : input.price !== null;
  const renewalLine = input.renewalLine ?? null;

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
      paidHead: tr(ladder ? "pricing.paid_head_ladder" : "pricing.paid_head"),
      offers,
      difference: ladder ? tr("pricing.ladder_difference") : null,
      renewalLine,
      refundLine: renewalLine === null && anyPrice && input.refundDays !== null ? tr("pricing.refund", { days: input.refundDays }) : null,
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
