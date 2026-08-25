import { Plus } from "lucide-react";

export type FaqItem = {
  question: string;
  answer: string;
};

/**
 * Plain <details>/<summary> accordion, no client JS or extra dependency
 * needed: the browser already handles open/close state and keyboard/
 * screen-reader semantics for free.
 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {items.map((item) => (
        <details
          key={item.question}
          className="group rounded-xl border border-charcoal-ink/10 bg-white p-5 open:pb-5"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-base font-semibold text-charcoal-ink [&::-webkit-details-marker]:hidden">
            {item.question}
            <Plus
              aria-hidden
              className="h-5 w-5 shrink-0 text-brand-green transition-transform duration-200 group-open:rotate-45"
            />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
