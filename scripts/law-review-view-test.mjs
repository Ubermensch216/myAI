import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await fs.readFile(path.join(rootDir, "public", "index.html"), "utf8");
const css = await fs.readFile(path.join(rootDir, "public", "styles.css"), "utf8");

function findAll(regex, text) {
  return [...text.matchAll(regex)].map((match) => match[1]);
}

const navTargets = findAll(/class="primary-nav-item[^"]*"[^>]*data-view-target="([^"]+)"/g, html);
assert.deepEqual(navTargets, ["chat", "law", "calendar"], "primary nav order is chat, law, calendar");

assert.match(html, /data-view-content="law"/, "law review sidebar content exists");
assert.match(html, /id="newLawReviewButton"/, "new law review button exists");
assert.match(html, /id="lawReviewList"/, "law review list exists");
assert.match(html, /<section class="law-area"[^>]*>/, "law review main area exists");
assert.match(html, /법령검토/, "law review label is used");

assert.doesNotMatch(html, /id="studioLawButton"/, "Studio law tool card is removed");
assert.doesNotMatch(html, /id="studioLawRailButton"/, "Studio law rail button is removed");
assert.doesNotMatch(html, /id="studioLawPanel"/, "Studio law panel is removed");

const lawWorkbenchIds = findAll(/id="(lawWorkbench[^"]+)"/g, html);
assert.equal(new Set(lawWorkbenchIds).size, lawWorkbenchIds.length, "law workbench DOM ids are unique");

assert.match(
  css,
  /\.primary-nav\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  "primary nav uses three equal columns"
);
assert.match(css, /\.law-area\s*{/, "law-area styles exist");
