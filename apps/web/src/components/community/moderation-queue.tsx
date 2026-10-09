"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { holdReasonLabel, type ModItem } from "@/lib/community/model";
import { formatWhen } from "./staff-format";
import {
  REMOVE_REASONS,
  SANCTION_KINDS,
  type ModerationCallbacks,
  type SanctionKind,
  type StaffActionResult,
} from "./staff-types";

type Mode = "idle" | "remove" | "sanction" | "sanction_confirm" | "safety_confirm";

const reasonLabel = (code: string): string => REMOVE_REASONS.find((r) => r.code === code)?.label ?? "Another reason";

function ModerationCard({
  item,
  busy,
  run,
  callbacks,
}: {
  item: ModItem;
  busy: boolean;
  run: (fn: () => Promise<StaffActionResult>) => void;
  callbacks: ModerationCallbacks;
}) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<SanctionKind>("warning");
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kindInfo = SANCTION_KINDS.find((k) => k.code === kind);
  const timed = kindInfo?.timed === true;
  const hoursNumber = Number(hours);
  const hoursValid = Number.isInteger(hoursNumber) && hoursNumber >= 1 && hoursNumber <= 8760;

  const hasEatingDisorder = item.reasons.includes("eating_disorder");
  const why: string[] = item.reasons.map((c) => (c === "eating_disorder" ? "Possible eating-disorder wording" : holdReasonLabel(c)));
  if (item.report_count > 0) why.push(`Reported ${item.report_count} ${item.report_count === 1 ? "time" : "times"}`);

  function close() {
    setMode("idle");
    setError(null);
  }

  function submitRemove() {
    if (!reason) return setError("Please choose a reason.");
    setError(null);
    run(() => callbacks.onDecide({ postId: item.post_id, decision: "remove", reasonCode: reason }));
  }

  function reviewSanction() {
    if (!reason) return setError("Please choose a reason.");
    if (timed && !hoursValid) return setError("Please give a number of hours from 1 to 8760.");
    setError(null);
    setMode("sanction_confirm");
  }

  function confirmSanction() {
    run(() =>
      callbacks.onSanction({ postId: item.post_id, kind, reasonCode: reason, ...(timed ? { hours: hoursNumber } : {}) }),
    );
  }

  const summary =
    kind === "warning"
      ? "send a warning to"
      : kind === "ban"
        ? "ban from this group"
        : kind === "mute"
          ? `mute for ${hoursNumber} ${hoursNumber === 1 ? "hour" : "hours"}`
          : `suspend for ${hoursNumber} ${hoursNumber === 1 ? "hour" : "hours"}`;

  return (
    <li className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4" aria-labelledby={`${uid}-title`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h3 id={`${uid}-title`} className="font-semibold text-charcoal-ink">
          {item.group_name}
        </h3>
        <span className="text-charcoal-ink/70">
          by <span className="font-medium">{item.author_handle}</span>
        </span>
        {item.is_reply && <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">Reply</span>}
        {item.author_is_new && <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">New member</span>}
        <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={item.created_at}>
          {formatWhen(item.created_at)}
        </time>
      </div>

      <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink">{item.body}</p>

      <div className="text-sm text-charcoal-ink/80">
        <p className="font-medium">Why this is here</p>
        {why.length > 0 ? (
          <ul className="list-disc pl-5">
            {why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p>No reason was recorded.</p>
        )}
        {item.report_reasons.length > 0 && <p className="mt-1">Reasons given by members: {item.report_reasons.join(", ")}.</p>}
      </div>

      {hasEatingDisorder && (
        <p className="rounded-md border border-charcoal-ink/15 bg-warm-ivory p-3 text-sm text-charcoal-ink">
          Possible eating-disorder wording. If you are worried about the writer, send it to a safety reviewer.
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(() => callbacks.onDecide({ postId: item.post_id, decision: "approve" }))}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("remove")}>
            Remove
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("sanction")}>
            Sanction the member
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("safety_confirm")}>
            Send to a safety reviewer
          </Button>
        </div>
      )}

      {mode === "safety_confirm" && (
        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <legend className="px-1 text-sm font-medium">Send this post to a safety reviewer</legend>
          <p className="text-sm text-charcoal-ink/80">
            Use this when you are worried about the person who wrote this. From then on only a safety reviewer can see it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => callbacks.onDecide({ postId: item.post_id, decision: "send_to_safety" }))}>
              Yes, send it to a safety reviewer
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}

      {mode === "remove" && (
        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <legend className="px-1 text-sm font-medium">Remove this post</legend>
          <label htmlFor={`${uid}-rr`} className="block text-sm">
            Reason
          </label>
          <Select id={`${uid}-rr`} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason</option>
            {REMOVE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={submitRemove}>
              Confirm removal
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}

      {(mode === "sanction" || mode === "sanction_confirm") && (
        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <legend className="px-1 text-sm font-medium">Sanction the member who wrote this</legend>
          <p className="text-sm text-charcoal-ink/70">You do not see who this member is; the sanction applies to them in this group.</p>
          {mode === "sanction" ? (
            <>
              <label htmlFor={`${uid}-sk`} className="block text-sm">
                What to do
              </label>
              <Select id={`${uid}-sk`} value={kind} onChange={(e) => setKind(e.target.value as SanctionKind)}>
                {SANCTION_KINDS.map((k) => (
                  <option key={k.code} value={k.code}>
                    {k.label}
                  </option>
                ))}
              </Select>
              {timed && (
                <>
                  <label htmlFor={`${uid}-sh`} className="block text-sm">
                    For how many hours (1 to 8760)
                  </label>
                  <Input
                    id={`${uid}-sh`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={8760}
                    step={1}
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </>
              )}
              <label htmlFor={`${uid}-sr`} className="block text-sm">
                Reason
              </label>
              <Select id={`${uid}-sr`} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose a reason</option>
                {REMOVE_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={reviewSanction}>
                  Review
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium" role="status">
                You are about to {summary} the author of this post in {item.group_name}. Reason: {reasonLabel(reason)}.
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={confirmSanction}>
                  Yes, apply this sanction
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("sanction")}>
                  Go back
                </Button>
              </div>
            </>
          )}
        </fieldset>
      )}
    </li>
  );
}

/**
 * The moderation queue. Shows a handle and the text, never who the member is. Callbacks are server actions passed in by the page, so
 * the admin area can reuse this with its own. There is no platform-wide sanction here by design.
 */
export function ModerationQueue({ items, ...callbacks }: { items: ModItem[] } & ModerationCallbacks) {
  const [message, setMessage] = useState<StaffActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<StaffActionResult>) {
    startTransition(async () => {
      try {
        setMessage(await fn());
      } catch {
        setMessage({ ok: false, message: "That could not be done. Please try again." });
      }
    });
  }

  return (
    <section aria-label="Moderation queue" className="space-y-4">
      <div aria-live="polite" role="status" className="min-h-5 text-sm">
        {message && (
          <p className={message.ok ? "text-brand-green" : "text-red-700"}>
            {message.ok ? "Done: " : "Not done: "}
            {message.message}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">
          Nothing is waiting for you. New posts to check will appear here.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <ModerationCard key={item.post_id} item={item} busy={pending} run={run} callbacks={callbacks} />
          ))}
        </ul>
      )}
    </section>
  );
}
