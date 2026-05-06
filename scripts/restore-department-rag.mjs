/**
 * Restores data/notebooks/ and data/indexes/ from a backup created by
 * backup-department-rag.mjs.
 *
 * Usage:
 *   node scripts/restore-department-rag.mjs <backup-dir> [--yes]
 *
 * Qdrant is NOT restored automatically — repopulate it with:
 *   npm run rag:rebuild
 */

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let backupDir = "";
let autoYes = false;

for (const arg of args) {
  if (arg === "--yes" || arg === "-y") autoYes = true;
  else if (!arg.startsWith("-")) backupDir = path.resolve(arg);
}

if (!backupDir) {
  console.error("Usage: node scripts/restore-department-rag.mjs <backup-dir> [--yes]");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(path.join(backupDir, "backup-manifest.json"), "utf8"));
} catch (err) {
  console.error(`Cannot read backup-manifest.json in ${backupDir}: ${err.message}`);
  process.exit(1);
}

console.log(`\nBackup:    ${backupDir}`);
console.log(`Created:   ${manifest.createdAt}`);
console.log(`Notebooks: ${manifest.notebookCount}`);
console.log(`SQLite:    ${manifest.sqliteBackedUp ? "included" : "not in backup"}`);
console.log(`Qdrant:    ${manifest.qdrantSnapshot ? manifest.qdrantSnapshot : "not in backup"}`);
console.log(`\nWill overwrite: data/notebooks/`);
if (manifest.sqliteBackedUp) console.log(`                data/indexes/`);
console.log(`Qdrant will NOT be restored — run 'npm run rag:rebuild' after restore.`);

if (!autoYes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nContinue? [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Restore cancelled.");
    process.exit(0);
  }
}

// Restore data/notebooks/
const srcNotebooks = path.join(backupDir, "notebooks");
const dstNotebooks = path.join(rootDir, "data", "notebooks");
try {
  await fs.access(srcNotebooks);
  await fs.rm(dstNotebooks, { recursive: true, force: true });
  await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
  await fs.cp(srcNotebooks, dstNotebooks, { recursive: true });
  console.log(`ok   data/notebooks/ restored (${manifest.notebookCount} notebooks)`);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("skip no notebooks/ directory in backup");
  } else {
    console.error(`Notebooks restore failed: ${err.message}`);
    process.exit(1);
  }
}

// Restore data/indexes/ (SQLite FTS)
if (manifest.sqliteBackedUp) {
  const srcIndexes = path.join(backupDir, "indexes");
  const dstIndexes = path.join(rootDir, "data", "indexes");
  try {
    await fs.rm(dstIndexes, { recursive: true, force: true });
    await fs.cp(srcIndexes, dstIndexes, { recursive: true });
    console.log("ok   data/indexes/ restored");
  } catch (err) {
    console.warn(`warn SQLite restore failed: ${err.message}`);
    console.warn("     Run 'npm run rag:rebuild' to rebuild the SQLite FTS index.");
  }
}

console.log("\nRestore complete.");
const rebuildNote = manifest.sqliteBackedUp
  ? "Run 'npm run rag:rebuild' to repopulate Qdrant."
  : "Run 'npm run rag:rebuild' to repopulate Qdrant and SQLite FTS.";
console.log(rebuildNote);
