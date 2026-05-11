import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-kg-law-test-"));
process.env.LAW_OC = "SECRET-LAW-KEY";
process.env.LAW_CACHE_PATH = path.join(tempDir, "law-cache.sqlite");
// Default 0.6; we use 0.95 in harvester so deterministic citations stay enabled.
process.env.KG_CONFIDENCE_THRESHOLD = process.env.KG_CONFIDENCE_THRESHOLD || "0.6";

const {
  ENTITY_TYPES,
  RELATION_TYPES,
  LLM_EXTRACTED_ENTITY_TYPES,
  LLM_EXTRACTED_RELATION_TYPE_IDS,
  isLlmExtractableEntityType,
  isLlmExtractableRelationType
} = await import("../server/rag/graph/ontology.js");
const {
  openNotebookGraphAtPath,
  closeGraphDatabase,
  getStats,
  findNodesByAlias,
  neighborsOf,
  upsertNode,
  upsertEdge
} = await import("../server/rag/graph/store.js");
const { harvestLegalCitationsInChunk } = await import("../server/rag/graph/builder.js");
const {
  expandQueryWithGraph,
  extractArticleRefsFromNeighborhood
} = await import("../server/rag/graph/expander.js");
const {
  buildLawContextFromArticleRefs,
  mergeLawContexts
} = await import("../server/law/lawContextBuilder.js");

let failureCount = 0;

await run("ontology includes Statute/Article entity types", testOntologyEntities);
await run("ontology includes REFERS_TO_ARTICLE relation", testOntologyRelation);
await run("LLM extraction excludes Statute/Article/REFERS_TO_ARTICLE", testLlmFilters);
await run("harvestLegalCitationsInChunk creates Statute/Article + PART_OF", testHarvestCreatesNodes);
await run("harvestLegalCitationsInChunk skips empty / non-legal text", testHarvestSkipsEmpty);
await run("harvestLegalCitationsInChunk dedupes repeated citations", testHarvestDedupe);
await run("extractArticleRefsFromNeighborhood parses Article labels", testExtractRefsFromNodes);
await run("expandQueryWithGraph surfaces articleRefs from KG", testExpanderArticleRefs);
await run("buildLawContextFromArticleRefs fetches + formats KG citations", testBuildLawContextFromKg);
await run("buildLawContextFromArticleRefs returns null for empty refs", testBuildLawContextEmpty);
await run("buildLawContextFromArticleRefs degrades on fetch failures", testBuildLawContextFailure);
await run("mergeLawContexts adds unique citations, dedupes by canonical", testMergeLawContexts);

await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

async function makeTempGraph(label) {
  const dbPath = path.join(tempDir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
  const db = await openNotebookGraphAtPath("test_nb", dbPath);
  return { db, dbPath };
}

function testOntologyEntities() {
  assert.ok(ENTITY_TYPES.includes("Statute"), "Statute must be in ENTITY_TYPES");
  assert.ok(ENTITY_TYPES.includes("Article"), "Article must be in ENTITY_TYPES");
}

function testOntologyRelation() {
  const ids = RELATION_TYPES.map((r) => r.id);
  assert.ok(ids.includes("REFERS_TO_ARTICLE"), "REFERS_TO_ARTICLE must be in RELATION_TYPES");
}

function testLlmFilters() {
  assert.ok(!LLM_EXTRACTED_ENTITY_TYPES.includes("Statute"), "Statute must be hidden from LLM");
  assert.ok(!LLM_EXTRACTED_ENTITY_TYPES.includes("Article"), "Article must be hidden from LLM");
  assert.ok(LLM_EXTRACTED_ENTITY_TYPES.includes("Concept"), "LLM should still see Concept");
  assert.ok(!LLM_EXTRACTED_RELATION_TYPE_IDS.includes("REFERS_TO_ARTICLE"));
  assert.equal(isLlmExtractableEntityType("Statute"), false);
  assert.equal(isLlmExtractableEntityType("Concept"), true);
  assert.equal(isLlmExtractableRelationType("REFERS_TO_ARTICLE"), false);
  assert.equal(isLlmExtractableRelationType("RELATES_TO"), true);
}

async function testHarvestCreatesNodes() {
  const { db } = await makeTempGraph("harvest-creates");
  try {
    const articleIds = harvestLegalCitationsInChunk(db, {
      documentId: "doc-1",
      chunkIndex: 0,
      text: "민법 제750조에 따라 불법행위로 인한 손해는 배상되어야 한다."
    });
    assert.equal(articleIds.length, 1, "one citation in chunk → one Article id");

    const stats = getStats(db);
    const statuteCount = stats.nodeTypeCounts.find((r) => r.type === "Statute")?.c || 0;
    const articleCount = stats.nodeTypeCounts.find((r) => r.type === "Article")?.c || 0;
    assert.equal(statuteCount, 1, "Statute node created");
    assert.equal(articleCount, 1, "Article node created");

    const partOfCount = stats.relationTypeCounts.find((r) => r.type === "PART_OF")?.c || 0;
    assert.equal(partOfCount, 1, "PART_OF edge between Article and Statute");

    // Alias lookups must hit the canonical and surface forms.
    const byCanonical = findNodesByAlias(db, "민법/제750조");
    assert.ok(byCanonical.some((n) => n.type === "Article"), "canonical alias hits Article");
    const bySurface = findNodesByAlias(db, "민법 제750조");
    assert.ok(bySurface.some((n) => n.type === "Article"), "surface alias hits Article");
  } finally {
    closeGraphDatabase(db);
  }
}

async function testHarvestSkipsEmpty() {
  const { db } = await makeTempGraph("harvest-empty");
  try {
    assert.deepEqual(harvestLegalCitationsInChunk(db, { documentId: "d", chunkIndex: 0, text: "" }), []);
    assert.deepEqual(
      harvestLegalCitationsInChunk(db, {
        documentId: "d",
        chunkIndex: 0,
        text: "오늘 회의에서 1조 5인 발표 순서를 정했다."
      }),
      [],
      "non-legal text with bare '1조' must not produce nodes"
    );
    const stats = getStats(db);
    assert.equal(stats.nodeCount, 0, "no nodes created on empty/non-legal input");
  } finally {
    closeGraphDatabase(db);
  }
}

async function testHarvestDedupe() {
  const { db } = await makeTempGraph("harvest-dedupe");
  try {
    const ids1 = harvestLegalCitationsInChunk(db, {
      documentId: "d1",
      chunkIndex: 0,
      text: "민법 제750조에 따라 손해배상 책임이 있다."
    });
    // Two citations in one chunk — second one duplicates the first → same node id.
    const ids2 = harvestLegalCitationsInChunk(db, {
      documentId: "d1",
      chunkIndex: 1,
      text: "민법 제750조. 민법 제750조 다시 본다."
    });
    assert.equal(ids1.length, 1);
    assert.equal(ids2.length, 1, "in-chunk dedupe collapses duplicate citations");
    assert.equal(ids1[0], ids2[0], "same canonical across chunks → same Article node id");
    const stats = getStats(db);
    assert.equal(stats.nodeTypeCounts.find((r) => r.type === "Article")?.c, 1, "still only one Article node");
  } finally {
    closeGraphDatabase(db);
  }
}

function testExtractRefsFromNodes() {
  const refs = extractArticleRefsFromNeighborhood([
    { id: "n_a", type: "Article", label: "민법 제750조", confidence: 0.95, hop: 0 },
    { id: "n_b", type: "Article", label: "개인정보 보호법 제15조", confidence: 0.95, hop: 1 },
    { id: "n_c", type: "Article", label: "민법 제750조", confidence: 0.95, hop: 1 },  // duplicate canonical
    { id: "n_d", type: "Concept", label: "동의", confidence: 0.7, hop: 0 },           // wrong type
    { id: "n_e", type: "Article", label: "임의 라벨 그냥 텍스트", confidence: 0.95, hop: 0 }  // unparseable
  ]);
  const canonicals = refs.map((r) => r.canonical).sort();
  assert.deepEqual(canonicals, ["개인정보 보호법/제15조", "민법/제750조"]);
}

async function testExpanderArticleRefs() {
  // openNotebookGraphAtPath caches via openNotebookGraph; expandQueryWithGraph
  // uses openNotebookGraph(notebookId) which reads from data/notebooks/<id>/.
  // We bypass that here by using extractArticleRefsFromNeighborhood directly,
  // which is the unit under test for the surfacing logic. The integration test
  // (expander → searchNotebook) is exercised via the live smoke path.
  const { db } = await makeTempGraph("expander-seed");
  try {
    harvestLegalCitationsInChunk(db, {
      documentId: "doc-1",
      chunkIndex: 0,
      text: "개인정보 보호법 제15조에 따라 동의를 받아야 한다."
    });
    const seeds = findNodesByAlias(db, "개인정보 보호법 제15조");
    assert.ok(seeds.length > 0, "alias lookup must find Article seed");
    const articleSeed = seeds.find((s) => s.type === "Article");
    assert.ok(articleSeed, "Article seed present");

    // Build a minimal neighborhood (seed + 1-hop) like the expander would.
    const neighbors = neighborsOf(db, articleSeed.id, { directions: "both", limit: 5 });
    const neighborhood = [
      { id: articleSeed.id, type: "Article", label: articleSeed.label, confidence: articleSeed.confidence, hop: 0 },
      ...neighbors.map((n) => ({
        id: n.neighbor_id,
        type: n.neighbor_type,
        label: n.neighbor_label,
        confidence: n.confidence,
        hop: 1
      }))
    ];
    const refs = extractArticleRefsFromNeighborhood(neighborhood);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].canonical, "개인정보 보호법/제15조");
    assert.equal(refs[0].lawName, "개인정보 보호법");
    assert.equal(refs[0].article, "제15조");
  } finally {
    closeGraphDatabase(db);
  }
}

async function testBuildLawContextFromKg() {
  const captured = [];
  const fakeClient = {
    async getLawArticle(input) {
      captured.push(input);
      return {
        ok: true,
        cacheHit: false,
        text: input.lawName === "민법"
          ? "고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다."
          : "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다.",
        citation: {
          citationId: "L1",
          sourceType: "law",
          lawName: input.lawName,
          article: input.article,
          canonical: `${input.lawName}/${input.article}`,
          title: input.lawName === "민법" ? "불법행위의 내용" : "개인정보의 수집ㆍ이용",
          locator: `${input.lawName} ${input.article}`,
          effectiveDate: "2023-09-15",
          url: `https://www.law.go.kr/법령/${input.lawName}/${input.article}`
        }
      };
    }
  };
  const ctx = await buildLawContextFromArticleRefs(
    [
      { lawName: "민법", article: "제750조", canonical: "민법/제750조" },
      { lawName: "개인정보 보호법", article: "제15조", canonical: "개인정보 보호법/제15조" }
    ],
    { client: fakeClient }
  );
  assert.ok(ctx, "context returned");
  assert.equal(ctx.ok, true);
  assert.equal(ctx.mode, "kg_articles");
  assert.equal(ctx.disclaimer, "short");
  assert.equal(ctx.citations.length, 2);
  assert.ok(ctx.citations.every((c) => c.kgDerived === true), "all KG citations carry kgDerived flag");
  assert.match(ctx.contextText, /지식그래프 연계 법령 근거/);
  assert.match(ctx.contextText, /\[공식 법령 근거\]/);
  assert.equal(captured.length, 2, "fetched both refs");
}

async function testBuildLawContextEmpty() {
  const noClient = { async getLawArticle() { throw new Error("should not be called"); } };
  assert.equal(await buildLawContextFromArticleRefs([], { client: noClient }), null);
  assert.equal(await buildLawContextFromArticleRefs(null, { client: noClient }), null);
  assert.equal(await buildLawContextFromArticleRefs([{ lawName: "민법" }], { client: noClient }), null,
    "missing article field → null");
}

async function testBuildLawContextFailure() {
  const fakeClient = {
    async getLawArticle() {
      const error = new Error("not found");
      error.marker = "NOT_FOUND";
      throw error;
    }
  };
  const ctx = await buildLawContextFromArticleRefs(
    [{ lawName: "민법", article: "제9999조", canonical: "민법/제9999조" }],
    { client: fakeClient }
  );
  assert.ok(ctx, "context object still returned");
  assert.equal(ctx.ok, false);
  assert.equal(ctx.citations.length, 0);
  assert.ok(ctx.errorDetails.length >= 1);
}

function testMergeLawContexts() {
  const primary = {
    ok: true,
    mode: "law_article",
    citations: [
      { citationId: "L1", canonical: "민법/제750조", lawName: "민법", article: "제750조" }
    ],
    contextText: "[공식 법령 근거]\n[L1] 민법 제750조 ..."
  };
  const kg = {
    ok: true,
    mode: "kg_articles",
    citations: [
      { citationId: "L1", canonical: "민법/제750조", lawName: "민법", article: "제750조", kgDerived: true },
      { citationId: "L2", canonical: "개인정보 보호법/제15조", lawName: "개인정보 보호법", article: "제15조", kgDerived: true }
    ],
    contextText: "[지식그래프 연계 법령 근거]\n..."
  };
  const merged = mergeLawContexts(primary, kg);
  assert.equal(merged.citations.length, 2, "duplicate canonical is dropped");
  assert.equal(merged.citations[1].canonical, "개인정보 보호법/제15조");
  assert.equal(merged.citations[1].citationId, "L2", "new citation id is renumbered");
  assert.equal(merged.kgArticlesMerged, 1);
  assert.match(merged.contextText, /지식그래프 연계 법령 근거/);
  assert.match(merged.contextText, /공식 법령 근거/);

  // No KG → returns primary unchanged.
  assert.equal(mergeLawContexts(primary, null), primary);
  assert.equal(mergeLawContexts(primary, { ok: false, citations: [] }), primary);
  // No primary → returns kg.
  assert.equal(mergeLawContexts(null, kg), kg);
}
