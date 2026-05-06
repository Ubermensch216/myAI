import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.MYAI_SMOKE_BASE_URL || "http://127.0.0.1:3000";
let failureCount = 0;

await run("app shell ids exist", testAppShellIds);
const status = await run("GET /api/status", testStatus);
await run("GET /api/notebooks", testNotebookList);
await run("POST /api/upload text file", testUpload);
await run("POST /api/visualize invalid plan returns 400", testVisualizePlanValidation);
await run("POST /api/agent/intent month range", () => testCalendarIntent(status));
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
  const result = await fetchJson("/api/agent/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      prompt: "5월 전체 일정 보고해.",
      model: process.env.MYAI_SMOKE_MODEL || status?.defaultModel || "gemma3n:e2b",
      currentDate: "2026-05-04T09:00:00+09:00"
    })
  });

  assert.equal(result.intent, "calendar.list");
  assert.equal(result.payload?.from, "2026-05-01");
  assert.equal(result.payload?.to, "2026-05-31");
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
    response = await fetch(new URL("/api/upload", baseUrl), { method: "POST", body: formData });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. ${err.message}`);
  }
  assert.equal(response.status, 200, `POST /api/upload returned ${response.status}`);
  const payload = await response.json();
  assert.ok(payload.document?.id, "upload response should have document.id");
  assert.equal(payload.document?.kind, "document", "upload response should have kind=document");
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
