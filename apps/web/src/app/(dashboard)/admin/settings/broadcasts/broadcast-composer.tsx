"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  useBroadcastHistory,
  useBroadcastAudienceCount,
  useSendBroadcast,
  type BroadcastAudience,
  type BroadcastAudienceFilter,
  type NotificationChannel,
} from "@/lib/queries/broadcasts";
import { useAllSubscriptionPlansAdmin } from "@/lib/queries/subscription-plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const AUDIENCES: { value: BroadcastAudience; label: string }[] = [
  { value: "all_patients", label: "All patients" },
  { value: "patients_by_state", label: "Patients in a state" },
  { value: "subscribers_by_plan", label: "Subscribers on a plan" },
  { value: "all_partners", label: "All partners" },
  { value: "partners_by_type", label: "A partner group" },
];

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

export function BroadcastComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all_patients");
  const [state, setState] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [partnerType, setPartnerType] = useState<"pharmacy" | "specialist">("pharmacy");
  const [channels, setChannels] = useState<NotificationChannel[]>(["email"]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const plans = useAllSubscriptionPlansAdmin();
  const send = useSendBroadcast();
  const history = useBroadcastHistory();

  const filter = useMemo<BroadcastAudienceFilter>(() => {
    const f: BroadcastAudienceFilter = {};
    if (
      (audience === "patients_by_state" || audience === "subscribers_by_plan") &&
      state.trim()
    ) {
      f.state = state.trim();
    }
    if (audience === "subscribers_by_plan" && planCode) f.plan_code = planCode;
    if (audience === "partners_by_type") f.partner_type = partnerType;
    return f;
  }, [audience, state, planCode, partnerType]);

  const count = useBroadcastAudienceCount(audience, filter);
  const isPartnerAudience = audience === "all_partners" || audience === "partners_by_type";

  function toggleChannel(channel: NotificationChannel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSentCount(null);
    if (!title.trim() || !body.trim()) {
      setValidationError("Add a subject and a message.");
      return;
    }
    if (channels.length === 0) {
      setValidationError("Choose at least one channel.");
      return;
    }
    setValidationError(null);
    send.mutate(
      { title: title.trim(), body: body.trim(), audience, filter, channels },
      {
        onSuccess: (recipients) => {
          setSentCount(recipients);
          setTitle("");
          setBody("");
        },
      }
    );
  }

  // Distinct plan codes for the dropdown (plans repeat per currency/interval).
  const planCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of plans.data ?? []) if (!seen.has(p.code)) seen.set(p.code, p.name);
    return [...seen.entries()];
  }, [plans.data]);

  const sendError = (send.error as Error | null)?.message ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compose broadcast</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Subject</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Free BP checks this weekend"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="The message recipients will receive."
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audience">Audience</Label>
              <Select
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>

            {(audience === "patients_by_state" || audience === "subscribers_by_plan") && (
              <div className="space-y-1.5">
                <Label htmlFor="state">
                  State {audience === "subscribers_by_plan" && "(optional)"}
                </Label>
                <Input
                  id="state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. Lagos"
                />
              </div>
            )}

            {audience === "subscribers_by_plan" && (
              <div className="space-y-1.5">
                <Label htmlFor="plan">Plan (optional — any plan if blank)</Label>
                <Select id="plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="">Any plan</option>
                  {planCodes.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {audience === "partners_by_type" && (
              <div className="space-y-1.5">
                <Label htmlFor="partner_type">Partner group</Label>
                <Select
                  id="partner_type"
                  value={partnerType}
                  onChange={(e) => setPartnerType(e.target.value as "pharmacy" | "specialist")}
                >
                  <option value="pharmacy">Pharmacies</option>
                  <option value="specialist">Specialists</option>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Channels</Label>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((c) => {
                  const disabled = isPartnerAudience && c.value === "whatsapp";
                  return (
                    <label
                      key={c.value}
                      className={`flex items-center gap-2 text-sm ${
                        disabled ? "text-charcoal-ink/40" : "text-charcoal-ink"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={channels.includes(c.value) && !disabled}
                        disabled={disabled}
                        onChange={() => toggleChannel(c.value)}
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
              {isPartnerAudience && (
                <p className="text-xs text-charcoal-ink/50">
                  Partners are reached by email/SMS only — WhatsApp is a patient channel.
                </p>
              )}
            </div>

            <p className="text-sm text-charcoal-ink/70">
              {count.isLoading
                ? "Counting recipients…"
                : count.isError
                  ? "Could not estimate recipients."
                  : `This will reach ${count.data ?? 0} recipient${count.data === 1 ? "" : "s"}.`}
            </p>

            {validationError && <p className="text-sm text-red-600">{validationError}</p>}
            {sendError && <p className="text-sm text-red-600">{sendError}</p>}
            {sentCount !== null && (
              <p className="text-sm text-brand-green">
                Queued to {sentCount} recipient{sentCount === 1 ? "" : "s"}.
              </p>
            )}

            <Button type="submit" disabled={send.isPending || (count.data ?? 0) === 0}>
              {send.isPending ? "Sending…" : "Send broadcast"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent broadcasts</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {history.data && history.data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No broadcasts sent yet.</p>
          )}
          {history.data && history.data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {history.data.map((b) => (
                <li key={b.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{b.title}</p>
                    <Badge variant={b.status === "sent" ? "green" : "grey"}>
                      {b.status === "sent" ? `Sent · ${b.recipient_count}` : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {b.audience.replace(/_/g, " ")} · {b.channels.join(", ")}
                    {b.sent_at ? ` · ${new Date(b.sent_at).toLocaleString()}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
