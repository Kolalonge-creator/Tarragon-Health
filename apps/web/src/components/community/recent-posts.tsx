"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ModRecentItem } from "@/lib/community/model";
import { PostPicture } from "./post-picture";
import { formatWhen } from "./staff-format";
import {
  RECENT_REMOVE_REASONS,
  type RecentCallbacks,
  type StaffActionResult,
} from "./staff-types";

/** A page is 30 posts. A full page means there may be older ones. */
export const RECENT_PAGE_SIZE = 30;

const STATE_LABEL: Record<ModRecentItem["state"], string> = {
  visible: "Visible to the group",
  held: "Waiting for a moderator",
  auto_hidden: "Hidden after reports",
};

function RecentCard({
  item,
  busy,
  run,
  onRemove,
}: {
  item: ModRecentItem;
  busy: boolean;
  run: (fn: () => Promise<StaffActionResult>, after: (r: StaffActionResult) => void) => void;
  onRemove: RecentCallbacks["onRemove"];
}) {
  const uid = useId();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const label = RECENT_REMOVE_REASONS.find((r) => r.code === reason)?.label ?? "";

  function remove() {
    const code = RECENT_REMOVE_REASONS.find((r) => r.code === reason)?.code;
    if (!code) return setError("Please choose a reason.");
    setError(null);
    run(
      () => onRemove({ postId: item.post_id, reasonCode: code }),
      (r) => {
        if (r.ok) setGone(true);
      },
    );
  }

  return (
    <li className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4" aria-labelledby={`${uid}-t`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h3 id={`${uid}-t`} className="font-semibold text-charcoal-ink">
          {item.group_name}
        </h3>
        <span className="text-charcoal-ink/70">
          by <span className="font-medium">{item.author_handle}</span>
        </span>
        {item.is_reply && <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">Reply</span>}
        <span className="rounded-full border border-charcoal-ink/20 px-2 py-0.5 text-xs">{STATE_LABEL[item.state]}</span>
        <time className="ml-auto text-xs text-charcoal-ink/60" dateTime={item.created_at}>
          {formatWhen(item.created_at)}
        </time>
      </div>
      {item.image_id && <PostPicture imageId={item.image_id} />}
      <p className="whitespace-pre-wrap break-words rounded-md bg-warm-ivory p-3 text-sm text-charcoal-ink">{item.body}</p>
      {gone ? (
        <p className="text-sm font-medium text-charcoal-ink">Removed.</p>
      ) : !confirming ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
          Remove
        </Button>
      ) : (
        <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <legend className="px-1 text-sm font-medium">Remove this post</legend>
          <label htmlFor={`${uid}-r`} className="block text-sm">
            Reason
          </label>
          <Select id={`${uid}-r`} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason</option>
            {RECENT_REMOVE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
          {reason && (
            <p className="text-sm" role="status">
              The post will be taken down for the whole group and the member will be told. Reason: {label}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={remove}>
              Yes, remove it
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
    </li>
  );
}

/**
 * Every recent post in the groups the moderator covers, newest first, including replies. Moderators work around the clock and can take
 * down anything that does not belong. Handles only, never who a member is.
 */
export function RecentPosts({ initial, ...callbacks }: { initial: ModRecentItem[] } & RecentCallbacks) {
  const [items, setItems] = useState<ModRecentItem[]>(initial);
  const [more, setMore] = useState(initial.length >= RECENT_PAGE_SIZE);
  const [message, setMessage] = useState<StaffActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<StaffActionResult>, after: (r: StaffActionResult) => void) {
    startTransition(async () => {
      let result: StaffActionResult;
      try {
        result = await fn();
      } catch {
        result = { ok: false, message: "That could not be done. Please try again." };
      }
      setMessage(result);
      after(result);
    });
  }

  function loadOlder() {
    const last = items[items.length - 1];
    if (!last) return;
    startTransition(async () => {
      try {
        const page = await callbacks.onLoadOlder({ before: last.created_at });
        if (!page.ok) {
          setMessage({ ok: false, message: page.message });
          return;
        }
        const seen = new Set(items.map((i) => i.post_id));
        setItems([...items, ...page.items.filter((i) => !seen.has(i.post_id))]);
        setMore(page.items.length >= RECENT_PAGE_SIZE);
        setMessage(null);
      } catch {
        setMessage({ ok: false, message: "That could not be done. Please try again." });
      }
    });
  }

  return (
    <section aria-label="All recent posts" className="space-y-4">
      <p className="text-sm text-charcoal-ink/80">
        These are the newest posts and replies in your groups, including ones already visible. If something does not belong, remove it.
      </p>
      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {message && (
          <p className={message.ok ? "text-brand-green" : "text-red-700"}>
            {message.ok ? "Done: " : "Not done: "}
            {message.message}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">There are no posts yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <RecentCard key={item.post_id} item={item} busy={pending} run={run} onRemove={callbacks.onRemove} />
          ))}
        </ul>
      )}
      {more && items.length > 0 && (
        <Button variant="outline" disabled={pending} onClick={loadOlder}>
          Load older
        </Button>
      )}
    </section>
  );
}
