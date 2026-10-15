// S71 (19.6): one adapter per HMO behind one interface. An adapter answers a single question: is this member number active with this HMO today?
// It is given the number for the duration of the call only; nothing here stores, logs or returns it. The database keeps a keyed hash.
// No HMO has a public eligibility API that was found (docs/research/S71.md), so the only adapter that exists connects to nothing and always
// answers "unavailable", which leaves the check for the manual operations verification (decision S71-1). A real adapter is added by writing one
// more object of this shape and naming it in HMO_ADAPTERS; no other code changes.
export type AdapterAnswer = "eligible" | "not_eligible" | "unavailable";

export interface HmoAdapter {
  /** A short lower-case id, recorded on the check (`adapter`). */
  readonly id: string;
  check(input: { readonly hmoOrgId: string; readonly memberNumber: string }): Promise<AdapterAnswer>;
}

/** Connects to nothing. Always unavailable, so every check goes to operations. */
export const stubAdapter: HmoAdapter = {
  id: "stub",
  check: () => Promise.resolve("unavailable"),
};

const REGISTRY: Readonly<Record<string, HmoAdapter>> = { stub: stubAdapter };

/** HMO_ADAPTERS is `<hmo org id>=<adapter id>` pairs separated by commas. An HMO with no entry, or an unknown adapter id, uses the stub. */
export function adapterFor(hmoOrgId: string, config: string | undefined | null): HmoAdapter {
  for (const pair of (config ?? "").split(",")) {
    const [org, name] = pair.split("=").map((s) => s.trim());
    if (org === hmoOrgId && name && REGISTRY[name]) return REGISTRY[name]!;
  }
  return stubAdapter;
}

/** An adapter that throws or hangs is treated as unavailable: a person is never told "not eligible" because a connection failed. */
export async function askAdapter(adapter: HmoAdapter, input: { hmoOrgId: string; memberNumber: string }, timeoutMs = 5000): Promise<AdapterAnswer> {
  try {
    const timeout = new Promise<AdapterAnswer>((resolve) => setTimeout(() => resolve("unavailable"), timeoutMs));
    const r = await Promise.race([adapter.check(input), timeout]);
    return r === "eligible" || r === "not_eligible" ? r : "unavailable";
  } catch {
    return "unavailable";
  }
}
