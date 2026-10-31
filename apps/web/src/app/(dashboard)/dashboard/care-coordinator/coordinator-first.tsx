import type { FirstView } from "@/lib/care-coordinator/first-view";

/**
 * The first thing on the coordinator home. Which items show, in what order,
 * and when the view must refuse to say "nothing waiting" is decided in
 * lib/care-coordinator/first-view.ts, where it is tested.
 *
 * When the read failed it draws nothing: the page already shows a failure
 * notice above it, and a second one would only repeat it.
 */
export function CoordinatorFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") return null;

  return (
    <section
      aria-labelledby="coordinator-first"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 id="coordinator-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {view.kind === "loading" && <p className="mt-2 text-sm text-charcoal-ink/60">Checking your outreach tasks…</p>}
      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">No act-first tasks and no test results being awaited.</p>
      )}
      {view.kind === "items" && (
        <>
          <a
            href={view.top.href}
            className="mt-2 inline-flex font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {view.top.text}
          </a>
          {view.rest.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {view.rest.map((item) => (
                <li key={item.key}>
                  <a href={item.href} className="font-medium text-brand-green hover:underline">
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
