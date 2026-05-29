import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.INFOGRAPHIC_OLLAMA_TIMEOUT_MS = "100";

const { generateInfographicSpec, __test__ } = await import("../server/infographic.js");

const sampleDocument = {
  kind: "document",
  id: "safety-audit-prd",
  fileName: "[분석 보고서] 안전감사 시스템(2026.5.13.).pdf",
  fileType: "pdf",
  summary: "안전감사 지식운영 시스템(myAI) 구축을 위한 요구사항과 단계별 로드맵",
  topics: ["안전감사 요구사항", "핵심 기능군", "구축 단계별 로드맵"],
  text: `
안전감사 지식운영 시스템 (myAI)
구축 단계별 로드맵
Phase 1: 즉시 구축 - 법령 검토, 매뉴얼 안내
Phase 2: 데이터 연계 - 동파 지표 분석
Phase 3: 고도화 - 예측 모델링
`
};

// 1) LLM 미가용 -> fallback 인포그래픽 반환
const fallback = await generateInfographicSpec({ documents: [sampleDocument], model: "missing-model", layout: "summary" });
assert.match(fallback.warnings.join(" "), /fallback_infographic|model_fallback/);
assert.equal(fallback.layout, "summary");
assert.ok(fallback.blocks.length >= 1, "fallback should produce blocks");
assert.equal(fallback.blocks[0].type, "kpi");
assert.ok(fallback.blocks.some((b) => b.type === "cards"), "fallback should include cards");
assert.ok(fallback.citations.length >= 1, "fallback should cite the source doc");

// 2) 알 수 없는 layout 은 summary 로 정규화
const fallbackBadLayout = await generateInfographicSpec({ documents: [sampleDocument], model: "missing-model", layout: "bogus" });
assert.equal(fallbackBadLayout.layout, "summary");

// 3) 빈 문서는 에러
await assert.rejects(
  () => generateInfographicSpec({ documents: [], model: "missing-model" }),
  /requires at least one document/
);

// 4) normalizeInfographicSpec — 4개 블록 타입 전부 + citation 필터링
assert.equal(typeof __test__?.normalizeInfographicSpec, "function", "normalizeInfographicSpec test helper should be exported");
const docs = [{ fileName: sampleDocument.fileName, summary: sampleDocument.summary, text: sampleDocument.text, topics: sampleDocument.topics, source: sampleDocument }];
const fb = __test__.buildFallbackInfographic(docs, "process");
const normalized = __test__.normalizeInfographicSpec({
  title: "안전감사 시스템 구축",
  subtitle: "근거 기반 요약",
  layout: "process",
  blocks: [
    { type: "kpi", title: "핵심 지표", items: [{ label: "단계 수", value: "3개", citationIds: ["N1"] }] },
    { type: "cards", title: "주요 내용", items: [{ title: "법령 검토", body: "Law Engine", citationIds: ["N1", "BADREF"] }] },
    { type: "timeline", title: "추진 일정", items: [{ when: "Phase 1", title: "즉시 구축", body: "법령 검토" }] },
    { type: "steps", title: "절차", items: [{ label: "1", title: "요구분석", body: "" }] },
    { type: "comparison", title: "비교", columns: ["현행", "개선안"], rows: [{ label: "검토 속도", cells: ["수동", "자동"], citationIds: ["N1"] }] },
    { type: "bogus", title: "무시됨", items: [{ title: "x" }] }
  ],
  citations: [{ id: "N1", documentName: sampleDocument.fileName, locator: "p.1", excerpt: "Phase 1" }]
}, docs, "process", fb);

assert.equal(normalized.layout, "process");
assert.equal(normalized.title, "안전감사 시스템 구축");
const types = normalized.blocks.map((b) => b.type);
assert.deepEqual(types, ["kpi", "cards", "timeline", "steps", "comparison"], "unknown block type should be dropped");
assert.equal(normalized.citations.length, 1);
// 존재하지 않는 citation id(BADREF)는 제거되어야 함
const cardBlock = normalized.blocks.find((b) => b.type === "cards");
assert.deepEqual(cardBlock.items[0].citationIds, ["N1"], "invalid citation id should be filtered out");
const cmp = normalized.blocks.find((b) => b.type === "comparison");
assert.equal(cmp.columns.length, 2);
assert.equal(cmp.rows[0].cells.length, 2);

// 5) comparison 은 columns 2개 미만이면 제거
const fewCols = __test__.normalizeBlock({ type: "comparison", columns: ["하나"], rows: [{ label: "x", cells: ["a"] }] }, new Set(), []);
assert.equal(fewCols, null, "comparison with <2 columns should be dropped");

// 6) citation 없는 kpi 는 warning
const w = [];
__test__.normalizeBlock({ type: "kpi", items: [{ label: "값", value: "10" }] }, new Set(), w);
assert.ok(w.includes("kpi_without_citation"), "uncited kpi should add warning");

// 7) 출처에 없는 documentName 의 citation 은 제거
const { citations } = __test__.normalizeCitations(
  [{ id: "N1", documentName: "존재하지않는문서.pdf" }, { id: "N2", documentName: sampleDocument.fileName }],
  new Set([sampleDocument.fileName])
);
assert.equal(citations.length, 1);
assert.equal(citations[0].documentName, sampleDocument.fileName);

// 8) 프론트엔드 배선 확인
const infographicJs = await fs.readFile(new URL("../public/modules/infographicStudio.js", import.meta.url), "utf8");
assert.match(infographicJs, /export (async )?function generateInfographic/);
assert.match(infographicJs, /export function renderInfographicStudio/);
assert.match(infographicJs, /export function bindInfographicStudioEvents/);
assert.match(infographicJs, /\/api\/studio\/infographic/);

const studioJs = await fs.readFile(new URL("../public/modules/studio.js", import.meta.url), "utf8");
assert.match(studioJs, /bindInfographicStudioEvents/);
assert.match(studioJs, /renderInfographicStudio/);
assert.match(studioJs, /"infographic"/);

const indexHtml = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
assert.match(indexHtml, /studioInfographicButton/);
assert.match(indexHtml, /studioInfographicPanel/);
assert.match(indexHtml, /data-layout="comparison"/);

const stylesCss = await fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8");
assert.match(stylesCss, /\.infographic-sheet/);
assert.match(stylesCss, /\.infographic-comparison|\.infographic-timeline|\.infographic-steps/);

console.log("Infographic tests passed");
