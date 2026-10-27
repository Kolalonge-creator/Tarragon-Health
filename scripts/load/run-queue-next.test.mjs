import test from "node:test";
import assert from "node:assert/strict";
import { checkSessionsFile, jwtRole } from "./run-queue-next.mjs";

const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;
const good = JSON.stringify([{ jwt: jwt("authenticated") }]);
// git double: a repo at /repo; `tracked` and `ignored` sets decide the answers
const gitFor = ({ tracked = [], ignored = [] } = {}) => (args) => {
  if (args[0] === "rev-parse") return { code: 0, out: "/repo\n" };
  if (args[0] === "ls-files") return { code: tracked.includes(args[2]) ? 0 : 1, out: "" };
  if (args[0] === "check-ignore") return { code: ignored.includes(args[2]) ? 0 : 1, out: "" };
  return { code: 1, out: "" };
};

test("a file outside the repository passes", () => {
  assert.deepEqual(checkSessionsFile("/home/me/sessions.json", { git: gitFor(), readFile: () => good, repoRootOf: () => "/repo" }), []);
});

test("a file inside the repository must be ignored and untracked", () => {
  const ok = checkSessionsFile("/repo/scripts/load/sessions.json", { git: gitFor({ ignored: ["scripts/load/sessions.json"] }), readFile: () => good });
  assert.deepEqual(ok, []);
  const notIgnored = checkSessionsFile("/repo/scripts/load/sessions.json", { git: gitFor(), readFile: () => good });
  assert.match(notIgnored.join(" "), /not git-ignored/);
  const tracked = checkSessionsFile("/repo/scripts/load/sessions.json", { git: gitFor({ tracked: ["scripts/load/sessions.json"], ignored: ["scripts/load/sessions.json"] }), readFile: () => good });
  assert.match(tracked.join(" "), /TRACKED/);
});

test("relative paths, unreadable files, empty lists and service-role tokens are refused", () => {
  assert.match(checkSessionsFile("sessions.json").join(" "), /absolute/);
  assert.match(checkSessionsFile("/x/s.json", { git: gitFor(), readFile: () => { throw new Error("nope"); } }).join(" "), /cannot read/);
  assert.match(checkSessionsFile("/x/s.json", { git: gitFor(), readFile: () => "[]" }).join(" "), /non-empty/);
  assert.match(checkSessionsFile("/x/s.json", { git: gitFor(), readFile: () => JSON.stringify([{ jwt: jwt("service_role") }]) }).join(" "), /service_role/);
  assert.equal(jwtRole(jwt("authenticated")), "authenticated");
  assert.equal(jwtRole("garbage"), null);
});
