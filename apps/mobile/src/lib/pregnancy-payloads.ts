/** Payloads the offline outbox sends for the pregnancy tools (S67). Plain data, no I/O. */
export interface KickSessionPayload {
  started_at: string;
  ended_at: string | null;
  movement_offsets_s: number[];
  reported_less: boolean;
  result: "target_reached" | "contact_today" | "stopped";
  result_reason: "window_elapsed_without_target" | "clear_drop" | "reported_less_movement" | null;
  minutes_to_target: number | null;
  week_at_start: number | null;
  config_version: number;
  organisation_id: string;
}

export interface ContractionSessionPayload {
  started_at: string;
  /** [{ s: seconds from started_at, d: duration in seconds }] */
  timings: { s: number; d: number }[];
  instant_signs: string[];
  pattern: "standard" | "earlier";
  result: "keep_timing" | "go_now";
  result_reason: "instant_sign" | "before_term" | "pattern" | null;
  week_at_start: number | null;
  config_version: number;
  organisation_id: string;
}
