"use client";

import {
  useNotificationTemplates,
  useSetNotificationTemplateActive,
  useApproveNotificationTemplate,
  useUnregisteredTemplates,
  type NotificationTemplate,
} from "@/lib/queries/notification-templates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableList } from "@/components/ui/searchable-list";

const PRIORITY_BADGE: Record<
  NotificationTemplate["business_priority"],
  "grey" | "amber" | "green" | "red" | "blue"
> = {
  critical: "red",
  urgent: "amber",
  important: "blue",
  routine: "grey",
  marketing: "green",
};

function TemplateRow({ template }: { template: NotificationTemplate }) {
  const setActive = useSetNotificationTemplateActive();
  const approve = useApproveNotificationTemplate();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-charcoal-ink">{template.key}</p>
          <Badge variant={PRIORITY_BADGE[template.business_priority]}>
            {template.business_priority}
          </Badge>
          <Badge variant="grey">{template.category}</Badge>
          {!template.is_active && <Badge variant="red">Inactive</Badge>}
          {template.requires_clinical_approval && (
            <Badge variant={template.clinical_approved_at ? "green" : "amber"}>
              {template.clinical_approved_at ? "Approved" : "Needs sign-off"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-charcoal-ink/60">{template.description}</p>
        <p className="text-xs text-charcoal-ink/50">
          {template.audience} · {template.default_channels.join(", ")} · {template.timing}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {template.requires_clinical_approval && !template.clinical_approved_at && (
          <Button
            size="sm"
            disabled={approve.isPending}
            onClick={() => approve.mutate(template.key)}
          >
            Approve
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={setActive.isPending}
          onClick={() =>
            setActive.mutate({ key: template.key, isActive: !template.is_active })
          }
        >
          {template.is_active ? "Mark inactive" : "Mark active"}
        </Button>
      </div>
    </li>
  );
}

export function NotificationTemplatesManager() {
  const { data: templates, isLoading, isError } = useNotificationTemplates();
  const { data: unregistered } = useUnregisteredTemplates();

  return (
    <div className="space-y-6">
      {unregistered && unregistered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sent but not registered</CardTitle>
            <CardDescription>
              These templates were enqueued in the last 30 days but have no catalogue entry:
              a gap in documentation, not necessarily a broken send.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {unregistered.map((u) => (
                <li key={u.template} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-xs">{u.template}</span>
                  <span className="text-charcoal-ink/60">
                    {u.send_count} sends, last{" "}
                    {new Date(u.last_sent_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Template registry</CardTitle>
          <CardDescription>
            Every notification&apos;s governance metadata: category, urgency, audience,
            default channels, and clinical sign-off status. Deliberately not a live kill
            switch: for all but two templates, the actual copy still renders from the send
            pipeline&apos;s own code regardless of the Active toggle here (see each
            template&apos;s design notes for why). This is the catalogue admins and
            compliance read, not an editor for what actually goes out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load templates.</p>}
          {templates && (
            <SearchableList
              items={templates}
              filterFn={(t, q) =>
                t.key.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q) ||
                t.business_priority.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q) ||
                t.audience.toLowerCase().includes(q)
              }
              searchPlaceholder="Search notification templates…"
              emptyMessage="No notification templates yet."
              renderContainer={(children) => (
                <ul className="divide-y divide-charcoal-ink/10">{children}</ul>
              )}
              renderItem={(t) => <TemplateRow key={t.key} template={t} />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
