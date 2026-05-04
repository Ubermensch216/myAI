import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseUpload } from "../server/parsers.js";
import {
  addNotebookDocument,
  createNotebook,
  deleteNotebook,
  getNotebook,
  queryNotebook,
  removeNotebookDocument,
  updateNotebook
} from "../server/notebooks.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.MYAI_SMOKE_BASE_URL || "http://127.0.0.1:3000";
let failureCount = 0;

await run("app shell ids exist", testAppShellIds);
const status = await run("GET /api/status", testStatus);
await run("POST /api/agent/intent month range", () => testCalendarIntent(status));
await run("parser and notebook CRUD", testParserAndNotebookCrud);

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
  const ids = new Set();
  for (const match of app.matchAll(/document\.querySelector\("#([^"]+)"\)/g)) {
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

async function testParserAndNotebookCrud() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-smoke-"));
  const csvPath = path.join(tempDir, "sales.csv");
  let notebookId = null;

  try {
    await fs.writeFile(csvPath, "제품,금액\nA,10\nB,20\n", "utf8");
    const parsedCsv = await parseUpload({
      path: csvPath,
      originalname: "sales.csv",
      mimetype: "text/csv"
    });
    assert.equal(parsedCsv.kind, "document");
    assert.equal(parsedCsv.tables?.[0]?.headers?.[0], "제품");

    const created = await createNotebook({
      name: `Smoke Test ${Date.now()}`,
      description: "temporary smoke-test notebook"
    });
    notebookId = created.id;
    assert.match(notebookId, /^nb_[a-f0-9]{16}$/);

    const loaded = await getNotebook(notebookId);
    assert.equal(loaded.id, notebookId);

    const updated = await updateNotebook(notebookId, {
      name: `${created.name} Updated`,
      description: "updated"
    });
    assert.equal(updated.name, `${created.name} Updated`);

    const csvDoc = await addNotebookDocument(notebookId, parsedCsv);
    assert.match(csvDoc.id, /^doc_[a-f0-9]{16}$/);

    const duplicateA = await addNotebookDocument(notebookId, {
      kind: "document",
      fileName: "duplicate-a.txt",
      fileType: "txt",
      text: "shared duplicate keyword",
      pages: [{ page: 1, text: "shared duplicate keyword" }]
    });
    const duplicateB = await addNotebookDocument(notebookId, {
      kind: "document",
      fileName: "duplicate-b.txt",
      fileType: "txt",
      text: "shared duplicate keyword",
      pages: [{ page: 1, text: "shared duplicate keyword" }]
    });

    const queryResult = await queryNotebook(notebookId, "duplicate keyword", { budget: 10000 });
    assert.equal(queryResult.ok, true);
    const duplicateIds = new Set(
      queryResult.chunks
        .filter((chunk) => chunk.text === "shared duplicate keyword")
        .map((chunk) => chunk.documentId)
    );
    assert.ok(duplicateIds.has(duplicateA.id));
    assert.ok(duplicateIds.has(duplicateB.id));

    assert.equal(await removeNotebookDocument(notebookId, csvDoc.id), true);
  } finally {
    if (notebookId) await deleteNotebook(notebookId).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
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
