import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.MINDMAP_OLLAMA_TIMEOUT_MS = "100";
process.env.MINDMAP_MAX_NODES = "42";
process.env.MINDMAP_MAX_EDGES = "64";

const { generateMindmap, __test__ } = await import("../server/mindmap.js");

const sampleDocument = {
  kind: "document",
  id: "safety-audit-prd",
  fileName: "[분석 보고서] from_PRD_안전감사팀(2026.5.13.).pdf",
  fileType: "pdf",
  summary: "안전감사 지식운영 시스템(myAI) 구축을 위한 요구사항과 단계별 로드맵",
  topics: ["안전감사 요구사항", "핵심 기능군", "구축 단계별 로드맵", "신규 모듈 및 보안", "지식그래프 및 데이터 구조"],
  text: `
[분석 보고서] from_PRD_안전감사팀(2026.5.13.)
안전감사 지식운영 시스템 (myAI)

안전감사팀 요구사항 본질
- 위험 예측형: 데이터 기반 사전 감지
- 매뉴얼 실행형: 상황 기반 절차 안내
- 법령·기준 연결형: Law Engine 활용 검토
- 보고서 생성형: Studio 편집기 자동화

핵심 기능군
- 업무별 AI 워크스페이스
- 재난상황 매뉴얼 실행 엔진
- 동파 위험 예측 및 대응
- KRMS 재난관리지원 추천
- 안전점검 보고서 자동 생성
- 교육 이수 관리 AI
- 복무점검 및 처분요구서 생성
- 통합 업무 매뉴얼 생성기
- 징계·조사 판단지원

구축 단계별 로드맵
Phase 1: 즉시 구축
- 법령 검토
- 매뉴얼 안내
- 보고서 초안 생성

Phase 2: 데이터 연계
- 동파 지표 분석
- 자원 추천
- 교육 이수 관리

Phase 3: 고도화
- 예측 모델링
- 지식그래프 심화

신규 모듈 및 보안
- Safety Audit Workspace
- Checklist Engine
- Privacy Redaction Layer (개인정보 마스킹)
- Public Work Manual Builder

지식그래프 및 데이터 구조
- 노트북 메타데이터 설계
- 재난유형-필요자원 관계 정의
- 법령-조문-위반행위 연결
`
};

const fallback = await generateMindmap({ documents: [sampleDocument], model: "missing-model" });
assert.match(fallback.warnings.join(" "), /fallback_mindmap/);
assert.notEqual(fallback.nodes[0].label, "Mind Map");
assert.match(fallback.nodes[0].label, /안전감사|지식운영|myAI/);
assert.ok(fallback.nodes.length >= 25, `expected rich fallback, got ${fallback.nodes.length} nodes`);
assert.ok(fallback.edges.length >= 24, `expected rich fallback edges, got ${fallback.edges.length}`);
assert.ok(fallback.nodes.some((node) => /Phase 1|즉시 구축/.test(node.label)));
assert.ok(fallback.nodes.some((node) => /Privacy Redaction/.test(node.label)));

assert.equal(typeof __test__?.normalizeMindmap, "function", "normalizeMindmap test helper should be exported");
const normalized = __test__.normalizeMindmap({
  title: "안전감사 지식운영 시스템",
  groups: [{ id: "root", label: "Root" }],
  nodes: [
    { id: "root", label: "안전감사 지식운영 시스템", group: "root", importance: 5 },
    { id: "branch", label: "핵심 기능군", parentId: "root", group: "features", importance: 4 },
    { id: "leaf", label: "보고서 자동 생성", parentId: "branch", group: "features", importance: 3 }
  ],
  edges: []
}, [sampleDocument], fallback);
assert.equal(normalized.nodes.length, 3);
assert.deepEqual(
  normalized.edges.map((edge) => `${edge.from}->${edge.to}`),
  ["root->branch", "branch->leaf"]
);

const studioJs = await fs.readFile(new URL("../public/modules/studio.js", import.meta.url), "utf8");
assert.match(studioJs, /function buildInitialCollapsed/);
assert.match(studioJs, /AUTO_COLLAPSE_NODE_THRESHOLD/);
assert.match(studioJs, /fitMindmapToViewport/);

const stylesCss = await fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8");
assert.match(stylesCss, /\.studio-mindmap-canvas[\s\S]*background:\s*#050706/);
assert.match(stylesCss, /\.map-node rect[\s\S]*rx:\s*8/);
assert.match(stylesCss, /\.map-edge[\s\S]*stroke-linecap:\s*round/);

console.log("Mindmap tests passed");
