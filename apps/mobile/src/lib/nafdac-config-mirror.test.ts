import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { NAFDAC_NUMBER_CONFIG } from "@tarragon/medicines";

describe("medicines.nafdac_number_format", () => {
  it("the compiled-in config is identical to the versioned registry entry", () => {
    expect(getProposedConfig("medicines.nafdac_number_format").value).toEqual({ ...NAFDAC_NUMBER_CONFIG });
  });
});
