import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section } from "@/components/credentialing/shared";
import { respondCoverOffer } from "@/lib/capacity/actions";
import { getMyCoverOffers } from "@/lib/capacity/queries";
import { formatLagos } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

/** A clinician's own cover offers after a busy night, and the rest rule in plain words. */
export async function RestAndCoverPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { offers, rest_hours: restHours, rest_enforced: restEnforced } = await getMyCoverOffers();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Rest and cover"
        description="After a busy night you can ask for your next shift to be covered. Rest comes first: it is never held against you."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <Section title="The rest rule">
        <p className="text-sm">
          {restEnforced
            ? `After a shift with overnight pages you cannot be put on call, or declare queue time, until you have had at least ${restHours} hours of rest. Only the clinical lead can make an exception, and they must write down why.`
            : `This rule is not switched on yet. When it is, after a shift with overnight pages you will not be put on call, or able to declare queue time, until you have had at least ${restHours} hours of rest. Only the clinical lead can make an exception, and they must write down why.`}
        </p>
      </Section>
      <Section title="Your offers">
        {offers.length === 0 ? <Muted>You have no offers. One appears here after two or more overnight pages in a shift.</Muted> : null}
        {offers.map((f) => (
          <div key={f.id} className="space-y-2 rounded-md border border-charcoal-ink/15 p-3 text-sm">
            <p>
              Your next shift starts {formatLagos(f.next_shift_starts_at)} and ends {formatLagos(f.next_shift_ends_at)}. It can be covered if you would like that.
            </p>
            {f.state === "offered" ? (
              <form action={respondCoverOffer} className="space-y-2">
                <Hidden name="returnTo" value="/clinician/rest-and-cover" />
                <Hidden name="id" value={f.id} />
                <Field label="Anything you would like the clinical lead to know (optional)">
                  <input name="note" maxLength={300} className={fieldClass} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="answer" value="fit" className="inline-flex h-9 items-center rounded-md bg-brand-green px-3 text-sm font-medium text-white">
                    I am fit to work this shift
                  </button>
                  <button type="submit" name="answer" value="cover" className="inline-flex h-9 items-center rounded-md border border-charcoal-ink/25 px-3 text-sm font-medium">
                    Please arrange cover
                  </button>
                </div>
              </form>
            ) : (
              <Badge variant={f.state === "fit_confirmed" ? "green" : "amber"}>
                {f.state === "fit_confirmed" ? "You confirmed you are fit to work" : "You asked for cover"}
              </Badge>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}
