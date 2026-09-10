"use client";

import { koboToNaira } from "@tarragon/shared";
import type { PanelBundle } from "@/lib/queries/lab-orders";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * How a test is presented now that Tarragon does not sell tests.
 *
 * The catalogue became guidance on 2026-09-10: what Tarragon recorded as its
 * cost for a test was the laboratory's own published retail price, so any
 * margin made Tarragon dearer than the laboratory performing it. Deciding which
 * tests someone needs stays free and is still the point of the platform;
 * reading the result is what is now paid for.
 *
 * So this renders three things a checkout button never did — what it costs at a
 * major private laboratory, that smaller ones are usually cheaper, and where to
 * actually go — and one thing it did: a way to get the request.
 *
 * TWO RULES FOR ANYONE EDITING THIS
 *
 * 1. The indicative price is what a LABORATORY charges, never what Tarragon
 *    charges. It must always read as an estimate the patient can check, never
 *    as a quote. If you find yourself adding a "Pay" button here, the
 *    commercial decision has been reversed and the database will refuse the
 *    order anyway (private.enforce_guidance_only_is_never_billed).
 * 2. Never name a single laboratory as the place to go. `where_to_get` is
 *    written at the category level on purpose — sending everyone to one
 *    provider is how the platform ended up marking up that provider's retail
 *    price in the first place.
 */

/** The estimate, or null when no active provider prices every component. */
export function indicativePriceLabel(bundle: {
  indicative_price_kobo: number | null;
}): string | null {
  if (!bundle.indicative_price_kobo) return null;
  return `₦${koboToNaira(bundle.indicative_price_kobo).toLocaleString("en-NG")}`;
}

export function TestGuidanceDetail({
  bundle,
}: {
  bundle: Pick<
    PanelBundle,
    "indicative_price_kobo" | "indicative_price_checked_on" | "where_to_get"
  >;
}) {
  const price = indicativePriceLabel(bundle);

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-soft-sage/40 p-3">
      <div className="flex items-start gap-2">
        <SEMANTIC_ICON.billing
          className="mt-0.5 h-4 w-4 shrink-0 text-clinical-navy"
          strokeWidth={2}
          aria-hidden
        />
        <p className="text-xs leading-relaxed text-charcoal-ink/80">
          {price ? (
            <>
              <span className="font-medium text-charcoal-ink">
                About {price} at a major private laboratory.
              </span>{" "}
              Smaller laboratories are often cheaper for the same test, so it is worth asking two.
              You pay the laboratory directly, at their price. Tarragon adds nothing and takes no
              cut.
            </>
          ) : (
            <>
              <span className="font-medium text-charcoal-ink">
                Ask the laboratory for their current price.
              </span>{" "}
              We do not have a reliable figure for this one, so we would rather say so than guess.
              You pay them directly; Tarragon adds nothing.
            </>
          )}
        </p>
      </div>

      {bundle.where_to_get ? (
        <p className="pl-6 text-xs leading-relaxed text-charcoal-ink/65">{bundle.where_to_get}</p>
      ) : null}
    </div>
  );
}

/**
 * One recommended test or panel, with what to expect it to cost, where to get
 * it, and a way to get the written request.
 *
 * `action` is passed in rather than owned here because the surfaces that use
 * this differ in how a request is raised: some are answering a due screening
 * (which must carry its screening_schedule_id), some are a front-door request
 * with no schedule at all. Both land in the same free, self-arranged
 * lab_orders row.
 */
export function TestGuidanceCard({
  name,
  description,
  bundle,
  action,
}: {
  name: string;
  description?: string | null;
  bundle: Pick<
    PanelBundle,
    "indicative_price_kobo" | "indicative_price_checked_on" | "where_to_get"
  >;
  action?: React.ReactNode;
}) {
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-charcoal-ink">{name}</p>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/65">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <TestGuidanceDetail bundle={bundle} />
    </li>
  );
}

/**
 * The standing explanation, shown once above a list rather than repeated on
 * every card. Deliberately leads with what is free, because the most common
 * misreading of this change is that Tarragon has stopped doing something.
 */
export function TestGuidanceIntro() {
  return (
    <p className="text-sm leading-relaxed text-charcoal-ink/70">
      Working out which tests you need and writing the request is free, and always will be. You take
      that request to whichever laboratory you choose and pay them directly, at their price — we add
      nothing and take no cut. Upload the result when it comes back and a doctor can read it with
      you.
    </p>
  );
}
