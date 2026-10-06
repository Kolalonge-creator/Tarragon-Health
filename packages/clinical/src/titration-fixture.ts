/** TEST USE ONLY (not exported from the package index): the placeholder step table, fictional drugs, status draft. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProtocolDefinition } from "./titration-types";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "titration-placeholder.json");
export const TITRATION_PLACEHOLDER = JSON.parse(readFileSync(file, "utf8")) as ProtocolDefinition;
