import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.MYAI_SMOKE_BASE_URL || "http://127.0.0.1:3000";
const documentCacheKey = crypto.randomUUID();
let failureCount = 0;

await run("app shell ids exist", testAppShellIds);
const status = await run("GET /api/status", testStatus);
await run("GET /api/law/status", testLawStatus);
await run("GET/POST /api/law workbench basics", testLawWorkbenchBasics);
await run("GET /api/access/status", testAccessStatus);
await run("GET /api/notebooks", testNotebookList);
await run("POST /api/upload text file", testUpload);
await run("POST /api/export docx", testExportDocx);
await run("POST /api/export pdf and hwpx", testExportPdfAndHwpx);
await run("POST /api/studio/mindmap without documents returns 400", testMindmapNoDocuments);
await run("POST /api/studio/mindmap fallback includes warnings", testMindmapFallbackWarnings);
await run("POST /api/visualize invalid plan returns 400", testVisualizePlanValidation);
await run("POST /api/agent/intent calendar regression set", () => testCalendarIntent(status));
if (status?.ok) {
  await run("POST /api/chat echo", testChat);
}
if (process.env.MYAI_SMOKE_LAW_LIVE === "1") {
  await run("POST /api/law live endpoints", testLawLiveEndpoints);
  if (status?.ok) {
    await run("POST /api/chat law-grounded prompt (live)", () => testChatLawPrompt(status));
  }
}

if (failureCount > 0) {
  process.exitCode = 1;
}

async function run(name, fn) {
  try {
    const result = await fn();
    console.log(`ok - ${name}`);
    return result;
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
    return null;
  }
}

async function testAppShellIds() {
  const html = await fs.readFile(path.join(rootDir, "public", "index.html"), "utf8");
  const app = await fs.readFile(path.join(rootDir, "public", "app.js"), "utf8");
  const state = await fs.readFile(path.join(rootDir, "public", "modules", "state.js"), "utf8");
  const ids = new Set();
  for (const match of `${app}\n${state}`.matchAll(/document\.querySelector\("#([^"]+)"\)/g)) {
    ids.add(match[1]);
  }

  const missing = Array.from(ids)
    .filter((id) => !html.includes(`id="${id}"`) && !html.includes(`id='${id}'`))
    .sort();
  assert.deepEqual(missing, []);

  const staleSymbols = [
    "adminTokenSection",
    "adminNotebookContent",
    "adminNotebookFileInput",
    "showNewNotebookForm",
    "hideNewNotebookForm",
    "buildAdminNotebookCard"
  ].filter((symbol) => app.includes(symbol));
  assert.deepEqual(staleSymbols, []);
}

async function testStatus() {
  const status = await fetchJson("/api/status");
  assert.equal(status.ok, true);
  assert.equal(typeof status.defaultModel, "string");
  assert.ok(status.defaultModel.length > 0);
  assert.ok(Array.isArray(status.models));
  return status;
}

async function testLawStatus() {
  const response = await fetch(new URL("/api/law/status", baseUrl));
  assert.ok([200, 503].includes(response.status), `GET /api/law/status returned ${response.status}`);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.equal(typeof payload.ok, "boolean");
  assert.equal(typeof payload.enabled, "boolean");
  assert.equal(typeof payload.configured, "boolean");
  assert.equal(payload.api?.provider, "law.go.kr");
  assert.equal(payload.cache?.path, undefined, "law status must not expose server cache path");
  const lawSecret = String(process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || "").trim();
  if (lawSecret) assert.equal(text.includes(lawSecret), false, "law status must not expose API key");
  return payload;
}

async function testLawWorkbenchBasics() {
  const terms = await fetchJson("/api/law/terms?q=%EC%A0%84%EC%84%B8%EA%B8%88%20%EB%AA%BB%20%EB%B0%9B%EC%9D%8C");
  assert.equal(terms.ok, true);
  assert.ok(Array.isArray(terms.terms), "terms endpoint should return terms array");
  assert.ok(terms.terms.some((item) => (item.canonicalTerms || []).includes("임대차보증금 반환")));

  const emptyWorkbench = await fetch(new URL("/api/law/workbench", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(emptyWorkbench.status, 400, "empty workbench request should be a client error");

  const report = await fetchJson("/api/law/workbench/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateId: "law_review_opinion",
      workbench: {
        input: { query: "smoke", lawName: "Test Act", article: "제1조" },
        article: { ok: true, text: "Article body", citation: { citationId: "L1", locator: "Test Act 제1조" } },
        citations: [{ citationId: "L1", sourceType: "law", locator: "Test Act 제1조" }]
      }
    })
  });
  assert.equal(report.ok, true);
  assert.equal(report.recommendedTemplateId, "law_review_opinion");
  assert.match(report.markdown, /질문\/업로드 문서 요약/);
}

async function testCalendarIntent(status) {
  const currentDate = "2026-05-04T09:00:00+09:00";
  const model = process.env.MYAI_SMOKE_MODEL || status?.defaultModel || "gemma3n:e2b";
  const cases = [
    ["5\uc6d4 \uc804\uccb4 \uc77c\uc815 \ubcf4\uace0\uc2f6\uc5b4", "2026-05-01", "2026-05-31"],
    ["\uc774\ubc88 \ub2ec \uc77c\uc815 \ubcf4\uc5ec\uc918", "2026-05-01", "2026-05-31"],
    ["\uc774\ubc88 \uc8fc \uc77c\uc815 \ubcf4\uc5ec\uc918", "2026-05-03", "2026-05-09"],
    ["\ub0b4\uc77c \uc77c\uc815 \uc54c\ub824\uc918", "2026-05-05", "2026-05-05"],
    ["6\uc6d4\ubd80\ud130 12\uc6d4\uae4c\uc9c0 \uc77c\uc815 \uc54c\ub824\uc918", "2026-06-01", "2026-12-31"]
  ];

  for (const [prompt, from, to] of cases) {
    const result = await fetchJson("/api/agent/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ prompt, model, currentDate })
    });

    assert.equal(result.intent, "calendar.list", `${prompt} intent`);
    assert.equal(result.payload?.from, from, `${prompt} from`);
    assert.equal(result.payload?.to, to, `${prompt} to`);
  }
}
async function testNotebookList() {
  const payload = await fetchJson("/api/notebooks");
  assert.ok(Array.isArray(payload.notebooks), "GET /api/notebooks should return { notebooks: [] }");
}

async function testAccessStatus() {
  const status = await fetchJson("/api/access/status");
  assert.equal(typeof status.configured, "boolean", "access status should expose configured");
  assert.equal(typeof status.authenticated, "boolean", "access status should expose authenticated");
  const options = await fetchJson("/api/access/options");
  assert.ok(Array.isArray(options.groups), "access options should expose groups");
  assert.equal(typeof options.super?.enabled, "boolean", "access options should expose super.enabled");
}

async function testUpload() {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob(["name,score\nAlice,90\nBob,75"], { type: "text/csv" }),
    "smoke-test.csv"
  );
  let response;
  try {
    response = await fetch(new URL("/api/upload", baseUrl), {
      method: "POST",
      headers: { "X-MyAI-Document-Key": documentCacheKey },
      body: formData
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.equal(response.status, 200, `POST /api/upload returned ${response.status}`);
  const payload = await response.json();
  assert.ok(payload.document?.id, "upload response should have document.id");
  assert.equal(payload.document?.kind, "document", "upload response should have kind=document");

  response = await fetch(new URL("/api/documents", baseUrl));
  assert.equal(response.status, 404, "runtime document listing should be disabled");

  response = await fetch(new URL(`/api/documents/${payload.document.id}`, baseUrl));
  assert.equal(response.status, 404, "runtime document fetch without owner key should be hidden");

  response = await fetch(new URL(`/api/documents/${payload.document.id}`, baseUrl), {
    headers: { "X-MyAI-Document-Key": documentCacheKey }
  });
  assert.equal(response.status, 200, "runtime document fetch with owner key should succeed");
}

async function testVisualizePlanValidation() {
  let response;
  try {
    response = await fetch(new URL("/api/visualize", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "smoke test", documents: [], model: "nonexistent" })
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  // Expects a 400 or 500 when no documents are provided — just check it does not hang or crash
  assert.ok(
    response.status >= 400,
    `POST /api/visualize with no documents should return 4xx/5xx, got ${response.status}`
  );
}

async function testExportDocx() {
  let response;
  try {
    response = await fetch(new URL("/api/export", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "docx",
        title: "smoke export",
        content: "# Smoke Export\n\n| name | score |\n| --- | --- |\n| Alice | 90 |"
      })
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.equal(response.status, 200, `POST /api/export returned ${response.status}`);
  assert.match(response.headers.get("content-type") || "", /wordprocessingml\.document/);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.length > 1000, "DOCX export should return a non-empty zip package");
  assert.equal(body.subarray(0, 2).toString("utf8"), "PK", "DOCX export should be a zip package");
}

async function testExportPdfAndHwpx() {
  const content = "# 한글 내보내기\n\n본문입니다. 위버멘쉬와 네이버 검색 결과를 정리합니다.";
  const pdf = await fetch(new URL("/api/export", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "pdf", title: "한글 PDF", content })
  });
  assert.equal(pdf.status, 200, `POST /api/export pdf returned ${pdf.status}`);
  const pdfBody = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBody.subarray(0, 4).toString("utf8"), "%PDF", "PDF export should be a PDF package");
  assert.ok(pdfBody.length > 5000, "PDF export should include an embedded Korean-capable font");

  const hwpx = await fetch(new URL("/api/export", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "hwpx", title: "한글 HWPX", content })
  });
  assert.equal(hwpx.status, 200, `POST /api/export hwpx returned ${hwpx.status}`);
  const hwpxBody = Buffer.from(await hwpx.arrayBuffer());
  assert.equal(hwpxBody.subarray(0, 2).toString("utf8"), "PK", "HWPX export should be a zip package");
  assert.ok(hwpxBody.length > 2500, "HWPX export should include HWPX package metadata");
  const zip = await JSZip.loadAsync(hwpxBody);
  assert.ok(zip.file("Contents/content.hpf"), "HWPX should include Contents/content.hpf");
  assert.ok(zip.file("Contents/header.xml"), "HWPX should include Contents/header.xml");
  assert.ok(zip.file("Contents/section0.xml"), "HWPX should include Contents/section0.xml");
  assert.ok(zip.file("META-INF/manifest.xml"), "HWPX should include META-INF/manifest.xml");
  const hpf = await zip.file("Contents/content.hpf").async("string");
  assert.match(hpf, /href="Contents\/section0\.xml"/, "HWPX content.hpf should reference Contents/section0.xml");
}

async function testMindmapNoDocuments() {
  let response;
  try {
    response = await fetch(new URL("/api/studio/mindmap", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [], model: "nonexistent" })
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.equal(response.status, 400, `POST /api/studio/mindmap without documents returned ${response.status}`);
}

async function testMindmapFallbackWarnings() {
  let response;
  try {
    response = await fetch(new URL("/api/studio/mindmap", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [{
          kind: "document",
          id: "smoke-mindmap-doc",
          fileName: "mindmap-smoke.txt",
          fileType: "txt",
          text: "마인드맵 스모크 테스트 문서입니다. 핵심 주제는 생성 실패 시 기본 마인드맵 경고 표시입니다.",
          summary: "마인드맵 fallback 경고 테스트",
          topics: ["마인드맵", "fallback", "경고"]
        }],
        model: "myai-nonexistent-mindmap-model"
      })
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.equal(response.status, 200, `POST /api/studio/mindmap fallback returned ${response.status}`);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.mindmap?.warnings), "fallback response should include warnings");
  assert.ok(payload.mindmap.warnings.includes("fallback_mindmap"), "fallback warning should be present");
  assert.ok(payload.mindmap.warnings.some((warning) => String(warning).startsWith("model_fallback:")), "model fallback warning should be present");
}

async function testChat() {
  // Smoke only verifies the endpoint is reachable and doesn't 5xx.
  // Full inference correctness is covered by npm run test:live.
  let response;
  try {
    response = await fetch(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Reply with the single word OK.",
        messages: [],
        documents: []
      })
    });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.ok(response.status < 500, `POST /api/chat caused server error: ${response.status}`);
}

function decodeNotebookMetaHeader(header) {
  if (!header) return null;
  try {
    const json = Buffer.from(String(header), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function testChatLawPrompt(status) {
  // Verifies that the full chat path detects a Korean law prompt, calls
  // Korean Law Engine, and exposes verified citations + excerpt through the
  // X-Notebook-Meta header. Independent of the LLM's text — we only assert
  // metadata, since model output is non-deterministic.
  const lawStatusResponse = await fetch(new URL("/api/law/status", baseUrl));
  const lawStatus = await lawStatusResponse.json().catch(() => ({}));
  if (!lawStatus.ok || !lawStatus.configured) {
    console.log("skip - chat law prompt (LAW_OC not configured)");
    return;
  }

  const model = process.env.MYAI_SMOKE_MODEL || status?.defaultModel || "gemma3n:e2b";
  const cases = [
    {
      label: "law_article",
      prompt: "민법 제750조 본문을 알려줘.",
      expectMode: /law_article/,
      expectCitationMatch: /민법.*제750조/
    },
    {
      label: "verify_citations",
      prompt: "조문 검증해줘: 민법 제750조, 민법 제9999조.",
      expectMode: /verify_citations/,
      expectFailCount: 1
    }
  ];

  for (const testCase of cases) {
    const body = JSON.stringify({
      prompt: testCase.prompt,
      messages: [{ role: "user", content: testCase.prompt }],
      documents: [],
      model
    });
    const response = await fetch(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    assert.ok(response.status < 500, `chat ${testCase.label} should not 5xx, got ${response.status}`);
    const meta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    assert.ok(meta, `chat ${testCase.label} should expose X-Notebook-Meta`);
    assert.ok(meta.law, `chat ${testCase.label} should include law metadata`);
    assert.match(meta.law.mode, testCase.expectMode, `chat ${testCase.label} mode should match ${testCase.expectMode}`);

    if (testCase.label === "law_article") {
      assert.ok(Array.isArray(meta.law.citations) && meta.law.citations.length > 0, "law_article should produce at least one citation");
      const first = meta.law.citations[0];
      assert.match(`${first.lawName} ${first.article}`, testCase.expectCitationMatch, "first citation should reference 민법 제750조");
      assert.equal(first.sourceType, "law");
      assert.ok(first.url, "law citation should expose official url");
      assert.ok(typeof first.excerpt === "string" && first.excerpt.length > 0, "law citation should expose excerpt");
    } else if (testCase.label === "verify_citations") {
      assert.ok(meta.law.verification?.checked, "verify_citations should report checked=true");
      assert.equal(meta.law.verification?.failCount, testCase.expectFailCount, "verify_citations failCount should match");
      const invalid = (meta.law.verification.results || []).find((item) => item.valid === false);
      assert.ok(invalid && /9999/.test(invalid.citation), "fail entry should reference 제9999조");
    }

    // Body should not leak the API key into chat output.
    const text = await response.text();
    const lawSecret = String(process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || "").trim();
    if (lawSecret) {
      assert.equal(text.includes(lawSecret), false, "chat output must not contain LAW_OC");
    }
  }
}

async function testLawLiveEndpoints() {
  const statusResponse = await fetch(new URL("/api/law/status", baseUrl));
  const status = await statusResponse.json().catch(() => ({}));
  if (!status.ok || !status.configured) {
    console.log("skip - POST /api/law live endpoints (LAW_OC not configured)");
    return;
  }

  // Search across statute families with very different name shapes / agencies
  // so a single live run exercises the JSON parser against multiple real responses.
  const searchCases = [
    { query: "\ubbfc\ubc95", expectMatch: /\ubbfc\ubc95/ },
    { query: "\ub3c4\ub85c\uad50\ud1b5\ubc95", expectMatch: /\ub3c4\ub85c\uad50\ud1b5\ubc95/ },
    { query: "\uac1c\uc778\uc815\ubcf4 \ubcf4\ud638\ubc95", expectMatch: /\uac1c\uc778\uc815\ubcf4/ },
    { query: "\ud615\ubc95", expectMatch: /\ud615\ubc95/ }
  ];
  for (const { query, expectMatch } of searchCases) {
    const search = await fetchJson("/api/law/search", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query, display: 5 })
    });
    assertNoLawSecrets(search, `search ${query}`);
    assert.equal(search.ok, true, `search ${query} ok`);
    assert.ok(Array.isArray(search.results), `search ${query} results array`);
    assert.ok(search.results.length > 0, `search ${query} should return candidates`);
    assert.ok(
      search.results.some((item) => expectMatch.test(String(item.lawName || ""))),
      `search ${query} should include a result matching ${expectMatch}`
    );
    for (const item of search.results) {
      assert.ok(item.lawName, `search ${query} result must include lawName`);
      assert.ok(item.lawId || item.mst, `search ${query} result must include lawId or MST`);
      assert.equal(item.raw, undefined, `search ${query} result must not expose raw upstream payload`);
    }
  }

  // Fetch articles across statute families and confirm parser yields citation+text
  // for each. Includes a branched-article case to validate JO code padding.
  const articleCases = [
    { lawName: "\ubbfc\ubc95", article: "\uc81c750\uc870", expectMatch: /\ubd88\ubc95\ud589\uc704|\uc190\ud574/ },
    { lawName: "\ubbfc\ubc95", article: "\uc81c758\uc870", expectMatch: /\uacf5\uc791\ubb3c|\uc810\uc720\uc790/ },
    { lawName: "\ub3c4\ub85c\uad50\ud1b5\ubc95", article: "\uc81c44\uc870", expectMatch: /\uc220|\uc6b4\uc804/ },
    { lawName: "\uac1c\uc778\uc815\ubcf4 \ubcf4\ud638\ubc95", article: "\uc81c15\uc870", expectMatch: /\uac1c\uc778\uc815\ubcf4|\uc218\uc9d1/ }
  ];
  for (const { lawName, article, expectMatch } of articleCases) {
    const detail = await fetchJson("/api/law/article", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ lawName, article })
    });
    assertNoLawSecrets(detail, `article ${lawName} ${article}`);
    assert.equal(detail.ok, true, `article ${lawName} ${article} ok`);
    assert.equal(detail.citation?.sourceType, "law", `article ${lawName} ${article} sourceType`);
    assert.equal(detail.citation?.article, article, `article ${lawName} ${article} canonical mismatch`);
    assert.ok(String(detail.text || "").length > 0, `article ${lawName} ${article} text should be non-empty`);
    assert.ok(expectMatch.test(detail.text), `article ${lawName} ${article} body should match ${expectMatch}`);
    assert.ok(detail.citation?.url, `article ${lawName} ${article} citation should expose url`);
    assert.ok(
      !detail.text.includes("<![CDATA["),
      `article ${lawName} ${article} text must not leak CDATA wrapper`
    );
    assert.equal(detail.raw, undefined, `article ${lawName} ${article} must not expose raw upstream payload`);
  }

  const verification = await fetchJson("/api/law/verify-citations", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      text: "\ubbfc\ubc95 \uc81c750\uc870\uc640 \ub3c4\ub85c\uad50\ud1b5\ubc95 \uc81c44\uc870\uc640 \ubbfc\ubc95 \uc81c9999\uc870\ub97c \uac80\uc99d\ud574\uc918"
    })
  });
  assertNoLawSecrets(verification, "verify citations");
  assert.equal(verification.ok, true);
  assert.equal(verification.checked, true);
  assert.ok(Array.isArray(verification.results));
  assert.equal(verification.passCount, 2, "verification should accept 2 real citations");
  assert.equal(verification.failCount, 1, "verification should reject 1 fake citation");
  const invalid = verification.results.find((item) => item.valid === false);
  assert.ok(invalid && /9999/.test(invalid.citation), "invalid citation should reference \uc81c9999\uc870");

  // Phase 2: precedent + interpretation endpoints (skip detail step if search empty)
  const precSearch = await fetchJson("/api/law/precedents/search", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ query: "\ubd88\ubc95\ud589\uc704 \uc190\ud574\ubc30\uc0c1", display: 3 })
  });
  assertNoLawSecrets(precSearch, "precedent search");
  assert.equal(precSearch.ok, true, "precedent search ok");
  assert.ok(Array.isArray(precSearch.results), "precedent search results array");
  if (precSearch.results.length) {
    const top = precSearch.results[0];
    assert.ok(top.precId || top.title, "precedent search hit should expose id or title");
    if (top.precId) {
      const precDetail = await fetchJson("/api/law/precedents/detail", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ precId: top.precId })
      });
      assertNoLawSecrets(precDetail, "precedent detail");
      assert.equal(precDetail.ok, true, "precedent detail ok");
      assert.equal(precDetail.citation?.sourceType, "law_precedent");
      assert.ok(precDetail.citation?.url, "precedent citation should expose url");
      assert.equal(precDetail.raw, undefined, "precedent detail must not expose raw upstream payload");
    }
  }

  const expcSearch = await fetchJson("/api/law/interpretations/search", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ query: "\uac1c\uc778\uc815\ubcf4", display: 3 })
  });
  assertNoLawSecrets(expcSearch, "interpretation search");
  assert.equal(expcSearch.ok, true, "interpretation search ok");
  assert.ok(Array.isArray(expcSearch.results), "interpretation search results array");
  if (expcSearch.results.length) {
    const top = expcSearch.results[0];
    if (top.expcId) {
      const expcDetail = await fetchJson("/api/law/interpretations/detail", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ expcId: top.expcId })
      });
      assertNoLawSecrets(expcDetail, "interpretation detail");
      assert.equal(expcDetail.ok, true, "interpretation detail ok");
      assert.equal(expcDetail.citation?.sourceType, "law_interpretation");
      assert.ok(expcDetail.citation?.url, "interpretation citation should expose url");
      assert.equal(expcDetail.raw, undefined, "interpretation detail must not expose raw upstream payload");
    }
  }
}

function assertNoLawSecrets(payload, label) {
  const text = JSON.stringify(payload);
  const lawSecret = String(process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || "").trim();
  if (lawSecret) assert.equal(text.includes(lawSecret), false, `${label} must not expose API key`);
  assert.equal(/[?&]OC=/.test(text), false, `${label} must not expose upstream OC query values`);
  assert.equal(text.includes("/DRF/lawService.do"), false, `${label} must not expose upstream service URLs`);
}

async function fetchJson(route, options = {}) {
  let response;
  try {
    response = await fetch(new URL(route, baseUrl), options);
  } catch (error) {
    throw new Error(`Could not reach ${baseUrl}. Start the app with npm start before running smoke tests. ${error.message}`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${route}, got: ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(`${route} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  return payload;
}
