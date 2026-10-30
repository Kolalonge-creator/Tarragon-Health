import { describe, expect, it } from "@jest/globals";
import { RENEWAL_CONSENT_TICKED_BY_DEFAULT } from "../../../supabase/functions/_shared/commerce/renewal-consent.ts";
import * as commerce from "./index.ts";

describe("the automatic-renewal consent default", () => {
  it("starts UNTICKED, and is the one shared constant web and mobile import", () => {
    expect(RENEWAL_CONSENT_TICKED_BY_DEFAULT).toBe(false);
    expect(commerce.RENEWAL_CONSENT_TICKED_BY_DEFAULT).toBe(RENEWAL_CONSENT_TICKED_BY_DEFAULT);
  });
});
