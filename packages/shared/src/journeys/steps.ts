// S85: the typed step model every end to end journey uses (spec D.7.3, build plan section 3 item 7).
//
// A journey declares ALL its steps up front. Each step then ends in one of four states:
//   passed   the step ran and its assertions held
//   failed   the step ran and something did not hold (or it never ran at all)
//   pending  the step depends on something that is not built or not signed yet; it names the owner session
//   skipped  the step could not run in THIS environment (for example no Paystack test key), with the reason
//
// The point of the model is honesty about what the platform does not do yet. A journey is therefore never
// "passing" while a step is pending or skipped: its verdict is "incomplete". Only a journey whose every step
// passed is "passing", and even then this module never says anything about a stage or a gate being complete.
//
// No Node or browser imports here: the model is pure so Playwright, Jest and the report script can all use it.

export type StepStatus = "passed" | "failed" | "pending" | "skipped";

export interface StepDeclaration {
  /** Stable id, unique within the journey, lower case with dashes. */
  readonly id: string;
  readonly title: string;
}

export type StepResult =
  | { readonly status: "passed" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "pending"; readonly owner: string; readonly reason: string }
  | { readonly status: "skipped"; readonly reason: string };

export type Verdict = "failed" | "incomplete" | "passing";

export interface StepReportRow extends StepDeclaration {
  readonly result: StepResult;
}

export interface JourneyReport {
  readonly journey: string;
  readonly title: string;
  readonly verdict: Verdict;
  readonly counts: Readonly<Record<StepStatus, number>> & { readonly total: number };
  /** Pending steps grouped by the session that owns them, for the report. */
  readonly pendingByOwner: Readonly<Record<string, readonly string[]>>;
  readonly steps: readonly StepReportRow[];
}

/** A session id (S58, S59a) or several joined by a comma, or a named non-session owner such as the CMO or the founder. */
const OWNER_PATTERN = /^(S\d{2}[a-z]?(, ?S\d{2}[a-z]?)*|CMO|FOUNDER)( [^\n]{1,120})?$/;

export function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner);
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export class JourneyRun {
  private readonly results = new Map<string, StepResult>();
  private readonly order: StepDeclaration[];

  constructor(
    readonly journey: string,
    readonly title: string,
    steps: readonly StepDeclaration[],
  ) {
    if (steps.length === 0) throw new Error(`journey ${journey}: a journey with no steps proves nothing`);
    const seen = new Set<string>();
    for (const s of steps) {
      if (!ID_PATTERN.test(s.id)) throw new Error(`journey ${journey}: bad step id "${s.id}"`);
      if (seen.has(s.id)) throw new Error(`journey ${journey}: duplicate step id "${s.id}"`);
      if (s.title.trim().length === 0) throw new Error(`journey ${journey}: step "${s.id}" has no title`);
      seen.add(s.id);
    }
    this.order = steps.map((s) => ({ ...s }));
  }

  private record(id: string, result: StepResult): void {
    if (!this.order.some((s) => s.id === id)) throw new Error(`journey ${this.journey}: unknown step "${id}"`);
    if (this.results.has(id)) throw new Error(`journey ${this.journey}: step "${id}" was already resolved`);
    this.results.set(id, result);
  }

  /** Mark a step pending. The owner is mandatory so a pending step always names who turns it on. */
  pending(id: string, owner: string, reason: string): void {
    if (!isValidOwner(owner)) throw new Error(`journey ${this.journey}: pending step "${id}" needs an owner session (got "${owner}")`);
    if (reason.trim().length < 5) throw new Error(`journey ${this.journey}: pending step "${id}" needs a reason`);
    this.record(id, { status: "pending", owner, reason });
  }

  skipped(id: string, reason: string): void {
    if (reason.trim().length < 5) throw new Error(`journey ${this.journey}: skipped step "${id}" needs a reason`);
    this.record(id, { status: "skipped", reason });
  }

  /**
   * Run a step. A thrown error is recorded as a failure and the journey carries on with its other steps, so one
   * failure does not hide the state of the rest. `finish()` rethrows so the test still fails.
   */
  async step(id: string, fn: () => void | Promise<void>): Promise<boolean> {
    try {
      await fn();
    } catch (e) {
      // A matcher failure can carry hundreds of lines (an array diff); the report keeps the head, not the whole diff.
      const text = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, "");
      this.record(id, { status: "failed", reason: text.length > 700 ? `${text.slice(0, 700)} ...[truncated]` : text });
      return false;
    }
    this.record(id, { status: "passed" });
    return true;
  }

  isResolved(id: string): boolean {
    return this.results.has(id);
  }

  /** Resolve a step as failed without running anything, for steps that cannot run because an earlier one failed. */
  blocked(id: string, because: string): void {
    this.record(id, { status: "failed", reason: `did not run: ${because}` });
  }

  report(): JourneyReport {
    const steps: StepReportRow[] = this.order.map((s) => ({
      ...s,
      // A step nobody resolved is a failure, never silently absent.
      result: this.results.get(s.id) ?? { status: "failed", reason: "step was never resolved" },
    }));
    const counts = { passed: 0, failed: 0, pending: 0, skipped: 0, total: steps.length };
    const pendingByOwner: Record<string, string[]> = {};
    for (const s of steps) {
      counts[s.result.status] += 1;
      if (s.result.status === "pending") (pendingByOwner[s.result.owner] ??= []).push(s.id);
    }
    return { journey: this.journey, title: this.title, verdict: verdictOf(counts), counts, pendingByOwner, steps };
  }
}

export function verdictOf(counts: Readonly<Record<StepStatus, number>>): Verdict {
  if (counts.failed > 0) return "failed";
  if (counts.pending > 0 || counts.skipped > 0) return "incomplete";
  return "passing";
}

/** One printable report. The wording never calls a journey passing while anything is pending or skipped. */
export function renderReport(r: JourneyReport): string {
  const lines: string[] = [];
  lines.push(`Journey ${r.journey}: ${r.title}`);
  lines.push(
    `  verdict: ${r.verdict.toUpperCase()}  (passed ${r.counts.passed}, failed ${r.counts.failed}, pending ${r.counts.pending}, skipped ${r.counts.skipped}, of ${r.counts.total})`,
  );
  for (const s of r.steps) {
    const res = s.result;
    const tail =
      res.status === "pending" ? ` -> ${res.owner}: ${res.reason}` : res.status === "passed" ? "" : `: ${res.reason}`;
    lines.push(`  [${res.status.toUpperCase().padEnd(7)}] ${s.id}  ${s.title}${tail}`);
  }
  if (r.verdict === "incomplete") {
    lines.push(`  This journey is INCOMPLETE. It is not reported as passing while ${r.counts.pending} step(s) are pending and ${r.counts.skipped} skipped.`);
  }
  return lines.join("\n");
}

/** A single summary over several journeys, for the progress log and the CI summary. */
export function renderSummary(reports: readonly JourneyReport[]): string {
  const pending = reports.reduce((n, r) => n + r.counts.pending, 0);
  const skipped = reports.reduce((n, r) => n + r.counts.skipped, 0);
  const failed = reports.reduce((n, r) => n + r.counts.failed, 0);
  const passed = reports.reduce((n, r) => n + r.counts.passed, 0);
  const rows = reports.map(
    (r) => `  ${r.journey.padEnd(10)} ${r.verdict.padEnd(10)} passed ${r.counts.passed} / pending ${r.counts.pending} / skipped ${r.counts.skipped} / failed ${r.counts.failed}`,
  );
  return [`Journeys: ${reports.length}. Steps: passed ${passed}, pending ${pending}, skipped ${skipped}, failed ${failed}.`, ...rows].join("\n");
}
