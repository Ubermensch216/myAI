/**
 * Backs up data/notebooks/, data/indexes/ (SQLite FTS), and optionally
 * a Qdrant collection snapshot.
 *
 * Usage:
 *   node scripts/backup-department-rag.mjs [--out <dir>] [--no-qdrant]
 *
 * Output:
 *   <outDir>/department-rag-YYYY-MM-DDTHH-MM-SS/
 *     backup-manifest.json
 *     notebooks/              copy of data/notebooks/
 *     indexes/                copy of data/indexes/ (if present)
 *     <name>.snapshot         Qdrant snapshot (if QDRANT_URL is configured)
 *
 * Qdrant can always be rebuilt with:
 *   npm run rag:rebuild
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../server/env.js";

loadLocalEnv();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let outDir = path.join(rootDir, "backups");
let skipQdrant = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) outDir = path.resolve(args[++i]);
  if (args[i] === "--no-qdrant") skipQdrant = true;
}

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(outDir, `department-rag-${ts}`);
await fs.mkdir(backupDir, { recursive: true });

let notebookCount = 0;
let sqliteBackedUp = false;
let qdrantSnapshot = null;

// data/notebooks/ — source of truth, always backed up
const srcNotebooks = path.join(rootDir, "data", "notebooks");
const dstNotebooks = path.join(backupDir, "notebooks");
try {
  await fs.cp(srcNotebooks, dstNotebooks, { recursive: true });
  const entries = await fs.readdir(dstNotebooks).catch(() => []);
  notebookCount = entries.filter((e) => e.startsWith("nb_")).length;
  console.log(`ok   data/notebooks/ → notebooks/ (${notebookCount} notebooks)`);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("skip data/notebooks/ not found (no notebooks yet)");
  } else {
    console.error(`fail data/notebooks/ copy failed: ${err.message}`);
    process.exit(1);
  }
}

// data/indexes/ — SQLite FTS (rebuildable, but fast to restore)
const srcIndexes = path.join(rootDir, "data", "indexes");
const dstIndexes = path.join(backupDir, "indexes");
try {
  await fs.access(srcIndexes);
  await fs.cp(srcIndexes, dstIndexes, { recursive: true });
  sqliteBackedUp = true;
  console.log("ok   data/indexes/ → indexes/");
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("skip data/indexes/ not found");
  } else {
    console.warn(`warn data/indexes/ copy failed: ${err.message}`);
  }
}

// Qdrant snapshot — optional; skip if QDRANT_URL is unset or --no-qdrant
const qdrantUrl = (process.env.QDRANT_URL || "").replace(/\/+$/, "");
const qdrantCollection = process.env.QDRANT_COLLECTION || "myai_notebook_chunks";
const qdrantApiKey = process.env.QDRANT_API_KEY || "";

if (!skipQdrant && qdrantUrl) {
  const headers = qdrantApiKey ? { "api-key": qdrantApiKey } : {};
  try {
    const createResp = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/snapshots`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000)
    });
    if (!createResp.ok) throw new Error(`Create snapshot returned HTTP ${createResp.status}`);
    const created = await createResp.json();
    const snapshotName = created.result?.name;
    if (!snapshotName) throw new Error("No snapshot name in Qdrant response");

    const downloadResp = await fetch(
      `${qdrantUrl}/collections/${qdrantCollection}/snapshots/${encodeURIComponent(snapshotName)}`,
      { headers, signal: AbortSignal.timeout(120_000) }
    );
    if (!downloadResp.ok) throw new Error(`Download snapshot returned HTTP ${downloadResp.status}`);
    const buf = Buffer.from(await downloadResp.arrayBuffer());
    await fs.writeFile(path.join(backupDir, snapshotName), buf);
    qdrantSnapshot = snapshotName;
    console.log(`ok   Qdrant snapshot → ${snapshotName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.warn(`warn Qdrant snapshot skipped: ${err.message}`);
  }
} else if (!skipQdrant) {
  console.log("skip QDRANT_URL not configured");
}

// backup-manifest.json
const manifest = {
  version: "1",
  createdAt: new Date().toISOString(),
  notebookCount,
  sqliteBackedUp,
  qdrantSnapshot,
  qdrantCollection,
  qdrantUrl: qdrantUrl || null
};
await fs.writeFile(
  path.join(backupDir, "backup-manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(`\nBackup: ${backupDir}`);
