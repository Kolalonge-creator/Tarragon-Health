"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { markOrderCollected, submitPartnerCorrection, submitPartnerResult } from "@/lib/lab-results/structured-actions";
import {
  CORRECTION_KINDS,
  formatRange,
  LAB_RESULT_FILE_ACCEPT,
  PANEL_CODES,
  PANEL_LABEL,
  type PanelCode,
  type PanelDefinition,
} from "@/lib/lab-results/structured";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type PortalOrder = {
  order_id: string;
  order_number: string | null;
  partner_reference: string | null;
  status: string;
  panel_code: string | null;
  patient_name: string | null;
  patient_number: string | null;
  ordered_at: string;
  sample_collected_at: string | null;
  result_received: boolean;
  latest_result_id: string | null;
};

type EntryItem = { analyte_code: string; value_numeric?: number; value_text?: string; unit?: string };

const COLLECTABLE = new Set(["payment_confirmed", "ordered"]);
const TOUCH = "min-h-11";

function isPanel(v: string | null): v is PanelCode {
  return v !== null && (PANEL_CODES as readonly string[]).includes(v);
}

export function OrderResultCard({ order, panels }: { order: PortalOrder; panels: Record<string, PanelDefinition> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [collectError, setCollectError] = useState<string | null>(null);
  const reference = order.partner_reference ?? order.order_number ?? order.order_id.slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">
            {order.patient_name ?? "Patient"} <span className="text-charcoal-ink/60">{order.patient_number ?? ""}</span>
          </CardTitle>
          <p className="text-sm text-charcoal-ink/60">Booking reference {reference}</p>
        </div>
        <Badge variant={order.result_received ? "green" : order.status === "sample_collected" || order.status === "processing" ? "blue" : "amber"}>
          {order.result_received ? "Result received" : order.status.replace(/_/g, " ")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {order.result_received ? (
          <>
            <p className="text-sm text-charcoal-ink/70">Thank you. Your result was received. Tarragon reviews it before the patient sees it.</p>
            {order.latest_result_id ? (
              <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {open ? "Close" : "Send a correction"}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {COLLECTABLE.has(order.status) ? (
              <Button
                type="button"
                variant="outline"
                className={TOUCH}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await markOrderCollected(order.order_id);
                    setCollectError(r?.error ?? null);
                  })
                }
              >
                Mark sample collected
              </Button>
            ) : null}
            <Button type="button" className={TOUCH} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Close" : "Enter result"}
            </Button>
          </div>
        )}
        {collectError ? <p role="alert" className="text-sm text-red-700">{collectError}</p> : null}
        {open && !order.result_received ? <EntryForm order={order} panels={panels} /> : null}
        {open && order.result_received && order.latest_result_id ? <EntryForm order={order} panels={panels} correctsId={order.latest_result_id} /> : null}
      </CardContent>
    </Card>
  );
}

function EntryForm({ order, panels, correctsId }: { order: PortalOrder; panels: Record<string, PanelDefinition>; correctsId?: string }) {
  const [panel, setPanel] = useState<PanelCode>(isPanel(order.panel_code) ? order.panel_code : "essential");
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(correctsId ? submitPartnerCorrection : submitPartnerResult, undefined);
  const def = panels[panel];

  const items = useMemo((): EntryItem[] => {
    if (!def) return [];
    return def.analytes.flatMap((a): EntryItem[] => {
      const raw = (values[a.code] ?? "").trim();
      if (raw === "") return [];
      if (a.kind === "numeric") {
        const n = Number(raw);
        return Number.isFinite(n) ? [{ analyte_code: a.code, value_numeric: n, unit: a.unit }] : [];
      }
      return raw === "positive" || raw === "negative" ? [{ analyte_code: a.code, value_text: raw }] : [];
    });
  }, [def, values]);

  if (state?.success) {
    return <p role="status" className="text-sm text-green-800">Received. Thank you.</p>;
  }

  return (
    <form action={action} className="space-y-4 border-t pt-4">
      <input type="hidden" name="order_id" value={order.order_id} />
      <input type="hidden" name="panel" value={panel} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {correctsId ? (
        <>
          <input type="hidden" name="corrects_result_id" value={correctsId} />
          <p className="text-sm text-charcoal-ink/70">
            Enter the complete corrected panel. It goes through the same checks as a new result, and the earlier result is replaced only once Tarragon has released this one.
          </p>
          <div>
            <Label htmlFor={`kind-${order.order_id}`}>What kind of change is this?</Label>
            <Select id={`kind-${order.order_id}`} name="kind" defaultValue="corrected" className={TOUCH}>
              {CORRECTION_KINDS.map((k) => (
                <option key={k} value={k}>{k === "corrected" ? "A value was wrong (corrected)" : k === "amended" ? "A value or note changed (amended)" : "More results added (appended)"}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`reason-${order.order_id}`}>What changed and why?</Label>
            <Input id={`reason-${order.order_id}`} name="reason" required minLength={5} maxLength={500} className={TOUCH} />
          </div>
        </>
      ) : null}

      {isPanel(order.panel_code) ? null : (
        <div>
          <Label htmlFor={`panel-${order.order_id}`}>Panel</Label>
          <Select id={`panel-${order.order_id}`} value={panel} onChange={(e) => setPanel(e.target.value as PanelCode)} className={TOUCH}>
            {PANEL_CODES.map((p) => (
              <option key={p} value={p}>{PANEL_LABEL[p]}</option>
            ))}
          </Select>
        </div>
      )}

      {!def ? (
        <p className="text-sm text-red-700">The panel list could not be loaded. Please refresh.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {def.analytes.map((a) => {
            const id = `${order.order_id}-${a.code}`;
            const range = a.kind === "numeric" ? formatRange(a.refLow ?? null, a.refHigh ?? null, a.unit) : "";
            return (
              <div key={a.code}>
                <Label htmlFor={id}>
                  {a.label}
                  {a.optional ? " (only if ordered)" : ""}
                  {a.kind === "numeric" ? ` (${a.unit})` : ""}
                </Label>
                {a.kind === "numeric" ? (
                  <Input id={id} inputMode="decimal" className={TOUCH} value={values[a.code] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [a.code]: e.target.value }))} />
                ) : (
                  <Select id={id} className={TOUCH} value={values[a.code] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [a.code]: e.target.value }))}>
                    <option value="">Not tested</option>
                    <option value="negative">Negative</option>
                    <option value="positive">Positive</option>
                  </Select>
                )}
                {range ? <p className="mt-1 text-xs text-charcoal-ink/60">Reference {range}</p> : null}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <Label htmlFor={`file-${order.order_id}`}>Lab report (PDF or photo, optional)</Label>
        <Input id={`file-${order.order_id}`} type="file" name="file" accept={LAB_RESULT_FILE_ACCEPT} className={TOUCH} />
      </div>

      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      <Button type="submit" className={TOUCH} disabled={pending}>
        {pending ? "Sending" : correctsId ? "Send the correction" : "Submit result"}
      </Button>
    </form>
  );
}
