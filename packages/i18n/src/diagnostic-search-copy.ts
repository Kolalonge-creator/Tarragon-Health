/**
 * Patient and doctor search for a lab or imaging centre (`dxsearch.`), 2026-11-05. English only. Proposed copy, CMO and DPO
 * review pending. Rules held by the copy test: no em dashes; never call a listing "accredited", "approved" or "certified";
 * never call a partner "better", "best", "trusted" or "recommended"; the partner explainer always says the placement is
 * commercial (DIR-1).
 */
export const diagnosticSearchCopy = {
  "dxsearch.partner.badge": "Tarragon Preferred Partner",
  "dxsearch.partner.explainer_title": "What \"Preferred Partner\" means",
  "dxsearch.partner.explainer":
    "Tarragon has a business agreement with Preferred Partner branches, and some of these agreements pay Tarragon. A partner branch is shown first only when it passes the same checks as every other branch and is within a few kilometres of the nearest one that does. Partners farther away are listed by distance with everyone else. Being a partner says nothing about the quality of the test, and you are free to choose any branch on this list.",
  "dxsearch.verified.explainer":
    "Every branch on this list has been checked by a named member of our team: the address and phone number, that this branch does this test, and the regulator registration the test needs. These checks are repeated regularly. They are not an inspection, and prices are set by the facility.",
} as const;
