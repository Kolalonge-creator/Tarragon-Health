import { HYPERTENSION_PROTOCOL_CODE } from "./suggest-titration";

/**
 * The titration engine must read the step table the 'bp' pathway names (pathway_definitions.step_table_code = htn_rtsl_ng,
 * migration 20261007190627_s61_s62_pathway_engine.sql). For four weeks it read "htn_hearts_ng", a code no protocol row ever
 * carried, so the Chief Medical Officer's approval of htn_rtsl_ng v1 changed nothing. This pin fails the build if the two drift.
 */
describe("hypertension protocol code", () => {
  it("matches the bp pathway step table code", () => {
    expect(HYPERTENSION_PROTOCOL_CODE).toBe("htn_rtsl_ng");
  });
});
