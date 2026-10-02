/**
 * Motion tokens. Durations in milliseconds; spring configs for Reanimated.
 * Motion is information (a saved reading settles, a sheet rises from where it
 * was asked), never decoration, and every component checks the reduce-motion
 * setting before animating.
 */
export const duration = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 340,
} as const;

export const spring = {
  /** Press feedback: quick and slightly firm. */
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  /** Sheets and toasts: a soft settle. */
  settle: { damping: 22, stiffness: 220, mass: 0.9 },
} as const;

/** Scale a pressed control sinks to. */
export const PRESS_SCALE = 0.97;
