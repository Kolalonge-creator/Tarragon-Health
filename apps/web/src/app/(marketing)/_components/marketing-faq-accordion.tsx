import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = {
  question: string;
  answer: string;
};

/**
 * Plain <details>/<summary> accordion, no client JS or extra dependency
 * needed: the browser already handles open/close state and keyboard/
 * screen-reader semantics for free.
 *
 * "card" (default) is the boxed style already used across most product
 * pages. "minimal" is a flatter, hairline-divider treatment (no border/
 * background per item) for pages where the FAQ is the whole point of the
 * page (faq, pricing) rather than a closing section on a longer page.
 */
export function FaqAccordion({
  items,
  variant = "card",
}: {
  items: FaqItem[];
  variant?: "card" | "minimal";
}) {
  if (variant === "minimal") {
    return (
      <div className="mx-auto max-w-3xl divide-y divide-charcoal-ink/10">
        {items.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-lg font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              {item.question}
              <Plus
                aria-hidden
                className="h-5 w-5 shrink-0 text-charcoal-ink/50 transition-transform duration-200 group-open:rotate-45"
              />
            </summary>
            <p className="mt-3 text-charcoal-ink/70">{item.answer}</p>
          </details>
        ))}
      </div>
    );
  }

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
              className={cn(
                "h-5 w-5 shrink-0 text-brand-green transition-transform duration-200 group-open:rotate-45"
              )}
            />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
