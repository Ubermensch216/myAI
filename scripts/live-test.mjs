import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseUpload } from "../server/parsers.js";
import { embedTexts } from "../server/embeddings.js";
import {
  addNotebookDocument,
  createNotebook,
  deleteNotebook,
  getNotebook,
  queryNotebook,
  removeNotebookDocument,
  updateNotebook
} from "../server/notebooks.js";

let failureCount = 0;

await run("Ollama is reachable", testOllamaReachable);
await run("embedding model returns vectors", testEmbeddings);
await run("parser and notebook CRUD/query", testParserAndNotebookCrud);

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

async function testOllamaReachable() {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/tags`);
  } catch (error) {
    throw new Error(`Could not reach Ollama at ${ollamaUrl}. Start Ollama before running live tests. ${error.message}`);
  }
  assert.equal(response.ok, true);
}

async function testEmbeddings() {
  const vectors = await embedTexts(["local live test embedding probe"]);
  assert.equal(vectors.length, 1);
  assert.ok(Array.isArray(vectors[0]));
  assert.ok(vectors[0].length > 0);
  assert.equal(typeof vectors[0][0], "number");
}

async function testParserAndNotebookCrud() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-live-"));
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
      name: `Live Test ${Date.now()}`,
      description: "temporary live-test notebook"
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
