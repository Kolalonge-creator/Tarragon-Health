"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during the server render and the hydration pass, true afterwards. The workspace's queries are shared across the shell and
 * the page, so by the time a page hydrates its data can already be in the cache; showing it then makes the first client render
 * differ from the server HTML ("…" on the server, "5" in the browser). Components read cached data only once this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
