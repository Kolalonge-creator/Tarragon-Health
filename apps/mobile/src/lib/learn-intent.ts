/**
 * A one-shot hand-off from Today to the Learn screen: "Start the lesson" on the this-week card records which lesson to open, and
 * the Learn screen takes it on mount. Module state only (never persisted, never a deep link), so a stale request cannot survive an
 * app restart.
 */
let requested: string | null = null;

export function requestLesson(code: string): void {
  requested = code;
}

export function takeRequestedLesson(): string | null {
  const code = requested;
  requested = null;
  return code;
}
