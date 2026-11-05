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
  // Patient: the place a doctor suggested for one order (Phase 5)
  "dxsearch.place.open": "Where your doctor suggests",
  "dxsearch.place.hide": "Hide",
  "dxsearch.place.loading": "Loading...",
  "dxsearch.place.none": "Your doctor has not suggested a place for this one. You can use any registered laboratory or imaging centre.",
  "dxsearch.place.error": "We could not load this just now. Please try again.",
  "dxsearch.place.title": "Suggested by {name} on {date}",
  "dxsearch.place.for": "For: {test}",
  "dxsearch.place.call_first": "Call before you go: this test is by appointment here.",
  "dxsearch.place.prep": "Before you go: {note}",
  "dxsearch.place.no_longer": "This branch no longer passes our checks for this test. Please choose another place, or ask your care team in the app.",
  "dxsearch.place.free_choice": "This is a suggestion, not a requirement. You can have the test done at any registered facility, and you pay the facility directly at its price.",
  "dxsearch.place.directions": "Directions",
  // Clinician: suggest a place for an order (Phase 5)
  "dxsearch.suggest.title": "Where to have it done",
  "dxsearch.suggest.current": "Suggested: {branch}, {provider} ({address}). Patient {seen}.",
  "dxsearch.suggest.seen": "opened it on {date}",
  "dxsearch.suggest.not_seen": "has not opened it yet",
  "dxsearch.suggest.stale": "This branch no longer passes the directory checks for this test. Suggest another.",
  "dxsearch.suggest.none": "No place suggested yet.",
  "dxsearch.suggest.test": "Test",
  "dxsearch.suggest.state": "Patient's state",
  "dxsearch.suggest.lga": "LGA (optional)",
  "dxsearch.suggest.find": "Find places",
  "dxsearch.suggest.found_none": "No branch in the directory passes the checks for this test there yet. The patient can still go to any registered facility.",
  "dxsearch.suggest.pick": "Suggest this place",
  "dxsearch.suggest.withdraw": "Withdraw suggestion",
  "dxsearch.suggest.withdraw_reason": "Reason (at least 5 characters)",
  "dxsearch.suggest.error.denied": "You cannot suggest a place for this patient.",
  "dxsearch.suggest.error.not_recommendable": "That branch has stopped passing the checks for this test. Search again.",
  "dxsearch.suggest.error.invalid": "Check the test and location and try again.",
  "dxsearch.suggest.error.failed": "That did not save. Please try again.",
  "dxsearch.suggest.error.closed": "The directory is not open yet.",
  "dxsearch.suggest.hint": "Searches the patient's own state, not yours. Only branches that pass every directory check are shown. The patient sees your suggestion with a note that they may go anywhere.",
} as const;
