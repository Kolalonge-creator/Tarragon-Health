/**
 * §24.10's internal support knowledge base, narrowed to technical support
 * and clinical-escalation judgment calls — appointment/pharmacy/laboratory/
 * payment reference material belongs with the navigator worklist
 * (navigation_requests, module 75) that now owns those categories.
 * Content-as-code, same choice as the patient FAQ (support/_content/faq.ts)
 * — genuinely static reference material at this stage, not a per-tenant
 * authored CMS.
 */
export interface KnowledgeBaseArticle {
  title: string;
  body: string;
  topic: "technical" | "escalation";
}

export const SUPPORT_KNOWLEDGE_BASE: KnowledgeBaseArticle[] = [
  {
    title: "App crash or login problem",
    body:
      "Start with the basics: app version, device OS, and whether it happens on every login or just once. If it reproduces consistently, this is a real Tier 1 -> Tier 2 -> Engineering ticket, not a one-off — use the technical escalation ladder rather than guessing at a fix yourself.",
    topic: "technical",
  },
  {
    title: "A reading or entry didn't save",
    body:
      "Ask what screen they were on and whether they saw a confirmation. If the data genuinely didn't save, check whether it's a sync/connectivity issue (common on a poor connection) before treating it as a bug — but log it either way so a pattern across patients is visible.",
    topic: "technical",
  },
  {
    title: "When to escalate to clinical review",
    body:
      "Escalate a ticket into clinical review when the patient is asking something that needs real clinical judgment — a described symptom or medication concern that came in through a technical ticket by mistake. Never answer a clinical question yourself, and never create an ordinary ticket for something that sounds like a medical emergency (severe chest pain, trouble breathing, etc.) — that goes straight to the emergency pathway instead.",
    topic: "escalation",
  },
  {
    title: "Wrong entry point — appointment, pharmacy, lab, insurance, referral, or payment",
    body:
      "Those aren't handled here. Point the patient to \"Need help\" on their Care page (navigation_requests) — it goes to the navigator worklist, not this queue. Reassign or close out anything that lands here by mistake rather than working it as a technical ticket.",
    topic: "technical",
  },
];
