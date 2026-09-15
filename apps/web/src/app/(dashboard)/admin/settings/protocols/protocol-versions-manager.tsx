"use client";

import { useState } from "react";
import { protocolContentText } from "./protocol-content-text";
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
import type { ProtocolVersion } from "@/lib/queries/protocol-versions";

const DEFAULT_VISIBLE_VERSIONS = 3;

function formatApprovedAt(approvedAt: string): string {
  return new Date(approvedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One protocol_id's card. Versions are sorted newest-first by the query
 * this reads from — collapsed to the latest few by default so re-signing
 * the same protocol every year for a decade doesn't turn its card into an
 * endless scroll. Every version is still there and one click away; nothing
 * is deleted or hidden from the database, only from the default render —
 * a signed protocol version is a regulatory record and this ledger stays
 * append-only.
 */
function ProtocolVersionGroupCard({ id, protocolVersions }: { id: string; protocolVersions: ProtocolVersion[] }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = protocolVersions.length - DEFAULT_VISIBLE_VERSIONS;
  const visible = expanded || hiddenCount <= 0 ? protocolVersions : protocolVersions.slice(0, DEFAULT_VISIBLE_VERSIONS);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{protocolVersions[0].title}</CardTitle>
        <CardDescription>{id}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {visible.map((v) => (
            <li key={v.id} className="space-y-1 py-3">
              <p className="text-sm font-medium text-charcoal-ink">
                v{v.version_number}, {formatApprovedAt(v.approved_at)}
              </p>
              <p className="text-xs text-charcoal-ink/60">
                Signed by {v.approved_by_staff?.full_name ?? "unknown"}
                {v.approved_by_staff?.credential_type &&
                  v.approved_by_staff?.credential_number &&
                  ` · ${v.approved_by_staff.credential_type} ${v.approved_by_staff.credential_number}`}
              </p>
              <p className="text-sm text-charcoal-ink/80">{v.change_summary}</p>
              {/* The signed text itself. It was previously written and
                  never read back anywhere in the app, so nobody could
                  see what they had signed — which defeats the point of
                  a signed record. Collapsed by default because these
                  run to several screens. */}
              {protocolContentText(v.content) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-brand-green">
                    Read the signed protocol
                  </summary>
                  <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-warm-ivory p-3 font-sans text-sm leading-relaxed text-charcoal-ink/90">
                    {protocolContentText(v.content)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
        {hiddenCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Show fewer versions" : `Show ${hiddenCount} earlier version${hiddenCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ProtocolVersionsManager() {
  const { data: versions, isLoading, isError } = useProtocolVersions();
  const create = useCreateProtocolVersion();

  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [contentText, setContentText] = useState("");
  const [search, setSearch] = useState("");

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !versions) {
    return <p className="text-sm text-red-600">Could not load protocol versions.</p>;
  }

  const byProtocol = new Map<string, typeof versions>();
  for (const v of versions) {
    byProtocol.set(v.protocol_id, [...(byProtocol.get(v.protocol_id) ?? []), v]);
  }
  // A distinct protocol_id is added a handful of times a year at most, but
  // that still means dozens within a few years and, eventually, more than
  // fit on a screen — unlike a version count within one protocol, there's
  // no sensible "latest N" to collapse to here, since every protocol_id is
  // a different clinical topic someone may need to find. A plain text
  // filter scales indefinitely without hiding anything.
  const searchNormalized = search.trim().toLowerCase();
  const visibleProtocols = [...byProtocol.entries()].filter(
    ([id, protocolVersions]) =>
      searchNormalized.length === 0 ||
      id.toLowerCase().includes(searchNormalized) ||
      protocolVersions[0].title.toLowerCase().includes(searchNormalized)
  );

  const canSubmit =
    protocolId.trim().length > 0 && title.trim().length > 0 && changeSummary.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign a new protocol version</CardTitle>
          <CardDescription>
            protocol_id is a stable slug shared across versions of the same protocol; reuse an
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

      {byProtocol.size > 5 && (
        <div className="space-y-1.5">
          <Label htmlFor="protocol-search">Find a protocol</Label>
          <Input
            id="protocol-search"
            placeholder="Search by protocol_id or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {byProtocol.size > 0 && visibleProtocols.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">No signed protocol matches &quot;{search}&quot;.</p>
      )}

      {visibleProtocols.map(([id, protocolVersions]) => (
        <ProtocolVersionGroupCard key={id} id={id} protocolVersions={protocolVersions} />
      ))}
    </div>
  );
}
