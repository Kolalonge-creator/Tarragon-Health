import { SUPPORT_KNOWLEDGE_BASE, type KnowledgeBaseArticle } from "../_content/knowledge-base";

const TOPIC_LABEL: Record<KnowledgeBaseArticle["topic"], string> = {
  appointments: "Appointments",
  pharmacy: "Pharmacy",
  laboratory: "Laboratory",
  payments: "Payments",
  technical: "Technical troubleshooting",
  escalation: "Escalation",
};

export default function SupportKnowledgeBasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Internal knowledge base</h1>
        <p className="text-sm text-charcoal-ink/60">
          Common questions, appointment/pharmacy/laboratory processes, payments, and technical
          troubleshooting — reference material for handling a ticket, not patient-facing.
        </p>
      </div>
      <div className="space-y-3">
        {SUPPORT_KNOWLEDGE_BASE.map((article) => (
          <div key={article.title} className="rounded-lg border border-charcoal-ink/10 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">{TOPIC_LABEL[article.topic]}</p>
            <h2 className="mt-1 font-medium text-charcoal-ink">{article.title}</h2>
            <p className="mt-1 text-sm text-charcoal-ink/70">{article.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
