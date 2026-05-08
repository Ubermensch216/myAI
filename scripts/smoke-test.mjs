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
await run("GET /api/notebooks", testNotebookList);
await run("POST /api/upload text file", testUpload);
await run("POST /api/export docx", testExportDocx);
await run("POST /api/export pdf and hwpx", testExportPdfAndHwpx);
await run("POST /api/visualize invalid plan returns 400", testVisualizePlanValidation);
await run("POST /api/agent/intent calendar regression set", () => testCalendarIntent(status));
if (status?.ok) {
  await run("POST /api/chat echo", testChat);
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
