/**
 * When does a video consultation drop to audio only? (S11-S15 R7a)
 *
 *   pnpm --filter @tarragon/web audio-fallback-table [profiles.json]
 *
 * Prints, for each network profile, what the REAL consultation ladder does under the PROPOSED `video.audio_fallback` values and under a
 * few candidate values, so the numbers can be chosen from data instead of guessed. With no argument it uses the built-in ILLUSTRATIVE
 * profiles, which are NOT measurements. Give it a JSON file of profiles read off real handsets to get a table that means something:
 *   [ { "name": "3G, power-saving on", "note": "Tecno, Lagos Island", "phases": [ { "seconds": 600, "lossPercent": 4, "rttMs": 380, "bandwidthKbps": 220 } ] } ]
 * A phase may add "disconnected": true for a drop. No network, no vendor and no patient data is involved; nothing is written.
 */
import { readFileSync } from "node:fs";
import { getProposedConfig } from "@tarragon/shared";
import { ILLUSTRATIVE_PROFILES, renderTable, type FallbackPolicy, type NetworkProfile } from "../../../packages/integrations/src/evidence/audio-fallback-table";

const cfg = getProposedConfig<{ poorSamplesToDowngrade: number; goodSamplesToOfferVideo: number; poorBelowKbps: number; poorAudioLossPercent: number; poorAudioRttMs: number; sampleIntervalSeconds: number }>("video.audio_fallback").value;
const grace = getProposedConfig<{ reconnectGraceSeconds: number }>("consultations.policy").value.reconnectGraceSeconds;
const current: FallbackPolicy = { ...cfg, reconnectGraceSeconds: grace };

const file = process.argv[2];
const profiles: readonly NetworkProfile[] = file ? (JSON.parse(readFileSync(file, "utf8")) as NetworkProfile[]) : ILLUSTRATIVE_PROFILES;

console.log(`Values on the table now (PROPOSED, video.audio_fallback): ${JSON.stringify(cfg)}, reconnect grace ${grace}s\n`);
console.log(
  renderTable(profiles, [
    { label: "current", policy: current },
    { label: "2 poor samples", policy: { ...current, poorSamplesToDowngrade: 2 } },
    { label: "5 poor samples", policy: { ...current, poorSamplesToDowngrade: 5 } },
    { label: "loss 5% / rtt 400ms", policy: { ...current, poorAudioLossPercent: 5, poorAudioRttMs: 400 } },
    { label: "floor 200 kbps", policy: { ...current, poorBelowKbps: 200 } },
  ]),
);
if (!file) console.log("\nThese profiles are illustrative shapes, not readings from a real network. Replace them before drawing a conclusion.");
