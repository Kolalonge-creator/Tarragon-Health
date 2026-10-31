import Link from "next/link";

export interface NeedsFirstItem {
  key: string;
  href: string;
  text: string;
}

export type NeedsFirstBody =
  | { kind: "loading"; text: string }
  | { kind: "clear"; text: string }
  | {
      kind: "items";
      top: NeedsFirstItem;
      rest: NeedsFirstItem[];
      /** A short note under the list, for example that it is incomplete or may be out of date. */
      notice?: string;
    };

/**
 * The "Needs you first" block that opens a role's home page.
 *
 * It only draws. What it says, in what order, and when a view must refuse to
 * say "nothing waiting" is decided by each role's own tested first-view module,
 * and each role decides what to show when its read failed (a failure notice, or
 * nothing because the page already shows one) before it reaches this.
 */
export function NeedsFirst({ id, body }: { id: string; body: NeedsFirstBody }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {body.kind === "loading" && <p className="mt-2 text-sm text-charcoal-ink/60">{body.text}</p>}
      {body.kind === "clear" && <p className="mt-2 text-sm text-charcoal-ink/70">{body.text}</p>}
      {body.kind === "items" && (
        <>
          <Link
            href={body.top.href}
            className="mt-2 inline-flex font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {body.top.text}
          </Link>
          {body.rest.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {body.rest.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="font-medium text-brand-green hover:underline">
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {body.notice && <p className="mt-3 text-sm text-charcoal-ink/60">{body.notice}</p>}
        </>
      )}
    </section>
  );
}
