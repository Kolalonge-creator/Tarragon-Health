"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getSupportAttachmentLink, uploadSupportAttachment } from "@/lib/support/attachment-actions";

/**
 * Files on a support ticket (SUP-2). Patients and staff can attach; staff can mark a file internal. Every file is
 * scanned before it is stored. A support lead can restrict a clinical document attached by mistake: it leaves the support
 * queue, and the lead passes it to the care team through the clinical document upload rather than forwarding the file.
 */
export function TicketAttachments({ ticketId, mode, isLead = false }: { ticketId: string; mode: "staff" | "patient"; isLead?: boolean }) {
  const qc = useQueryClient();
  const key = ["support-ticket-attachments", ticketId];
  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_ticket_attachments")
        .select("id, file_name, size_bytes, scan_status, uploader_role, is_internal, restricted_at, restricted_reason, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function open(id: string) {
    setMessage(null);
    const res = await getSupportAttachmentLink(id);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    else setMessage(res.error);
  }

  async function restrict(id: string) {
    const reason = window.prompt("Why is this file being restricted? For example: a clinical document attached by mistake.");
    if (!reason) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("restrict_support_attachment", { p_attachment_id: id, p_reason: reason });
    setMessage(error ? error.message : "Restricted. Pass the document to the care team through the clinical document upload; do not forward the file.");
    await qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="space-y-2">
      {list.isError && <p role="alert" className="text-sm text-red-700">Files could not be loaded.</p>}
      {(list.data ?? []).length === 0 && list.data && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No files yet.</p>}
      <ul className="space-y-1">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright" onClick={() => open(a.id)}>
              {a.file_name}
            </button>
            <span className="text-xs text-charcoal-ink/55">{Math.max(1, Math.round(a.size_bytes / 1024))} KB · from {a.uploader_role === "patient" ? "the customer" : "staff"}</span>
            {a.is_internal && <Badge variant="amber">Internal</Badge>}
            {a.scan_status === "pending_scan" && <Badge variant="amber">Waiting for safety check</Badge>}
            {a.restricted_at && <Badge variant="grey">Restricted</Badge>}
            {mode === "staff" && isLead && !a.restricted_at && (
              <button type="button" className="text-xs text-charcoal-ink/60 underline-offset-2 hover:underline" onClick={() => restrict(a.id)}>
                Restrict
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const file = fileRef.current?.files?.[0];
          if (!file) return;
          setBusy(true);
          setMessage(null);
          const fd = new FormData();
          fd.set("ticket_id", ticketId);
          fd.set("internal", String(mode === "staff" && internal));
          fd.set("file", file);
          const res = await uploadSupportAttachment(fd);
          setBusy(false);
          if (res.ok) {
            if (fileRef.current) fileRef.current.value = "";
            setMessage("File attached.");
            await qc.invalidateQueries({ queryKey: key });
          } else setMessage(res.error);
        }}
      >
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" aria-label="File to attach" className="text-sm" />
        {mode === "staff" && (
          <label className="flex items-center gap-1 text-sm text-charcoal-ink/70">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal
          </label>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? "Checking the file…" : "Attach"}
        </Button>
      </form>
      {mode === "patient" && <p className="text-xs text-charcoal-ink/55">Please do not attach test results or medical letters here; upload them in your health record instead.</p>}
      {message && <p role="status" className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{message}</p>}
    </div>
  );
}
