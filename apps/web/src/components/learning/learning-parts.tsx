"use client";

import { useState } from "react";
import Link from "next/link";
import {
  formatLagosDate,
  nextStep,
  parseFaq,
  parseInfographic,
  publicShareUrl,
  reviewCredit,
  shareByEmailUrl,
  type LearningItemFields,
} from "@tarragon/shared";
import { cn } from "@/lib/utils";

/**
 * Small, null-gated building blocks for a Learning Centre item (S55): the reviewer credit with sources, the standard
 * "What can I do next?" footer, the Members lock, share by link or email, and the FAQ and infographic renderers.
 * Everything here reads only what the database returned; nothing is implied or hard-coded.
 */

const MUTED = "text-charcoal-ink/60 dark:text-night-ink/60";

/** One quiet line for lists: the reviewer and date, or an honest "not yet reviewed". */
export function ReviewCreditInline({ item }: { item: LearningItemFields }) {
  const credit = reviewCredit(item);
  if (!credit) return <span>Not yet reviewed by a clinician</span>;
  return (
    <span>
      Reviewed by {credit.reviewer}, {formatLagosDate(credit.reviewedAt)}
    </span>
  );
}

/** Full credit block for an open item: reviewer, review date, next review, and the sources. */
export function ReviewCreditBlock({ item }: { item: LearningItemFields & { creator_name?: string | null } }) {
  const credit = reviewCredit(item);
  const sources = credit?.sources ?? (item.source_reference ? item.source_reference.split(/\n|;/).map((s) => s.trim()).filter(Boolean) : []);
  return (
    <div className={cn("space-y-1 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs", MUTED)} data-testid="review-credit">
      {item.creator_name && <p>Written by {item.creator_name}</p>}
      {credit ? (
        <p>
          Reviewed by {credit.reviewer} on {formatLagosDate(credit.reviewedAt)}
          {credit.nextReviewDue ? `. Next review due ${formatLagosDate(`${credit.nextReviewDue}T12:00:00+01:00`)}.` : "."}
        </p>
      ) : (
        <p>This has not yet been reviewed by a clinician.</p>
      )}
      {sources.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Sources</summary>
          <ul className="mt-1 list-disc pl-5">
            {sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const STEP_HREF = {
  care_plan_goal: "/patient/lifestyle",
  booking: "/patient/appointments",
} as const;

const STEP_ACTION = {
  care_plan_goal: "Set a goal",
  booking: "Book a visit",
  lesson: "Read the next lesson",
} as const;

/** The standard footer: what the patient can do next, with one link when it is a goal, a booking or another lesson. */
export function NextStepFooter({ item }: { item: LearningItemFields }) {
  const step = nextStep(item);
  if (!step) return null;
  const href =
    step.kind === null ? null : step.kind === "lesson" ? (step.targetCode ? `/patient/learn/${encodeURIComponent(step.targetCode)}` : null) : STEP_HREF[step.kind];
  return (
    <section
      aria-labelledby="next-step-heading"
      className="rounded-lg border border-brand-green/30 bg-soft-sage/40 dark:bg-brand-green/15 p-4"
      data-testid="next-step-footer"
    >
      <h3 id="next-step-heading" className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
        What can I do next?
      </h3>
      <p className="mt-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">{step.label}</p>
      {href && step.kind && (
        <Link
          href={href}
          className="mt-2 inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright underline"
        >
          {step.kind === "lesson" && step.targetTitle ? `${STEP_ACTION.lesson}: ${step.targetTitle}` : STEP_ACTION[step.kind]}
        </Link>
      )}
    </section>
  );
}

/** Shown in place of a Members item's body to someone who is not a member. */
export function MembersLockNotice({ creatorName }: { creatorName?: string | null }) {
  return (
    <div className="rounded-lg border border-charcoal-ink/15 dark:border-night-ink/20 p-4 text-sm" data-testid="members-lock">
      <p className="font-medium text-charcoal-ink dark:text-night-ink">This one is for Members</p>
      <p className={cn("mt-1", MUTED)}>
        {creatorName ? `Written by ${creatorName}. ` : ""}Clinician series are part of Tarragon Membership.
      </p>
      <Link href="/patient/membership" className="mt-2 inline-block font-medium text-brand-green dark:text-brand-green-bright underline">
        See Membership
      </Link>
    </div>
  );
}

/** Share by link or email (9.8). Only offered for an item the database flagged public; the link carries only the content code. */
export function ShareButtons({ code, title, siteOrigin }: { code: string; title: string; siteOrigin: string }) {
  const [copied, setCopied] = useState(false);
  const url = publicShareUrl(siteOrigin, code);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="share-buttons">
      <span className={MUTED}>Share:</span>
      <button type="button" onClick={copy} className="font-medium text-brand-green dark:text-brand-green-bright underline">
        {copied ? "Link copied" : "Copy link"}
      </button>
      <a href={shareByEmailUrl(title, url)} className="font-medium text-brand-green dark:text-brand-green-bright underline">
        Send by email
      </a>
    </div>
  );
}

export function FaqView({ body }: { body: string }) {
  const entries = parseFaq(body);
  if (!entries) return <div className="whitespace-pre-line text-sm leading-relaxed">{body}</div>;
  return (
    <div className="space-y-2" data-testid="faq-view">
      {entries.map((e) => (
        <details key={e.question} className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
          <summary className="cursor-pointer text-sm font-medium text-charcoal-ink dark:text-night-ink">{e.question}</summary>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/85 dark:text-night-ink/85">{e.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function InfographicView({ body }: { body: string }) {
  const { imageUrl, alt, text } = parseInfographic(body);
  return (
    <div className="space-y-3" data-testid="infographic-view">
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote editorial image, size unknown, https only (parseInfographic)
        <img src={imageUrl} alt={alt} loading="lazy" className="max-h-96 w-full rounded-lg object-contain" />
      )}
      {text && <div className="whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/90 dark:text-night-ink/90">{text}</div>}
    </div>
  );
}
