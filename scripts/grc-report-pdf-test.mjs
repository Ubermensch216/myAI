import assert from "node:assert/strict";
import { contentDispositionForFilename, createGrcReportPdf } from "../server/compliance/grcReport.js";

const artifact = {
  title: "근로계약서 내부검토 보고서",
  targetDocName: "근로계약서.pdf",
  policyDocName: "인사 규정",
  generatedAt: new Date("2026-05-25T09:00:00+09:00").toISOString(),
  summary: "대상 문서에는 내부 기준과 충돌 가능성이 있는 조항이 있으며 보완이 필요합니다.",
  overallRisk: "Medium",
  riskLabel: "보통",
  counts: { high: 1, medium: 1, low: 1, info: 1 },
  results: [
    {
      ruleTitle: "수습기간 제한",
      status: "충돌 가능성",
      reason: "대상 문서의 수습기간이 내부 기준보다 깁니다.",
      remediation: "수습기간을 내부 기준에 맞게 단축합니다."
    },
    {
      ruleTitle: "보안 서약",
      status: "적합",
      reason: "보안 서약 조항이 내부 기준과 일치합니다.",
      remediation: ""
    }
  ],
  actionItems: [
    {
      ruleTitle: "수습기간 제한",
      status: "충돌 가능성",
      reason: "대상 문서의 수습기간이 내부 기준보다 깁니다.",
      remediation: "수습기간을 내부 기준에 맞게 단축합니다."
    }
  ],
  missingInformation: ["예외 승인권자 정보"],
  draftOpinion: "## 1. 검토 목적\n내부 규정 적합성을 검토했습니다.\n\n## 2. 종합 의견\n일부 보완이 필요합니다."
};

const disposition = contentDispositionForFilename("근로계약서 내부검토 보고서.pdf");
assert.match(disposition, /filename\*=UTF-8''/);
assert.match(disposition, /%EA%B7%BC%EB%A1%9C%EA%B3%84%EC%95%BD%EC%84%9C/);

try {
  const buffer = await createGrcReportPdf({ artifact });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.ok(buffer.length > 1000);
  console.log("ok - GRC report PDF renderer");
} catch (error) {
  if (error?.code === "PDF_FONT_MISSING") {
    console.log("ok - GRC report PDF renderer skipped without Korean PDF font");
  } else {
    throw error;
  }
}

console.log("ok - GRC report PDF content disposition");
