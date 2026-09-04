/**
 * §24.11's patient-facing FAQ. Content-as-code, matching the marketing
 * site's own HOMEPAGE_FAQS pattern (apps/web/src/app/(marketing)/_content/services.ts)
 * — but deliberately a separate array, not an extension of it: marketing
 * pages must not import platform/auth modules, and this FAQ is genuinely
 * in-app, post-login, and general (not organised by support-ticket
 * category, since this page's tickets are technical-support only — see
 * lib/validation/support-tickets.ts). Appointment/lab/pharmacy/payment
 * questions point to the "Need help" card on the Care page
 * (navigation_requests, module 75) rather than to a ticket here.
 */
export interface SupportFaqEntry {
  question: string;
  answer: string;
}

export const SUPPORT_FAQS: SupportFaqEntry[] = [
  {
    question: "How does Tarragon work?",
    answer:
      "You log your vitals, symptoms, and medications in the app, and your care team reviews them against clinical protocols — escalating to a doctor whenever something needs one. Reminders and alerts come through the app and, where useful, WhatsApp or SMS.",
  },
  {
    question: "How do I get help with an appointment, pharmacy, lab, insurance, referral, or payment issue?",
    answer:
      "Use the \"Need help\" card on your Care page — a navigator will pick it up and follow through with you. This Help & support page is for technical/app issues and formal complaints.",
  },
  {
    question: "The app is crashing, freezing, or not saving what I enter — what do I do?",
    answer:
      "File a ticket below with what you were doing when it happened, your device, and whether it happens every time. That gets it in front of our technical team, with a Tier 1 → Tier 2 → Engineering escalation path if it needs deeper investigation.",
  },
  {
    question: "How do I contact my doctor?",
    answer:
      "Use Messages to reach your care team directly in the app — that's the on-the-record way to reach them. This Help & support page is for technical issues and complaints; Messages is for talking with your care team.",
  },
  {
    question: "How do I update my profile?",
    answer: "Go to Profile in the sidebar to update your contact details, address, and emergency contact.",
  },
  {
    question: "I'm not satisfied with how something was handled — what can I do?",
    answer:
      "File a formal complaint below. It goes through an accountable review process (acknowledged → investigated → responded to → resolved), and anything indicating a real safety concern is escalated into a formal clinical incident review.",
  },
];
