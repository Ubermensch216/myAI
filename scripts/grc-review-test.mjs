import assert from "node:assert/strict";
import { runGrcReview } from "../server/compliance/grcReview.js";

let failureCount = 0;

await run("GRC review parameter validation", testParameterValidation);
await run("GRC review mock execution structure", testMockExecutionStructure);
await run("GRC review maps Korean opinion draft aliases", testKoreanDraftOpinionAlias);
await run("GRC review synthesizes opinion draft when model omits it", testSynthesizedDraftOpinion);

if (failureCount > 0) process.exitCode = 1;

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

async function testParameterValidation() {
  // Empty target text should fail
  await assert.rejects(
    () => runGrcReview({ targetText: "", policyText: "규정" }),
    /텍스트 내용이 비어있습니다/
  );

  // Empty policy text should fail
  await assert.rejects(
    () => runGrcReview({ targetText: "대상", policyText: "" }),
    /텍스트 내용이 비어있습니다/
  );
}

async function testMockExecutionStructure() {
  // Mock fetch globally during test to prevent real network calls to local Ollama in offline CI environment
  const originalFetch = globalThis.fetch;
  
  const mockReviewResponse = {
    summary: "검토 대상 근로계약서의 기밀 유지 조항이 회사 지침과 충돌함을 확인했습니다.",
    overallRisk: "Medium",
    results: [
      {
        ruleTitle: "기밀유지 기간 제한",
        status: "충돌 가능성",
        reason: "근로 계약서상의 기밀유지 기간이 퇴직 후 5년으로 설정되어 있으며, 이는 회사 업무 지침 제12조의 '퇴직 후 최대 3년' 기준을 초과합니다.",
        remediation: "기밀유지 기간을 퇴직 후 3년으로 수정하십시오."
      },
      {
        ruleTitle: "사내 장비 보안 서약",
        status: "적합",
        reason: "노트북 및 반입 장비에 관한 보안 서약 조항이 보안 지침 제5조와 완전 일치합니다.",
        remediation: ""
      }
    ],
    missingInformation: ["외주 용역 계약인 경우 용역 계약서 추가 첨부 필요"],
    draftOpinion: "## 1. 검토 목적\n본 의견서는 근로계약서의 사내 보안 및 업무 지침 준수 여부를 검토하기 위해 작성되었습니다."
  };

  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify(mockReviewResponse)
        }
      })
    };
  };

  try {
    const result = await runGrcReview({
      targetText: "근로 계약 기밀유지 기간 5년 서약합니다.",
      policyText: "사내 보안 지침: 퇴직 후 기밀유지 기간은 최대 3년이어야 합니다.",
      model: "mock-model"
    });

    assert.equal(result.overallRisk, "Medium");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].status, "충돌 가능성");
    assert.equal(result.results[1].status, "적합");
    assert.ok(result.summary.includes("기밀 유지 조항이"));
    assert.ok(result.draftOpinion.includes("검토 목적"));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testKoreanDraftOpinionAlias() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: JSON.stringify({
          요약: "규정 검토 요약입니다.",
          종합위험도: "보통",
          결과: [],
          필요정보: [],
          draftOpinion: "",
          "의견서 초안": "## 1. 검토 목적\n공백이 포함된 한국어 키로 반환된 의견서 초안입니다."
        })
      }
    })
  });

  try {
    const result = await runGrcReview({
      targetText: "검토 대상 문서 본문",
      policyText: "검토 기준 규정 본문",
      model: "mock-model"
    });

    assert.equal(result.draftOpinion, "## 1. 검토 목적\n공백이 포함된 한국어 키로 반환된 의견서 초안입니다.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSynthesizedDraftOpinion() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: JSON.stringify({
          summary: "계약서 일부 조항이 내부 규정과 충돌할 가능성이 있습니다.",
          overallRisk: "Medium",
          results: [
            {
              ruleTitle: "보안 준수 조항",
              status: "충돌 가능성",
              reason: "대상 문서의 외부 반출 허용 조항이 내부 보안 규정과 맞지 않습니다.",
              remediation: "외부 반출 예외 승인 절차를 명시하세요."
            }
          ],
          missingInformation: ["예외 승인권자 정보"],
          draftOpinion: ""
        })
      }
    })
  });

  try {
    const result = await runGrcReview({
      targetText: "검토 대상 문서 본문",
      policyText: "검토 기준 규정 본문",
      model: "mock-model"
    });

    assert.ok(result.draftOpinion.includes("## 1. 검토 목적"));
    assert.ok(result.draftOpinion.includes("계약서 일부 조항이"));
    assert.ok(result.draftOpinion.includes("보안 준수 조항"));
    assert.ok(result.draftOpinion.includes("예외 승인권자 정보"));
  } finally {
    globalThis.fetch = originalFetch;
  }
}
