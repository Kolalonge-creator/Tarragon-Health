/**
 * The two plans on the pricing page and the homepage (Tarragon Health 2.0, decisions T2-01, T2-02, T2-05 and T2-09, 2026-11-04): Free
 * and Membership. Membership Plus is retired: it is no longer sold, there is no upgrade, and the public site never offers it. Laboratory
 * tests are not included in the Membership; the member uses any reputable laboratory and pays it directly. Prices are never typed here:
 * the page formats them from versioned config (commerce.membership_prices) and passes the labels in.
 *
 * Voice rules (docs/BRAND_GUIDE.md and the build brief): warm, no countdowns or scarcity, no strikethroughs, no "doctor-led", no ratios,
 * no em dashes, no Basic / Lite / Standard / Premium / Gold, no doctor review turnaround time, no laboratory price.
 */
import { t } from "@tarragon/i18n";
import { FREE_PLAN, LAB_TESTS_NOT_INCLUDED, MEMBERSHIP_INCLUDES, renewalCopy } from "@/lib/marketing/membership";

export interface PlanCard {
  id: "free" | "membership";
  name: string;
  priceLine: string;
  summary: string;
  includes: readonly string[];
}

export interface PlanPriceLabels {
  /** The Membership price, with the currency symbol. */
  membership: string;
}

/**
 * How laboratory tests work on every plan. Tarragon runs no laboratory, no testing day open to the public and no sample collection of
 * its own: the member takes the request form to any reputable laboratory, pays it directly, and uploads the report.
 */
export const LAB_TESTS_WHERE =
  "For any test, you download a request form in the app and take it to any reputable laboratory you choose. You pay the laboratory directly; contact the laboratory for current pricing. Then upload the report to the app: a doctor reviews it, and it goes into your health record and your trends.";

export const SAFETY_STATEMENT =
  "If a reading or a symptom looks urgent, the guidance you see is the same on every plan, including Free.";

export function planCards(price: PlanPriceLabels): PlanCard[] {
  return [
    {
      id: "free",
      name: FREE_PLAN.name,
      priceLine: FREE_PLAN.priceLine,
      summary: FREE_PLAN.summary,
      includes: FREE_PLAN.includes,
    },
    {
      id: "membership",
      name: t("catalog.membership_annual_no_panel.name", "en"),
      priceLine: `${price.membership} a year, paid once`,
      summary: "A year of care with your care team, on your phone. Laboratory tests and medicines are not included: you pay the laboratory or the pharmacy directly.",
      includes: MEMBERSHIP_INCLUDES,
    },
  ];
}

export function planFaq(refundDays: number, autoRenews = false): { question: string; answer: string }[] {
  return [
    {
      question: "Are laboratory tests included?",
      answer: `No. ${LAB_TESTS_WHERE}`,
    },
    {
      question: "Does it renew by itself?",
      answer: renewalCopy(autoRenews, refundDays).faqAnswer,
    },
    {
      question: "Can I get a refund?",
      answer: `Yes, within ${refundDays} days of buying. After ${refundDays} days it cannot be refunded. If a refund is approved your Member access ends straight away.`,
    },
    {
      question: "Are medicines included?",
      answer: "No. Your care team signs a prescription and you take it to any pharmacy and pay there.",
    },
    {
      question: "Can I give a Membership to someone else?",
      answer: "Yes. You can buy a year of Membership for a parent or relative. It is theirs to accept, and you never see their results.",
    },
    {
      question: "Can my employer pay for me?",
      answer:
        "Yes. An employer can buy the same Membership for each employee. If your employer pays you do not pay anything yourself, and your employer only ever sees counts, never anything about you.",
    },
  ];
}

export { LAB_TESTS_NOT_INCLUDED };
