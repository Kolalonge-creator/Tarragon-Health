import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";

export type StepperStepState = "complete" | "current" | "upcoming" | "skipped";

export interface StepperStep {
  key: string;
  label: string;
  state: StepperStepState;
}

const STATE_TINT: Record<StepperStepState, keyof typeof SEVERITY_TILE_TINT> = {
  complete: "green",
  current: "blue",
  upcoming: "grey",
  skipped: "grey",
};

/**
 * Horizontal on desktop, stacked on mobile — no existing stepper/timeline
 * component in this codebase, so this reuses the same Badge-adjacent color
 * tokens (SEVERITY_TILE_TINT) rather than inventing a new palette.
 */
export function Stepper({ steps }: { steps: StepperStep[] }) {
  return (
    <ol className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-1">
      {steps.map((step, i) => {
        const tint = SEVERITY_TILE_TINT[STATE_TINT[step.state]];
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tint.tintClassName} ${tint.iconClassName} ${
                step.state === "skipped" ? "opacity-50 line-through" : ""
              }`}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span className="hidden text-charcoal-ink/20 md:inline" aria-hidden>
                &rarr;
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
