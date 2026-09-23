import { describe, expect, it } from "@jest/globals";
import { pickFormValues } from "./pick-form-values";

/**
 * Direct unit test for the shared helper — CLAUDE.md requires a Jest test
 * for every service function, and until now this was only exercised
 * indirectly through the signup/patient-location/risk-assessment forms'
 * own integration tests, so a regression in the helper itself (e.g. a File
 * field wrongly coerced to a string) had no test that would catch it at
 * the source.
 */
describe("pickFormValues", () => {
  it("extracts only the requested string fields, in no particular order dependency", () => {
    const fd = new FormData();
    fd.set("firstName", "Ada");
    fd.set("lastName", "Lovelace");
    fd.set("email", "ada@example.com");

    expect(pickFormValues(fd, ["firstName", "lastName"])).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("omits a key entirely (not even as an empty string) when it wasn't submitted at all", () => {
    const fd = new FormData();
    fd.set("firstName", "Ada");

    const result = pickFormValues(fd, ["firstName", "middleName"]);
    expect(result.firstName).toBe("Ada");
    expect("middleName" in result).toBe(false);
  });

  it("keeps a genuinely empty submitted value as an empty string, distinct from a missing one", () => {
    const fd = new FormData();
    fd.set("area", "");

    expect(pickFormValues(fd, ["area"])).toEqual({ area: "" });
  });

  it("omits a File value rather than coercing it to a string", () => {
    const fd = new FormData();
    fd.set("attachment", new File(["contents"], "photo.png", { type: "image/png" }));

    const result = pickFormValues(fd, ["attachment"]);
    expect("attachment" in result).toBe(false);
  });

  it("returns an empty object when the requested keys list is empty", () => {
    const fd = new FormData();
    fd.set("firstName", "Ada");

    expect(pickFormValues(fd, [])).toEqual({});
  });
});
