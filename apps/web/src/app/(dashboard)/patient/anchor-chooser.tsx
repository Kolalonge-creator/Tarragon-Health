"use client";

import { useMemo } from "react";
import { ANCHOR_IDS, anchorBaseTime, type ResolvedAnchor, type AnchorId, type AnchorProfile } from "@tarragon/medicines";
import { anchorPhrase, anchorTitle, t, type MessageKey } from "@tarragon/i18n";
import { doseAnchorConfig } from "@/lib/medication-schedule/anchor-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Tie this to my day" (S08z): choose what a medicine is taken with (waking, a meal, a prayer, bedtime) instead of a clock time. The
 * patient confirms the time of each part of the day they use; it is saved under My day and reused. A way to line reminders up with
 * a day, not advice about when to take anything.
 */
export function AnchorChooser({
  profile,
  value,
  onChange,
  drafts,
  onDrafts,
}: {
  profile: AnchorProfile;
  value: ResolvedAnchor[];
  onChange: (next: ResolvedAnchor[]) => void;
  /** Times typed in this form and not yet saved. */
  drafts: Partial<Record<AnchorId, string>>;
  onDrafts: (next: Partial<Record<AnchorId, string>>) => void;
}) {
  const config = useMemo(() => doseAnchorConfig(), []);
  const chosen = ANCHOR_IDS.filter((id) => value.some((a) => a.anchor === id));

  function toggleAnchor(id: AnchorId) {
    if (chosen.includes(id)) {
      onChange(value.filter((a) => a.anchor !== id));
      const rest = { ...drafts };
      delete rest[id];
      onDrafts(rest);
    } else {
      onChange([...value, { anchor: id, offsetMinutes: 0 }]);
    }
  }

  function toggleOffset(id: AnchorId, offset: number) {
    const has = value.some((a) => a.anchor === id && a.offsetMinutes === offset);
    const others = value.filter((a) => a.anchor === id && a.offsetMinutes !== offset);
    if (has && others.length === 0) return; // at least one stays; the anchor chip removes the anchor
    onChange(has ? value.filter((a) => !(a.anchor === id && a.offsetMinutes === offset)) : [...value, { anchor: id, offsetMinutes: offset }]);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("doseanchor.pick_title")}</legend>
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("doseanchor.pick_help")}</p>
      <div className="flex flex-wrap gap-2">
        {ANCHOR_IDS.map((id) => (
          <Button key={id} type="button" size="sm" variant={chosen.includes(id) ? "default" : "outline"} aria-pressed={chosen.includes(id)} onClick={() => toggleAnchor(id)}>
            {anchorTitle(id)}
          </Button>
        ))}
      </div>
      {chosen.length === 0 ? <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("doseanchor.pick_none")}</p> : null}
      {chosen.map((id) => {
        const confirmed = (profile.times[id] ?? []).length > 0;
        const current = drafts[id] ?? anchorBaseTime(profile, id);
        const name = t(`doseanchor.name.${id}` as MessageKey);
        return (
          <div key={id} className="space-y-2 border-t border-charcoal-ink/10 pt-2 dark:border-night-ink/15">
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("doseanchor.pick_offset", undefined, { name })}</p>
            <div className="flex flex-wrap gap-2">
              {config.offsetChoices.map((off) => {
                const on = value.some((a) => a.anchor === id && a.offsetMinutes === off);
                return (
                  <Button key={off} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggleOffset(id, off)}>
                    {anchorPhrase(id, off)}
                  </Button>
                );
              })}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`chooser-${id}`}>{t("doseanchor.myday.time_label", undefined, { name: anchorTitle(id) })}</Label>
              <Input id={`chooser-${id}`} type="time" value={current} onChange={(event) => onDrafts({ ...drafts, [id]: event.target.value })} className="w-40" />
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                {confirmed ? t("doseanchor.pick_at_time", undefined, { time: current }) : t("doseanchor.pick_confirm_time", undefined, { time: current, name })}
              </p>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
