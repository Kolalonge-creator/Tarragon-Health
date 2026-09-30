/**
 * Stand-in for Next's `server-only` package under Jest.
 *
 * `server-only` exists to make a build fail if a server module is imported into
 * a client bundle. It has no runtime behaviour, and no resolvable module in a
 * plain Node test run, so importing a correctly-marked server module from a
 * test would otherwise fail to resolve. Mapping it here keeps the marker on the
 * real module (where it does its job) without making that module untestable.
 */
export {};
