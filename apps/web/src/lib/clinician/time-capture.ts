import { z } from "zod";

/**
 * W-01 doctor-time capture: the pure parts. A VisibleTimer counts only time the clinician is actually at the page: it pauses while the tab
 * is hidden, while this surface is not the one in focus, and after IDLE_SECONDS with no pointer, key or scroll input (it resumes on the next
 * input). It holds no clock of its own, so it is tested with plain numbers. This time is for planning and pricing, never to rank or compare
 * clinicians.
 */

/** Shorter than this is noise (a glance), so it is not sent. */
export const MIN_FLUSH_SECONDS = 5;
/** The database refuses more than four hours in one entry; a longer stretch is sent in several. */
export const MAX_ENTRY_SECONDS = 14400;
/** While the page stays open and in use, send what has built up this often so a closed laptop loses little. */
export const AUTO_FLUSH_SECONDS = 300;
/** No pointer, key or scroll for this long pauses the timer. */
export const IDLE_SECONDS = 120;
const IDLE_MS = IDLE_SECONDS * 1000;

export class VisibleTimer {
  private accumulatedMs = 0;
  private runningSince: number | null = null;
  private lastInputAt: number;
  private active: boolean;

  constructor(now: number, active: boolean) {
    this.active = active;
    this.lastInputAt = now;
    if (active) this.runningSince = now;
  }

  /** The point up to which running time counts: now, but never more than IDLE_SECONDS after the last input. */
  private endOf(now: number): number {
    return Math.min(now, this.lastInputAt + IDLE_MS);
  }

  private settle(now: number): void {
    if (this.runningSince !== null) {
      this.accumulatedMs += Math.max(0, this.endOf(now) - this.runningSince);
      this.runningSince = null;
    }
  }

  /** The surface became active (tab visible and this surface in focus) or inactive at `now`. Becoming active counts as input. */
  setVisible(active: boolean, now: number): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.lastInputAt = now;
      this.runningSince = now;
    } else {
      this.settle(now);
    }
  }

  /** A pointer, key or scroll event at `now`. After an idle pause this restarts the clock; the idle stretch itself is not counted. */
  input(now: number): void {
    if (!this.active) return;
    this.settle(now);
    this.lastInputAt = now;
    this.runningSince = now;
  }

  /** Whole seconds counted so far, without resetting. */
  seconds(now: number): number {
    const live = this.runningSince === null ? 0 : Math.max(0, this.endOf(now) - this.runningSince);
    return Math.floor((this.accumulatedMs + live) / 1000);
  }

  /**
   * Take what has built up and start again from zero. Returns the seconds to send, or 0 when it is under the minimum (the time stays
   * counted, so a short glance adds up with the next one rather than being lost).
   */
  take(now: number): number {
    const total = this.seconds(now);
    if (total < MIN_FLUSH_SECONDS) return 0;
    const send = Math.min(total, MAX_ENTRY_SECONDS);
    this.accumulatedMs = (total - send) * 1000;
    // an idle period stays uncounted: with runningSince reset to now, the capped end (last input + idle) is already behind it
    if (this.runningSince !== null) this.runningSince = now;
    return send;
  }
}

export const timeEntryInputSchema = z.object({
  source: z.enum(["task", "message", "manual"]),
  sourceRef: z.string().uuid().nullable(),
  patientId: z.string().uuid(),
  seconds: z.number().int().min(1).max(MAX_ENTRY_SECONDS),
  /** Makes a repeated send of the same entry a no-op in the database. */
  clientKey: z.string().uuid(),
});

export type TimeEntryInput = z.infer<typeof timeEntryInputSchema>;

/** Manual entries: up to 120 minutes, and a confirmation in the form above 60. */
export const MAX_MANUAL_MINUTES = 120;
export const MANUAL_CONFIRM_ABOVE_MINUTES = 60;

/** Minutes typed by hand to whole seconds, or null when it is not a usable number. */
export function manualMinutesToSeconds(raw: string): number | null {
  const minutes = Number(raw.trim());
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MANUAL_MINUTES) return null;
  return Math.round(minutes * 60);
}

/** True when the form must ask the clinician to confirm before sending. */
export function manualNeedsConfirm(raw: string): boolean {
  const minutes = Number(raw.trim());
  return Number.isFinite(minutes) && minutes > MANUAL_CONFIRM_ABOVE_MINUTES;
}
