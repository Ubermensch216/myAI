#!/usr/bin/env node
/**
 * Copies vendored frontend assets from node_modules into public/vendor/.
 * Run after `npm install` if vendor files are missing or out of date.
 *
 * Usage: node scripts/copy-vendor.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  {
    from: "node_modules/cytoscape/dist/cytoscape.min.js",
    to: "public/vendor/cytoscape.min.js"
  }
];

const dstDir = path.join(rootDir, "public", "vendor");
fs.mkdirSync(dstDir, { recursive: true });

let copied = 0;
for (const t of targets) {
  const src = path.join(rootDir, t.from);
  const dst = path.join(rootDir, t.to);
  if (!fs.existsSync(src)) {
    console.error(`[copy-vendor] missing source: ${t.from} (run npm install first)`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const size = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`[copy-vendor] ${t.from} -> ${t.to} (${size} KB)`);
  copied++;
}
console.log(`[copy-vendor] done (${copied}/${targets.length})`);
