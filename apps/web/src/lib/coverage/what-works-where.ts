/**
 * Which parts of Tarragon need the person to physically be in Nigeria, and
 * which do not.
 *
 * This is the honest half of the diaspora pitch. Roughly half the product is a
 * partner network: labs, pharmacies, specialists, couriers, home visits. Every
 * one of those is gated by the state rollout (region_service_available), so it
 * only exists for someone standing in a live Nigerian state. The other half is
 * monitoring, doctors over video and text, the record itself, and paying for
 * someone else's care, none of which cares where anybody is sitting.
 *
 * Before this, that split was a sentence at the bottom of the pricing page.
 * A buyer in Houston choosing a plan for a mother in Enugu had no way to see it
 * at the moment it mattered, which is immediately before paying.
 *
 * One list, two surfaces: the public coverage page and the in-app plan picker
 * both read from here, so the promise made to someone who has not signed up
 * cannot drift from the one made to someone who has.
 */

export type Locality = "anywhere" | "in_nigeria";

export type CoverageItem = {
  /** Stable key, used for React lists and tests. */
  key: string;
  label: string;
  /** Why it does or does not travel. Shown as supporting text, never a footnote. */
  detail: string;
  locality: Locality;
  /**
   * For in_nigeria items, the rollout service whose live/dark state decides
   * whether this works in a given state. Null where the item needs Nigeria but
   * no partner (a vaccination logged at any centre, say).
   */
  gatedBy: "lab" | "pharmacy" | "specialist" | "home_visit" | "delivery" | null;
};

export const COVERAGE_ITEMS: CoverageItem[] = [
  {
    key: "vitals",
    label: "Blood pressure, blood sugar and weight tracking",
    detail:
      "Readings are logged in the app and charted over time. A reading that looks dangerous raises a flag for a doctor no matter where it was taken.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "medication",
    label: "Medication reminders and adherence check-ins",
    detail: "Reminders arrive in the app, and by WhatsApp or SMS where those reach.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "ask_doctor",
    label: "Ask a doctor a written question",
    detail: "Answered by a Tarragon doctor within 24 hours. Included on the comprehensive plans.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "video_visit",
    label: "A 15-minute video consultation",
    detail:
      "Paid per visit. Your payment is held and only goes through once a doctor accepts, and it is refunded if nobody does.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "risk",
    label: "Cardiovascular and metabolic risk review",
    detail:
      "Calculated from real readings and history, against protocols a named doctor has signed.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "education",
    label: "Health education and lifestyle coaching",
    detail: "Reading and coaching matched to the conditions actually on the record.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "passport",
    label: "Health Passport export",
    detail:
      "The full record as a PDF, downloadable on any plan including the free one, to take to any clinician in any country.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "wallet",
    label: "Funding someone else's care",
    detail:
      "Top up a relative's Health Wallet from abroad and see exactly what each payment was spent on.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "next_of_kin",
    label: "Following a relative's care as next of kin",
    detail: "They accept your request first. You can see the record; only they can change it.",
    locality: "anywhere",
    gatedBy: null,
  },
  {
    key: "labs",
    label: "Lab tests and health check packages",
    detail:
      "Booked at a partner centre, so the person being tested has to be able to walk into one.",
    locality: "in_nigeria",
    gatedBy: "lab",
  },
  {
    key: "pharmacy",
    label: "Pharmacy collection",
    detail: "A prescription is routed to a partner pharmacy for collection in person.",
    locality: "in_nigeria",
    gatedBy: "pharmacy",
  },
  {
    key: "specialist",
    label: "Specialist referrals",
    detail: "Referred into a partner clinic for an in-person appointment.",
    locality: "in_nigeria",
    gatedBy: "specialist",
  },
  {
    key: "home_visit",
    label: "Home sample collection",
    detail: "Someone comes to the house to draw a sample.",
    locality: "in_nigeria",
    gatedBy: "home_visit",
  },
  {
    key: "delivery",
    label: "Medication delivery",
    detail: "Medication couriered to a Nigerian address.",
    locality: "in_nigeria",
    gatedBy: "delivery",
  },
];

export function itemsFor(locality: Locality): CoverageItem[] {
  return COVERAGE_ITEMS.filter((item) => item.locality === locality);
}

/** Every rollout service the in-Nigeria half depends on, deduplicated. */
export function gatedServices(): NonNullable<CoverageItem["gatedBy"]>[] {
  const seen = new Set<NonNullable<CoverageItem["gatedBy"]>>();
  for (const item of COVERAGE_ITEMS) if (item.gatedBy) seen.add(item.gatedBy);
  return [...seen];
}

export const SERVICE_LABEL: Record<NonNullable<CoverageItem["gatedBy"]>, string> = {
  lab: "Lab tests",
  pharmacy: "Pharmacy",
  specialist: "Specialists",
  home_visit: "Home sample collection",
  delivery: "Medication delivery",
};
