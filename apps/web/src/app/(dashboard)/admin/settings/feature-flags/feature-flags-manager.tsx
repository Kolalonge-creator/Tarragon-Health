"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type FeatureFlagStatus = "off" | "rollout" | "on" | "archived";
export type FeatureFlagRow = {
  key: string;
  label: string;
  description: string | null;
  category: string;
  status: FeatureFlagStatus;
  rollout_percent: number;
  created_at: string;
  updated_at: string;
};

export type FeatureFlagRuleKind = "profile" | "state" | "account_role" | "organisation";
export type FeatureFlagRuleRow = {
  id: string;
  flag_key: string;
  kind: FeatureFlagRuleKind;
  value: string;
  effect: "allow" | "deny";
  note: string | null;
  created_at: string;
};

const STATUS_VARIANT: Record<FeatureFlagStatus, "green" | "amber" | "grey" | "red"> = {
  on: "green",
  rollout: "amber",
  off: "grey",
  archived: "red",
};

const STATUS_LABEL: Record<FeatureFlagStatus, string> = {
  on: "On — everyone",
  rollout: "Rollout — targeted",
  off: "Off",
  archived: "Archived",
};

const RULE_KIND_LABEL: Record<FeatureFlagRuleKind, string> = {
  profile: "Person (profile id)",
  state: "State",
  account_role: "Account role",
  organisation: "Organisation (id)",
};

function NewRuleForm({
  flagKey,
  onCreated,
}: {
  flagKey: string;
  onCreated: (row: FeatureFlagRuleRow) => void;
}) {
  const [kind, setKind] = useState<FeatureFlagRuleKind>("state");
  const [value, setValue] = useState("");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-charcoal-ink/10 pt-3">
      <div className="space-y-1">
        <Label className="text-xs">Kind</Label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as FeatureFlagRuleKind)} className="h-8 w-44">
          {(Object.keys(RULE_KIND_LABEL) as FeatureFlagRuleKind[]).map((k) => (
            <option key={k} value={k}>
              {RULE_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Value</Label>
        <Input className="h-8 w-56" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "state" ? "Lagos" : kind === "account_role" ? "clinician" : "uuid"} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Effect</Label>
        <Select value={effect} onChange={(e) => setEffect(e.target.value as "allow" | "deny")} className="h-8 w-28">
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </Select>
      </div>
      <Button
        size="sm"
        disabled={pending || !value.trim()}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const supabase = createClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();
            const { data, error: insertError } = await supabase
              .from("feature_flag_rules")
              .insert({ flag_key: flagKey, kind, value: value.trim(), effect, created_by: user?.id ?? null })
              .select("*")
              .single();
            if (insertError || !data) {
              setError(insertError?.message ?? "Could not save");
              return;
            }
            onCreated(data as FeatureFlagRuleRow);
            setValue("");
          });
        }}
      >
        Add rule
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FlagRow({
  flag,
  rules,
  canManage,
  onUpdate,
  onRuleCreated,
  onRuleDeleted,
}: {
  flag: FeatureFlagRow;
  rules: FeatureFlagRuleRow[];
  canManage: boolean;
  onUpdate: (row: FeatureFlagRow) => void;
  onRuleCreated: (row: FeatureFlagRuleRow) => void;
  onRuleDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rollout, setRollout] = useState(flag.rollout_percent);
  const [error, setError] = useState<string | null>(null);

  function patch(fields: Partial<FeatureFlagRow>) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("feature_flags")
        .update(fields)
        .eq("key", flag.key)
        .select("*")
        .single();
      if (updateError || !data) {
        setError(updateError?.message ?? "Could not save");
        return;
      }
      onUpdate(data as FeatureFlagRow);
    });
  }

  return (
    <div className="rounded-md border border-charcoal-ink/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-charcoal-ink/50">{flag.key}</span>
          <span className="font-medium text-charcoal-ink">{flag.label}</span>
          <Badge variant={STATUS_VARIANT[flag.status]}>{STATUS_LABEL[flag.status]}</Badge>
          {flag.status === "rollout" && (
            <span className="text-xs text-charcoal-ink/50">{flag.rollout_percent}% baseline</span>
          )}
          <Badge variant="grey">{flag.category}</Badge>
        </div>
        {rules.length > 0 && (
          <button
            type="button"
            className="text-xs font-medium text-brand-green hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {rules.length} rule{rules.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>
      {flag.description && <p className="text-sm text-charcoal-ink/60">{flag.description}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-charcoal-ink/10 pt-3">
          {(["off", "rollout", "on"] as FeatureFlagStatus[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={flag.status === s ? "default" : "outline"}
              disabled={pending}
              onClick={() => patch({ status: s })}
            >
              {STATUS_LABEL[s]}
            </Button>
          ))}
          {flag.status === "rollout" && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                className="h-8 w-20"
                value={rollout}
                onChange={(e) => setRollout(Number(e.target.value))}
              />
              <Button size="sm" variant="outline" disabled={pending} onClick={() => patch({ rollout_percent: rollout })}>
                Set %
              </Button>
            </div>
          )}
          {flag.status !== "archived" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => patch({ status: "archived" })}>
              Archive
            </Button>
          )}
        </div>
      )}

      {(expanded || rules.length === 0) && canManage && (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs text-charcoal-ink/70">
              <span>
                <Badge variant={r.effect === "deny" ? "red" : "green"} className="mr-2">
                  {r.effect}
                </Badge>
                {RULE_KIND_LABEL[r.kind]}: <span className="font-mono">{r.value}</span>
              </span>
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => {
                  startTransition(async () => {
                    const supabase = createClient();
                    await supabase.from("feature_flag_rules").delete().eq("id", r.id);
                    onRuleDeleted(r.id);
                  });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <NewRuleForm flagKey={flag.key} onCreated={onRuleCreated} />
        </div>
      )}
    </div>
  );
}

function NewFlagForm({ onCreated }: { onCreated: (row: FeatureFlagRow) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New flag</Button>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a feature flag</CardTitle>
        <CardDescription>
          Starts off — turning it on for anyone is a separate step. Keys are snake_case and are
          never renamed once shipped (create a new flag instead).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="flag-key">Key</Label>
          <Input id="flag-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="my_new_feature" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="flag-category">Category</Label>
          <Input id="flag-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="flag-label">Label</Label>
          <Input id="flag-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="flag-description">Description</Label>
          <Textarea id="flag-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button
            disabled={pending || !key.trim() || !label.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const supabase = createClient();
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                const { data, error: insertError } = await supabase
                  .from("feature_flags")
                  .insert({
                    key: key.trim(),
                    label: label.trim(),
                    category: category.trim() || "general",
                    description: description.trim() || null,
                    created_by: user?.id ?? null,
                  })
                  .select("*")
                  .single();
                if (insertError || !data) {
                  setError(insertError?.message ?? "Could not save");
                  return;
                }
                onCreated(data as FeatureFlagRow);
                setOpen(false);
                setKey("");
                setLabel("");
                setDescription("");
              });
            }}
          >
            {pending ? "Saving…" : "Create flag"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FeatureFlagsManager({
  initialFlags,
  initialRules,
  canManage,
}: {
  initialFlags: FeatureFlagRow[];
  initialRules: FeatureFlagRuleRow[];
  canManage: boolean;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [rules, setRules] = useState(initialRules);

  const active = flags.filter((f) => f.status !== "archived");
  const archived = flags.filter((f) => f.status === "archived");

  return (
    <div className="space-y-6">
      {canManage && <NewFlagForm onCreated={(row) => setFlags((prev) => [...prev, row])} />}
      <Card>
        <CardHeader>
          <CardTitle>Flags</CardTitle>
          <CardDescription>{active.length} active · {archived.length} archived</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {flags.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No flags yet.</p>
          ) : (
            [...active, ...archived].map((flag) => (
              <FlagRow
                key={flag.key}
                flag={flag}
                rules={rules.filter((r) => r.flag_key === flag.key)}
                canManage={canManage}
                onUpdate={(row) => setFlags((prev) => prev.map((f) => (f.key === row.key ? row : f)))}
                onRuleCreated={(row) => setRules((prev) => [row, ...prev])}
                onRuleDeleted={(id) => setRules((prev) => prev.filter((r) => r.id !== id))}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
