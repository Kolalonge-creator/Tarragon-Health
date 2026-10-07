"use client";

import { useState } from "react";
import { t, pointsRuleLabel } from "@tarragon/i18n";
import { useAdminRewardRules, useAdminRewardsSummary, useSetRewardRule, type RewardRule } from "@/lib/queries/wellness";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Caps = Record<string, unknown>;
const CAP_KEYS = ["per_day", "per_week", "lifetime"] as const;

function RuleRow({ rule }: { rule: RewardRule }) {
  const save = useSetRewardRule();
  const caps = (rule.caps ?? {}) as Caps;
  const [points, setPoints] = useState(String(rule.points));
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(CAP_KEYS.map((k) => [k, caps[k] == null ? "" : String(caps[k])])),
  );
  const [active, setActive] = useState(rule.is_active);
  const [message, setMessage] = useState<string | null>(null);
  const catalogue = rule.points_source === "catalogue";

  async function onSave() {
    setMessage(null);
    const nextCaps: Caps = { ...caps };
    for (const k of CAP_KEYS) {
      const raw = limits[k]?.trim();
      if (raw) nextCaps[k] = Number(raw);
      else delete nextCaps[k];
    }
    try {
      const version = await save.mutateAsync({ code: rule.code, points: catalogue ? 0 : Number(points), caps: nextCaps, active });
      setMessage(t("points.admin.saved", "en", { version }));
    } catch {
      setMessage(t("points.admin.failed"));
    }
  }

  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <p className="text-sm font-medium text-charcoal-ink">{pointsRuleLabel(rule.code)}</p>
        <p className="text-xs text-charcoal-ink/60">{rule.code}</p>
      </td>
      <td className="py-2 pr-3 text-xs text-charcoal-ink/70">{rule.trigger_event}</td>
      <td className="py-2 pr-3">
        {catalogue ? (
          <span className="text-xs text-charcoal-ink/60">{t("points.admin.catalogue_points")}</span>
        ) : (
          <input aria-label={`${rule.code} points`} className="w-20 rounded border px-2 py-1 text-sm" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
        )}
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-wrap gap-1">
          {CAP_KEYS.map((k) => (
            <label key={k} className="text-xs text-charcoal-ink/60">
              {k.replace("_", " ")}
              <input aria-label={`${rule.code} ${k}`} className="ml-1 w-14 rounded border px-1 py-0.5 text-sm" inputMode="numeric" value={limits[k] ?? ""} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {caps.decay != null && <p className="mt-1 text-xs text-charcoal-ink/50">decay: {JSON.stringify(caps.decay)}</p>}
      </td>
      <td className="py-2 pr-3 text-xs text-charcoal-ink/70">v{rule.version} · {rule.status}</td>
      <td className="py-2 pr-3">
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {active ? t("points.admin.state_on") : t("points.admin.state_off")}
        </label>
      </td>
      <td className="py-2">
        <Button size="sm" onClick={onSave} disabled={save.isPending}>{t("points.admin.save")}</Button>
        {message && <p role="status" className="mt-1 text-xs text-charcoal-ink/70">{message}</p>}
      </td>
    </tr>
  );
}

export function RewardRulesManager() {
  const { data: rules, isLoading } = useAdminRewardRules();
  const { data: summary } = useAdminRewardsSummary();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("points.admin.summary_title")}</CardTitle>
          <CardDescription>
            {t("points.admin.summary_points")}: {(summary?.points_30d ?? 0).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/70">
          <p>{t("points.admin.redemption_off")}</p>
          <p>{t("points.admin.leaderboards_off")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {isLoading && <p className="text-sm text-charcoal-ink/60">{t("points.loading")}</p>}
          {rules && (
            <table className="w-full text-left">
              <thead className="text-xs uppercase text-charcoal-ink/50">
                <tr>
                  <th className="pr-3">{t("points.admin.col_rule")}</th>
                  <th className="pr-3">{t("points.admin.col_event")}</th>
                  <th className="pr-3">{t("points.admin.col_points")}</th>
                  <th className="pr-3">{t("points.admin.col_caps")}</th>
                  <th className="pr-3">{t("points.admin.col_version")}</th>
                  <th className="pr-3">{t("points.admin.col_state")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/10">
                {rules.map((r) => <RuleRow key={`${r.code}-${r.version}`} rule={r} />)}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
