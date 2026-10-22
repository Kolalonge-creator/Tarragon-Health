import { getProposedConfig } from "../proposed-config";

/** S68b: every number here is PROPOSED configuration (`child_log.*`), never typed at a call site. */
export interface ChildLogSettings {
  readonly due_window_days: number;
  readonly timeline_limit: number;
  readonly caregiver_label_max_chars: number;
  readonly card_photo_max_edge_px: number;
  readonly card_photo_jpeg_quality: number;
  readonly card_photo_max_bytes: number;
}

export function childLogSettings(): { settings: ChildLogSettings; version: number } {
  const c = getProposedConfig<Record<string, number>>("child_log.settings");
  return { settings: c.value as unknown as ChildLogSettings, version: c.version };
}
