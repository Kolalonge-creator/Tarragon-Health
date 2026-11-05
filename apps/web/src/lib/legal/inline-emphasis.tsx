import { Fragment } from "react";

/**
 * Renders the one inline mark the legal texts use, `**bold**`, as <strong>.
 * The consent_versions bodies carry it (46 marks in Terms v2, 12 in the
 * Telehealth consent), and both the public legal pages and the onboarding
 * consent step printed the asterisks literally. Anything else is shown as
 * plain text: no HTML is ever injected, so a body can never smuggle markup.
 * An unpaired `**` is left as typed rather than guessed at.
 */
export function splitEmphasis(text: string): Array<{ bold: boolean; text: string }> {
  const parts: Array<{ bold: boolean; text: string }> = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ bold: false, text: text.slice(last, start) });
    parts.push({ bold: true, text: m[1] });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ bold: false, text: text.slice(last) });
  return parts;
}

export function InlineEmphasis({ text }: { text: string }) {
  return (
    <>
      {splitEmphasis(text).map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold text-charcoal-ink">
            {part.text}
          </strong>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </>
  );
}
