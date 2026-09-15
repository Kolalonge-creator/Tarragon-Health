import { SUPPORT_FAQS } from "./_content/faq";

/** §24.11's patient FAQ — native <details>/<summary>, same lightweight pattern as the marketing site's FAQ. */
export function FaqAccordion() {
  return (
    <div className="space-y-2">
      {SUPPORT_FAQS.map((entry) => (
        <details key={entry.question} className="group rounded-lg border border-charcoal-ink/10 bg-white px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-charcoal-ink marker:hidden">
            {entry.question}
          </summary>
          <p className="mt-2 text-sm text-charcoal-ink/70">{entry.answer}</p>
        </details>
      ))}
    </div>
  );
}
