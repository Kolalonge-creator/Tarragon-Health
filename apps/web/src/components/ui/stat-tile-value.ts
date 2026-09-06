/**
 * The value half of a StatTile's props, split into its own pure module so
 * call sites have one obvious way to satisfy the union and so it can be
 * tested without rendering React.
 *
 * StatTile's contract is that a tile shows either a real display-scale value
 * or a friendly muted hint, never a bare display-scale "—". The discriminated
 * union below is what enforces that, but a caller can still route around it
 * by folding the empty case into the value string:
 *
 *     value={latestBp ? `${sys}/${dia}` : "—"}   // type-checks, breaks the rule
 *
 * Six patient tiles did exactly that. `statTileValue` closes the loophole by
 * taking the possibly-absent value and the hint to show in its place, so the
 * empty case can't be spelled as a dash by accident.
 */

export type StatTileValueProps =
  | { value: string; unit?: string; empty?: undefined }
  | { empty: { hint: string }; value?: undefined; unit?: undefined };

/**
 * Build a StatTile's value props from a value that may not exist yet.
 *
 * @param value  The reading, count or date to show. `null`/`undefined` (and
 *   an empty string, which would render as an invisible value) mean "nothing
 *   on file yet".
 * @param hint   The muted line shown in the value's place, in patient voice
 *   ("No reading yet"), never a dash and never a warning.
 * @param unit   Attached to the value only. A unit with no value to attach it
 *   to is meaningless, which is why the union forbids it on the empty side.
 */
export function statTileValue(
  value: string | number | null | undefined,
  hint: string,
  unit?: string
): StatTileValueProps {
  if (value === null || value === undefined || value === "") {
    return { empty: { hint } };
  }
  const text = String(value);
  return unit === undefined ? { value: text } : { value: text, unit };
}
