import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { buildS06S10Rows, type S06S10Facts } from "@/lib/clinical/s06-s10-signoff-model";
import type { S06S10Snapshot } from "@/lib/queries/s06-s10-signoffs";
import { S06S10Banner } from "./s06-s10-banner";

const pending = { status: "pending", panelKey: "versioned_draft:home_bp_programme_signoffs", version: 1 } as const;
const signed = { status: "signed", panelKey: null, version: 1 } as const;
const facts: S06S10Facts = {
  homeBp: pending,
  prn: { status: "pending", panelKey: "versioned_draft:prn_limit_rules", version: 1 },
  myHealth: signed,
  triage: { status: "pending", panelKey: "triage_rule_set_draft", version: 4 },
  attestations: { c4CuffWording: false, patternClinicianOnly: false },
  proposedConfirmed: { "bp.home_programme": false, "medicines.prn_limits": false, "medicines.adherence_report": false, "my_health.lock_screen_pass": false },
};
const snapshot = (over: Partial<S06S10Snapshot> = {}): S06S10Snapshot => ({
  rows: buildS06S10Rows(facts),
  openProposed: [],
  founderReview: [],
  items: [],
  failed: false,
  failedSources: [],
  ...over,
});

describe("S06S10Banner", () => {
  it("lists all eight items with their decision, basis and an anchor to the panel that signs them", () => {
    const html = renderToStaticMarkup(<S06S10Banner snapshot={snapshot()} />);
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]) expect(html).toContain(`>${id}</span>`);
    expect(html).toContain("S06 to S10 items awaiting your signature");
    expect(html).toContain('href="#item-versioned-draft-home-bp-programme-signoffs"');
    expect(html).toContain('href="#item-triage-rule-set-draft"');
    expect(html).toContain("Nigeria 2023-2028");
    expect(html).toContain("7 of 8 still need you");
  });

  it("links the founder review values to the readable go-live page (a CMO login cannot open /admin) and says they are not signable here", () => {
    const html = renderToStaticMarkup(
      <S06S10Banner snapshot={snapshot({ founderReview: [{ key: "offline.trust", title: "Offline", what: "x", row: null }] })} />,
    );
    expect(html).toContain('href="/clinician/go-live#offline.trust"');
    expect(html).not.toContain("/admin/");
    expect(html).toContain("not signable from this account");
  });

  it("says so when nothing could be read instead of showing an all-clear", () => {
    const html = renderToStaticMarkup(<S06S10Banner snapshot={snapshot({ rows: [], failed: true })} />);
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("All eight are signed");
  });

  it("shows the unreadable state on a row that failed to load", () => {
    const rows = buildS06S10Rows({ ...facts, prn: { status: "unreadable", panelKey: null, version: null } });
    const html = renderToStaticMarkup(<S06S10Banner snapshot={snapshot({ rows, failed: true, failedSources: ["the as-needed limits"] })} />);
    expect(html).toContain("Could not read: the as-needed limits");
  });

  it("does not claim all signed while registry values still need confirming", () => {
    const rows = buildS06S10Rows({
      ...facts,
      homeBp: signed,
      prn: signed,
      triage: signed,
      attestations: { c4CuffWording: true, patternClinicianOnly: true },
      proposedConfirmed: { "bp.home_programme": true, "medicines.prn_limits": true, "medicines.adherence_report": true, "my_health.lock_screen_pass": true, "adherence.threshold": true },
    });
    const done = renderToStaticMarkup(<S06S10Banner snapshot={snapshot({ rows })} />);
    expect(done).toContain("All eight are signed.");
    const open = renderToStaticMarkup(
      <S06S10Banner snapshot={snapshot({ rows, openProposed: [{ key: "bp.home_programme" } as never] })} />,
    );
    expect(open).not.toContain("All eight are signed.");
    expect(open).toContain("1 proposed values still need confirming");
  });
});
