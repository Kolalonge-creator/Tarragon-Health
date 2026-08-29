"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Real next-of-kin categories (see lib/validation/care-access.ts's
 * NEXT_OF_KIN_RELATIONSHIPS), duplicated here as display labels rather than
 * imported — marketing pages must not import platform/auth modules. Kept in
 * sync by hand since the underlying list rarely changes.
 */
const RELATIONSHIPS = [
  { value: "parent", label: "Mum or Dad" },
  { value: "spouse", label: "Spouse or partner" },
  { value: "sibling", label: "Sibling" },
  { value: "child", label: "Child" },
  { value: "other", label: "Another family member" },
] as const;

/**
 * A live-updating gift-card mockup paired with a name/relationship form,
 * dohealth.co-style. Deliberately does not submit or persist anything: no
 * network call, no Supabase write (that stays Contact/Join's job per
 * CLAUDE.md), just local state that personalizes the preview card and the
 * CTA copy before handing off to /login or /signup, where the real "add
 * them as family, then choose the check" flow lives.
 */
export function GiftPersonalizer() {
  const [firstName, setFirstName] = useState("");
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]["value"]>(
    "parent"
  );

  const displayName = firstName.trim() || "someone you love";
  const relationshipLabel =
    RELATIONSHIPS.find((option) => option.value === relationship)?.label ?? "family member";
  const ctaLabel = firstName.trim() ? `Buy ${firstName.trim()} some care` : "Buy them some care";

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
      <div
        aria-hidden
        className="relative rounded-2xl border-2 border-dashed border-brand-green/40 bg-white p-6 shadow-lg shadow-charcoal-ink/5 sm:p-8"
      >
        <div className="flex items-center gap-2">
          <Image
            src="/brand/guard-leaf-mark.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span className="font-heading text-sm font-semibold text-charcoal-ink">
            TarragonHealth
          </span>
        </div>
        <p className="mt-6 text-xs font-medium uppercase tracking-wide text-deep-forest">
          A health check, gifted
        </p>
        <p className="mt-2 font-heading text-2xl font-bold leading-snug text-charcoal-ink sm:text-3xl">
          For {displayName}
        </p>
        <p className="mt-1 text-sm text-charcoal-ink/60">Your {relationshipLabel.toLowerCase()}</p>
        <div className="my-6 border-t border-dashed border-charcoal-ink/15" />
        <p className="text-sm leading-relaxed text-charcoal-ink/70">
          A named check or a year of care, doctor-reviewed and already paid for. Theirs to book
          whenever they are ready.
        </p>
        <p className="mt-4 text-xs text-charcoal-ink/50">From you, waiting on their account</p>
      </div>

      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
          Make it theirs
        </p>
        <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
          Who is it for?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
          Tell us who you are gifting this to and we will personalize the card. This does not
          start the purchase, it is just for you: the real gift happens on your dashboard once
          you have added them as family.
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="gift-recipient-name">Their first name</Label>
            <Input
              id="gift-recipient-name"
              className="mt-1.5"
              placeholder="e.g. Adaeze"
              maxLength={40}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="gift-recipient-relationship">They&apos;re your...</Label>
            <Select
              id="gift-recipient-relationship"
              className="mt-1.5"
              value={relationship}
              onChange={(event) =>
                setRelationship(event.target.value as (typeof RELATIONSHIPS)[number]["value"])
              }
            >
              {RELATIONSHIPS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/login">{ctaLabel}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/signup?intent=support">New here? Get started</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
