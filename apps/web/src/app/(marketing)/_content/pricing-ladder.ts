/**
 * The three equal cards on the pricing page once the Membership ladder is public (founder decision 2026-10-21,
 * docs/DECISIONS.md). Free, Membership and Membership Plus. Prices are never typed here: the page formats them from the versioned
 * config (commerce.membership_ladder) and passes the labels in. The one difference between the two paid cards is the annual blood
 * panel, and it is stated in the first line of every card. Both paid cards are a Member for every safety purpose, so the page also says
 * that the care itself is the same.
 *
 * Voice rules (docs/BRAND_GUIDE.md and the build brief): warm, no countdowns or scarcity, no strikethroughs, no "doctor-led", no ratios,
 * no em dashes, no Basic / Lite / Standard / Premium / Gold, no stronger visual weight on one card.
 */
import { t } from "@tarragon/i18n";
import { renewalCopy } from "@/lib/marketing/membership";

export interface LadderCard {
  id: "free" | "evergreen" | "evergreen_plus";
  name: string;
  /** First line of the card: the single difference, "Annual blood panel: no" or "yes". */
  difference: string;
  priceLine: string;
  summary: string;
  includes: readonly string[];
}

export interface LadderPriceLabels {
  evergreen: string;
  evergreenPlus: string;
}

export const LADDER_SAME_CARE_STATEMENT =
  "Membership and Membership Plus are the same care: the same care team, the same monthly video call, the same urgent-care guidance. The only difference is the yearly blood panel.";

export const LADDER_SAFETY_STATEMENT =
  "If a reading or a symptom looks urgent, the guidance you see is the same on every plan, including Free.";

export function ladderCards(price: LadderPriceLabels): LadderCard[] {
  return [
    {
      id: "free",
      name: "Free",
      difference: "Annual blood panel: no",
      priceLine: "No cost, no card, no time limit",
      summary: "The app: tracking, reminders, education and guidance.",
      includes: [
        "Log your readings and see your trends",
        "Reminders and the screening calendar",
        "The full education library",
        "Urgent-care guidance if something looks wrong",
      ],
    },
    {
      id: "evergreen",
      name: t("catalog.membership_annual_no_panel.name", "en"),
      difference: "Annual blood panel: no",
      priceLine: `${price.evergreen} a year, paid once`,
      summary: t("catalog.membership_annual_no_panel.description", "en"),
      includes: [
        t("catalog.membership_annual_no_panel.incl.1", "en"),
        t("catalog.membership_annual_no_panel.incl.2", "en"),
        t("catalog.membership_annual_no_panel.incl.3", "en"),
      ],
    },
    {
      id: "evergreen_plus",
      name: "Membership Plus",
      difference: "Annual blood panel: yes",
      priceLine: `${price.evergreenPlus} a year, paid once`,
      summary: t("catalog.membership_annual.description", "en"),
      includes: [
        t("catalog.membership_annual.incl.1", "en"),
        t("catalog.membership_annual.incl.2", "en"),
        t("catalog.membership_annual.incl.3", "en"),
        t("catalog.membership_annual.incl.4", "en"),
      ],
    },
  ];
}

export function ladderFaq(refundDays: number, autoRenews = false): { question: string; answer: string }[] {
  return [
    {
      question: "What is the difference between Membership and Membership Plus?",
      answer:
        "One thing: the yearly blood panel. Both are a year of care with your care team, a video call every month and prescriptions your care team signs. Membership Plus adds the yearly blood panel.",
    },
    {
      question: "Can I move from Membership to Membership Plus later?",
      answer:
        "Yes, at any time in the year. You pay only the difference, once, and your year does not change. Moving the other way happens when your year ends, at renewal.",
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
      question: "Can my employer pay for me?",
      answer:
        "Yes. An employer can cover its employees. If your employer pays you do not pay anything yourself, and your employer only ever sees counts, never anything about you.",
    },
  ];
}
