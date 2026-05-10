import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-law-intent-eval-"));
process.env.LAW_OC = "SECRET-LAW-KEY";
process.env.LAW_AUTO_DETECT = "false";
process.env.LAW_CACHE_PATH = path.join(tempDir, "law-cache.sqlite");

const { detectLawIntent } = await import("../server/law/lawIntent.js");
const { extractLawCitations } = await import("../server/law/lawArticleRef.js");

// Each case: [prompt, expectLegal, options, label]
// `expectLegal=true`  -> intent.isLegalQuery must be true (true positive).
// `expectLegal=false` -> intent.isLegalQuery must be false (must NOT trigger).
const cases = [
  // === True positives — must trigger ===
  ["민법 제750조 찾아줘", true, {}, "explicit law + 제N조"],
  ["도로교통법 제44조 알려줘", true, {}, "도로교통법 + 제N조"],
  ["개인정보 보호법 제15조 본문", true, {}, "PIPA + 제N조"],
  ["헌법 제10조의 의미는?", true, {}, "헌법 + 제N조"],
  ["민법 750조에 따르면", true, {}, "strong law + bare N조 (no 제)"],
  ["조문 검증해줘: 형법 제250조, 형법 제9999조", true, {}, "verify_citations"],
  ["법령에서 임대차보호법 찾아줘", true, {}, "explicit 법령에서 찾아"],
  ["이 문서가 개인정보 보호법 제15조에 맞는지 검토해줘", true, { hasDocuments: true }, "department_legal_review"],
  ["민법 제758조의2 본문 알려줘", true, {}, "branched 제N조의M"],
  ["근로기준법 제53조 위반 여부", true, {}, "근로기준법 + 제N조 + 위반"],

  // === False positives — must NOT trigger ===
  ["라면 끓이는 방법 알려줘", false, {}, "방법 (recipe, not 법)"],
  ["Git 사용법 정리해줘", false, {}, "사용법 (manual, not 법)"],
  ["야구 규칙 좀 설명해줘", false, {}, "야구 규칙 (sport, not 법규)"],
  ["Linux 명령어 ls -l 어떻게 써?", false, {}, "명령어 (shell, not 명령)"],
  ["오늘 회의 1조 발표 순서", false, {}, "회의 1조 (group, not 제1조)"],
  ["이 매장은 1조 5인 운영", false, {}, "1조 5인 (group)"],
  ["수법이 교묘하다", false, {}, "수법 (tactic, not 법)"],
  ["비법 30가지 정리", false, {}, "비법 (secret, not 법)"],
  ["편법으로 처리하지 마세요", false, {}, "편법"],
  ["Z세대 어법은 다르다", false, {}, "어법 (diction)"],
  ["요리법 100조각으로 잘라", false, {}, "요리법 + 100조각 (cook)"],
  ["프로토콜 1000조 패킷", false, {}, "1000조 패킷 (protocol)"],
  ["오늘 점심 메뉴 추천해줘", false, {}, "totally non-legal"],
  ["기법을 설명해주세요", false, {}, "기법 (technique)"],
  ["사내규정에 따르면 늦게 출근하면", false, { hasDocuments: true }, "사내규정 (company, no article ref)"],

  // === Borderline / context-sensitive ===
  ["이 문서가 우리 사내 규정에 맞는지 봐줘", false, { hasDocuments: true }, "internal company rules — no statute reference"],
  ["민법 검토해줘", true, { hasDocuments: true }, "민법 + 검토 + doc context (legal review)"]
];

const failures = [];
for (const [prompt, expectLegal, options, label] of cases) {
  const intent = detectLawIntent(prompt, options || {});
  const got = Boolean(intent.isLegalQuery);
  if (got !== expectLegal) {
    failures.push({
      prompt,
      label,
      expected: expectLegal,
      got,
      mode: intent.mode,
      extracted: intent.extracted
    });
  }
}

console.log(`evaluated ${cases.length} cases, ${cases.length - failures.length} pass, ${failures.length} fail`);
for (const failure of failures) {
  console.log(`  FAIL [${failure.expected ? "TP-missed" : "FP-fired"}] (${failure.label}) "${failure.prompt}"`);
  console.log(`    -> got isLegal=${failure.got} mode=${failure.mode}`);
}

// extractLawCitations FP audit: these should NOT yield any citations.
const citationFpCases = [
  "라면 끓이는 방법 100조각",
  "Git 사용법 1조 5호",
  "프로토콜 1000조 패킷",
  "사내 규칙 5조",
  "야구 규칙 30조 점수",
  "오늘 1조 5인 회의"
];
const citationFps = [];
for (const text of citationFpCases) {
  const citations = extractLawCitations(text);
  if (citations.length > 0) {
    citationFps.push({ text, citations });
  }
}
console.log(`extractLawCitations FP audit: ${citationFpCases.length - citationFps.length}/${citationFpCases.length} clean`);
for (const fp of citationFps) {
  console.log(`  FP "${fp.text}" -> ${fp.citations.map((c) => c.canonical).join(", ")}`);
}

// extractLawCitations TP audit: these MUST yield citations.
const citationTpCases = [
  ["민법 제750조", "민법/제750조"],
  ["도로교통법 제44조", "도로교통법/제44조"],
  ["민법 750조", "민법/제750조"],
  ["민법 제758조의2", "민법/제758조의2"],
  ["개인정보 보호법 제15조 제1항", "개인정보 보호법/제15조/제1항"]
];
const citationTpMisses = [];
for (const [text, expected] of citationTpCases) {
  const citations = extractLawCitations(text);
  if (!citations.some((c) => c.canonical === expected)) {
    citationTpMisses.push({ text, expected, got: citations.map((c) => c.canonical) });
  }
}
console.log(`extractLawCitations TP audit: ${citationTpCases.length - citationTpMisses.length}/${citationTpCases.length} matched`);
for (const miss of citationTpMisses) {
  console.log(`  MISS "${miss.text}" expected ${miss.expected}, got [${miss.got.join(", ")}]`);
}

await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

const totalFails = failures.length + citationFps.length + citationTpMisses.length;
if (totalFails > 0) process.exitCode = 1;
