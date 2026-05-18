import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await fs.readFile(path.join(rootDir, "public", "index.html"), "utf8");
const css = await fs.readFile(path.join(rootDir, "public", "styles.css"), "utf8");
const lawJs = await fs.readFile(path.join(rootDir, "public", "modules", "lawWorkbench.js"), "utf8");
const stateJs = await fs.readFile(path.join(rootDir, "public", "modules", "state.js"), "utf8");
const reviewServerJs = await fs.readFile(path.join(rootDir, "server", "law", "lawWorkbenchReview.js"), "utf8");

function findAll(regex, text) {
  return [...text.matchAll(regex)].map((match) => match[1]);
}

const navTargets = findAll(/class="primary-nav-item[^"]*"[^>]*data-view-target="([^"]+)"/g, html);
assert.deepEqual(navTargets, ["chat", "law", "calendar"], "primary nav order is chat, law, calendar");

assert.match(html, /data-view-content="law"/, "law review sidebar content exists");
assert.match(html, /id="newLawReviewButton"/, "new law review button exists");
assert.match(html, /id="lawReviewList"/, "law review list exists");
assert.match(html, /<section class="law-area"[^>]*>/, "law review main area exists");
assert.match(html, /id="lawWorkbenchReviewType"/, "law review has review type condition");
assert.match(html, /id="lawWorkbenchOutputType"/, "law review has output type condition");
assert.match(html, /data-law-workbench-tab="review"/, "law review has review result tab");
assert.match(html, /data-law-workbench-tab="evidence"/, "law review has grouped evidence tab");
assert.match(html, /data-law-workbench-tab="history"/, "law review has revision and impact tab");
assert.match(html, /data-law-workbench-tab="report"/, "law review has report tab");
assert.match(html, /검토 초안/, "law review draft-first tab label exists");
assert.match(html, /근거/, "law review evidence tab label exists");
assert.doesNotMatch(html, /data-law-workbench-tab="main"/, "law review hides source-family tabs from primary workflow");
assert.doesNotMatch(html, /data-law-workbench-tab="system"/, "law review groups law hierarchy under evidence");
assert.doesNotMatch(html, /data-law-workbench-tab="decisions"/, "law review groups decisions under evidence");
assert.match(html, /법령검토/, "law review label is used");

assert.doesNotMatch(html, /id="studioLawButton"/, "Studio law tool card is removed");
assert.doesNotMatch(html, /id="studioLawRailButton"/, "Studio law rail button is removed");
assert.doesNotMatch(html, /id="studioLawPanel"/, "Studio law panel is removed");
assert.doesNotMatch(lawJs, /getActiveDocuments/, "law review must not auto-include chat room attachments");
assert.match(lawJs, /const\s+reviewDocuments\s*=\s*getLawReviewDocuments\(state\)/, "law review scopes documents to dedicated law review state");
assert.match(lawJs, /documents:\s*reviewDocuments/, "law review sends only dedicated law review documents");
assert.match(lawJs, /reviewError/, "law review stores exact LLM failure reason for the UI");
assert.match(lawJs, /function\s+renderWorkflowSteps/, "law review renders progress as workflow steps");
assert.match(lawJs, /function\s+renderEvidenceDashboard/, "law review summarizes collected evidence before raw source lists");
assert.match(lawJs, /function\s+renderReportPanel/, "law review has a dedicated report workflow panel");
assert.match(lawJs, /main:\s*"evidence"/, "legacy main tab maps to grouped evidence tab");
assert.match(lawJs, /decisions:\s*"evidence"/, "legacy decisions tab maps to grouped evidence tab");
assert.match(reviewServerJs, /\[law-workbench-review\]/, "law review diagnostics log is present");
assert.match(reviewServerJs, /prompt_eval_count/, "law review diagnostics logs Ollama prompt eval count");
assert.match(reviewServerJs, /eval_count/, "law review diagnostics logs Ollama eval count");
assert.doesNotMatch(reviewServerJs, /promptEvalCount|evalCount:/, "law review diagnostics use Ollama field names");
assert.match(stateJs, /Object\.assign\(review,\s*normalized\)/, "law review normalization preserves object identity during async review rendering");
assert.match(stateJs, /reportCreatedAt/, "law review report creation state is persisted");

const lawWorkbenchIds = findAll(/id="(lawWorkbench[^"]+)"/g, html);
assert.equal(new Set(lawWorkbenchIds).size, lawWorkbenchIds.length, "law workbench DOM ids are unique");

assert.match(
  css,
  /\.primary-nav\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  "primary nav uses three equal columns"
);
assert.match(css, /\.law-area\s*{/, "law-area styles exist");
assert.match(css, /\.law-workflow-steps\s*{/, "law review workflow step styles exist");
assert.match(css, /\.law-evidence-dashboard\s*{/, "law review evidence dashboard styles exist");
assert.match(css, /\.law-report-panel\s*{/, "law review report panel styles exist");
