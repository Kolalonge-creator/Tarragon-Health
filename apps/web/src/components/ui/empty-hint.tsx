/**
 * One muted line standing in for a card that has nothing to show yet.
 *
 * Several patient cards self-hide when they are empty, which is right when
 * they sit among other content but wrong on a page like Your health summary,
 * where each card is introduced by its own heading: a new patient saw six
 * headings with nothing under any of them and no way to tell an empty record
 * from a broken page. Those cards now take an optional `emptyHint` and render
 * this instead of nothing, so the heading is answered.
 *
 * Deliberately a plain line and not a card: an empty section should read as
 * quieter than a filled one, never as another box competing for attention.
 */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{children}</p>;
}
