import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEvidenceSummaryItems } from "../public/modules/evidenceSummary.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chatJs = await fs.readFile(path.join(rootDir, "public", "modules", "chat.js"), "utf8");

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

const summary = buildEvidenceSummaryItems({
  citations: [
    { citationId: "N1", sourceType: "notebook", documentName: "Policy" },
    { citationId: "L1", sourceType: "law", recordType: "statute" },
    { citationId: "L-S2", sourceType: "law", recordType: "law" },
    { citationId: "P1", sourceType: "law_precedent", recordType: "precedent" },
    { citationId: "D1", sourceType: "decision_hunzae_kor", recordType: "decision", detailKind: "list_only" },
    { citationId: "D2", sourceType: "decision_haengjim", recordType: "decision", detailKind: "full_text" },
    { citationId: "W1", sourceType: "naver" }
  ],
  sources: {
    documents: [{ displayName: "contract.pdf" }, { displayName: "memo.docx" }],
    images: [{ displayName: "scan.png" }]
  },
  law: {
    verification: {
      results: [
        { citation: "민법 제750조", valid: true },
        { citation: "가짜법 제1조", valid: false, reason: "NOT_FOUND" }
      ]
    }
  }
});

assert.deepEqual(
  summary.map(({ code, label, count, status, text }) => ({ code, label, count, status, text })),
  [
    { code: "L", label: "공식 법령", count: 2, status: "ok", text: "※근거 : 공식 법령[L] (2)" },
    { code: "P", label: "판례", count: 1, status: "ok", text: "※근거 : 판례[P] (1)" },
    { code: "D", label: "결정례", count: 2, status: "mixed", text: "※근거 : 결정례[D] (2) 목록 1 / 전문 1" },
    { code: "F", label: "첨부문서", count: 3, status: "ok", text: "※근거 : 첨부문서[F] (3)" },
    { code: "N", label: "내부 문서", count: 1, status: "ok", text: "※근거 : 내부 문서[N] (1)" },
    { code: "W", label: "네이버 검색", count: 1, status: "ok", text: "※근거 : 네이버 검색[W] (1)" },
    { code: "!", label: "검증 실패", count: 1, status: "warning", text: "※근거 : 검증 실패! (1)" }
  ]
);

const decision = summary.find((item) => item.code === "D");
assert.equal(decision.detail, "목록 1 / 전문 1");
assert.equal(decision.marker, "[D]");

const classifyLawCitationBody = findFunctionBody(chatJs, "classifyLawCitation");
assert.match(classifyLawCitationBody, /sourceType\s*===\s*"law_article"/, "chat citation panel treats AI law-article results as legal citations");
assert.match(classifyLawCitationBody, /\^AI-L/, "chat citation panel recognizes AI-L citation ids");
assert.match(classifyLawCitationBody, /\^L-S/, "chat citation panel recognizes law search candidate ids");

const shouldSuppressEvidenceBody = findFunctionBody(chatJs, "shouldSuppressEvidenceForAnswer");
assert.match(shouldSuppressEvidenceBody, /isNoEvidenceAnswer\(answer\)/, "evidence suppression still checks no-evidence answers");
assert.match(shouldSuppressEvidenceBody, /!hasRenderableCitations\(citations\)/, "evidence suppression keeps citation panels when citations exist");
assert.match(chatJs, /shouldSuppressEvidenceForAnswer\(finalAnswer,\s*allCitations\)/, "streaming chat keeps law citations visible even when answer text says evidence is limited");
assert.match(chatJs, /shouldSuppressEvidenceForAnswer\(text,\s*options\.citations\)/, "saved message rendering keeps persisted citations visible");

const file = summary.find((item) => item.code === "F");
assert.equal(file.marker, "[F]");
assert.equal(file.title, "※근거 : 첨부문서[F] (3)");
