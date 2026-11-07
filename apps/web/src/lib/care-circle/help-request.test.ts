/** P22 / PD-08: the typed help request model shared by the patient card and the supporter view. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HELP_NOTE_MAX,
  HELP_REQUEST_TYPES,
  buildHelpAlertArgs,
  isMissingTypedSignature,
  parseHelpRequestType,
  withoutTypedArgs,
} from "./help-request";

describe("help request model", () => {
  it("has exactly the five kinds the database CHECK accepts", () => {
    const sql = readFileSync(join(__dirname, "../../../../../supabase/migrations/20261107011314_care_circle_typed_help_requests.sql"), "utf8");
    const check = sql.match(/request_type in \(([^)]*)\)\);/);
    expect(check).not.toBeNull();
    const dbValues = (check?.[1] ?? "").split(",").map((v) => v.trim().replace(/'/g, ""));
    expect([...HELP_REQUEST_TYPES]).toEqual(dbValues);
    expect(HELP_NOTE_MAX).toBe(200);
  });

  it("builds the arguments with the type, a trimmed note and the location only when given", () => {
    expect(buildHelpAlertArgs({ type: "transport", note: "  Lift to the lab  " }, null)).toEqual({ p_request_type: "transport", p_note: "Lift to the lab" });
    expect(buildHelpAlertArgs({ type: "call_me", note: "   " }, null)).toEqual({ p_request_type: "call_me" });
    expect(buildHelpAlertArgs({ type: "booking" }, { lat: 6.45, lng: 3.39, accuracy: 20 })).toEqual({
      p_request_type: "booking",
      p_lat: 6.45,
      p_lng: 3.39,
      p_accuracy_m: 20,
    });
  });

  it("refuses an unknown kind or a note that is too long, so nothing is sent", () => {
    expect(buildHelpAlertArgs({ type: "diagnosis" as never }, null)).toBeNull();
    expect(buildHelpAlertArgs({ type: "transport", note: "a".repeat(201) }, null)).toBeNull();
    expect(buildHelpAlertArgs({ type: "transport", note: "a".repeat(200) }, null)).not.toBeNull();
  });

  it("reads back only a known kind; anything else (an older alert) is null", () => {
    expect(parseHelpRequestType("medicine_collection")).toBe("medicine_collection");
    expect(parseHelpRequestType(null)).toBeNull();
    expect(parseHelpRequestType("something_else")).toBeNull();
    expect(parseHelpRequestType(3)).toBeNull();
  });

  it("recognises the deploy-window error and drops only the typed arguments for the retry", () => {
    expect(isMissingTypedSignature({ code: "PGRST202" })).toBe(true);
    expect(isMissingTypedSignature({ code: "42501" })).toBe(false);
    expect(isMissingTypedSignature(null)).toBe(false);
    expect(withoutTypedArgs({ p_request_type: "transport", p_note: "x", p_lat: 1, p_lng: 2, p_accuracy_m: 3 })).toEqual({ p_lat: 1, p_lng: 2, p_accuracy_m: 3 });
  });
});
