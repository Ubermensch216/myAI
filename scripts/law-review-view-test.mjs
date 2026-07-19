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

function findFunctionBody(source, name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${name} function exists`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} function body starts`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, i);
  }
  assert.fail(`${name} function body closes`);
}

const navTargets = findAll(/class="primary-nav-item[^"]*"[^>]*data-view-target="([^"]+)"/g, html);
assert.deepEqual(navTargets, ["chat", "knowledge", "law", "grc", "calendar", "safedoc"], "primary nav order is chat, knowledge, law, grc, calendar, safedoc");

assert.match(html, /data-view-content="law"/, "law review sidebar content exists");
assert.match(html, /id="newLawReviewButton"/, "new law review button exists");
assert.match(html, /id="lawReviewList"/, "law review list exists");
assert.match(html, /<section class="law-area"[^>]*>/, "law review main area exists");
assert.match(html, /id="lawWorkbenchReviewType"/, "law review has review type condition");
assert.match(html, /data-law-workbench-tab="review"/, "law review has review result tab");
assert.match(html, /data-law-workbench-tab="evidence"/, "law review has grouped evidence tab");
assert.match(html, /data-law-workbench-tab="history"/, "law review has revision and impact tab");
assert.doesNotMatch(html, /data-law-workbench-tab="report"/, "law review keeps report generation inside the review tab");
assert.match(html, /검토 초안/, "law review draft-first tab label exists");
assert.match(html, /근거/, "law review evidence tab label exists");
assert.match(html, /검토 요청을 입력하면 공식 근거 수집, AI 검토 초안, 보고서 생성 순서로 진행합니다\./, "static law empty state matches workflow-first JS copy");
assert.match(html, /<li><strong>검토 초안<\/strong> 결론 후보, 쟁점, 리스크, 보완 권고<\/li>/, "static law empty state describes draft output");
assert.doesNotMatch(html, /자연어 질문 한 줄이면 공식 법령/, "static law empty state no longer uses search-first copy");
for (const example of [
  "민원 회신에 필요한 법령 근거 검토",
  "내부 지침이 상위법과 충돌하는지 검토",
  "행정처분 사전통지 절차 검토"
]) {
  assert.match(html, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `law review example exists: ${example}`);
}
assert.doesNotMatch(html, /공무원 음주운전 징계/, "law review examples no longer lead with generic search fixtures");
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
assert.match(lawJs, /function\s+renderEvidenceDashboard/, "law review summarizes collected evidence before raw source lists");
assert.match(lawJs, /function\s+renderEvidenceSection/, "law review evidence details use status-aware sections");
assert.match(lawJs, /function\s+renderDecisionEvidenceSection/, "law review decision evidence is grouped by source type");
assert.match(lawJs, /law-evidence-detail-section/, "law review evidence details have dedicated section markup");
assert.match(lawJs, /law-evidence-source-badge/, "law review evidence details show source status badges");
assert.match(lawJs, /renderImpact\(target,\s*data\.internalImpact\);\s*renderHistory\(target,\s*data\.history\);/, "law review shows impact before revision history");
assert.match(lawJs, /function\s+splitImpactNodes/, "law review separates internal material signals from law-derived nodes");
assert.match(lawJs, /law-impact-brief/, "law review renders a clear internal impact brief");
assert.match(lawJs, /law-impact-signal-list/, "law review renders internal material signals as their own list");
assert.match(lawJs, /function\s+buildReviewStatusSummary/, "law review builds a compact workflow status summary");
assert.match(lawJs, /className\s*=\s*"law-review-status-summary"/, "law review status summary has dedicated markup");
assert.match(lawJs, /buildReviewStatusSummary\(state\)/, "law review card renders the status summary");
assert.match(lawJs, /const\s+VALID_TABS\s*=\s*new Set\(\["review",\s*"evidence",\s*"history"\]\);/, "law review valid tabs match the visible three-tab workflow");
assert.match(lawJs, /main:\s*"evidence"/, "legacy main tab maps to grouped evidence tab");
assert.match(lawJs, /decisions:\s*"evidence"/, "legacy decisions tab maps to grouped evidence tab");
assert.match(lawJs, /report:\s*"review"/, "legacy report tab maps to the review tab");
assert.doesNotMatch(lawJs, /const\s+VALID_TABS\s*=\s*new Set\(\[[^\]]*"report"/, "removed report tab is not accepted as a current valid tab");
const renderTabHintsBody = findFunctionBody(lawJs, "renderTabHints");
assert.doesNotMatch(renderTabHintsBody, /tab:\s*"decisions"/, "tab hints no longer target the removed decisions tab");
assert.doesNotMatch(renderTabHintsBody, /tab:\s*"system"/, "tab hints no longer target the removed system tab");
assert.match(renderTabHintsBody, /tab:\s*"evidence"/, "tab hints route evidence counts to the grouped evidence tab");
assert.match(renderTabHintsBody, /tab:\s*"history"/, "tab hints keep revision history on the history tab");
const renderStructureBody = findFunctionBody(lawJs, "renderStructure");
assert.doesNotMatch(renderStructureBody, /return;\s*if\s*\(!tiers\)/, "renderStructure does not keep unreachable legacy code after returning");
assert.doesNotMatch(renderStructureBody, /renderListPanel\(target,\s*rows,\s*"\uBC95\uCCB4\uACC4"\)/, "renderStructure no longer keeps the unreachable legacy rows renderer");
const renderBodySource = findFunctionBody(lawJs, "renderBody");
assert.match(renderBodySource, /renderEvidenceDashboard\(target,\s*state\);\s*renderAiCandidates\(target,\s*data\.aiCandidates\);\s*renderArticle\(target,\s*data\.article\);/, "related article candidates render above the long article body");
assert.match(lawJs, /law-ai-candidates-section/, "related article candidates use evidence detail section styling");
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
  /\.primary-nav\s*{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
  "primary nav uses four equal columns"
);
assert.match(css, /\.law-area\s*{/, "law-area styles exist");
assert.match(
  css,
  /\.law-workbench-tabs\.law-mode-tabs\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  "law review workflow tabs use three columns"
);
assert.match(
  css,
  /\.law-tab-lamp\s*{[\s\S]*?width:\s*14px;[\s\S]*?height:\s*14px;/,
  "law review tab lamps are prominent"
);
assert.match(
  css,
  /\.law-mode-tab\.is-lamp-done\s+\.law-tab-lamp\s*{[\s\S]*?(?:#16a34a|--success|green)/,
  "completed law review tab lamp uses a green state"
);
assert.match(css, /\.law-review-status-summary\s*{/, "law review status summary styles exist");
assert.match(css, /\.law-workflow-steps\s*{/, "law review workflow step styles exist");
assert.match(
  css,
  /\.law-workbench-body\s*>\s*\*\s*{[\s\S]*?flex:\s*0\s+0\s+auto;/,
  "law review result sections do not shrink and overlap in the scroll body"
);
assert.match(css, /\.law-evidence-dashboard\s*{/, "law review evidence dashboard styles exist");
assert.match(css, /\.law-evidence-detail-section\s*{/, "law review evidence detail section styles exist");
assert.match(css, /\.law-evidence-source-badge\s*{/, "law review evidence status badge styles exist");
assert.match(
  css,
  /\.law-evidence-detail-section\s+\.law-explorer-empty\s*,[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/,
  "law review nested empty states reset the full-panel empty height"
);
assert.match(css, /\.law-report-panel\s*{/, "law review report panel styles exist");
assert.match(css, /\.law-impact-brief\s*{/, "law review impact brief styles exist");
assert.match(css, /\.law-impact-signal-list\s*{/, "law review impact signal list styles exist");
