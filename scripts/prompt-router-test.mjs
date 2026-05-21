import assert from "node:assert/strict";

process.env.LAW_AUTO_DETECT = "false";

const { classifyChatRoute } = await import("../server/promptRouter.js");

const explanationPrompt = "\"법무/컴플라이언스 관리자\"라는 용어에서 컴플라이언스의 의미를 중학생 수준에 맞춰 쉽게 설명해";
const compliancePrompt = "현재 자료로 개인정보 법령 적합성 검토를 상세 보고서로 작성해줘";
const newsPrompt = "최신 AI 뉴스 검색해줘";

run("compliance term explanation stays normal chat", () => {
  const route = classifyChatRoute({ prompt: explanationPrompt });
  assert.equal(route.route, "normal_chat");
  assert.equal(route.requiresInternalMaterial, false);
  assert.equal(route.chatFlags.forceWebSearch, false);
});

run("compliance review without material is routed with material requirement", () => {
  const route = classifyChatRoute({ prompt: compliancePrompt });
  assert.equal(route.route, "compliance_review");
  assert.equal(route.requiresInternalMaterial, true);
  assert.equal(route.lawIntent.mode, "department_legal_review");
  assert.match(route.notebookQueryOverride, /개인정보/);
});

run("forced law search mode wins over all other routes", () => {
  const route = classifyChatRoute({
    prompt: newsPrompt,
    mode: "map_reduce",
    lawSearchMode: true,
    notebookId: "nb-1",
    documents: [{ kind: "document", fileName: "a.txt", text: "hello" }]
  });
  assert.equal(route.route, "strict_law_search");
  assert.equal(route.chatFlags.isLawSearchMode, true);
  assert.equal(route.chatFlags.forceWebSearch, false);
  assert.equal(route.chatFlags.shouldLoadNotebookContext, false);
});

run("map reduce routes when not in law search mode", () => {
  const route = classifyChatRoute({
    prompt: newsPrompt,
    mode: "map_reduce",
    notebookId: "nb-1"
  });
  assert.equal(route.route, "map_reduce");
  assert.equal(route.chatFlags.shouldLoadNotebookContext, false);
});

run("explicit web search routes when no notebook is selected", () => {
  const route = classifyChatRoute({ prompt: newsPrompt });
  assert.equal(route.route, "web_search");
  assert.equal(route.chatFlags.forceWebSearch, true);
  assert.equal(route.chatFlags.allowWebSearch, true);
});

run("notebook selection blocks web search and routes to notebook rag", () => {
  const route = classifyChatRoute({ prompt: newsPrompt, notebookId: "nb-1" });
  assert.equal(route.route, "notebook_rag");
  assert.equal(route.chatFlags.forceWebSearch, false);
  assert.equal(route.chatFlags.allowWebSearch, false);
  assert.equal(route.chatFlags.shouldLoadNotebookContext, true);
});

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}
