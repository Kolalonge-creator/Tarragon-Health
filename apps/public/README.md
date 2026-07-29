# apps/public

Next.js public outcomes dashboard, unauthenticated. Build spec v3 §14.

Not yet built. Built at **M8** alongside apps/console (Phase 1), then substantially
extended at Phase 2 **P1** ("Evidence layer... public dashboard reads snapshots only") —
per `docs/tarragon-build-spec-v3-phase2.md`. In Phase 2, this app must read only from
`outcome_snapshots` (I16: published figures are computed from immutable dated
snapshots, never live queries) — do not wire it directly to live tables even as a
shortcut. Do not add functional code here out of order.
