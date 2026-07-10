export type PricingLabel = "INCLUDED" | "BOOK & PAY" | "FREE ELSEWHERE" | "ADD-ON";

export type PricingLineItem = {
  feature: string;
  label: PricingLabel;
};

export type PricingTier = {
  id: string;
  name: string;
  priceNgn?: string;
  priceGbp?: string;
  period?: string;
  description: string;
  highlight?: boolean;
  items: PricingLineItem[];
};

export const PRICING_LABELS: Record<
  PricingLabel,
  { title: string; description: string; className: string }
> = {
  INCLUDED: {
    title: "Included",
    description: "Part of your plan at no extra charge",
    className: "bg-brand-green/10 text-deep-forest",
  },
  "BOOK & PAY": {
    title: "Book & pay",
    description: "Available through Tarragon; you pay the partner directly",
    className: "bg-clinical-navy/10 text-clinical-navy",
  },
  "FREE ELSEWHERE": {
    title: "Free elsewhere",
    description: "Available outside Tarragon at no charge",
    className: "bg-soft-sage text-charcoal-ink",
  },
  "ADD-ON": {
    title: "Add-on",
    description: "Optional paid upgrade",
    className: "bg-sprout-gold/15 text-charcoal-ink",
  },
};

export const NGN_TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Tarragon Free",
    priceNgn: "₦0",
    period: "forever",
    description: "Self-monitoring, reminders, and education — no clinician review.",
    items: [
      { feature: "BP, glucose, and weight logging", label: "INCLUDED" },
      { feature: "Medication and appointment reminders", label: "INCLUDED" },
      { feature: "Preventive screening calendar", label: "INCLUDED" },
      { feature: "Health education library", label: "INCLUDED" },
      { feature: "Downloadable Health Passport PDF", label: "INCLUDED" },
      { feature: "Clinician review of readings", label: "ADD-ON" },
      { feature: "Lab booking through partner network", label: "BOOK & PAY" },
      { feature: "Emergency room care", label: "FREE ELSEWHERE" },
    ],
  },
  {
    id: "essential",
    name: "Essential Care",
    priceNgn: "₦8,000",
    period: "per month",
    description: "Clinician-led monitoring for one chronic condition.",
    highlight: true,
    items: [
      { feature: "BP and glucose tracking with trend view", label: "INCLUDED" },
      { feature: "Medication reminders via WhatsApp and app", label: "INCLUDED" },
      { feature: "Nurse review when readings drift", label: "INCLUDED" },
      { feature: "Doctor escalation when closer care is needed", label: "INCLUDED" },
      { feature: "Lab tests through partner network", label: "BOOK & PAY" },
      { feature: "Pharmacy fulfilment", label: "BOOK & PAY" },
      { feature: "Annual health check bundle", label: "ADD-ON" },
    ],
  },
  {
    id: "complete",
    name: "Complete Care",
    priceNgn: "₦25,000",
    period: "per year add-on",
    description: "Essential Care plus preventive health and care-gap closure.",
    items: [
      { feature: "Everything in Essential Care", label: "INCLUDED" },
      { feature: "Preventive screening reminders", label: "INCLUDED" },
      { feature: "Care-gap tracking and follow-up", label: "INCLUDED" },
      { feature: "Clinician review of abnormal screening results", label: "INCLUDED" },
      { feature: "Upgrade into chronic monitoring when needed", label: "INCLUDED" },
      { feature: "Specialist referral coordination", label: "BOOK & PAY" },
      { feature: "Premium ParentCare coordinator", label: "ADD-ON" },
    ],
  },
  {
    id: "family",
    name: "Family Plan",
    priceNgn: "₦150,000",
    period: "per year",
    description: "Monitoring for 4–6 family members, including ParentCare.",
    items: [
      { feature: "Up to 6 family members on one plan", label: "INCLUDED" },
      { feature: "ParentCare coordination and family updates", label: "INCLUDED" },
      { feature: "Chronic and preventive monitoring per member", label: "INCLUDED" },
      { feature: "Shared family health record vault", label: "INCLUDED" },
      { feature: "Lab panels for each member", label: "BOOK & PAY" },
      { feature: "Dedicated clinician coordinator", label: "ADD-ON" },
    ],
  },
];

export const GBP_TIERS: PricingTier[] = [
  {
    id: "diaspora-essential",
    name: "Diaspora Essential",
    priceGbp: "£15",
    period: "per month",
    description: "Monitor one loved one in Nigeria from abroad.",
    highlight: true,
    items: [
      { feature: "One condition monitored remotely", label: "INCLUDED" },
      { feature: "WhatsApp and app updates", label: "INCLUDED" },
      { feature: "Monthly doctor call review", label: "INCLUDED" },
      { feature: "ParentCare family summaries", label: "INCLUDED" },
      { feature: "Lab tests in Nigeria", label: "BOOK & PAY" },
      { feature: "Full family plan upgrade", label: "ADD-ON" },
    ],
  },
  {
    id: "diaspora-premium",
    name: "Diaspora Premium",
    priceGbp: "£45",
    period: "per month",
    description: "Full monitoring plus family portal access.",
    items: [
      { feature: "Everything in Diaspora Essential", label: "INCLUDED" },
      { feature: "Multiple family members monitored", label: "INCLUDED" },
      { feature: "Preventive screening coordination", label: "INCLUDED" },
      { feature: "Priority escalation support", label: "INCLUDED" },
      { feature: "Specialist referrals in Nigeria", label: "BOOK & PAY" },
      { feature: "In-person home nurse visits", label: "ADD-ON" },
    ],
  },
];
