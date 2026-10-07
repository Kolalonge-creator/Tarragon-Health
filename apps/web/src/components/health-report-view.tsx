import type { RenderModel, Block } from "@/lib/health-report/render-model";

/**
 * Text-first rendering of a signed yearly report (S46, principles 3, 11). No images, no scripts, no colour-only meaning: every state is a word plus a symbol,
 * and the `print:` styles give plain black on white for an A4 sheet. The same RenderModel feeds the PDF.
 */
function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case "p":
      return <p className="text-sm leading-relaxed">{b.text}</p>;
    case "line":
      return <p className="text-sm">{b.text}</p>;
    case "priority":
      return (
        <div className="rounded border border-current/20 p-3 text-sm print:break-inside-avoid">
          <p className="font-semibold">{b.n}. {b.action}</p>
          <p>{b.why}</p>
          <p><span className="font-medium">Who helps: </span>{b.who}. <span className="font-medium">When: </span>{b.when}.</p>
        </div>
      );
    case "item":
      return (
        <div className="text-sm print:break-inside-avoid">
          <p>
            <span className="font-semibold">{b.label}</span>
            {b.value ? <span>: {b.value}</span> : null}{" "}
            <span aria-hidden="true">{b.symbol}</span> <span className="font-medium">{b.stateWord}</span>
          </p>
          {b.notes.map((n) => (
            <p key={n} className="text-xs opacity-80">{n}</p>
          ))}
        </div>
      );
  }
}

export function HealthReportView({ model }: { model: RenderModel }) {
  return (
    <article className="space-y-5 print:text-black" aria-label={model.title}>
      <header className="space-y-1 border-b pb-3">
        <h1 className="font-heading text-2xl font-semibold">{model.title}</h1>
        <p className="text-sm">{model.yearLine}. {model.versionLine}.</p>
        <p className="text-sm">{model.signedLine}</p>
        {model.correctionLine ? <p role="note" className="text-sm font-medium">{model.correctionLine}</p> : null}
      </header>
      {model.sections.map((s) => (
        <section key={s.id} className="space-y-2 print:break-inside-avoid-page" aria-labelledby={`hr-${s.id}`}>
          <h2 id={`hr-${s.id}`} className="font-heading text-lg font-semibold">{s.heading}</h2>
          {s.blocks.map((b, i) => (
            <BlockView key={`${s.id}-${i}`} b={b} />
          ))}
        </section>
      ))}
    </article>
  );
}
