import assert from "node:assert/strict";

process.env.LAW_OC = "SECRET-LAW-KEY";

const { detectLawIntent } = await import("../server/law/lawIntent.js");
const { buildLawContext } = await import("../server/law/lawContextBuilder.js");
const { classifyReviewType } = await import("../server/compliance/complianceIntent.js");
const { buildCompliancePromptBlock, buildComplianceUnavailableMessage } = await import("../server/compliance/compliancePrompt.js");
const { buildComplianceSearchQuery } = await import("../server/compliance/complianceTypes.js");

let failureCount = 0;

await run("review type classification", testReviewTypeClassification);
await run("law intent carries compliance fields", testLawIntentComplianceFields);
await run("compliance prompt construction", testCompliancePromptConstruction);
await run("compliance retrieval query expansion", testComplianceQueryExpansion);
await run("LAW_OC missing produces compliance law error", testLawOcMissing);
await run("compliance law context metadata shape", testComplianceLawContextShape);

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

function testReviewTypeClassification() {
  assert.equal(classifyReviewType("개인정보 처리 지침이 개인정보 보호법에 맞는지 검토해줘"), "privacy");
  assert.equal(classifyReviewType("민원 답변 문안의 법적 리스크를 검토해줘"), "civil_complaint");
  assert.equal(classifyReviewType("용역 계약서의 위탁 조항을 검토해줘"), "contract_outsourcing");
  assert.equal(classifyReviewType("감사 지적사항 재발방지 대책을 검토해줘"), "audit");
  assert.equal(classifyReviewType("처분 사전통지와 의견제출 절차를 확인해줘"), "administrative_procedure");
  assert.equal(classifyReviewType("내부 규정이 상위 법령과 충돌하는지 봐줘"), "internal_rule");
  assert.equal(classifyReviewType("자료를 법령 관점에서 봐줘"), "general");
}

function testLawIntentComplianceFields() {
  const intent = detectLawIntent("현재 자료로 개인정보 법령 적합성 검토를 상세 보고서로 작성해줘", {
    hasNotebook: false,
    hasDocuments: false
  });
  assert.equal(intent.isLegalQuery, true);
  assert.equal(intent.mode, "department_legal_review");
  assert.equal(intent.reviewType, "privacy");
  assert.equal(intent.outputStyle, "detailed_report");
  assert.equal(intent.requiresInternalMaterial, true);
  assert.ok(intent.focusLawNames.includes("개인정보 보호법"));
}

function testCompliancePromptConstruction() {
  const prompt = buildCompliancePromptBlock({
    reviewType: "privacy",
    outputStyle: "summary",
    hasLegalEvidence: false
  });
  assert.match(prompt, /Compliance Review Instructions/);
  assert.match(prompt, /Every risk, compliance gap, or recommendation must cite/);
  assert.match(prompt, /판단 보류/);
  assert.match(prompt, /업무 참고용 검토 초안/);
  assert.equal(buildComplianceUnavailableMessage("no_internal_material").includes("내부 자료"), true);
  assert.equal(buildComplianceUnavailableMessage("law_not_configured").includes("LAW_OC"), true);
}

function testComplianceQueryExpansion() {
  const query = buildComplianceSearchQuery({
    userQuestion: "위탁 계약서 검토",
    reviewType: "contract_outsourcing",
    focusLawNames: ["개인정보 보호법"]
  });
  assert.match(query, /위탁 계약서 검토/);
  assert.match(query, /비밀유지/);
  assert.match(query, /개인정보 보호법/);
}

async function testLawOcMissing() {
  const previous = process.env.LAW_OC;
  delete process.env.LAW_OC;
  const context = await buildLawContext("현재 자료로 개인정보 법령 적합성 검토를 해줘", {
    hasDocuments: true
  });
  process.env.LAW_OC = previous;
  assert.equal(context.mode, "department_legal_review");
  assert.equal(context.ok, false);
  assert.equal(context.error, "LAW_NOT_CONFIGURED");
  assert.equal(JSON.stringify(context).includes(previous), false);
}

async function testComplianceLawContextShape() {
  const context = await buildLawContext("현재 자료로 개인정보 법령 적합성 검토를 해줘", {
    hasDocuments: true,
    client: {
      async searchLaw({ query }) {
        return {
          ok: true,
          query,
          results: [{ lawName: query, lawId: "LAW", mst: "1", lawType: "법률", effectiveDate: "2026-01-01" }]
        };
      },
      async searchPrecedents() { return { results: [] }; },
      async searchInterpretations() { return { results: [] }; },
      async searchAdminRules() { return { results: [] }; },
      async searchOrdinances() { return { results: [] }; }
    }
  });
  assert.equal(context.mode, "department_legal_review");
  assert.equal(context.compliance.mode, "department_legal_review");
  assert.equal(context.compliance.reviewType, "privacy");
  assert.equal(context.compliance.outputStyle, "summary");
  assert.equal(context.compliance.disclaimer, "short");
  assert.equal(Array.isArray(context.citations), true);
  assert.match(context.contextText, /Compliance Review Instructions/);
}
