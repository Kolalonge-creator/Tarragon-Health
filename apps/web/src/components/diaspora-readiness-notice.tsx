"use client";

import Link from "next/link";
import { useState } from "react";
import { itemsFor } from "@/lib/coverage/what-works-where";

type Audience = "self" | "someone_in_nigeria";

/**
 * The "who is this actually for?" question, asked before payment rather than
 * discovered after it.
 *
 * Shown only on the dollar tab, because it is only a live question there. A
 * naira buyer is almost always the patient and is almost always in Nigeria, so
 * asking them would be noise. A dollar buyer is making one of two completely
 * different purchases that happen to share a price list: monitoring and doctors
 * for themselves, wherever they live, or the whole product for a parent at
 * home. Half of what Tarragon does needs the patient standing in a live
 * Nigerian state, and which half matters depends entirely on that answer.
 *
 * Nothing here gates or blocks the purchase. It sets expectations at the only
 * moment where doing so is honest rather than decorative.
 */
export function DiasporaReadinessNotice() {
  const [audience, setAudience] = useState<Audience | null>(null);

  const anywhere = itemsFor("anywhere");
  const inNigeria = itemsFor("in_nigeria");

  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-4">
      <p className="font-heading text-sm font-semibold text-charcoal-ink">
        Before you pay, who is this plan for?
      </p>
      <p className="mt-1 text-xs text-charcoal-ink/60">
        Part of Tarragon still needs someone to physically be in Nigeria: taking a lab request to
        a lab, collecting medication from a pharmacy, or seeing a specialist in person. The rest
        works anywhere.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["self", "For me, living abroad"],
            ["someone_in_nigeria", "For someone in Nigeria"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setAudience(value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              audience === value
                ? "border-brand-green bg-brand-green/10 text-brand-green"
                : "border-charcoal-ink/20 bg-white text-charcoal-ink/70"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {audience === "self" && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-brand-green/5 p-3 text-xs text-charcoal-ink/80">
            You get everything in the first list below. The second list will sit unused on your
            account until you are physically in Nigeria to visit a lab, pharmacy or specialist, so
            buy this for the monitoring, the doctors and the record, not for the labs.
          </p>
          <TwoLists anywhere={anywhere} inNigeria={inNigeria} />
        </div>
      )}

      {audience === "someone_in_nigeria" && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-brand-green/5 p-3 text-xs text-charcoal-ink/80">
            They get the whole product. Lab tests, pharmacy collection and specialist visits are
            self-arranged, so they work in every state today: we write the request, they take it
            to a provider of their choosing and pay directly. Home sample collection and
            medication delivery are the only two pieces still waiting on a contracted partner,
            worth checking their state for if that matters to them.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/coverage"
              target="_blank"
              className="rounded-full border border-brand-green px-3 py-1.5 text-xs font-medium text-brand-green"
            >
              Check their state
            </Link>
          </div>
          <p className="text-xs text-charcoal-ink/60">
            One more thing worth knowing: each person keeps their own account and their own
            plan. If you are paying for a parent, you can also fund their care directly through
            a named check for them and see when it was used.
          </p>
          <TwoLists anywhere={anywhere} inNigeria={inNigeria} />
        </div>
      )}
    </div>
  );
}

function TwoLists({
  anywhere,
  inNigeria,
}: {
  anywhere: ReturnType<typeof itemsFor>;
  inNigeria: ReturnType<typeof itemsFor>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold text-deep-forest">Works wherever you are</p>
        <ul className="mt-2 space-y-1.5">
          {anywhere.map((item) => (
            <li key={item.key} className="text-xs text-charcoal-ink/70">
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-charcoal-ink/70">
          Needs the person to be in Nigeria
        </p>
        <ul className="mt-2 space-y-1.5">
          {inNigeria.map((item) => (
            <li key={item.key} className="text-xs text-charcoal-ink/60">
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
