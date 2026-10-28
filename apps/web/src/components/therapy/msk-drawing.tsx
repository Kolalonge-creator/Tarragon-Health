import { MSK_DRAWINGS, MSK_DRAWING_ALT, MSK_VIEWBOX, arrowHead, type MskShape } from "@tarragon/shared";

const pts = (p: readonly (readonly [number, number])[]): string => p.map(([x, y]) => `${x},${y}`).join(" ");

function Shape({ s }: { s: MskShape }) {
  if (s.t === "c") return <circle cx={s.x} cy={s.y} r={s.r} fill="none" stroke="currentColor" strokeWidth={2.5} />;
  if (s.t === "l") {
    return (
      <polyline
        points={pts(s.p)}
        fill="none"
        stroke="currentColor"
        strokeWidth={s.role === "prop" ? 1.5 : 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={s.role === "prop" ? 0.55 : undefined}
      />
    );
  }
  const head = arrowHead(s.p);
  return (
    <g className="text-brand-green dark:text-brand-green-bright" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points={pts(s.p)} />
      {head && <polyline points={pts(head)} />}
    </g>
  );
}

/**
 * One exercise drawing (S96). A simple original stick figure, drawn from data in @tarragon/shared, so it is bundled with the app and works
 * offline. It uses the text colour, so light and dark mode both stay readable. The alt text is the description for a screen reader.
 */
export function MskDrawing({ exerciseKey, className }: { exerciseKey: string; className?: string }) {
  const shapes = MSK_DRAWINGS[exerciseKey];
  if (!shapes) return null;
  const alt = MSK_DRAWING_ALT[exerciseKey] ?? "";
  return (
    <svg
      viewBox={`0 0 ${MSK_VIEWBOX.width} ${MSK_VIEWBOX.height}`}
      role="img"
      aria-label={alt}
      className={className ?? "h-28 w-auto text-charcoal-ink dark:text-night-ink"}
      data-testid={`msk-drawing-${exerciseKey}`}
    >
      <title>{alt}</title>
      {shapes.map((s, i) => (
        <Shape key={i} s={s} />
      ))}
    </svg>
  );
}
