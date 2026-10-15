import WORDING from "./clinical-wording.json";
import { en } from "./en";

/** Every string the ledger covers: the catalogue keys (filtered by namespace by the checker) plus both versions of each EMG/TRI wording code. */
export function ledgerCandidates(): Record<string, string> {
  const out: Record<string, string> = { ...en };
  for (const [code, w] of Object.entries(WORDING.codes)) {
    for (const version of ["current", "proposed"] as const) {
      out[`wording:${code}:${version}:title`] = w[version].title;
      out[`wording:${code}:${version}:body`] = w[version].body;
    }
  }
  return out;
}
