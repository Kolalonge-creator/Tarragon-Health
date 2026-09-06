"use client";

import { useState } from "react";
import {
  useFeatureFlags,
  useFeatureFlagRules,
  useCreateFeatureFlag,
  useUpdateFeatureFlagStatus,
  useUpdateFeatureFlagRollout,
  useDeleteFeatureFlag,
  useAddFeatureFlagRule,
  useRemoveFeatureFlagRule,
  type FeatureFlag,
  type FeatureFlagRuleKind,
} from "@/lib/queries/feature-flags";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const STATUS_BADGE: Record<FeatureFlag["status"], { label: string; variant: "grey" | "amber" | "green" | "red" }> = {
  off: { label: "Off", variant: "grey" },
  rollout: { label: "Rolling out", variant: "amber" },
  on: { label: "On for everyone", variant: "green" },
  archived: { label: "Archived", variant: "red" },
};

const RULE_KINDS: { value: FeatureFlagRuleKind; label: string; placeholder: string }[] = [
  { value: "profile", label: "Specific person", placeholder: "profile UUID" },
  { value: "state", label: "State", placeholder: "e.g. Lagos" },
  { value: "account_role", label: "Account role", placeholder: "e.g. clinician" },
  { value: "organisation", label: "Organisation", placeholder: "organisation UUID" },
];

function RulesEditor({ flagKey }: { flagKey: string }) {
  const { data: rules, isLoading } = useFeatureFlagRules(flagKey);
  const addRule = useAddFeatureFlagRule();
  const removeRule = useRemoveFeatureFlagRule();
  const [kind, setKind] = useState<FeatureFlagRuleKind>("profile");
  const [value, setValue] = useState("");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");

  const kindMeta = RULE_KINDS.find((k) => k.value === kind) ?? RULE_KINDS[0];

  return (
    <div className="space-y-3 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium text-charcoal-ink/70">
        Cohort rules: only consulted while status is &ldquo;Rolling out&rdquo;. A deny always
        wins over an allow or the rollout percentage.
      </p>
      {isLoading && <p className="text-xs text-charcoal-ink/50">Loading rules…</p>}
      {rules && rules.length > 0 && (
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <Badge variant={rule.effect === "deny" ? "red" : "green"} className="mr-2">
                  {rule.effect}
                </Badge>
                {RULE_KINDS.find((k) => k.value === rule.kind)?.label ?? rule.kind}:{" "}
                <span className="font-mono text-xs">{rule.value}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={removeRule.isPending}
                onClick={() => removeRule.mutate({ id: rule.id, flagKey })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rules && rules.length === 0 && !isLoading && (
        <p className="text-xs text-charcoal-ink/50">No cohort rules yet: rollout_percent alone decides.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Effect</Label>
          <Select value={effect} onChange={(e) => setEffect(e.target.value as "allow" | "deny")} className="h-8 text-xs">
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Target</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as FeatureFlagRuleKind)} className="h-8 text-xs">
            {RULE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Value</Label>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kindMeta.placeholder}
            className="h-8 w-48 text-xs"
          />
        </div>
        <Button
          size="sm"
          disabled={addRule.isPending || !value.trim()}
          onClick={() => {
            addRule.mutate({ flagKey, kind, value, effect });
            setValue("");
          }}
        >
          Add rule
        </Button>
      </div>
      {addRule.isError && (
        <p className="text-xs text-red-600">{(addRule.error as Error).message}</p>
      )}
    </div>
  );
}

function FlagRow({ flag }: { flag: FeatureFlag }) {
  const [expanded, setExpanded] = useState(false);
  const [rolloutInput, setRolloutInput] = useState(String(flag.rollout_percent));
  const updateStatus = useUpdateFeatureFlagStatus();
  const updateRollout = useUpdateFeatureFlagRollout();
  const deleteFlag = useDeleteFeatureFlag();
  const badge = STATUS_BADGE[flag.status];

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink">{flag.label}</p>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className="text-xs text-charcoal-ink/50">{flag.category}</span>
          </div>
          <p className="font-mono text-xs text-charcoal-ink/60">{flag.key}</p>
          {flag.description && <p className="text-xs text-charcoal-ink/50">{flag.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={flag.status}
            onChange={(e) => updateStatus.mutate({ key: flag.key, status: e.target.value as FeatureFlag["status"] })}
            disabled={updateStatus.isPending}
            className="h-8 w-36 text-xs"
          >
            <option value="off">Off</option>
            <option value="rollout">Rolling out</option>
            <option value="on">On for everyone</option>
            <option value="archived">Archived</option>
          </Select>
          {flag.status === "rollout" && (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                value={rolloutInput}
                onChange={(e) => setRolloutInput(e.target.value)}
                onBlur={() => {
                  const n = Number(rolloutInput);
                  if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== flag.rollout_percent) {
                    updateRollout.mutate({ key: flag.key, rolloutPercent: n });
                  }
                }}
                className="h-8 w-16 text-xs"
              />
              <span className="text-xs text-charcoal-ink/50">%</span>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide rules" : "Rules"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={deleteFlag.isPending}
            onClick={() => {
              if (confirm(`Delete flag "${flag.key}"? This also removes its cohort rules.`)) {
                deleteFlag.mutate(flag.key);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      {expanded && <RulesEditor flagKey={flag.key} />}
    </li>
  );
}

function CreateFlagForm() {
  const create = useCreateFeatureFlag();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");

  const keyValid = /^[a-z][a-z0-9_]{2,63}$/.test(key);

  return (
    <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
      <p className="text-sm font-medium text-charcoal-ink">New flag</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ff-key">Key</Label>
          <Input
            id="ff-key"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="snake_case_key"
            className="w-48 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ff-label">Label</Label>
          <Input id="ff-label" value={label} onChange={(e) => setLabel(e.target.value)} className="w-56" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ff-category">Category</Label>
          <Input id="ff-category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-32" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ff-description">Description (optional)</Label>
          <Input
            id="ff-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-64"
          />
        </div>
        <Button
          disabled={create.isPending || !keyValid || !label.trim()}
          onClick={() => {
            create.mutate(
              { key, label, description: description || null, category },
              {
                onSuccess: () => {
                  setKey("");
                  setLabel("");
                  setDescription("");
                  setCategory("general");
                },
              }
            );
          }}
        >
          Create flag
        </Button>
      </div>
      {key && !keyValid && (
        <p className="text-xs text-charcoal-ink/50">
          Lowercase letters, numbers, underscores, 3–64 characters, starting with a letter.
        </p>
      )}
      {create.isError && <p className="text-xs text-red-600">{(create.error as Error).message}</p>}
    </div>
  );
}

export function FeatureFlagsManager() {
  const { data: flags, isLoading, isError } = useFeatureFlags();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature flags</CardTitle>
        <CardDescription>
          Turn a feature on for internal staff, a percentage of patients, or a named cohort
          (person/state/role/organisation) without a redeploy. Clinical-safety paths (abnormal
          results, emergency handling, red-flag detection, escalation SLAs) can never be
          registered here, or the database refuses the key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load feature flags.</p>}
        {flags && flags.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No flags yet.</p>
        )}
        {flags && flags.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {flags.map((flag) => (
              <FlagRow key={flag.key} flag={flag} />
            ))}
          </ul>
        )}
        <CreateFlagForm />
      </CardContent>
    </Card>
  );
}
