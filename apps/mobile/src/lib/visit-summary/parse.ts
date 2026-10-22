import type { Json } from "@tarragon/shared";
import { isRecord, str } from "../written-questions/types";

/** The patient's after-visit summary (AVS). Only approved summaries come back from the database; this just reads the shape. */
export interface VisitSummaryItem {
  id: string;
  kind: string;
  params: Record<string, Json | undefined>;
  customText: string | null;
  dueOn: string | null;
  doneAt: string | null;
  taskId: string | null;
}

export interface VisitSummary {
  id: string;
  noteId: string;
  summaryText: string;
  approvedAt: string | null;
  approvedByName: string | null;
  items: VisitSummaryItem[];
}

function parseItems(raw: Json | undefined): VisitSummaryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VisitSummaryItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const kind = str(item.kind);
    if (!id || !kind) continue;
    out.push({
      id,
      kind,
      params: isRecord(item.params) ? item.params : {},
      customText: str(item.custom_text),
      dueOn: str(item.due_on),
      doneAt: str(item.done_at),
      taskId: str(item.task_id),
    });
  }
  return out;
}

/** A row that cannot be read is dropped, never shown half-filled. */
export function parseVisitSummaries(raw: Json | null): VisitSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: VisitSummary[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const noteId = str(row.note_id);
    const summaryText = str(row.summary_text);
    if (!id || !noteId || summaryText === null) continue;
    out.push({
      id,
      noteId,
      summaryText,
      approvedAt: str(row.approved_at),
      approvedByName: str(row.approved_by_name),
      items: parseItems(row.items),
    });
  }
  return out;
}
