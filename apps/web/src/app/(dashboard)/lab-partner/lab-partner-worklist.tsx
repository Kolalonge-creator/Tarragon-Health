"use client";

import { useRef, useState } from "react";
import { useLabPartnerOrders, useLabPartnerUploadResult } from "@/lib/queries/lab-partner";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type OrderRow = {
  order_id: string;
  order_number: string | null;
  status: string;
  patient_name: string | null;
  patient_number: string | null;
  panel_name: string | null;
  ordered_at: string;
  resulted_at: string | null;
};

const STATUS_VARIANT: Record<string, "green" | "amber" | "blue" | "grey"> = {
  payment_confirmed: "amber",
  ordered: "amber",
  sample_collected: "blue",
  processing: "blue",
  resulted: "green",
  cancelled: "grey",
};

function OrderCard({ order }: { order: OrderRow }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useLabPartnerUploadResult();

  const done = order.status === "resulted" || order.status === "cancelled";

  function handleUpload() {
    setValidationError(null);
    if (!file) {
      setValidationError("Attach the result file.");
      return;
    }
    const fileError = validateResultDocFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    upload.mutate(
      { orderId: order.order_id, file, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setFile(null);
          setNote("");
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
      },
    );
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal-ink">
          {order.patient_name ?? "Patient"}
          {order.patient_number ? ` · ${order.patient_number}` : ""}
        </span>
        {order.order_number && <Badge variant="blue">{order.order_number}</Badge>}
        <Badge variant={STATUS_VARIANT[order.status] ?? "grey"}>{order.status}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">{order.panel_name ?? "Lab test"}</p>

      {done ? (
        <p className="text-xs text-brand-green">
          {order.status === "resulted"
            ? "Result uploaded."
            : "This order was cancelled."}
        </p>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-charcoal-ink/70"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Upload result"}
          </Button>

          {expanded && (
            <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-3">
              <div className="space-y-1.5">
                <Label htmlFor={`file_${order.order_id}`} className="text-xs">
                  Result file
                </Label>
                <Input
                  id={`file_${order.order_id}`}
                  ref={fileInputRef}
                  type="file"
                  accept={RESULT_DOC_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="h-8 text-xs"
                />
                <p className="text-xs text-charcoal-ink/60">PDF or photo, up to 10 MB.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`note_${order.order_id}`} className="text-xs">
                  Note (optional)
                </Label>
                <Textarea
                  id={`note_${order.order_id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
              </div>
              {displayError && <p className="text-xs text-red-600">{displayError}</p>}
              <Button
                size="sm"
                variant="outline"
                disabled={upload.isPending || !file}
                onClick={handleUpload}
              >
                {upload.isPending ? "Uploading…" : "Upload result"}
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function LabPartnerWorklist() {
  const { data, isLoading, isError } = useLabPartnerOrders();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Orders to fulfil</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load your orders.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No orders routed to your lab yet.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {(data as OrderRow[]).map((order) => (
                <OrderCard key={order.order_id} order={order} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
