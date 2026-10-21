import type { RenderModel, Block, ChartGeo, GaugeGeo } from "@/lib/health-report/render-model";

/**
 * Text-first rendering of a signed yearly report (S46, principles 3, 11). No images, no scripts, no colour-only meaning: every state is a word plus a symbol,
 * and the `print:` styles give plain black on white for an A4 sheet. The same RenderModel feeds the PDF.
 */
/**
 * Greyscale-safe graphics (S46d): black line and markers, a light grey band with a dashed outline, no colour carries any meaning. Every chart and bar is
 * followed by a sentence that says the same thing in words, and the data is also listed as text in the same section.
 */
function Chart({ geo, alt }: { geo: ChartGeo; alt: string }) {
  return (
    <svg viewBox={`0 0 ${geo.width} ${geo.height}`} role="img" aria-label={alt} className="h-auto w-full max-w-md text-black dark:text-white print:text-black">
      <title>{alt}</title>
      {geo.band ? <rect x={0} y={geo.band.y} width={geo.width} height={geo.band.height} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeDasharray="4 3" strokeWidth={0.75} /> : null}
      <path d={geo.path} fill="none" stroke="currentColor" strokeWidth={2} />
      {geo.dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={i === geo.dots.length - 1 ? 5 : 3} fill="currentColor" />
      ))}
    </svg>
  );
}

function Gauge({ g }: { g: GaugeGeo }) {
  return (
    <div className="mt-1 max-w-xs text-black dark:text-white print:text-black">
      <svg viewBox="0 0 100 12" role="img" aria-label={g.caption} className="h-3 w-full">
        <title>{g.caption}</title>
        <rect x={0} y={4} width={100} height={4} fill="none" stroke="currentColor" strokeWidth={0.5} />
        <rect x={g.bandFrom} y={4} width={Math.max(0, g.bandTo - g.bandFrom)} height={4} fill="currentColor" fillOpacity={0.25} />
        <path d={`M${g.marker} 0 L${g.marker + 2} 6 L${g.marker} 12 L${g.marker - 2} 6 Z`} fill="currentColor" />
      </svg>
      <p className="text-xs opacity-80">{g.caption}</p>
    </div>
  );
}

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
    case "chart":
      return (
        <figure className="print:break-inside-avoid">
          <Chart geo={b.geo} alt={b.alt} />
          <figcaption className="mt-1 space-y-0.5 text-xs">
            <p className="font-medium">{b.caption}</p>
            {b.notes.map((n) => (
              <p key={n} className="opacity-80">{n}</p>
            ))}
          </figcaption>
        </figure>
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
          {b.gauge ? <Gauge g={b.gauge} /> : null}
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
