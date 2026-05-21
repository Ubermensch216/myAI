import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await fs.readFile(path.join(rootDir, "public", "index.html"), "utf8");
const css = await fs.readFile(path.join(rootDir, "public", "styles.css"), "utf8");

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*{([^}]*)}`));
  assert.ok(match, `${selector} block exists`);
  return match[1];
}

const activeButtonMatch = html.match(/<button[^>]*id="lawSearchActiveButton"[\s\S]*?<\/button>/);
assert.ok(activeButtonMatch, "lawSearchActiveButton exists");
assert.equal(
  /<span\b/i.test(activeButtonMatch[0]),
  false,
  "active law-search button is icon-only"
);
assert.equal(
  /id="complianceReviewButton"/.test(html),
  false,
  "composer material panel does not render the legacy compliance review button"
);

const rowBlock = cssBlock(".composer-main-row");
assert.match(rowBlock, /display:\s*flex;/, "composer uses flex so hidden icons cannot collapse prompt width");

const lawButtonBlock = cssBlock(".law-search-active-button");
assert.match(lawButtonBlock, /order:\s*2;/, "active law-search button follows the plus button");
assert.match(lawButtonBlock, /width:\s*46px;/, "active law-search button has fixed width");
assert.match(lawButtonBlock, /padding:\s*0;/, "active law-search button is icon-sized");

const materialButtonBlock = cssBlock(".material-toggle-button");
assert.match(materialButtonBlock, /order:\s*3;/, "file/material icon follows the active law-search icon");

const textareaBlock = cssBlock(".composer textarea");
assert.match(textareaBlock, /order:\s*4;/, "prompt input follows the mode and file icons");
assert.match(textareaBlock, /flex:\s*1\s+1\s+auto;/, "prompt input fills remaining width");

const stopButtonMatch = html.match(/<button[^>]*id="stopGenerationButton"[\s\S]*?<\/button>/);
assert.ok(stopButtonMatch, "stopGenerationButton exists");
assert.match(stopButtonMatch[0], /\btype="button"/, "stop button does not submit the prompt form");
assert.match(stopButtonMatch[0], /\bhidden\b/, "stop button starts hidden");
assert.match(stopButtonMatch[0], /\bdisabled\b/, "stop button starts disabled");
assert.doesNotMatch(stopButtonMatch[0], /\bstop-button\b/, "stop button does not use danger emphasis styling");
assert.equal(
  /<span\b/i.test(stopButtonMatch[0]),
  false,
  "stop button is icon-only"
);

const stopButtonBlock = cssBlock(".stop-generation-button");
assert.match(stopButtonBlock, /order:\s*5;/, "stop button sits to the right of the prompt input");
assert.match(stopButtonBlock, /width:\s*46px;/, "stop button has fixed icon-button width");
assert.match(stopButtonBlock, /height:\s*46px;/, "stop button has 1:1 icon-button height");
assert.match(stopButtonBlock, /min-width:\s*46px;/, "stop button does not inherit wide send-button sizing");
assert.match(stopButtonBlock, /padding:\s*0;/, "stop button is icon-sized");
