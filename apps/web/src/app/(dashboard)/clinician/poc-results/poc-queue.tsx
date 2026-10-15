"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionForm } from "@/components/testing-days/action-form";
import { getEcgTraceUrl, interpretEcg, releasePocResult, withholdPocResult } from "@/lib/testing-days/actions";
import { URINALYSIS_FIELDS, type PocQueue as PocQueueData } from "@/lib/testing-days/model";

const KIND_LABEL = { urinalysis: "Urine strip", hba1c: "HbA1c" } as const;

function labelOf(code: string): string {
  return URINALYSIS_FIELDS.find((f) => f.code === code)?.label ?? (code === "hba1c" ? "HbA1c" : code);
}

function OpenTrace({ id }: { id: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          const r = await getEcgTraceUrl(id);
          if (r.url) window.open(r.url, "_blank", "noopener,noreferrer");
          else setMsg(r.error ?? "Could not open the trace.");
        }}
      >
        Open the trace
      </Button>
      {msg ? (
        <p role="alert" className="text-sm text-status-red">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

export function PocQueue({ queue }: { queue: PocQueueData }) {
  if (queue.results.length === 0 && queue.ecgs.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">Nothing is waiting for you.</p>;
  }
  return (
    <div className="space-y-4">
      {queue.ecgs.map((e) => (
        <Card key={e.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              ECG for {e.full_name ?? "a member"} <Badge variant="amber">Unread</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-charcoal-ink/60">
              Recorded {new Date(e.recorded_at).toLocaleString("en-NG")}
              {e.device_label ? ` on ${e.device_label}` : ""}.
            </p>
            {e.machine_statement ? (
              <p className="rounded-md bg-charcoal-ink/5 p-2 text-sm text-charcoal-ink">
                Machine text (not a diagnosis, and not shown to the member): {e.machine_statement}
              </p>
            ) : null}
            <OpenTrace id={e.id} />
            <ActionForm action={interpretEcg} hidden={{ recordingId: e.id }} submitLabel="Save interpretation and share with the member">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`cls-${e.id}`}>Overall</Label>
                  <Select id={`cls-${e.id}`} name="interpretationClass" defaultValue="normal">
                    <option value="normal">Normal</option>
                    <option value="abnormal">Needs a closer look</option>
                    <option value="urgent">Urgent: contact the member</option>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor={`int-${e.id}`}>Your interpretation (the member reads these words)</Label>
                  <Input id={`int-${e.id}`} name="interpretation" required minLength={3} maxLength={2000} />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ))}

      {queue.results.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {KIND_LABEL[r.kind]} for {r.full_name ?? "a member"} <Badge variant="amber">Held</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm text-charcoal-ink">
              {(r.items ?? []).map((i) => (
                <li key={i.analyte_code} className="flex justify-between gap-4">
                  <span>{labelOf(i.analyte_code)}</span>
                  <span>
                    {i.value_numeric ?? i.value_text} {i.unit}{" "}
                    <Badge variant={i.flag === "normal" ? "green" : i.flag === "critical" ? "red" : "amber"}>{i.flag}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-start gap-4">
              <ActionForm action={releasePocResult} hidden={{ resultId: r.id }} submitLabel="Release to the member" />
              <ActionForm action={withholdPocResult} hidden={{ resultId: r.id }} submitLabel="Withhold" variant="outline">
                <div className="space-y-1">
                  <Label htmlFor={`why-${r.id}`}>Reason</Label>
                  <Input id={`why-${r.id}`} name="reason" />
                </div>
              </ActionForm>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
