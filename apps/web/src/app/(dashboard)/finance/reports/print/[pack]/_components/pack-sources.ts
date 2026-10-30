import { refreshQueryState } from "@/lib/queries/list-query-state";

/**
 * Which of a printed pack's data sources are usable, worked out apart from the
 * page so the rules can be tested without a database.
 *
 * A pack is printed, signed off and handed to people outside the company, so a
 * source that did not arrive must never print as an empty section or a zero.
 * `failed` is a source that never loaded: the pack must not be built. `stale`
 * is one that loaded and then failed to refresh: its figures are real, as of
 * the last successful read, and the page says so. `loading` means something is
 * still on its way, and the pack should not be printed yet.
 */
export interface PackSource {
  label: string;
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}

export interface PackSourceSummary {
  failed: string[];
  stale: string[];
  loading: boolean;
}

export function summarisePackSources(sources: PackSource[]): PackSourceSummary {
  const states = sources.map((s) => ({
    label: s.label,
    state: refreshQueryState({ isLoading: s.isLoading, isError: s.isError, hasData: s.hasData }),
  }));
  return {
    failed: states.filter((s) => s.state === "failed").map((s) => s.label),
    stale: states.filter((s) => s.state === "stale").map((s) => s.label),
    loading: states.some((s) => s.state === "loading"),
  };
}

/** The part of a TanStack Query result a source needs. */
export function packSource(label: string, q: { isLoading: boolean; isError: boolean; data: unknown }): PackSource {
  return { label, isLoading: q.isLoading, isError: q.isError, hasData: q.data !== undefined };
}
