/**
 * §24.10's internal support knowledge base — common questions, appointment
 * policies, pharmacy/laboratory processes, payments, technical
 * troubleshooting. Content-as-code, same choice as the patient FAQ
 * (support/_content/faq.ts) — genuinely static reference material at this
 * stage, not a per-tenant authored CMS.
 */
export interface KnowledgeBaseArticle {
  title: string;
  body: string;
  topic: "appointments" | "pharmacy" | "laboratory" | "payments" | "technical" | "escalation";
}

export const SUPPORT_KNOWLEDGE_BASE: KnowledgeBaseArticle[] = [
  {
    title: "Appointment cancellation/reschedule policy",
    body:
      "A patient can cancel or reschedule from Appointments in the app up until the visit is due to start. If a reschedule button isn't working, check the appointment's current status first — a held slot that already expired needs to be rebooked from scratch, not rescheduled.",
    topic: "appointments",
  },
  {
    title: "Missed appointment / no-show",
    body:
      "A no-show is marked by the clinician after the fact; it doesn't need support intervention unless the patient disputes it or the appointment engine's reminder didn't fire — in that case, log the ticket under Technical.",
    topic: "appointments",
  },
  {
    title: "Pharmacy delivery running late",
    body:
      "Pharmacy delivery/stock/medication issues are logistics, not clinical — you can reassure the patient and follow up with the pharmacy partner directly. Only escalate to clinical review if the patient describes a medication side effect or safety concern, not a delivery delay.",
    topic: "pharmacy",
  },
  {
    title: "Lab result delayed or missing",
    body:
      "Turnaround varies by test and lab partner. Check whether the sample was actually collected before assuming the delay is on the lab's side — an uncollected sample is the single most common cause of a \"missing\" result.",
    topic: "laboratory",
  },
  {
    title: "Failed or disputed payment",
    body:
      "Payment issues (failed charge, refund request, invoice question) stay with support unless they're tied to a clinical dispute. Refunds need a supervisor's sign-off — don't process one from a support conversation alone.",
    topic: "payments",
  },
  {
    title: "App crash or login problem",
    body:
      "Start with the basics: app version, device OS, and whether it happens on every login or just once. If it reproduces consistently, this is a real Tier 1 -> Tier 2 -> Engineering ticket, not a one-off — use the technical escalation ladder rather than guessing at a fix yourself.",
    topic: "technical",
  },
  {
    title: "When to escalate to clinical review",
    body:
      "Escalate a ticket into clinical review when the patient is asking something that needs real clinical judgment — \"who should I see,\" \"is this normal,\" a described symptom or medication concern — even if it arrived under a non-clinical category. Never answer a clinical question yourself, and never create an ordinary ticket for something that sounds like a medical emergency (severe chest pain, trouble breathing, etc.) — that goes straight to the emergency pathway instead.",
    topic: "escalation",
  },
];
