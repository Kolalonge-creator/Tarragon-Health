"use client";

import { useState } from "react";
import { useProtocolVersions, useCreateProtocolVersion } from "@/lib/queries/protocol-versions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatApprovedAt(approvedAt: string): string {
  return new Date(approvedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProtocolVersionsManager() {
  const { data: versions, isLoading, isError } = useProtocolVersions();
  const create = useCreateProtocolVersion();

  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [contentText, setContentText] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !versions) {
    return <p className="text-sm text-red-600">Could not load protocol versions.</p>;
  }

  const byProtocol = new Map<string, typeof versions>();
  for (const v of versions) {
    byProtocol.set(v.protocol_id, [...(byProtocol.get(v.protocol_id) ?? []), v]);
  }

  const canSubmit =
    protocolId.trim().length > 0 && title.trim().length > 0 && changeSummary.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign a new protocol version</CardTitle>
          <CardDescription>
            protocol_id is a stable slug shared across versions of the same protocol — reuse an
            existing one (see below) to add a version to it, or pick a new one to start a
            protocol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="protocol-id">protocol_id</Label>
              <Input
                id="protocol-id"
                placeholder="e.g. hypertension_escalation_thresholds"
                value={protocolId}
                onChange={(e) => setProtocolId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g. Hypertension escalation thresholds"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-summary">Change summary</Label>
            <Input
              id="change-summary"
              placeholder="What changed and why, in one line"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content">Protocol content</Label>
            <Textarea
              id="content"
              rows={6}
              placeholder="The actual thresholds/rules/care plan template text"
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
            />
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">{(create.error as Error).message}</p>
          )}
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => {
              create.mutate(
                { protocolId: protocolId.trim(), title: title.trim(), changeSummary: changeSummary.trim(), content: { text: contentText.trim() } },
                {
                  onSuccess: () => {
                    setProtocolId("");
                    setTitle("");
                    setChangeSummary("");
                    setContentText("");
                  },
                }
              );
            }}
          >
            {create.isPending ? "Signing…" : "Sign version"}
          </Button>
        </CardContent>
      </Card>

      {byProtocol.size === 0 && (
        <p className="text-sm text-charcoal-ink/60">No protocols signed yet.</p>
      )}

      {[...byProtocol.entries()].map(([id, protocolVersions]) => (
        <Card key={id}>
          <CardHeader>
            <CardTitle>{protocolVersions[0].title}</CardTitle>
            <CardDescription>{id}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {protocolVersions.map((v) => (
                <li key={v.id} className="space-y-1 py-3">
                  <p className="text-sm font-medium text-charcoal-ink">
                    v{v.version_number} — {formatApprovedAt(v.approved_at)}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    Signed by {v.approved_by_staff?.full_name ?? "unknown"}
                    {v.approved_by_staff?.credential_type &&
                      v.approved_by_staff?.credential_number &&
                      ` · ${v.approved_by_staff.credential_type} ${v.approved_by_staff.credential_number}`}
                  </p>
                  <p className="text-sm text-charcoal-ink/80">{v.change_summary}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
