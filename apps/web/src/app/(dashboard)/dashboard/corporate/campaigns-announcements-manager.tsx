"use client";

import { useState, type FormEvent } from "react";
import {
  useEmployerCampaigns,
  useCreateCampaign,
  useEmployerAnnouncements,
  useCreateAndSendAnnouncement,
} from "@/lib/queries/employer-campaigns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  bp_screening: "BP screening",
  diabetes_prevention: "Diabetes prevention",
  weight_management: "Weight management",
  vaccination: "Vaccination",
  mental_wellbeing: "Mental wellbeing",
  exercise_challenge: "Exercise challenge",
  preventive_care: "Preventive care",
  health_education: "Health education",
};

const CHANNEL_LABEL: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

function CampaignsCard({ organisationId }: { organisationId: string }) {
  const campaigns = useEmployerCampaigns(organisationId);
  const createCampaign = useCreateCampaign(organisationId);
  const [name, setName] = useState("");
  const [type, setType] = useState("bp_screening");
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createCampaign.mutate(
      { name: name.trim(), campaign_type: type, starts_on: startsOn },
      { onSuccess: () => setName("") }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health campaigns</CardTitle>
        <CardDescription>
          Screening drives and workplace challenges (Module 26 §26.10). Participation is shown here only as
          an aggregate count — individual participation stays with your Tarragon care team, per platform
          privacy policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="campaign_name">Name</Label>
            <Input id="campaign_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BP Week" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign_type">Type</Label>
            <Select id="campaign_type" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(CAMPAIGN_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign_starts">Starts</Label>
            <Input
              id="campaign_starts"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={createCampaign.isPending}>
            Launch
          </Button>
        </form>

        <ul className="divide-y divide-charcoal-ink/10">
          {(campaigns.data ?? []).map((c) => (
            <li key={c.campaign_id} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{c.name}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {CAMPAIGN_TYPE_LABEL[c.campaign_type ?? ""] ?? c.campaign_type}
                </p>
              </div>
              <Badge variant={c.status === "active" ? "green" : "grey"}>
                {c.participant_count ?? 0} participating
              </Badge>
            </li>
          ))}
          {campaigns.data?.length === 0 && (
            <li className="py-2 text-sm text-charcoal-ink/50">No campaigns yet — launch one above.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function AnnouncementsCard({ organisationId }: { organisationId: string }) {
  const announcements = useEmployerAnnouncements(organisationId);
  const send = useCreateAndSendAnnouncement(organisationId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<string[]>(["in_app"]);

  function toggleChannel(channel: string) {
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim() || channels.length === 0) return;
    send.mutate(
      { title: title.trim(), body: body.trim(), channels },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
        },
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisational messages</CardTitle>
        <CardDescription>
          Approved, non-clinical announcements to your workforce (Module 26 §26.11) — e.g. &quot;Annual health
          assessment is now available.&quot; Kept separate from clinical care messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSend} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="announcement_title">Title</Label>
            <Input id="announcement_title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="announcement_body">Message</Label>
            <Textarea id="announcement_body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {Object.entries(CHANNEL_LABEL).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-charcoal-ink/70">
                <input
                  type="checkbox"
                  checked={channels.includes(value)}
                  onChange={() => toggleChannel(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={send.isPending || channels.length === 0}>
            {send.isPending ? "Sending…" : "Send to roster"}
          </Button>
          {send.error && <p className="text-sm text-red-600">{(send.error as Error).message}</p>}
        </form>

        <ul className="divide-y divide-charcoal-ink/10">
          {(announcements.data ?? []).map((a) => (
            <li key={a.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-charcoal-ink">{a.title}</p>
                <Badge variant={a.status === "sent" ? "green" : "grey"}>
                  {a.status === "sent" ? `Sent to ${a.recipient_count}` : "Draft"}
                </Badge>
              </div>
              <p className="text-xs text-charcoal-ink/60">{a.body}</p>
            </li>
          ))}
          {announcements.data?.length === 0 && (
            <li className="py-2 text-sm text-charcoal-ink/50">No messages sent yet.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

export function CampaignsAnnouncementsManager({ organisationId }: { organisationId: string }) {
  return (
    <div className="space-y-6">
      <CampaignsCard organisationId={organisationId} />
      <AnnouncementsCard organisationId={organisationId} />
    </div>
  );
}
