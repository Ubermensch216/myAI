#!/usr/bin/env node
/**
 * Verifies that manual_override survives a re-extraction upsert.
 * Smoke test for KG curation flow.
 *
 * Usage: node --env-file=.env scripts/test-kg-override.mjs
 */
import {
  openNotebookGraph,
  upsertNode,
  getNode,
  setNodeEnabled,
  clearNodeOverride
} from "../server/rag/graph/store.js";

const NB = "nb_c7b5657d196c4910";
const NODE_ID = "n_a50e00c72564"; // 감사원

const db = await openNotebookGraph(NB);

console.log("[1] baseline:", await getNode(db, NODE_ID));

setNodeEnabled(db, NODE_ID, false);
console.log("[2] after disable:", await getNode(db, NODE_ID));

// Simulate a re-extraction call — upsert with same label but possibly different confidence
upsertNode(db, {
  type: "Department",
  label: "감사원",
  summary: "",
  confidence: 0.95,
  model: "gemma4:e4b",
  aliases: ["감사원"]
});
const afterUpsert = await getNode(db, NODE_ID);
console.log("[3] after re-extraction upsert:", afterUpsert);
if (afterUpsert.enabled !== 0) {
  console.error("FAIL: manual_override did NOT survive upsert (enabled was reset)");
  process.exit(1);
}
console.log("PASS: manual_override survived upsert (enabled stayed 0)");

clearNodeOverride(db, NODE_ID);
console.log("[4] after clear-override:", await getNode(db, NODE_ID));

console.log("\nAll override checks passed.");
