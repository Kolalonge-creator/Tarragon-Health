import type { SupportTicketCategoryInput } from "@/lib/validation/support-tickets";

/**
 * §24.11's patient-facing FAQ. Content-as-code, matching the marketing
 * site's own HOMEPAGE_FAQS pattern (apps/web/src/app/(marketing)/_content/services.ts)
 * — but deliberately a separate array, not an extension of it: marketing
 * pages must not import platform/auth modules, and this FAQ is genuinely
 * in-app, post-login, and organised by support-ticket category rather than
 * pre-signup product-trust questions.
 */
export interface SupportFaqEntry {
  question: string;
  answer: string;
  /** null groups under "General" rather than any one ticket category. */
  category: SupportTicketCategoryInput | null;
}

export const SUPPORT_FAQS: SupportFaqEntry[] = [
  {
    question: "How does Tarragon work?",
    answer:
      "You log your vitals, symptoms, and medications in the app, and your care team reviews them against clinical protocols — escalating to a doctor whenever something needs one. Reminders and alerts come through the app and, where useful, WhatsApp or SMS.",
    category: null,
  },
  {
    question: "How do I book an appointment?",
    answer:
      "Go to Appointments in the sidebar and choose a visit type, method (video or in person), and a time that works for you.",
    category: "appointment",
  },
  {
    question: "How do I cancel or reschedule an appointment?",
    answer:
      "Open the appointment from Appointments and choose Cancel or Reschedule. If something isn't working there, file a ticket under \"Appointment\" and your care team will sort it out directly.",
    category: "appointment",
  },
  {
    question: "How do I access my results?",
    answer:
      "Results appear under Labs & results once they're in and reviewed. If a result seems delayed, file a ticket under \"Laboratory\" and we'll check on it.",
    category: "laboratory",
  },
  {
    question: "How do I contact my doctor?",
    answer:
      "Use Messages to reach your care team directly in the app — that's the on-the-record way to reach them. This Help & support page is for logistics (tickets, complaints); Messages is for talking with your care team.",
    category: null,
  },
  {
    question: "How do referrals work?",
    answer:
      "If your care team decides you need a specialist, they'll create a referral you can track from your record. If a referral seems stuck, file a ticket under \"Clinical navigation\" and describe what's happening.",
    category: "clinical_navigation",
  },
  {
    question: "How do I get my medicine?",
    answer:
      "Your prescriptions can be arranged for delivery through our pharmacy network, or you can collect them yourself. Delivery or stock issues go under \"Pharmacy\".",
    category: "pharmacy",
  },
  {
    question: "How do I update my profile?",
    answer: "Go to Profile in the sidebar to update your contact details, address, and emergency contact.",
    category: null,
  },
];

export const SUPPORT_FAQ_CATEGORY_LABEL: Record<"general" | SupportTicketCategoryInput, string> = {
  general: "General",
  technical: "Technical",
  clinical_navigation: "Clinical navigation",
  appointment: "Appointments",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  payment: "Payment",
};
