import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";

const { generatedSourceRouter } = await import("../server/sourceWorkflow/generatedSourceApi.js");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/source-workflow", generatedSourceRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/api/source-workflow`;

let failures = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label} - ${error.message}`);
  }
}

async function asJson(response) {
  const text = await response.text();
  try {
    return { response, body: JSON.parse(text) };
  } catch {
    return { response, body: text };
  }
}

console.log("Source Workflow API smoke");

await check("POST /from-answer rejects empty answer", async () => {
  const { response, body } = await asJson(await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answerMarkdown: "   ", format: "md" })
  }));
  assert.equal(response.status, 400);
  assert.match(body.error, /empty/i);
});

await check("POST /from-answer rejects unsupported format", async () => {
  const { response, body } = await asJson(await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answerMarkdown: "content", format: "exe" })
  }));
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported/i);
});

for (const format of ["md", "pdf", "docx", "hwpx"]) {
  await check(`POST /from-answer creates ${format} generated source metadata`, async () => {
    const { response, body } = await asJson(await fetch(`${base}/from-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: "msg_test_1",
        title: "검토 보고서",
        answerMarkdown: "요약\n\n- 근거 [N1]\n- 법령 [L1]",
        format,
        metadata: {
          citations: [{ marker: "[N1]", documentName: "내부 문서" }],
          law: { ok: true },
          notebook: { id: "nb1", name: "감사 노트북" }
        }
      })
    }));
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.generatedSource.kind, "document");
    assert.equal(body.generatedSource.origin, "assistant_answer");
    assert.equal(body.generatedSource.sourceMessageId, "msg_test_1");
    assert.equal(body.generatedSource.generatedBy, "assistant");
    assert.equal(body.generatedSource.trustLevel, "generated");
    assert.equal(body.generatedSource.sourceTrust, 0.5);
    assert.equal(body.generatedSource.fileType, format);
    assert.equal(body.generatedSource.text, "요약\n\n- 근거 [N1]\n- 법령 [L1]");
    assert.equal(body.generatedSource.textLength, 23);
    assert.deepEqual(body.generatedSource.labels, ["AI 생성", "검증 필요"]);
    assert.deepEqual(body.generatedSource.citations, [{ marker: "[N1]", documentName: "내부 문서" }]);
    assert.equal(body.generatedSource.sourceMetadata.law.ok, true);
    assert.equal(body.generatedSource.sourceMetadata.notebook.id, "nb1");
    assert.match(body.generatedSource.id, /^generated_doc_/);
    assert.match(body.generatedSource.fileName, new RegExp(`\\.${format}$`));
    assert.match(body.generatedSource.mimeType, /\S/);
    if (format === "md") assert.match(body.generatedSource.dataBase64, /\S/);
  });
}

await new Promise((resolve) => server.close(resolve));

await check("frontend wires assistant save-as-source action", async () => {
  const chatJs = await fs.readFile(new URL("../public/modules/chat.js", import.meta.url), "utf8");
  const sourceWorkflowJs = await fs.readFile(new URL("../public/modules/sourceWorkflow.js", import.meta.url), "utf8");
  const stylesCss = await fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(chatJs, /openAnswerAsSourceDialog/);
  assert.match(chatJs, /createSaveAsSourceButton/);
  assert.match(chatJs, /save-as-source-button/);
  assert.match(sourceWorkflowJs, /export async function openAnswerAsSourceDialog/);
  assert.match(sourceWorkflowJs, /\/api\/source-workflow\/from-answer/);
  assert.match(sourceWorkflowJs, /room\.documents\.push/);
  const dialogRule = stylesCss.match(/\.source-workflow-dialog\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(dialogRule, /background:\s*var\(--surface\)/);
  assert.doesNotMatch(dialogRule, /background:\s*var\(--panel\)/);
});

await check("frontend displays generated sources as secondary materials", async () => {
  const appJs = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const fileDisplayJs = await fs.readFile(new URL("../public/fileDisplay.js", import.meta.url), "utf8");
  const chatJs = await fs.readFile(new URL("../public/modules/chat.js", import.meta.url), "utf8");
  assert.match(appJs, /isGeneratedSource/);
  assert.match(appJs, /generatedSources/);
  assert.match(appJs, /AI 생성 자료/);
  assert.match(appJs, /source-trust-badge/);
  assert.match(fileDisplayJs, /AI 생성/);
  assert.match(chatJs, /AI 생성 자료/);
});

await check("chat prompt marks generated sources as secondary references", async () => {
  const ollamaJs = await fs.readFile(new URL("../server/ollama.js", import.meta.url), "utf8");
  assert.match(ollamaJs, /hasGeneratedSources/);
  assert.match(ollamaJs, /AI-generated working documents/);
  assert.match(ollamaJs, /secondary references/);
  assert.match(ollamaJs, /isGeneratedSourceDocument/);
  assert.match(ollamaJs, /AI 생성 참고자료/);
});

await check("persistence keeps generated source metadata compatible", async () => {
  const stateJs = await fs.readFile(new URL("../public/modules/state.js", import.meta.url), "utf8");
  const persistenceJs = await fs.readFile(new URL("../public/modules/persistence.js", import.meta.url), "utf8");
  assert.match(stateJs, /generatedSources/);
  assert.match(persistenceJs, /normalizeGeneratedSourceDocument/);
  assert.match(persistenceJs, /trustLevel = "generated"/);
  assert.match(persistenceJs, /sourceTrust = 0\.5/);
  assert.match(persistenceJs, /AI 생성/);
  assert.match(persistenceJs, /검증 필요/);
});

await check("phase 3 source guide API and UI are wired", async () => {
  const indexJs = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const sourceGuideJs = await fs.readFile(new URL("../server/sourceWorkflow/sourceGuide.js", import.meta.url), "utf8");
  const documentStudioJs = await fs.readFile(new URL("../public/modules/documentStudio.js", import.meta.url), "utf8");
  assert.match(indexJs, /\/api\/source-workflow\/source-guide/);
  assert.match(sourceGuideJs, /recommendedQuestions/);
  assert.match(sourceGuideJs, /possibleOutputs/);
  assert.match(sourceGuideJs, /relatedLaws/);
  assert.match(documentStudioJs, /createSourceGuideOutput/);
  assert.match(documentStudioJs, /studioSourceGuideButton/);
});

await check("phase 4 Studio output library can become room sources", async () => {
  const stateJs = await fs.readFile(new URL("../public/modules/state.js", import.meta.url), "utf8");
  const documentStudioJs = await fs.readFile(new URL("../public/modules/documentStudio.js", import.meta.url), "utf8");
  const indexHtml = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(stateJs, /room\.studio\.outputs/);
  assert.match(documentStudioJs, /upsertStudioOutputFromDraft/);
  assert.match(documentStudioJs, /addOutputAsRoomSource/);
  assert.match(documentStudioJs, /\/api\/source-workflow\/from-answer/);
  assert.match(indexHtml, /studioOutputLibrary/);
});

await check("phase 5 promotion workflow is admin reviewed", async () => {
  const indexJs = await fs.readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const promotionsJs = await fs.readFile(new URL("../server/sourceWorkflow/sourcePromotions.js", import.meta.url), "utf8");
  const notebookJs = await fs.readFile(new URL("../public/modules/notebook.js", import.meta.url), "utf8");
  assert.match(indexJs, /\/api\/source-workflow\/promotions/);
  assert.match(indexJs, /\/api\/admin\/source-promotions/);
  assert.match(promotionsJs, /reviewSourcePromotion/);
  assert.match(promotionsJs, /addNotebookDocument/);
  assert.match(promotionsJs, /approvedBy/);
  assert.match(notebookJs, /showAdminSourcePromotions/);
});

if (failures) {
  console.error(`Source Workflow API smoke failed: ${failures}`);
  process.exit(1);
}

console.log("Source Workflow API smoke passed");
