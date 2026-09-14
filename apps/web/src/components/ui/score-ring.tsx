/**
 * A circular meter for a 0-100 score, shared by every card that visualises one
 * (HealthScoreCard, BiologicalAgeCard) so the ring math and theming live in one
 * place instead of being copy-pasted per card. Same dataviz convention as any
 * other meter in this app: "the fill carries severity, the unfilled track is a
 * lighter step of the same ramp."
 *
 * `colorVar` takes a Tailwind v4 theme color variable name (e.g.
 * "--color-green-500"), not a raw hex value, and is used at full opacity for
 * the filled arc and at low opacity for the track — that trick is what makes
 * this render correctly in both light and dark mode with a single color: an
 * opacity-only track needs no separate dark-mode value, unlike a literal hex
 * track color would.
 */
export function ScoreRing({
  value,
  colorVar,
  size = 160,
  strokeWidth = 12,
  children,
}: {
  /** 0-100; clamped before use so an out-of-range value never breaks the arc math. */
  value: number;
  colorVar: string;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const dashOffset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div className="relative" style={{ height: size, width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`var(${colorVar})`}
          strokeOpacity={0.15}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`var(${colorVar})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
