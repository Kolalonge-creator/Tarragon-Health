import { describe, expect, it } from "@jest/globals";
import { parseIdKeys } from "./partners-model";

describe("parseIdKeys", () => {
  it("accepts keys ending in _id or _ids, trims and de-duplicates", () => {
    expect(parseIdKeys(" lab_result_id,order_id lab_result_id ")).toEqual(["lab_result_id", "order_id"]);
    expect(parseIdKeys("task_ids")).toEqual(["task_ids"]);
  });
  it("accepts an empty list (nothing but the event itself is sent)", () => {
    expect(parseIdKeys("")).toEqual([]);
  });
  it("refuses person ids and keys of the wrong shape", () => {
    for (const bad of ["patient_id", "user_id", "caregiver_id", "name", "Lab_id", "1_id", "reading", "order_id,patient_id"]) {
      expect(parseIdKeys(bad)).toBeNull();
    }
  });
  it("refuses more than 20 keys", () => {
    expect(parseIdKeys(Array.from({ length: 21 }, (_, i) => `k${i}_id`).join(","))).toBeNull();
  });
});
